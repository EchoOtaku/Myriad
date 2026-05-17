//! 旧 GitHub OAuth 端点 — **已被通用 OAuth handler 替代**
//!
//! 详见 docs/oauth-refactor-plan.md §7.3
//!
//! 这里保留的内容：
//! 1. 旧路由 `/api/auth/github/{login,callback,link}` → 302 重定向到新路由
//!    `/api/auth/oauth/github/{login,callback,link}`，附 `Sunset` header
//! 2. `/api/auth/link-github` → `410 Gone`（早就 deprecated）
//! 3. `Claims` / `User` 类型仍由其他模块导入，保留
//! 4. `get_current_user` / `logout` 不归属 OAuth 抽象，保留

use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Redirect, Response},
    Json,
};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;

// Re-export Claims so existing imports `super::auth::Claims` keep working
pub use crate::middleware::auth::Claims;

/// 旧 User 类型 — 保留导出以避免上游编译破坏；新代码用 user_identities 表
#[derive(Debug, Serialize)]
#[allow(dead_code)]
pub struct User {
    pub id: i32,
    pub github_id: i64,
    pub username: String,
    pub display_name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: String,
}

/// 兼容用查询参数（保留以匹配旧路由签名）
#[derive(Debug, Deserialize)]
pub struct AuthCallbackQuery {
    pub code: Option<String>,
    pub state: Option<String>,
}

const SUNSET_DATE: &str = "Wed, 31 Dec 2026 00:00:00 GMT";

fn redirect_with_sunset(target: String) -> Response {
    let mut resp = Redirect::temporary(&target).into_response();
    if let Ok(v) = SUNSET_DATE.parse() {
        resp.headers_mut().insert("Sunset", v);
    }
    if let Ok(v) = "true".parse() {
        resp.headers_mut().insert("Deprecation", v);
    }
    resp
}

/// **DEPRECATED**: 旧端点 → 重定向到 `/api/auth/oauth/github/login`
pub async fn github_login(_headers: HeaderMap) -> Response {
    tracing::debug!("legacy /api/auth/github/login hit; redirecting");
    redirect_with_sunset("/api/auth/oauth/github/login".to_string())
}

/// **DEPRECATED**: 旧端点 → 重定向到 `/api/auth/oauth/github/callback?code=...&state=...`
pub async fn github_callback(
    Query(params): Query<AuthCallbackQuery>,
    State(_db): State<DatabaseConnection>,
    _headers: HeaderMap,
) -> Response {
    tracing::debug!("legacy /api/auth/github/callback hit; redirecting");
    let mut qs = vec![];
    if let Some(c) = params.code {
        qs.push(format!("code={}", urlencoding::encode(&c)));
    }
    if let Some(s) = params.state {
        qs.push(format!("state={}", urlencoding::encode(&s)));
    }
    let target = if qs.is_empty() {
        "/api/auth/oauth/github/callback".to_string()
    } else {
        format!("/api/auth/oauth/github/callback?{}", qs.join("&"))
    };
    redirect_with_sunset(target)
}

/// **DEPRECATED**: 旧端点 → 重定向到 `/api/auth/oauth/github/link`
pub async fn github_link(_headers: HeaderMap) -> Response {
    tracing::debug!("legacy /api/auth/github/link hit; redirecting");
    redirect_with_sunset("/api/auth/oauth/github/link".to_string())
}

/// **DEPRECATED**: POST 形态的旧 link API — 一律返回 410
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct LinkGitHubRequest {
    pub code: String,
    pub state: String,
}

pub async fn link_github_account(
    State(_db): State<DatabaseConnection>,
    _headers: HeaderMap,
    Json(_request): Json<LinkGitHubRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::warn!("/api/auth/link-github called (long-deprecated POST API)");
    Err((
        StatusCode::GONE,
        Json(json!({
            "error": "API removed",
            "message": "Use GET /api/auth/oauth/github/link instead. The OAuth callback is handled automatically."
        })),
    ))
}

// ---------- 仍在使用的端点（与 OAuth 抽象无关） ----------

/// `GET /api/auth/me` — 返回当前登录用户信息
pub async fn get_current_user(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
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
        })
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Unauthorized", "message": "Missing token"})),
            )
        })?;

    let jwt_secret = env::var("JWT_SECRET").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "JWT secret not configured"})),
        )
    })?;

    let token_data = jsonwebtoken::decode::<Claims>(
        token,
        &jsonwebtoken::DecodingKey::from_secret(jwt_secret.as_bytes()),
        &jsonwebtoken::Validation::default(),
    )
    .map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Invalid token"})),
        )
    })?;

    let user_id: i32 = token_data.claims.sub.parse().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Invalid token data"})),
        )
    })?;

    use sea_orm::Value as SeaValue;

    let user_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT id, username, auth_provider, is_admin, avatar_url, github_id, \
                    linked_github_id, bio \
             FROM users WHERE id = $1",
            vec![SeaValue::Int(Some(user_id))],
        ))
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Database error"})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "User not found"})),
            )
        })?;

    // identities 列表（用 user_identities 表）
    let identity_rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT id, provider, provider_username, is_primary, linked_at \
             FROM user_identities WHERE user_id = $1 ORDER BY linked_at ASC",
            vec![SeaValue::Int(Some(user_id))],
        ))
        .await
        .unwrap_or_default();

    let identities: Vec<Value> = identity_rows
        .into_iter()
        .map(|r| {
            json!({
                "id": r.try_get::<i32>("", "id").unwrap_or(0),
                "provider": r.try_get::<String>("", "provider").unwrap_or_default(),
                "provider_username": r.try_get::<Option<String>>("", "provider_username").unwrap_or(None),
                "is_primary": r.try_get::<bool>("", "is_primary").unwrap_or(false),
                "linked_at": r.try_get::<chrono::DateTime<chrono::Utc>>("", "linked_at").ok().map(|t| t.to_rfc3339()),
            })
        })
        .collect();

    let id: i32 = user_row.try_get("", "id").unwrap_or(0);
    let username: String = user_row.try_get("", "username").unwrap_or_default();
    let auth_provider: String = user_row
        .try_get("", "auth_provider")
        .unwrap_or_else(|_| "local".to_string());
    let is_admin: bool = user_row.try_get("", "is_admin").unwrap_or(false);
    let avatar_url: String = user_row
        .try_get("", "avatar_url")
        .unwrap_or_else(|_| "https://github.com/ghost.png".to_string());
    let github_id: Option<i64> = user_row.try_get("", "github_id").ok();
    let linked_github_id: Option<i64> = user_row.try_get("", "linked_github_id").ok();
    let bio: Option<String> = user_row.try_get("", "bio").ok();

    Ok(Json(json!({
        "id": id,
        "username": username,
        "display_name": username,
        "auth_provider": auth_provider,
        "is_admin": is_admin,
        "avatar_url": avatar_url,
        "github_id": github_id,
        "linked_github_id": linked_github_id.map(|id| id.to_string()),
        "bio": bio,
        "identities": identities,
    })))
}

/// `POST /api/auth/logout`
pub async fn logout() -> impl IntoResponse {
    tracing::info!("🚪 User logout - clearing auth cookie");
    let cookie_value = "auth_token=deleted; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; \
                        Expires=Thu, 01 Jan 1970 00:00:00 GMT";
    let mut response = Json(json!({"success": true, "message": "Logged out successfully"})).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, cookie_value.parse().unwrap());
    response
}
