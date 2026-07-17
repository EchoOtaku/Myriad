//! Tapp API 执行服务
//!
//! 负责：
//! 1. 解析 Tapp manifest 中的 API 声明
//! 2. 执行 API 调用（HTTP 或内置）
//! 3. 自动注入上下文（geo、user、secrets）
//! 4. 权限检查（public vs protected）
//! 5. 响应缓存
//! 6. 区域伪装（绕过地区限制）

use once_cell::sync::Lazy;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::str::FromStr;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::api::tapp_runtime::common::HTTP_CLIENT;
use crate::api::tapp_store::{TappAiOperation, TappApiAccess, TappApiDef};
use crate::services::permission_service::UserRole;
use crate::services::spoof_utils::{generate_spoof_headers, SpoofConfig};

// 预编译模板变量正则，避免每次调用都重新编译
static TEMPLATE_RE: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"\{\{([^}]+)\}\}").expect("Invalid template regex"));

// Geo 信息缓存（按 IP，10分钟 TTL）
static GEO_CACHE: Lazy<RwLock<HashMap<String, (GeoInfo, Instant)>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

const GEO_CACHE_TTL: Duration = Duration::from_secs(600);
const MAX_GEO_CACHE_ENTRIES: usize = 2048;

// ============ API 响应缓存 ============

struct CacheEntry {
    data: Value,
    expires_at: Instant,
    cached_at: Instant,
}

static API_CACHE: Lazy<RwLock<HashMap<String, CacheEntry>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));
const MAX_API_CACHE_ENTRIES: usize = 2048;
const MAX_TAPP_HTTP_RESPONSE_BYTES: usize = 2 * 1024 * 1024;

// ============ 上下文类型 ============

/// API 执行上下文
#[derive(Debug, Clone)]
pub struct ApiExecutionContext {
    /// 用户 ID（负数表示游客）
    pub user_id: i32,
    /// Manifest 所属安装 owner；共享管理员 Tapp 与用户 Tapp 不能共用响应缓存。
    pub owner_id: i32,
    /// 用户名
    pub username: String,
    /// 是否是管理员
    pub is_admin: bool,
    /// 客户端 IP
    pub client_ip: Option<String>,
    /// Tapp 已授权的权限
    pub granted_permissions: Vec<String>,
    /// Manifest AI model tier used by governed builtin adapters.
    pub ai_model_tier: Option<crate::config::ModelTier>,
}

/// 地理位置信息
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GeoInfo {
    pub lat: f64,
    pub lon: f64,
    pub city: String,
    pub region: String,
    pub country: String,
}

/// API 执行结果
#[derive(Debug, Serialize)]
pub struct ApiExecutionResult {
    pub success: bool,
    pub data: Option<Value>,
    pub error: Option<String>,
    pub cached: bool,
}

// ============ Tapp API 服务 ============

pub struct TappApiService;

