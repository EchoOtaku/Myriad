//! Tapp 共享基础模块
//!
//! 提供：
//! - 通用 TTL 缓存
//! - 全局 HTTP Client
//! - 平台数据缓存
//! - AI 配置缓存
//! - 速率限制器
//! - 安全验证
//! - 权限检查
//! - 性能指标

use axum::{http::StatusCode, Json};
use once_cell::sync::Lazy;
use sea_orm::{ColumnTrait, ConnectionTrait, DatabaseConnection, DbBackend, EntityTrait, QueryFilter, Statement};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::middleware::auth::Claims;
use crate::models::entities::tapps;
use crate::services::analyzer::AiProvider;
use crate::services::permission_service::{TappPermission, TappPermissionService, UserRole};
use crate::GLOBAL_DYNAMIC_CONFIG;

// ============ 通用 TTL 缓存 ============

/// 通用 TTL 缓存条目
struct CacheEntry<V> {
    value: V,
    created_at: Instant,
}

/// 通用的 TTL 缓存（线程安全）
pub struct TtlCache<V: Clone> {
    data: HashMap<String, CacheEntry<V>>,
    ttl: Duration,
}

impl<V: Clone> TtlCache<V> {
    pub fn new(ttl: Duration) -> Self {
        Self {
            data: HashMap::new(),
            ttl,
        }
    }

    pub fn get(&self, key: &str) -> Option<&V> {
        self.data.get(key).and_then(|entry| {
            if entry.created_at.elapsed() < self.ttl {
                Some(&entry.value)
            } else {
                None
            }
        })
    }

    pub fn set(&mut self, key: String, value: V) {
        self.data.insert(key, CacheEntry {
            value,
            created_at: Instant::now(),
        });
    }

    #[allow(dead_code)]
    pub fn invalidate(&mut self, key: &str) {
        self.data.remove(key);
    }

    #[allow(dead_code)]
    pub fn cleanup(&mut self) {
        self.data.retain(|_, entry| entry.created_at.elapsed() < self.ttl);
    }

    pub fn len(&self) -> usize {
        self.data.len()
    }
}

/// 单值 TTL 缓存（用于 AI 配置等全局配置）
pub struct SingleCache<V: Clone> {
    value: Option<V>,
    cached_at: Option<Instant>,
    ttl: Duration,
}

impl<V: Clone> SingleCache<V> {
    pub fn new(ttl: Duration) -> Self {
        Self {
            value: None,
            cached_at: None,
            ttl,
        }
    }

    pub fn get(&self) -> Option<V> {
        if let (Some(value), Some(cached_at)) = (&self.value, &self.cached_at) {
            if cached_at.elapsed() < self.ttl {
                return Some(value.clone());
            }
        }
        None
    }

    pub fn set(&mut self, value: V) {
        self.value = Some(value);
        self.cached_at = Some(Instant::now());
    }
}

// ============ 全局 HTTP Client ============

/// 全局 HTTP Client（复用连接池）
pub static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(Duration::from_secs(90))
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Myriad-Tapp/1.0")
        .build()
        .expect("Failed to create HTTP client")
});

// ============ 平台数据缓存 ============

/// 全局平台数据缓存（30秒 TTL）
pub static PLATFORM_CACHE: Lazy<Arc<RwLock<TtlCache<Value>>>> =
    Lazy::new(|| Arc::new(RwLock::new(TtlCache::new(Duration::from_secs(30)))));

/// 平台列表缓存（60秒 TTL）
static PLATFORM_LIST_CACHE: Lazy<Arc<RwLock<SingleCache<Vec<String>>>>> =
    Lazy::new(|| Arc::new(RwLock::new(SingleCache::new(Duration::from_secs(60)))));

/// 动态获取可用平台列表（带缓存）
pub async fn get_available_platforms() -> Vec<String> {
    // 检查缓存
    {
        let cache = PLATFORM_LIST_CACHE.read().await;
        if let Some(platforms) = cache.get() {
            return platforms;
        }
    }

    // 缓存未命中，扫描文件系统
    let cache_dir = std::path::Path::new("cache/platforms");
    let mut platforms = Vec::new();

    if let Ok(mut entries) = tokio::fs::read_dir(cache_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
            if let Some(name) = entry.file_name().to_str() {
                if name.ends_with("_filtered.json") {
                    let platform = name.trim_end_matches("_filtered.json");
                    platforms.push(platform.to_string());
                }
            }
        }
    }

    platforms.sort();

    // 更新缓存
    {
        let mut cache = PLATFORM_LIST_CACHE.write().await;
        cache.set(platforms.clone());
    }

    platforms
}

