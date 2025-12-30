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
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::api::tapps::{TappApiAccess, TappApiDef};
use crate::services::permission_service::UserRole;
use crate::services::spoof_utils::{generate_spoof_headers, SpoofConfig};
use crate::GLOBAL_DYNAMIC_CONFIG;

// ============ 全局 HTTP 客户端 ============

static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .pool_max_idle_per_host(10)
        .user_agent("Myriad-Tapp-API/1.0")
        .build()
        .expect("Failed to create HTTP client")
});

// ============ API 响应缓存 ============

struct CacheEntry {
    data: Value,
    expires_at: Instant,
}

static API_CACHE: Lazy<Arc<RwLock<HashMap<String, CacheEntry>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

// ============ 上下文类型 ============

/// API 执行上下文
#[derive(Debug, Clone)]
pub struct ApiExecutionContext {
    /// 用户 ID（负数表示游客）
    pub user_id: i32,
    /// 用户名
    pub username: String,
    /// 是否是管理员
    pub is_admin: bool,
    /// 用户角色（保留供将来使用）
    #[allow(dead_code)]
    pub role: UserRole,
    /// 客户端 IP
    pub client_ip: Option<String>,
    /// Tapp 已授权的权限
    pub granted_permissions: Vec<String>,
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
        let cache_key = Self::generate_cache_key(tapp_id, api_name, &params);
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
            "builtin" => Self::execute_builtin_api(api_def, &full_context, context).await,
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
        match api_def.access {
            TappApiAccess::Public => {
                // 公开 API，所有人可访问
                Ok(())
            }
            TappApiAccess::Protected => {
                // 受保护 API，需要 network:fetch 权限
                // 游客不能使用受保护 API
                if context.user_id < 0 {
                    return Err("Protected API requires login".to_string());
                }

                // 检查权限
                let has_permission = context
                    .granted_permissions
                    .iter()
                    .any(|p| p == "network:fetch");

                if !has_permission {
                    return Err("Permission 'network:fetch' required".to_string());
                }

                Ok(())
            }
        }
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

        // 检查是否需要注入地理位置
        let needs_geo = api_def
            .inject
            .as_ref()
            .is_some_and(|inject| inject.values().any(|v| v.contains("{{geo.")))
            || api_def
                .endpoint
                .as_ref()
                .is_some_and(|e| e.contains("{{geo."));

        if needs_geo {
            let geo = Self::get_geo_info(context.client_ip.as_deref()).await;
            inject_context.insert("geo.lat".to_string(), json!(geo.lat));
            inject_context.insert("geo.lon".to_string(), json!(geo.lon));
            inject_context.insert("geo.city".to_string(), json!(geo.city));
            inject_context.insert("geo.region".to_string(), json!(geo.region));
            inject_context.insert("geo.country".to_string(), json!(geo.country));
        }

        // 检查是否需要注入密钥
        if let Some(inject) = &api_def.inject {
            for template in inject.values() {
                if template.contains("{{secrets.") {
                    Self::inject_secrets(&mut inject_context).await?;
                    break;
                }
            }
        }

        // 检查 endpoint 是否需要密钥
        if let Some(endpoint) = &api_def.endpoint {
            if endpoint.contains("{{secrets.") {
                Self::inject_secrets(&mut inject_context).await?;
            }
        }