impl TappApiService {
    /// 执行 Tapp API 调用
    ///
    /// # 参数
    /// - `tapp_id`: Tapp ID
    /// - `api_name`: API 名称（在 manifest.apis 中定义的 key）
    /// - `api_def`: API 定义
    /// - `params`: 前端传入的参数
    /// - `context`: 执行上下文
    ///
    /// # 返回
    /// API 执行结果
    pub async fn execute(
        tapp_id: &str,
        api_name: &str,
        api_def: &TappApiDef,
        params: Option<Value>,
        context: &ApiExecutionContext,
    ) -> ApiExecutionResult {
        // 1. 权限检查
        if let Err(e) = Self::check_permission(api_def, context).await {
            return ApiExecutionResult {
                success: false,
                data: None,
                error: Some(e),
                cached: false,
            };
        }

        // 2. 检查缓存
        let cache_key = Self::generate_cache_key(tapp_id, api_name, api_def, &params, context);
        if api_def.cache_ttl > 0 {
            if let Some(cached) = Self::get_cached(&cache_key).await {
                return ApiExecutionResult {
                    success: true,
                    data: Some(cached),
                    error: None,
                    cached: true,
                };
            }
        }

        // 3. 构建注入上下文
        let inject_context = match Self::build_inject_context(api_def, context).await {
            Ok(ctx) => ctx,
            Err(e) => {
                return ApiExecutionResult {
                    success: false,
                    data: None,
                    error: Some(e),
                    cached: false,
                };
            }
        };

        // 4. 合并前端参数
        let mut full_context = inject_context;
        if let Some(params) = params {
            if let Some(obj) = params.as_object() {
                for (k, v) in obj {
                    full_context.insert(format!("params.{}", k), v.clone());
                }
            }
        }

        // 5. 执行 API
        let result = match api_def.api_type.as_str() {
            "http" => Self::execute_http_api(api_def, &full_context).await,
            "builtin" => Self::execute_builtin_api(tapp_id, api_def, &full_context, context).await,
            _ => Err(format!("Unknown API type: {}", api_def.api_type)),
        };

        match result {
            Ok(data) => {
                // 缓存结果
                if api_def.cache_ttl > 0 {
                    Self::set_cached(&cache_key, &data, api_def.cache_ttl).await;
                }

                ApiExecutionResult {
                    success: true,
                    data: Some(data),
                    error: None,
                    cached: false,
                }
            }
            Err(e) => ApiExecutionResult {
                success: false,
                data: None,
                error: Some(e),
                cached: false,
            },
        }
    }

    /// 权限检查
    async fn check_permission(
        api_def: &TappApiDef,
        context: &ApiExecutionContext,
    ) -> Result<(), String> {
        if api_def.api_type == "http"
            && !context
                .granted_permissions
                .iter()
                .any(|permission| permission == "network:fetch")
        {
            return Err("Permission 'network:fetch' required".to_string());
        }

        if api_def.access == TappApiAccess::Protected && context.user_id < 0 {
            return Err("Protected API requires login".to_string());
        }

        Ok(())
    }

    /// 构建注入上下文
    async fn build_inject_context(
        api_def: &TappApiDef,
        context: &ApiExecutionContext,
    ) -> Result<HashMap<String, Value>, String> {
        let mut inject_context: HashMap<String, Value> = HashMap::new();

        // 添加用户上下文
        inject_context.insert("user.id".to_string(), json!(context.user_id));
        inject_context.insert("user.username".to_string(), json!(context.username));
        inject_context.insert("user.isAdmin".to_string(), json!(context.is_admin));

        // Every templated HTTP surface can consume host context. Inspect them
        // all so direct references in headers/body do not resolve to empty
        // strings merely because endpoint itself has no placeholder.
        let needs_geo = Self::api_uses_template_prefix(api_def, "{{geo.");

        if needs_geo {
            let geo = Self::get_geo_info(context.client_ip.as_deref()).await;
            inject_context.insert("geo.lat".to_string(), json!(geo.lat));
            inject_context.insert("geo.lon".to_string(), json!(geo.lon));
            inject_context.insert("geo.city".to_string(), json!(geo.city));
            inject_context.insert("geo.region".to_string(), json!(geo.region));
            inject_context.insert("geo.country".to_string(), json!(geo.country));
        }

        if Self::api_uses_template_prefix(api_def, "{{secrets.") {
            return Err("Host secret templates are not available to Tapps".to_string());
        }

        Self::apply_inject_aliases(api_def.inject.as_ref(), &mut inject_context);

        Ok(inject_context)
    }

    fn api_uses_template_prefix(api_def: &TappApiDef, prefix: &str) -> bool {
        api_def.endpoint.iter().any(|value| value.contains(prefix))
            || api_def
                .headers
                .iter()
                .flat_map(|values| values.values())
                .any(|value| value.contains(prefix))
            || api_def
                .inject
                .iter()
                .flat_map(|values| values.values())
                .any(|value| value.contains(prefix))
            || api_def
                .body
                .as_ref()
                .is_some_and(|body| Self::json_contains_template_prefix(body, prefix))
    }

