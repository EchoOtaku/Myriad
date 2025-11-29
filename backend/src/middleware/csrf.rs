use axum::{
    extract::Request,
    http::{header, HeaderMap, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use rand::{distributions::Alphanumeric, Rng};
use serde_json::json;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// CSRF Token 结构
#[derive(Debug, Clone)]
struct CsrfToken {
    token: String,
    created_at: Instant,
}

/// 全局 CSRF Token 存储
/// Key: Session ID (从 Cookie 或 JWT 中提取)
static CSRF_TOKENS: once_cell::sync::Lazy<Arc<RwLock<HashMap<String, CsrfToken>>>> =
    once_cell::sync::Lazy::new(|| {
        // 启动清理任务
        let store: Arc<RwLock<HashMap<String, CsrfToken>>> = Arc::new(RwLock::new(HashMap::new()));
        let store_clone = store.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(600)); // 每10分钟清理一次
            loop {
                interval.tick().await;
                let mut tokens = store_clone.write().await;
                let now = Instant::now();
                tokens.retain(|_, csrf_token| {
                    now.duration_since(csrf_token.created_at) < Duration::from_secs(3600)
                    // Token 有效期 1 小时
                });
                tracing::debug!("CSRF tokens cleanup: {} active tokens", tokens.len());
            }
        });

        store
    });

/// 生成随机 CSRF Token
fn generate_csrf_token() -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(32)
        .map(char::from)
        .collect()
}

/// 从请求中提取会话标识符（用于关联 CSRF Token）
fn extract_session_id(headers: &HeaderMap) -> Option<String> {
    // 优先从 Authorization header 提取 JWT
    if let Some(auth_header) = headers.get("Authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(token) = auth_str.strip_prefix("Bearer ") {
                // 使用 JWT 的前 32 个字符作为会话 ID
                return Some(token.chars().take(32).collect());
            }
        }
    }

    // 回退到 Cookie
    if let Some(cookie_header) = headers.get(header::COOKIE) {
        if let Ok(cookies) = cookie_header.to_str() {
            for cookie in cookies.split(';') {
                if let Some((name, value)) = cookie.trim().split_once('=') {
                    if name == "auth_token" {
                        // 使用 Cookie Token 的前 32 个字符作为会话 ID
                        return Some(value.chars().take(32).collect());
                    }
                }
            }
        }
    }

    None
}

/// CSRF 防护中间件
/// ✅ 安全修复 P0: 验证所有状态变更请求的 CSRF Token
pub async fn csrf_middleware(req: Request, next: Next) -> Response {
    let method = req.method();
    let path = req.uri().path();

    // 只对状态变更操作（POST/PUT/PATCH/DELETE）进行 CSRF 检查
    if !matches!(
        method,
        &Method::POST | &Method::PUT | &Method::PATCH | &Method::DELETE
    ) {
        return next.run(req).await;
    }

    // 排除不需要 CSRF 保护的端点（登录、公开接口等）
    if is_csrf_exempt(path) {
        return next.run(req).await;
    }

    let headers = req.headers();

    // 提取会话 ID
    let session_id = match extract_session_id(headers) {
        Some(id) => id,
        None => {
            tracing::warn!("🚨 CSRF check failed: No session ID found");
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "error": "Unauthorized",
                    "message": "Authentication required for CSRF protection"
                })),
            )
                .into_response();
        }
    };

    // 从请求头获取 CSRF Token
    let client_token = headers
        .get("X-CSRF-Token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if client_token.is_empty() {
        tracing::warn!("🚨 CSRF check failed: Missing X-CSRF-Token header");
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "CSRF token missing",
                "message": "X-CSRF-Token header is required for state-changing operations"
            })),
        )
            .into_response();
    }

    // 验证 CSRF Token
    let tokens = CSRF_TOKENS.read().await;
    match tokens.get(&session_id) {
        Some(stored_token) => {
            // 检查 Token 是否过期
            if Instant::now().duration_since(stored_token.created_at) > Duration::from_secs(3600) {
                drop(tokens); // 释放读锁
                tracing::warn!("🚨 CSRF check failed: Token expired");
                return (
                    StatusCode::FORBIDDEN,
                    Json(json!({
                        "error": "CSRF token expired",
                        "message": "Please refresh the page and try again"
                    })),
                )
                    .into_response();
            }

            // 验证 Token 是否匹配
            if stored_token.token != client_token {
                drop(tokens); // 释放读锁
                tracing::warn!("🚨 CSRF check failed: Token mismatch");
                return (
                    StatusCode::FORBIDDEN,
                    Json(json!({
                        "error": "CSRF token invalid",
                        "message": "Invalid CSRF token. Please refresh the page and try again."
                    })),
                )
                    .into_response();
            }

            drop(tokens); // 释放读锁
            tracing::debug!("✅ CSRF check passed for {}", path);
            next.run(req).await
        }
        None => {
            drop(tokens); // 释放读锁
            tracing::warn!("🚨 CSRF check failed: No token found for session");
            (
                StatusCode::FORBIDDEN,
                Json(json!({
                    "error": "CSRF token not found",
                    "message": "No CSRF token found for this session. Please refresh the page."
                })),
            )
                .into_response()
        }
    }
}

/// 检查路径是否不需要 CSRF 保护
fn is_csrf_exempt(path: &str) -> bool {
    // 公开接口、登录接口、健康检查等不需要 CSRF 保护
    path.starts_with("/api/auth/login")
        || path.starts_with("/api/auth/logout") // 退出登录不需要 CSRF（已经在退出了）
        || path.starts_with("/api/auth/github/")
        || path.starts_with("/api/setup/")
        || path.starts_with("/health")
        || path.starts_with("/api/proxy/") // 图片代理等公开接口
        || path.starts_with("/api/ai/") // AI 推荐等公开接口
}

/// 生成并返回 CSRF Token 的接口
/// GET /api/csrf-token
pub async fn get_csrf_token(headers: HeaderMap) -> impl IntoResponse {
    let session_id = match extract_session_id(&headers) {
        Some(id) => id,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "error": "Unauthorized",
                    "message": "Authentication required to get CSRF token"
                })),
            )
                .into_response();
        }
    };

    // 生成新的 CSRF Token
    let token = generate_csrf_token();
    let csrf_token = CsrfToken {
        token: token.clone(),
        created_at: Instant::now(),
    };

    // 存储 Token
    let mut tokens = CSRF_TOKENS.write().await;
    tokens.insert(session_id, csrf_token);

    tracing::debug!("✅ CSRF token generated");

    (
        StatusCode::OK,
        Json(json!({
            "csrf_token": token
        })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_csrf_token() {
        let token1 = generate_csrf_token();
        let token2 = generate_csrf_token();

        assert_eq!(token1.len(), 32);
        assert_eq!(token2.len(), 32);
        assert_ne!(token1, token2);
    }

    #[test]
    fn test_is_csrf_exempt() {
        assert!(is_csrf_exempt("/api/auth/login"));
        assert!(is_csrf_exempt("/api/auth/github/callback"));
        assert!(is_csrf_exempt("/api/setup/init-database"));
        assert!(is_csrf_exempt("/health"));
        assert!(is_csrf_exempt("/api/proxy/image"));

        assert!(!is_csrf_exempt("/api/config"));
        assert!(!is_csrf_exempt("/api/profile/report"));
        assert!(!is_csrf_exempt("/api/auth/change-password"));
    }
}