/// 验证平台名称安全性（防止路径遍历）
pub fn validate_platform_name(name: &str) -> Result<(), String> {
    if name.is_empty() || name.len() > 64 {
        return Err("Invalid platform name length".to_string());
    }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Platform name contains invalid characters".to_string());
    }
    Ok(())
}

/// 获取平台数据（带缓存，double-check locking 防止 thundering herd）
pub async fn get_cached_platform_data(platform: &str) -> Result<Value, String> {
    validate_platform_name(platform)?;
    let key = platform.to_lowercase();

    // 先检查缓存（read lock）
    {
        let cache = PLATFORM_CACHE.read().await;
        if let Some(data) = cache.get(&key) {
            return Ok(data.clone());
        }
    }

    // 缓存未命中，获取 write lock 并 double-check
    let mut cache = PLATFORM_CACHE.write().await;

    // 二次检查：其他线程可能已经填充了缓存
    if let Some(data) = cache.get(&key) {
        return Ok(data.clone());
    }

    // 确实需要从文件读取
    let cache_file = format!("cache/platforms/{}_filtered.json", key);
    let content = tokio::fs::read_to_string(&cache_file)
        .await
        .map_err(|e| format!("Failed to read cache: {}", e))?;

    let data: Value = serde_json::from_str(&content).unwrap_or(json!({ "items": [] }));
    cache.set(key, data.clone());

    Ok(data)
}

// ============ AI 配置缓存 ============

/// AI 配置信息
#[derive(Clone)]
pub struct AiConfig {
    pub provider: AiProvider,
    pub api_key: String,
    pub model: String,
    pub base_url: Option<String>,
}

/// AI 图片生成配置
#[derive(Clone)]
pub struct AiImageConfig {
    pub provider: String,
    pub model: String,
    pub width: u32,
    pub height: u32,
    pub imaginepro_api_key: Option<String>,
}

/// AI 配置缓存（5分钟 TTL）
static AI_CONFIG_CACHE: Lazy<Arc<RwLock<SingleCache<AiConfig>>>> =
    Lazy::new(|| Arc::new(RwLock::new(SingleCache::new(Duration::from_secs(300)))));

/// AI 图片配置缓存（5分钟 TTL）
static AI_IMAGE_CONFIG_CACHE: Lazy<Arc<RwLock<SingleCache<AiImageConfig>>>> =
    Lazy::new(|| Arc::new(RwLock::new(SingleCache::new(Duration::from_secs(300)))));

/// 获取 AI 配置（带缓存）
pub async fn get_ai_config() -> Result<AiConfig, (StatusCode, Json<Value>)> {
    {
        let cache = AI_CONFIG_CACHE.read().await;
        if let Some(config) = cache.get() {
            return Ok(config);
        }
    }

    let config = GLOBAL_DYNAMIC_CONFIG.read().await;

    let ai_config = {
        if let Some(key) = &config.openai_api_key {
            if !key.is_empty() {
                let model = if config.openai_model.is_empty() {
                    "gpt-4o-mini".to_string()
                } else {
                    config.openai_model.clone()
                };
                let base_url = if config.openai_base_url.is_empty() {
                    None
                } else {
                    Some(config.openai_base_url.clone())
                };
                Some(AiConfig {
                    provider: AiProvider::OpenAI,
                    api_key: key.clone(),
                    model,
                    base_url,
                })
            } else {
                None
            }
        } else {
            None
        }
    }
    .or_else(|| {
        if let Some(key) = &config.gemini_api_key {
            if !key.is_empty() {
                let model = if config.gemini_model.is_empty() {
                    "gemini-3-flash-preview".to_string()
                } else {
                    config.gemini_model.clone()
                };
                Some(AiConfig {
                    provider: AiProvider::Gemini,
                    api_key: key.clone(),
                    model,
                    base_url: None,
                })
            } else {
                None
            }
        } else {
            None
        }
    });

    match ai_config {
        Some(cfg) => {
            let mut cache = AI_CONFIG_CACHE.write().await;
            cache.set(cfg.clone());
            Ok(cfg)
        }
        None => Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "No AI provider configured" })),
        )),
    }
}