    fn json_contains_template_prefix(value: &Value, prefix: &str) -> bool {
        match value {
            Value::String(value) => value.contains(prefix),
            Value::Array(values) => values
                .iter()
                .any(|value| Self::json_contains_template_prefix(value, prefix)),
            Value::Object(values) => values
                .values()
                .any(|value| Self::json_contains_template_prefix(value, prefix)),
            _ => false,
        }
    }

    fn apply_inject_aliases(
        aliases: Option<&HashMap<String, String>>,
        context: &mut HashMap<String, Value>,
    ) {
        let Some(aliases) = aliases else {
            return;
        };
        // Resolve every alias from the same host context snapshot. This keeps
        // behavior deterministic and prevents HashMap iteration order from
        // turning alias-to-alias chains into an accidental API contract.
        let source = context.clone();
        for (alias, template) in aliases {
            let value = Self::resolve_json_templates(&Value::String(template.clone()), &source);
            context.insert(alias.clone(), value);
        }
    }

    /// 获取地理位置信息（带缓存）
    async fn get_geo_info(client_ip: Option<&str>) -> GeoInfo {
        let ip = client_ip.unwrap_or("auto");

        // 检查缓存
        {
            let cache = GEO_CACHE.read().await;
            if let Some((geo, cached_at)) = cache.get(ip) {
                if cached_at.elapsed() < GEO_CACHE_TTL {
                    return geo.clone();
                }
            }
        }

        // 检查是否为本地/内网 IP
        let is_local = ip == "auto"
            || ip == "127.0.0.1"
            || ip == "::1"
            || ip.starts_with("192.168.")
            || ip.starts_with("10.")
            || ip.starts_with("172.16.")
            || ip.starts_with("172.17.")
            || ip.starts_with("172.18.")
            || ip.starts_with("172.19.")
            || ip.starts_with("172.20.")
            || ip.starts_with("172.21.")
            || ip.starts_with("172.22.")
            || ip.starts_with("172.23.")
            || ip.starts_with("172.24.")
            || ip.starts_with("172.25.")
            || ip.starts_with("172.26.")
            || ip.starts_with("172.27.")
            || ip.starts_with("172.28.")
            || ip.starts_with("172.29.")
            || ip.starts_with("172.30.")
            || ip.starts_with("172.31.");

        let target_ip = if is_local {
            // 获取服务器公网 IP
            if let Ok(resp) = HTTP_CLIENT
                .get("https://api.ipify.org?format=json")
                .send()
                .await
            {
                if let Ok(data) = resp.json::<Value>().await {
                    data.get("ip")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                } else {
                    None
                }
            } else {
                None
            }
        } else {
            Some(ip.to_string())
        };

        let target_ip = target_ip.unwrap_or_else(|| "auto".to_string());

        // 使用 ip-api.com 获取地理位置
        let url = format!(
            "http://ip-api.com/json/{}?fields=status,lat,lon,city,regionName,country",
            if target_ip == "auto" { "" } else { &target_ip }
        );

        if let Ok(resp) = HTTP_CLIENT.get(&url).send().await {
            if let Ok(data) = resp.json::<Value>().await {
                if data.get("status").and_then(|s| s.as_str()) == Some("success") {
                    let geo = GeoInfo {
                        lat: data.get("lat").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        lon: data.get("lon").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        city: data
                            .get("city")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        region: data
                            .get("regionName")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                        country: data
                            .get("country")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string(),
                    };
                    let mut cache = GEO_CACHE.write().await;
                    cache.retain(|_, (_, cached_at)| cached_at.elapsed() < GEO_CACHE_TTL);
                    while cache.len() >= MAX_GEO_CACHE_ENTRIES {
                        let Some(oldest) = cache
                            .iter()
                            .min_by_key(|(_, (_, cached_at))| *cached_at)
                            .map(|(key, _)| key.clone())
                        else {
                            break;
                        };
                        cache.remove(&oldest);
                    }
                    cache.insert(ip.to_string(), (geo.clone(), Instant::now()));
                    return geo;
                }
            }
        }

        GeoInfo::default()
    }