        Ok(inject_context)
    }

    /// 注入密钥
    async fn inject_secrets(context: &mut HashMap<String, Value>) -> Result<(), String> {
        let config = GLOBAL_DYNAMIC_CONFIG.read().await;

        // 常用 API 密钥映射
        // OpenWeatherMap
        if let Some(key) = &config.openweather_api_key {
            context.insert("secrets.OPENWEATHER_KEY".to_string(), json!(key));
        }

        // 可以根据需要添加更多密钥...

        Ok(())
    }

    /// 获取地理位置信息
    async fn get_geo_info(client_ip: Option<&str>) -> GeoInfo {
        let ip = client_ip.unwrap_or("auto");

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
                    return GeoInfo {
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
        // 支持 endpoint 或 url 字段（url 是 endpoint 的别名，向后兼容）
        let base_url = api_def
            .endpoint
            .as_ref()
            .or(api_def.url.as_ref())
            .ok_or("HTTP API requires endpoint or url")?;

        // 解析模板变量
        let mut url = Self::resolve_template(base_url, context);

        // 处理 params 字段（向后兼容旧格式）
        // 如果有 params，将其转换为 URL 查询参数
        if let Some(params) = &api_def.params {
            let mut query_parts: Vec<String> = Vec::new();
            for (key, value) in params {
                let resolved_value = Self::resolve_template(value, context);
                query_parts.push(format!(
                    "{}={}",
                    urlencoding::encode(key),
                    urlencoding::encode(&resolved_value)
                ));
            }
            if !query_parts.is_empty() {
                let separator = if url.contains('?') { "&" } else { "?" };
                url = format!("{}{}{}", url, separator, query_parts.join("&"));
            }
        }

        // 验证 URL 安全性
        Self::validate_url_security(&url)?;

        // 构建请求
        let method = reqwest::Method::from_str(&api_def.method.to_uppercase())
            .map_err(|_| format!("Invalid method: {}", api_def.method))?;

        let mut request = HTTP_CLIENT.request(method, &url);

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
                if let (Ok(name), Ok(val)) = (
                    HeaderName::from_str(key),
                    HeaderValue::from_str(&resolved_value),
                ) {
                    request = request.header(name, val);
                }
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
        let body = response
            .text()
            .await
            .map_err(|e| format!("Failed to read response: {}", e))?;

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
        api_def: &TappApiDef,
        _context: &HashMap<String, Value>,
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
                // TODO: 调用实际的 AI 服务
                Err("AI chat not implemented yet".to_string())
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
                // TODO: 调用实际的 AI 服务
                Err("AI generate not implemented yet".to_string())
            }
            _ => Err(format!("Unknown builtin API: {}", builtin)),
        }
    }

    /// 验证 URL 安全性（防止 SSRF）
    fn validate_url_security(url: &str) -> Result<(), String> {
        let parsed = reqwest::Url::parse(url).map_err(|e| format!("Invalid URL: {}", e))?;

        // 只允许 HTTP/HTTPS
        if !["http", "https"].contains(&parsed.scheme()) {
            return Err("Only HTTP/HTTPS protocols are allowed".to_string());
        }

        let host = parsed.host_str().ok_or("URL has no host")?;

        // 禁止本地地址
        if host == "localhost"
            || host == "127.0.0.1"
            || host == "::1"
            || host == "[::1]"
            || host.ends_with(".local")
            || host.ends_with(".localhost")
        {
            return Err("Localhost access is not allowed".to_string());
        }

        // 检查私有 IP
        if let Ok(ip) = host.parse::<std::net::Ipv4Addr>() {
            if ip.is_private() || ip.is_loopback() || ip.is_link_local() {
                return Err("Private network access is not allowed".to_string());
            }
            // 元数据服务
            if ip.octets()[0] == 169 && ip.octets()[1] == 254 {
                return Err("Metadata service access is not allowed".to_string());
            }
        }

        Ok(())
    }

    /// 解析模板变量 {{varName}}
    fn resolve_template(template: &str, context: &HashMap<String, Value>) -> String {
        let re = regex::Regex::new(r"\{\{([^}]+)\}\}").unwrap();
        re.replace_all(template, |caps: &regex::Captures| {
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
    fn generate_cache_key(tapp_id: &str, api_name: &str, params: &Option<Value>) -> String {
        let params_hash = params
            .as_ref()
            .map(|p| format!("{:x}", md5::compute(p.to_string())))
            .unwrap_or_else(|| "none".to_string());
        format!("tapp_api:{}:{}:{}", tapp_id, api_name, params_hash)
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
        cache.insert(
            key.to_string(),
            CacheEntry {
                data: data.clone(),
                expires_at: Instant::now() + Duration::from_secs(ttl as u64),
            },
        );

        // 清理过期缓存（简单策略：超过 1000 条时清理）
        if cache.len() > 1000 {
            let now = Instant::now();
            cache.retain(|_, entry| entry.expires_at > now);
        }
    }

    /// 列出 Tapp 可用的 API
    #[allow(dead_code)]
    pub fn list_apis(manifest: &Value) -> Vec<String> {
        manifest
            .get("apis")
            .and_then(|apis| apis.as_object())
            .map(|obj| obj.keys().cloned().collect())
            .unwrap_or_default()
    }
}