/// 获取 AI 图片生成配置（带缓存）
pub async fn get_ai_image_config() -> Result<AiImageConfig, (StatusCode, Json<Value>)> {
    {
        let cache = AI_IMAGE_CONFIG_CACHE.read().await;
        if let Some(config) = cache.get() {
            return Ok(config);
        }
    }

    let config = GLOBAL_DYNAMIC_CONFIG.read().await;
    let image_config = AiImageConfig {
        provider: config.ai_image_provider.clone(),
        model: config.ai_image_model.clone(),
        width: config.ai_image_width as u32,
        height: config.ai_image_height as u32,
        imaginepro_api_key: config.imaginepro_api_key.clone(),
    };

    let mut cache = AI_IMAGE_CONFIG_CACHE.write().await;
    cache.set(image_config.clone());
    Ok(image_config)
}

// ============ 速率限制器 ============

/// 速率限制记录
#[derive(Clone)]
struct RateLimitEntry {
    count: u32,
    window_start: Instant,
}

/// 速率限制配置（未使用但保留用于将来扩展）
#[allow(dead_code)]
struct RateLimitConfig {
    limit: u32,
    window_secs: u64,
}

/// 获取操作的速率限制配置
pub fn get_rate_limit_config(operation: &str) -> (u32, u64) {
    match operation {
        "ai.generate" | "ai.analyze" | "ai.chat" => (20, 60),
        "ai.image" => (20, 60),
        "platform.write" => (30, 60),
        "storage.set" | "storage.clear" => (100, 60),
        _ => (200, 60),
    }
}

/// Tapp 速率限制器
pub(crate) struct TappRateLimiter {
    limits: HashMap<String, RateLimitEntry>,
    last_cleanup: Instant,
}

impl TappRateLimiter {
    fn new() -> Self {
        Self {
            limits: HashMap::new(),
            last_cleanup: Instant::now(),
        }
    }

    fn check_and_record(
        &mut self,
        key: &str,
        limit: u32,
        window_secs: u64,
    ) -> (bool, u32, u64) {
        let window = Duration::from_secs(window_secs);
        let now = Instant::now();

        // 定期清理过期记录（每5分钟）
        if now.duration_since(self.last_cleanup) > Duration::from_secs(300) {
            self.limits.retain(|_, entry| now.duration_since(entry.window_start) <= window);
            self.last_cleanup = now;
        }

        let entry = self.limits.entry(key.to_string()).or_insert_with(|| RateLimitEntry {
            count: 0,
            window_start: now,
        });

        if now.duration_since(entry.window_start) > window {
            entry.count = 0;
            entry.window_start = now;
        }

        let reset_in = window
            .checked_sub(now.duration_since(entry.window_start))
            .unwrap_or_default()
            .as_secs();

        if entry.count >= limit {
            return (false, 0, reset_in);
        }

        entry.count += 1;
        (true, limit - entry.count, reset_in)
    }

    fn active_count(&self) -> usize {
        self.limits.len()
    }

    fn get_status(&self, key: &str, limit: u32, window_secs: u64) -> (u32, u32, u64) {
        let window = Duration::from_secs(window_secs);
        match self.limits.get(key) {
            Some(entry) => {
                let elapsed = entry.window_start.elapsed();
                if elapsed < window {
                    let reset_in = (window - elapsed).as_secs();
                    let remaining = limit.saturating_sub(entry.count);
                    (entry.count, remaining, reset_in)
                } else {
                    (0, limit, 0)
                }
            }
            None => (0, limit, window_secs),
        }
    }
}

/// 全局速率限制器
pub static TAPP_RATE_LIMITER: Lazy<Arc<RwLock<TappRateLimiter>>> =
    Lazy::new(|| Arc::new(RwLock::new(TappRateLimiter::new())));

/// 检查速率限制
pub async fn check_rate_limit(
    user_id: i32,
    tapp_id: &str,
    operation: &str,
) -> Result<(), (StatusCode, Json<Value>)> {
    let (limit, window_secs) = get_rate_limit_config(operation);
    let key = format!("{}:{}:{}", user_id, tapp_id, operation);

    let mut limiter = TAPP_RATE_LIMITER.write().await;
    let (allowed, remaining, reset_in) = limiter.check_and_record(&key, limit, window_secs);

    if !allowed {
        tracing::warn!(
            user_id = user_id,
            tapp_id = tapp_id,
            operation = operation,
            "[TAPP] Rate limit exceeded"
        );
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({
                "error": "Rate limit exceeded",
                "code": "RATE_LIMIT_EXCEEDED",
                "retryAfter": reset_in,
                "limit": limit,
                "remaining": remaining
            })),
        ));
    }

    Ok(())
}