    /// 执行 HTTP API
    async fn execute_http_api(
        api_def: &TappApiDef,
        context: &HashMap<String, Value>,
    ) -> Result<Value, String> {
        let base_url = api_def
            .endpoint
            .as_ref()
            .ok_or("HTTP API requires endpoint")?;

        // 解析模板变量
        let url = Self::resolve_template(base_url, context);

        // 构建请求
        let method = reqwest::Method::from_str(&api_def.method.to_uppercase())
            .map_err(|_| format!("Invalid method: {}", api_def.method))?;
        let (target_url, client) = crate::services::outbound_security::build_public_http_client(
            &url,
            Duration::from_secs(30),
            Some("Myriad-Tapp/1.0 (declared-api)"),
        )
        .await?;
        let mut request = client.request(method, target_url);

        // 应用区域伪装（如果配置了 spoof 参数）
        if let Some(spoof_region) = &api_def.spoof {
            let spoof_config = SpoofConfig::new(spoof_region);
            let spoof_headers = generate_spoof_headers(&spoof_config);

            // 应用伪装请求头
            let mut header_map = HeaderMap::new();
            spoof_headers.apply_to(&mut header_map);

            for (name, value) in header_map.iter() {
                request = request.header(name.clone(), value.clone());
            }

            tracing::debug!(
                "Applied spoof headers for region '{}' to {}",
                spoof_region,
                url
            );
        }

        // 添加用户定义的请求头（会覆盖伪装头）
        if let Some(headers) = &api_def.headers {
            for (key, value) in headers {
                let resolved_value = Self::resolve_template(value, context);
                let name = HeaderName::from_str(key)
                    .map_err(|_| format!("Invalid HTTP header name: {key}"))?;
                crate::services::outbound_security::validate_outbound_header(&name)?;
                let value = HeaderValue::from_str(&resolved_value)
                    .map_err(|_| format!("Invalid HTTP header value: {key}"))?;
                request = request.header(name, value);
            }
        }

        // 添加请求体
        if let Some(body) = &api_def.body {
            let resolved_body = Self::resolve_json_templates(body, context);
            request = request.json(&resolved_body);
        }

        // 发送请求
        let response = request
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?;

        let status = response.status();
        let body = crate::services::outbound_security::read_limited_body(
            response,
            MAX_TAPP_HTTP_RESPONSE_BYTES,
        )
        .await?;
        let body = String::from_utf8_lossy(&body).into_owned();

        // 尝试解析为 JSON
        let data = serde_json::from_str::<Value>(&body).unwrap_or_else(|_| json!({ "text": body }));

        if status.is_success() {
            Ok(data)
        } else {
            Err(format!("HTTP {} - {}", status.as_u16(), body))
        }
    }

