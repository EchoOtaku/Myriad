use axum::{
    extract::Request,
    http::{header, HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use jsonwebtoken::{decode, DecodingKey, Validation};
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;

/// JWT Claims structure (must match auth.rs)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,      // User ID
    pub username: String, // Username
    pub is_admin: bool,   // ✅ 安全修复 P0: Admin status
    pub exp: i64,         // Expiration time
    pub iat: i64,         // Issued at
}

/// Authentication middleware - verifies JWT token
/// Returns 401 if token is missing or invalid
pub async fn auth_middleware(req: Request, next: Next) -> Response {
    let headers = req.headers();

    match verify_jwt_token(headers) {
        Ok(claims) => {
            // Token is valid, inject claims into request extensions
            let mut req = req;
            req.extensions_mut().insert(claims);
            next.run(req).await
        }
        Err(error_response) => *error_response,
    }
}

/// Admin-only middleware - verifies JWT token and checks admin status
/// Returns 403 if user is not an admin
///
/// ✅ SECURITY: Checks both the signed claim and the current database role.
/// Used for dangerous operations like deleting all reports
pub async fn admin_middleware(req: Request, next: Next) -> Response {
    let headers = req.headers();

    match verify_jwt_token(headers) {
        Ok(claims) => {
            if let Err((status, body)) = ensure_current_admin(&claims).await {
                tracing::warn!(
                    "⚠️  User {} (is_admin={}) attempted to access admin-only endpoint (Forbidden)",
                    claims.username,
                    claims.is_admin
                );
                return (status, body).into_response();
            }

            tracing::info!(
                "✅ Admin access granted to user: {} (is_admin=true)",
                claims.username
            );

            // ✅ 关键修复: 将 claims 注入到 request extensions 中
            // 这样后续的 Extension(claims) 提取器才能正常工作
            let mut req = req;
            req.extensions_mut().insert(claims);
            next.run(req).await
        }
        Err(error_response) => *error_response,
    }
}

/// Verify the signed admin claim against the current database state.
///
/// This prevents a demoted admin from keeping admin access until the old JWT
/// expires.
pub async fn ensure_current_admin(
    claims: &Claims,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if !claims.is_admin {
        return Err(admin_forbidden());
    }

    let user_id: i32 = claims.sub.parse().map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "Unauthorized",
                "message": "Invalid user ID in authorization token."
            })),
        )
    })?;

    let db_guard = crate::DB_CONNECTION.read().await;
    let db = db_guard.as_ref().ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "Administrator status cannot be verified."
            })),
        )
    })?;

    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT is_admin FROM users WHERE id = $1 LIMIT 1",
            [user_id.into()],
        ))
        .await
        .map_err(|e| {
            tracing::error!("Failed to verify current admin status: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Database error",
                    "message": "Administrator status cannot be verified."
                })),
            )
        })?;

    let is_admin = row
        .and_then(|r| r.try_get::<bool>("", "is_admin").ok())
        .unwrap_or(false);

    if is_admin {
        Ok(())
    } else {
        Err(admin_forbidden())
    }
}

/// Verify JWT headers and re-check the admin flag against the current database.
pub async fn verify_current_admin_from_headers(
    headers: &HeaderMap,
) -> Result<Claims, (StatusCode, Json<serde_json::Value>)> {
    let claims = verify_jwt_token(headers).map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "Unauthorized",
                "message": "Please login before using administrator functions."
            })),
        )
    })?;

    ensure_current_admin(&claims).await?;
    Ok(claims)
}

fn admin_forbidden() -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::FORBIDDEN,
        Json(json!({
            "error": "Forbidden",
            "message": "Administrator access required. Only current admin users can perform this action."
        })),
    )
}

/// 根据 IP 生成稳定的游客 ID
///
/// 使用 IP 的哈希值生成负数 ID（与正数用户 ID 区分）
/// 范围: -2147483648 到 -1
fn generate_guest_id(ip: &str) -> i32 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    ip.hash(&mut hasher);
    // 生成负数 ID（范围 -2147483647 到 -1）
    let hash = hasher.finish();
    -((hash % 2147483647) as i32 + 1)
}