/// 获取速率限制状态（只读，不记录）
pub async fn get_rate_limit_status_for(user_id: i32, tapp_id: &str, operation: &str) -> (u32, u32, u64) {
    let (limit, window_secs) = get_rate_limit_config(operation);
    let key = format!("{}:{}:{}", user_id, tapp_id, operation);
    let limiter = TAPP_RATE_LIMITER.read().await;
    limiter.get_status(&key, limit, window_secs)
}

pub async fn get_rate_limiter_active_count() -> usize {
    let limiter = TAPP_RATE_LIMITER.read().await;
    limiter.active_count()
}

// ============ 性能指标 ============

/// API 调用指标
pub struct ApiMetrics {
    operations: HashMap<String, (u64, u64, u64)>,
    last_reset: Instant,
}

impl ApiMetrics {
    fn new() -> Self {
        Self {
            operations: HashMap::new(),
            last_reset: Instant::now(),
        }
    }

    pub fn record(&mut self, operation: &str, duration_ms: u64, is_error: bool) {
        let entry = self.operations.entry(operation.to_string()).or_insert((0, 0, 0));
        entry.0 += 1;
        entry.1 += duration_ms;
        if is_error {
            entry.2 += 1;
        }
    }

    pub fn get_summary(&self) -> Value {
        let uptime = self.last_reset.elapsed().as_secs();
        let mut ops: Vec<Value> = self.operations.iter().map(|(op, (count, total_ms, errors))| {
            json!({
                "operation": op,
                "count": count,
                "avgMs": if *count > 0 { total_ms / count } else { 0 },
                "errors": errors,
                "errorRate": if *count > 0 {
                    format!("{:.2}%", (*errors as f64 / *count as f64) * 100.0)
                } else {
                    "0%".to_string()
                }
            })
        }).collect();
        ops.sort_by(|a, b| {
            b.get("count").and_then(|v| v.as_u64()).unwrap_or(0)
                .cmp(&a.get("count").and_then(|v| v.as_u64()).unwrap_or(0))
        });
        json!({ "uptimeSeconds": uptime, "operations": ops })
    }

    pub fn reset(&mut self) {
        self.operations.clear();
        self.last_reset = Instant::now();
    }
}

/// 全局指标收集器
pub static API_METRICS: Lazy<Arc<RwLock<ApiMetrics>>> =
    Lazy::new(|| Arc::new(RwLock::new(ApiMetrics::new())));

/// 记录 API 调用指标
pub async fn record_metric(operation: &str, duration_ms: u64, is_error: bool) {
    let mut metrics = API_METRICS.write().await;
    metrics.record(operation, duration_ms, is_error);
}

// ============ 安全验证 ============

/// 获取管理员用户 ID（使用参数化查询）
pub async fn get_admin_user_id(db: &DatabaseConnection) -> Result<i32, (StatusCode, Json<Value>)> {
    let result = db
        .query_one(Statement::from_string(
            DbBackend::Postgres,
            "SELECT id FROM users WHERE is_admin = true LIMIT 1".to_string(),
        ))
        .await
        .map_err(|e| {
            tracing::error!("[TAPP] Database error fetching admin ID: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Database error" })))
        })?
        .ok_or_else(|| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "No admin user found" })))
        })?;

    result.try_get::<i32>("", "id").map_err(|e| {
        tracing::error!("[TAPP] Error parsing admin ID: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Database error" })))
    })
}