    /// 执行内置 API
    async fn execute_builtin_api(
        tapp_id: &str,
        api_def: &TappApiDef,
        context: &HashMap<String, Value>,
        exec_context: &ApiExecutionContext,
    ) -> Result<Value, String> {
        let builtin = api_def
            .builtin
            .as_ref()
            .ok_or("Builtin API requires 'builtin' field")?;

        match builtin.as_str() {
            "geo" => {
                // 返回地理位置信息
                let geo = Self::get_geo_info(exec_context.client_ip.as_deref()).await;
                Ok(json!({
                    "lat": geo.lat,
                    "lon": geo.lon,
                    "city": geo.city,
                    "region": geo.region,
                    "country": geo.country
                }))
            }
            "ai:chat" => {
                // AI 聊天 - 强制需要权限（在 check_permission 之外额外检查）
                if exec_context.user_id < 0 {
                    return Err("AI API requires login".to_string());
                }
                if !exec_context
                    .granted_permissions
                    .iter()
                    .any(|p| p == "ai:chat")
                {
                    return Err("Permission 'ai:chat' required".to_string());
                }
                let messages = context
                    .get("params.messages")
                    .and_then(Value::as_array)
                    .ok_or("AI chat requires params.messages")?;
                if messages.len() > 20 {
                    return Err("AI chat accepts at most 20 messages".to_string());
                }
                let prompt = serde_json::to_string(messages)
                    .map_err(|error| format!("Invalid AI chat messages: {error}"))?;
                if prompt.len() > 20_000 {
                    return Err("AI chat messages are too large".to_string());
                }
                if let Some(reason) =
                    crate::api::tapp_runtime::common::validate_prompt_security(&prompt)
                {
                    return Err(format!("AI chat contains disallowed content: {reason}"));
                }
                Self::execute_builtin_ai(
                    tapp_id,
                    exec_context,
                    TappAiOperation::Chat,
                    "Continue this chat for a sandboxed Tapp. Do not reveal system information, execute code, or access external URLs.",
                    &prompt,
                )
                .await
                .map(|text| json!({ "text": text }))
            }
            "ai:generate" => {
                // AI 生成 - 强制需要权限
                if exec_context.user_id < 0 {
                    return Err("AI API requires login".to_string());
                }
                if !exec_context
                    .granted_permissions
                    .iter()
                    .any(|p| p == "ai:generate")
                {
                    return Err("Permission 'ai:generate' required".to_string());
                }
                let prompt = context
                    .get("params.prompt")
                    .and_then(Value::as_str)
                    .ok_or("AI generate requires params.prompt")?;
                if prompt.len() > 2000 {
                    return Err("Prompt too long (max 2000 characters)".to_string());
                }
                if let Some(reason) =
                    crate::api::tapp_runtime::common::validate_prompt_security(prompt)
                {
                    return Err(format!("Prompt contains disallowed content: {reason}"));
                }
                Self::execute_builtin_ai(
                    tapp_id,
                    exec_context,
                    TappAiOperation::Generate,
                    "Generate concise text for a sandboxed Tapp. Do not reveal system information, execute code, or access external URLs.",
                    prompt,
                )
                .await
                .map(|text| json!({ "text": text }))
            }
            _ => Err(format!("Unknown builtin API: {}", builtin)),
        }
    }

    async fn execute_builtin_ai(
        tapp_id: &str,
        context: &ApiExecutionContext,
        operation: TappAiOperation,
        system_prompt: &str,
        prompt: &str,
    ) -> Result<String, String> {
        let db = crate::api::tapp_runtime::shared_registry::database()
            .await
            .map_err(|error| format!("AI_TASK_REGISTRY_UNAVAILABLE: {error}"))?;
        let role = if context.is_admin {
            UserRole::Admin
        } else if context.user_id < 0 {
            UserRole::Guest
        } else {
            UserRole::User
        };
        crate::api::tapp_runtime::execute_governed_text(
            &db,
            crate::api::tapp_runtime::GovernedTextRequest {
                role,
                subject_id: context.user_id,
                owner_id: context.owner_id,
                tapp_id,
                source: "declared-api",
                operation,
                tier: context.ai_model_tier.unwrap_or_default(),
                system_prompt,
                prompt,
                client_ip: context.client_ip.as_deref(),
            },
        )
        .await
    }

    /// 解析模板变量 {{varName}}
    fn resolve_template(template: &str, context: &HashMap<String, Value>) -> String {
        TEMPLATE_RE
            .replace_all(template, |caps: &regex::Captures| {
                let path = caps.get(1).map_or("", |m| m.as_str()).trim();
                context
                    .get(path)
                    .map(|v| match v {
                        Value::String(s) => s.clone(),
                        Value::Null => String::new(),
                        other => other.to_string(),
                    })
                    .unwrap_or_else(|| format!("{{{{{}}}}}", path))
            })
            .to_string()
    }