/// Optional authentication middleware - allows guest access
///
/// 用于支持权限下放的 API：
/// - 如果有有效 token，验证并注入 Claims
/// - 如果没有 token 或 token 无效，注入游客 Claims
///
/// 游客 ID 策略：
/// - 基于客户端 IP 生成稳定的负数 ID
/// - 同一 IP 的游客始终获得相同的 ID
/// - 负数 ID 与正数用户 ID 区分，便于管理
///
/// 安全说明：
/// - 游客 Claims 的 is_admin 为 false
/// - API 端点需要自行检查权限（通过 TappPermissionService）
pub async fn optional_auth_middleware(req: Request, next: Next) -> Response {
    let headers = req.headers();

    let claims = match verify_jwt_token(headers) {
        Ok(claims) => claims,
        Err(_) => {
            // 无 token 或 token 无效，创建游客 Claims
            let client_ip = crate::middleware::client_ip::extract_client_ip(&req)
                .map(|ip| ip.to_string())
                .unwrap_or_else(|| "unknown".to_string());
            let guest_id = generate_guest_id(&client_ip);

            tracing::debug!(
                "🎭 Guest access from IP: {} -> Guest ID: {}",
                client_ip,
                guest_id
            );

            Claims {
                sub: guest_id.to_string(), // 负数 ID 字符串
                username: format!("guest:{}", &client_ip),
                is_admin: false,
                exp: 0,
                iat: 0,
            }
        }
    };

    let mut req = req;
    req.extensions_mut().insert(claims);
    next.run(req).await
}

/// Verify JWT token from Authorization header or Cookie
/// Verify JWT for handlers that need claims outside the middleware pipeline.
pub fn verify_jwt_token(headers: &HeaderMap) -> Result<Claims, Box<Response>> {
    // Extract token from Authorization header or Cookie (优先 Header)
    let token = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| {
            // 回退到 HttpOnly Cookie
            headers
                .get(header::COOKIE)
                .and_then(|v| v.to_str().ok())
                .and_then(|cookies| {
                    cookies.split(';').find_map(|cookie| {
                        let (name, value) = cookie.trim().split_once('=')?;
                        if name == "auth_token" {
                            Some(value)
                        } else {
                            None
                        }
                    })
                })
        })
        .ok_or_else(|| {
            tracing::debug!("Missing or invalid Authorization header/cookie");
            Box::new(
                (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({
                        "error": "Unauthorized",
                        "message": "Missing or invalid authorization token. Please login first."
                    })),
                )
                    .into_response(),
            )
        })?;

    // Get JWT secret
    let jwt_secret = env::var("JWT_SECRET").map_err(|_| {
        tracing::error!("JWT_SECRET not configured");
        Box::new(
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Server configuration error",
                    "message": "Authentication system not properly configured"
                })),
            )
                .into_response(),
        )
    })?;

    // Decode and verify token
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| {
        tracing::debug!("Invalid JWT token: {:?}", e);
        Box::new(
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "error": "Invalid token",
                    "message": "Token is invalid or expired. Please login again."
                })),
            )
                .into_response(),
        )
    })?;

    Ok(token_data.claims)
}

/// Optional authentication - extracts claims if token is present, but doesn't fail if missing
/// Useful for endpoints that behave differently for authenticated users but are also public
pub fn extract_optional_claims(headers: &HeaderMap) -> Option<Claims> {
    // 尝试从 Authorization header 或 Cookie 获取 token
    let token = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| {
            headers
                .get(header::COOKIE)
                .and_then(|v| v.to_str().ok())
                .and_then(|cookies| {
                    cookies.split(';').find_map(|cookie| {
                        let (name, value) = cookie.trim().split_once('=')?;
                        if name == "auth_token" {
                            Some(value)
                        } else {
                            None
                        }
                    })
                })
        })?;

    let jwt_secret = env::var("JWT_SECRET").ok()?;
    decode::<Claims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .ok()
    .map(|data| data.claims)
}