/// 验证用户是否有权访问指定的 Tapp
pub async fn verify_tapp_ownership(
    db: &DatabaseConnection,
    user_id: i32,
    tapp_id: &str,
) -> Result<(), (StatusCode, Json<Value>)> {
    let admin_id = get_admin_user_id(db).await?;
    let is_guest = user_id < 0;

    if is_guest {
        let admin_tapp = tapps::Entity::find()
            .filter(tapps::Column::TappId.eq(tapp_id))
            .filter(tapps::Column::UserId.eq(admin_id))
            .one(db)
            .await
            .map_err(|e| {
                tracing::error!("[TAPP] Database error in ownership verification: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Database error" })))
            })?;

        if admin_tapp.is_none() {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({ "error": "Access denied", "message": "This Tapp is not available for guest access" })),
            ));
        }
        return Ok(());
    }

    // 普通用户：检查自己拥有的 Tapp 或管理员的公开 Tapp
    let tapp = tapps::Entity::find()
        .filter(tapps::Column::TappId.eq(tapp_id))
        .filter(
            tapps::Column::UserId.eq(user_id).or(tapps::Column::UserId.eq(admin_id)),
        )
        .one(db)
        .await
        .map_err(|e| {
            tracing::error!("[TAPP] Database error in ownership verification: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Database error" })))
        })?;

    if tapp.is_none() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({ "error": "Access denied", "message": "You do not have permission to access this Tapp" })),
        ));
    }

    Ok(())
}

/// 从 Claims 解析 user_id
pub fn parse_user_id(claims: &Claims) -> Result<i32, (StatusCode, Json<Value>)> {
    claims.sub.parse().map_err(|_| {
        (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid user ID" })))
    })
}

/// 检查用户是否拥有特定 Tapp 权限
pub async fn check_tapp_permission(
    claims: &Claims,
    permission: TappPermission,
) -> Result<(), (StatusCode, Json<Value>)> {
    let role = if claims.is_admin {
        UserRole::Admin
    } else if let Ok(user_id) = claims.sub.parse::<i32>() {
        if user_id < 0 { UserRole::Guest } else { UserRole::User }
    } else {
        UserRole::Guest
    };

    let config = GLOBAL_DYNAMIC_CONFIG.read().await;
    let has_permission = TappPermissionService::check(&config, role, permission);
    drop(config);

    if !has_permission {
        let perm_name = permission.as_str();
        tracing::warn!(
            user_id = %claims.sub,
            permission = %perm_name,
            role = ?role,
            "[TAPP] Permission denied"
        );
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Permission denied",
                "message": format!("You do not have the '{}' permission", perm_name),
                "code": "PERMISSION_DENIED"
            })),
        ));
    }

    Ok(())
}

// ============ Prompt 安全验证 ============

/// 验证提示词安全性（后端层）
pub fn validate_prompt_security(prompt: &str) -> Option<String> {
    let prompt_lower = prompt.to_lowercase();

    let role_override_patterns = [
        "ignore previous", "ignore all previous", "ignore above",
        "forget your instructions", "you are now", "new instructions:",
        "system prompt:", "[system]", "disregard",
    ];
    for pattern in role_override_patterns {
        if prompt_lower.contains(pattern) {
            return Some("Role override attempt detected".to_string());
        }
    }

    let jailbreak_patterns = [
        "jailbreak", "dan mode", "developer mode",
        "bypass safety", "bypass filter", "uncensored mode",
    ];
    for pattern in jailbreak_patterns {
        if prompt_lower.contains(pattern) {
            return Some("Jailbreak attempt detected".to_string());
        }
    }

    if prompt_lower.contains("api_key") || prompt_lower.contains("api-key")
        || prompt_lower.contains("apikey") || prompt_lower.contains("private_key")
        || prompt_lower.contains("secret_key") || prompt_lower.contains("access_token")
    {
        return Some("Sensitive information probe detected".to_string());
    }

    let mut prev_char = '\0';
    let mut repeat_count = 0;
    for c in prompt.chars() {
        if c == prev_char {
            repeat_count += 1;
            if repeat_count > 50 {
                return Some("Abnormal character repetition detected".to_string());
            }
        } else {
            prev_char = c;
            repeat_count = 0;
        }
    }

    None
}

/// 验证图片提示词安全性
pub fn validate_image_prompt_security(prompt: &str) -> Option<String> {
    let prompt_lower = prompt.to_lowercase();

    let nsfw_patterns = [
        "nude", "naked", "nsfw", "porn", "xxx", "hentai", "explicit", "sexual", "erotic", "fetish",
    ];
    for pattern in &nsfw_patterns {
        if prompt_lower.contains(pattern) {
            return Some(format!("NSFW content detected: {}", pattern));
        }
    }

    let violence_patterns = [
        "gore", "blood", "murder", "torture", "mutilation", "dismember", "decapitat",
    ];
    for pattern in &violence_patterns {
        if prompt_lower.contains(pattern) {
            return Some(format!("Violent content detected: {}", pattern));
        }
    }

    None
}