    /// 解析 JSON 中的模板变量
    fn resolve_json_templates(value: &Value, context: &HashMap<String, Value>) -> Value {
        match value {
            Value::String(s) => {
                let trimmed = s.trim();
                if trimmed.starts_with("{{")
                    && trimmed.ends_with("}}")
                    && trimmed.matches("{{").count() == 1
                {
                    let path = &trimmed[2..trimmed.len() - 2].trim();
                    if let Some(val) = context.get(*path) {
                        return val.clone();
                    }
                }
                Value::String(Self::resolve_template(s, context))
            }
            Value::Object(map) => {
                let new_map: serde_json::Map<String, Value> = map
                    .iter()
                    .map(|(k, v)| (k.clone(), Self::resolve_json_templates(v, context)))
                    .collect();
                Value::Object(new_map)
            }
            Value::Array(arr) => Value::Array(
                arr.iter()
                    .map(|v| Self::resolve_json_templates(v, context))
                    .collect(),
            ),
            other => other.clone(),
        }
    }

    /// 生成缓存 key
    fn generate_cache_key(
        tapp_id: &str,
        api_name: &str,
        api_def: &TappApiDef,
        params: &Option<Value>,
        context: &ApiExecutionContext,
    ) -> String {
        let params_hash = params
            .as_ref()
            .map(|params| format!("{:x}", Sha256::digest(params.to_string().as_bytes())))
            .unwrap_or_else(|| "none".to_string());
        let ip_hash = context
            .client_ip
            .as_ref()
            .map(|ip| format!("{:x}", Sha256::digest(ip.as_bytes())))
            .unwrap_or_else(|| "none".to_string());
        let username_hash = format!("{:x}", Sha256::digest(context.username.as_bytes()));
        let definition = serde_json::to_vec(api_def).unwrap_or_default();
        let definition_hash = format!("{:x}", Sha256::digest(definition));
        format!(
            "tapp_api:{}:{}:{}:{}:{}:{}:{}:{}:{}",
            tapp_id,
            context.owner_id,
            context.user_id,
            username_hash,
            context.is_admin,
            ip_hash,
            api_name,
            definition_hash,
            params_hash
        )
    }

    /// 获取缓存
    async fn get_cached(key: &str) -> Option<Value> {
        let cache = API_CACHE.read().await;
        cache.get(key).and_then(|entry| {
            if entry.expires_at > Instant::now() {
                Some(entry.data.clone())
            } else {
                None
            }
        })
    }

    /// 设置缓存
    async fn set_cached(key: &str, data: &Value, ttl: u32) {
        let mut cache = API_CACHE.write().await;
        let now = Instant::now();
        cache.retain(|_, entry| entry.expires_at > now);
        while cache.len() >= MAX_API_CACHE_ENTRIES {
            let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, entry)| entry.cached_at)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            cache.remove(&oldest);
        }
        cache.insert(
            key.to_string(),
            CacheEntry {
                data: data.clone(),
                expires_at: now + Duration::from_secs(ttl as u64),
                cached_at: now,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn api_def() -> TappApiDef {
        TappApiDef {
            access: TappApiAccess::Protected,
            api_type: "http".to_string(),
            endpoint: Some("https://example.com".to_string()),
            method: "GET".to_string(),
            headers: None,
            body: None,
            builtin: None,
            inject: None,
            cache_ttl: 0,
            spoof: None,
            description: None,
        }
    }

    fn context(user_id: i32, ip: &str) -> ApiExecutionContext {
        ApiExecutionContext {
            user_id,
            owner_id: user_id,
            username: format!("user-{user_id}"),
            is_admin: false,
            client_ip: Some(ip.to_string()),
            granted_permissions: Vec::new(),
            ai_model_tier: None,
        }
    }

    #[tokio::test]
    async fn public_http_api_still_requires_network_permission() {
        let mut api = api_def();
        api.access = TappApiAccess::Public;
        let mut execution_context = context(1, "203.0.113.1");

        assert!(TappApiService::check_permission(&api, &execution_context)
            .await
            .is_err());

        execution_context
            .granted_permissions
            .push("network:fetch".to_string());
        assert!(TappApiService::check_permission(&api, &execution_context)
            .await
            .is_ok());
    }

    #[test]
    fn declared_api_cache_isolated_by_user_and_client_context() {
        let params = Some(json!({ "query": "same" }));
        let first = TappApiService::generate_cache_key(
            "com.example.app",
            "profile",
            &api_def(),
            &params,
            &context(1, "203.0.113.1"),
        );
        let other_user = TappApiService::generate_cache_key(
            "com.example.app",
            "profile",
            &api_def(),
            &params,
            &context(2, "203.0.113.1"),
        );
        let other_ip = TappApiService::generate_cache_key(
            "com.example.app",
            "profile",
            &api_def(),
            &params,
            &context(1, "203.0.113.2"),
        );

        assert_ne!(first, other_user);
        assert_ne!(first, other_ip);
    }

    #[test]
    fn declared_api_cache_changes_with_owner_and_definition() {
        let params = Some(json!({ "query": "same" }));
        let base = api_def();
        let first_context = context(1, "203.0.113.1");
        let first = TappApiService::generate_cache_key(
            "com.example.app",
            "profile",
            &base,
            &params,
            &first_context,
        );

        let mut other_owner = first_context.clone();
        other_owner.owner_id = 99;
        let owner_key = TappApiService::generate_cache_key(
            "com.example.app",
            "profile",
            &base,
            &params,
            &other_owner,
        );

        let mut elevated = first_context.clone();
        elevated.is_admin = true;
        let role_key = TappApiService::generate_cache_key(
            "com.example.app",
            "profile",
            &base,
            &params,
            &elevated,
        );

        let mut changed = base.clone();
        changed.endpoint = Some("https://changed.example".to_string());
        let definition_key = TappApiService::generate_cache_key(
            "com.example.app",
            "profile",
            &changed,
            &params,
            &first_context,
        );

        assert_ne!(first, owner_key);
        assert_ne!(first, role_key);
        assert_ne!(first, definition_key);
    }

    #[test]
    fn declared_api_inject_aliases_preserve_host_value_types() {
        let mut values = HashMap::from([
            ("geo.city".to_string(), json!("Tokyo")),
            ("user.id".to_string(), json!(42)),
        ]);
        let aliases = HashMap::from([
            ("city".to_string(), "{{geo.city}}".to_string()),
            ("viewerId".to_string(), "{{user.id}}".to_string()),
            (
                "label".to_string(),
                "city={{geo.city}} user={{user.id}}".to_string(),
            ),
        ]);

        TappApiService::apply_inject_aliases(Some(&aliases), &mut values);

        assert_eq!(values.get("city"), Some(&json!("Tokyo")));
        assert_eq!(values.get("viewerId"), Some(&json!(42)));
        assert_eq!(values.get("label"), Some(&json!("city=Tokyo user=42")));
    }

    #[test]
    fn declared_api_scans_every_templated_http_surface() {
        let mut api = api_def();
        api.endpoint = Some("https://example.com".to_string());
        api.headers = Some(HashMap::from([(
            "X-City".to_string(),
            "{{geo.city}}".to_string(),
        )]));
        api.body = Some(json!({ "token": "{{secrets.OPENWEATHER_KEY}}" }));

        assert!(TappApiService::api_uses_template_prefix(&api, "{{geo."));
        assert!(TappApiService::api_uses_template_prefix(&api, "{{secrets."));
        assert!(!TappApiService::api_uses_template_prefix(&api, "{{user."));
    }
}
