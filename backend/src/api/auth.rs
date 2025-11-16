use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Redirect},
    Json,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{encode, EncodingKey, Header};
use oauth2::{
    basic::BasicClient, reqwest::async_http_client, AuthUrl, AuthorizationCode, ClientId,
    ClientSecret, CsrfToken, RedirectUrl, Scope, TokenResponse, TokenUrl,
};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::env;

use crate::oauth_url_builder::OAuthUrlBuilder;

// JWT Claims structure
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,      // User ID
    pub username: String, // GitHub username
    pub is_admin: bool,   // ✅ 安全修复 P0: Admin status from database
    pub exp: i64,         // Expiration time
    pub iat: i64,         // Issued at
}

// GitHub OAuth callback query parameters
#[derive(Debug, Deserialize)]
pub struct AuthCallbackQuery {
    code: String,
    #[allow(dead_code)]
    state: String,
}

// GitHub user info from API
#[derive(Debug, Deserialize)]
struct GitHubUser {
    #[allow(dead_code)]
    id: i64,
    login: String,
    #[allow(dead_code)]
    name: Option<String>,
    #[allow(dead_code)]
    email: Option<String>,
    #[allow(dead_code)]
    avatar_url: String,
    #[allow(dead_code)]
    html_url: String,
    #[allow(dead_code)]
    bio: Option<String>,
    #[allow(dead_code)]
    location: Option<String>,
    #[allow(dead_code)]
    company: Option<String>,
}

// User entity (simplified, you should use SeaORM entities)
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

/// GET /api/auth/github/login
/// Redirect user to GitHub OAuth page
/// 支持动态环境检测，自动适配开发/生产环境
pub async fn github_login(
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let client_id = env::var("GITHUB_CLIENT_ID").map_err(|_| {
        tracing::error!("GITHUB_CLIENT_ID environment variable not set");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "GitHub OAuth not configured",
                "message": "GITHUB_CLIENT_ID environment variable is not set. Please configure GitHub OAuth in .env file."
            })),
        )
    })?;

    let client_secret = env::var("GITHUB_CLIENT_SECRET").map_err(|_| {
        tracing::error!("GITHUB_CLIENT_SECRET environment variable not set");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "GitHub OAuth not configured",
                "message": "GITHUB_CLIENT_SECRET environment variable is not set. Please configure GitHub OAuth in .env file."
            })),
        )
    })?;

    // 使用智能URL构建器，支持环境变量和请求头检测
    let redirect_url = OAuthUrlBuilder::get_github_redirect_url(Some(&headers));
    tracing::info!(
        "🔐 GitHub OAuth login initiated with redirect URL: {}",
        redirect_url
    );

    let client = BasicClient::new(
        ClientId::new(client_id),
        Some(ClientSecret::new(client_secret)),
        AuthUrl::new("https://github.com/login/oauth/authorize".to_string()).unwrap(),
        Some(TokenUrl::new("https://github.com/login/oauth/access_token".to_string()).unwrap()),
    )
    .set_redirect_uri(RedirectUrl::new(redirect_url).unwrap());

    let (auth_url, _csrf_token) = client
        .authorize_url(CsrfToken::new_random)
        .add_scope(Scope::new("read:user".to_string()))
        .add_scope(Scope::new("user:email".to_string()))
        .url();

    Ok(Redirect::to(auth_url.as_str()))
}

/// GET /api/auth/github/callback
/// Handle GitHub OAuth callback
/// 支持动态环境检测，自动适配开发/生产环境
pub async fn github_callback(
    Query(params): Query<AuthCallbackQuery>,
    State(_db): State<DatabaseConnection>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    tracing::info!("🔐 GitHub OAuth callback received");

    let client_id = env::var("GITHUB_CLIENT_ID").map_err(|_| {
        tracing::error!("GITHUB_CLIENT_ID not set");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "GitHub OAuth not configured"})),
        )
    })?;

    let client_secret = env::var("GITHUB_CLIENT_SECRET").map_err(|_| {
        tracing::error!("GITHUB_CLIENT_SECRET not set");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "GitHub OAuth not configured"})),
        )
    })?;

    // 使用智能URL构建器，确保与登录时使用的URL一致
    let redirect_url = OAuthUrlBuilder::get_github_redirect_url(Some(&headers));
    let frontend_url = OAuthUrlBuilder::get_frontend_url(Some(&headers));

    tracing::info!(
        "🔐 OAuth callback - redirect_url: {}, frontend_url: {}",
        redirect_url,
        frontend_url
    );

    let client = BasicClient::new(
        ClientId::new(client_id),
        Some(ClientSecret::new(client_secret)),
        AuthUrl::new("https://github.com/login/oauth/authorize".to_string()).unwrap(),
        Some(TokenUrl::new("https://github.com/login/oauth/access_token".to_string()).unwrap()),
    )
    .set_redirect_uri(RedirectUrl::new(redirect_url).unwrap());

    // Exchange code for token
    let token_result = client
        .exchange_code(AuthorizationCode::new(params.code))
        .request_async(async_http_client)
        .await
        .map_err(|e| {
            tracing::error!("Failed to exchange code: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to exchange authorization code"})),
            )
        })?;

    let access_token = token_result.access_token().secret();
    tracing::info!("✅ Access token obtained");

    // Get user info from GitHub
    let http_client = reqwest::Client::new();
    let user_info: GitHubUser = http_client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "Myriad-App")
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to get user info: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to get user info from GitHub"})),
            )
        })?
        .json()
        .await
        .map_err(|e| {
            tracing::error!("Failed to parse user info: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to parse GitHub user info"})),
            )
        })?;

    tracing::info!("✅ GitHub user info: {}", user_info.login);

    // TODO: Use SeaORM entities here
    // For now, we'll use raw SQL queries via SeaORM
    use sea_orm::Value as SeaValue;

    // 账户处理策略：
    // 1. 检查是否有管理员已绑定此 GitHub ID (linked_github_id) -> 使用管理员账户登录
    // 2. 检查是否有 GitHub 用户已存在 (github_id) -> 更新并使用该用户
    // 3. 否则 -> 创建新的普通 GitHub 用户

    // Step 1: 检查是否有本地管理员已绑定此 GitHub ID
    let linked_admin_check = _db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT id, username, is_admin FROM users
             WHERE auth_provider = 'local'
             AND linked_github_id = $1
             LIMIT 1",
            vec![SeaValue::BigInt(Some(user_info.id))],
        ))
        .await
        .map_err(|e| {
            tracing::error!("Failed to check for linked admin: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Database error"})),
            )
        })?;

    // Step 2: 检查该 GitHub ID 是否已作为独立用户存在
    let github_user_check = _db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT id, username FROM users WHERE github_id = $1",
            vec![SeaValue::BigInt(Some(user_info.id))],
        ))
        .await
        .map_err(|e| {
            tracing::error!("Failed to check GitHub user: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Database error"})),
            )
        })?;

    // 决定处理策略
    let user_id = if let Some(admin_row) = linked_admin_check {
        // 场景 1: 管理员已绑定此 GitHub 账户 -> 使用管理员账户登录
        let admin_id: i32 = admin_row.try_get("", "id").map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to read admin data"})),
            )
        })?;
        let admin_username: String = admin_row
            .try_get("", "username")
            .unwrap_or_else(|_| "admin".to_string());

        tracing::info!(
            "✅ GitHub account {} is linked to admin account (id: {}, username: {})",
            user_info.login,
            admin_id,
            admin_username
        );

        // 更新管理员的最后登录时间和头像
        _db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "UPDATE users SET
                avatar_url = $1,
                last_login_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $2",
            vec![
                SeaValue::String(Some(Box::new(user_info.avatar_url.clone()))),
                SeaValue::Int(Some(admin_id)),
            ],
        ))
        .await
        .map_err(|e| {
            tracing::error!("Failed to update admin: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to update admin"})),
            )
        })?;

        admin_id
    } else if let Some(github_user_row) = github_user_check {
        // 场景 2: GitHub 用户已存在 -> 更新现有用户
        let existing_user_id: i32 = github_user_row.try_get("", "id").map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to read user data"})),
            )
        })?;

        tracing::info!("Updating existing GitHub user: {}", user_info.login);

        _db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "UPDATE users SET
                username = $1,
                display_name = $2,
                email = $3,
                avatar_url = $4,
                github_profile_url = $5,
                bio = $6,
                location = $7,
                company = $8,
                last_login_at = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
             WHERE id = $9",
            vec![
                SeaValue::String(Some(Box::new(user_info.login.clone()))),
                user_info.name.as_ref().map_or(SeaValue::String(None), |s| {
                    SeaValue::String(Some(Box::new(s.clone())))
                }),
                user_info
                    .email
                    .as_ref()
                    .map_or(SeaValue::String(None), |s| {
                        SeaValue::String(Some(Box::new(s.clone())))
                    }),
                SeaValue::String(Some(Box::new(user_info.avatar_url.clone()))),
                SeaValue::String(Some(Box::new(user_info.html_url.clone()))),
                user_info.bio.as_ref().map_or(SeaValue::String(None), |s| {
                    SeaValue::String(Some(Box::new(s.clone())))
                }),
                user_info
                    .location
                    .as_ref()
                    .map_or(SeaValue::String(None), |s| {
                        SeaValue::String(Some(Box::new(s.clone())))
                    }),
                user_info
                    .company
                    .as_ref()
                    .map_or(SeaValue::String(None), |s| {
                        SeaValue::String(Some(Box::new(s.clone())))
                    }),
                SeaValue::Int(Some(existing_user_id)),
            ],
        ))
        .await
        .map_err(|e| {
            tracing::error!("Failed to update GitHub user: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to update user"})),
            )
        })?;

        existing_user_id
    } else {
        // 场景 3: 创建新的普通GitHub用户
        tracing::info!("Creating new GitHub user: {}", user_info.login);

        let insert_result = _db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "INSERT INTO users (github_id, username, display_name, email, avatar_url, github_profile_url, bio, location, company, is_admin, auth_provider, last_login_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, 'github', CURRENT_TIMESTAMP)
                 RETURNING id",
                vec![
                    SeaValue::BigInt(Some(user_info.id)),
                    SeaValue::String(Some(Box::new(user_info.login.clone()))),
                    user_info.name.as_ref().map_or(SeaValue::String(None), |s| {
                        SeaValue::String(Some(Box::new(s.clone())))
                    }),
                    user_info.email.as_ref().map_or(SeaValue::String(None), |s| {
                        SeaValue::String(Some(Box::new(s.clone())))
                    }),
                    SeaValue::String(Some(Box::new(user_info.avatar_url.clone()))),
                    SeaValue::String(Some(Box::new(user_info.html_url.clone()))),
                    user_info.bio.as_ref().map_or(SeaValue::String(None), |s| {
                        SeaValue::String(Some(Box::new(s.clone())))
                    }),
                    user_info.location.as_ref().map_or(SeaValue::String(None), |s| {
                        SeaValue::String(Some(Box::new(s.clone())))
                    }),
                    user_info.company.as_ref().map_or(SeaValue::String(None), |s| {
                        SeaValue::String(Some(Box::new(s.clone())))
                    }),
                ],
            ))
            .await
            .map_err(|e| {
                tracing::error!("Failed to create GitHub user: {:?}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "Failed to create user"})),
                )
            })?
            .ok_or_else(|| {
                tracing::error!("Insert returned no result");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"error": "Failed to create user"})),
                )
            })?;

        insert_result.try_get("", "id").map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to get user ID"})),
            )
        })?
    };

    // ✅ 安全修复 P0: 查询用户的 is_admin 状态
    let is_admin_query = "SELECT is_admin FROM users WHERE id = $1";
    let is_admin_result = _db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            is_admin_query,
            vec![SeaValue::Int(Some(user_id))],
        ))
        .await
        .map_err(|e| {
            tracing::error!("Failed to query is_admin: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Database error"})),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "User not found after creation"})),
            )
        })?;

    let is_admin: bool = is_admin_result.try_get("", "is_admin").unwrap_or(false);

    // Generate JWT token
    let jwt_secret = env::var("JWT_SECRET").map_err(|_| {
        tracing::error!("JWT_SECRET not set");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "JWT secret not configured"})),
        )
    })?;
    let claims = Claims {
        sub: user_id.to_string(),
        username: user_info.login.clone(),
        is_admin, // ✅ 安全修复 P0: 从数据库读取
        exp: (Utc::now() + Duration::days(30)).timestamp(),
        iat: Utc::now().timestamp(),
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
    .map_err(|e| {
        tracing::error!("Failed to create JWT: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to create session token"})),
        )
    })?;

    tracing::info!("✅ JWT token created for user: {}", user_info.login);

    // ✅ 安全修复 P0: 设置 HttpOnly Cookie（安全）
    let is_production =
        env::var("ENVIRONMENT").unwrap_or_else(|_| "development".to_string()) == "production";
    let cookie_value = format!(
        "auth_token={}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000{}",
        token,
        if is_production { "; Secure" } else { "" } // 生产环境启用 Secure 标志
    );

    // ✅ 安全修复 P0: 移除 URL 中的 token 参数，防止通过历史记录/Referer泄露
    // 前端将完全依赖 HttpOnly Cookie 进行认证
    let redirect_url = format!("{}/?auth=success", frontend_url);

    // 构建包含 Set-Cookie 的响应
    let mut response = Redirect::to(&redirect_url).into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, cookie_value.parse().unwrap());

    tracing::info!("✅ GitHub OAuth successful, redirecting with HttpOnly cookie (no URL token)");
    Ok(response)
}

/// GET /api/auth/me
/// Get current user info from JWT
pub async fn get_current_user(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Extract JWT token from Authorization header or Cookie
    let token = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| {
            // 回退到 Cookie
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
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "error": "Unauthorized",
                    "message": "Missing or invalid authorization token"
                })),
            )
        })?;

    // Decode and verify JWT
    let jwt_secret = env::var("JWT_SECRET").map_err(|_| {
        tracing::error!("JWT_SECRET not configured");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "Server configuration error",
                "message": "JWT secret not configured"
            })),
        )
    })?;

    let token_data = jsonwebtoken::decode::<Claims>(
        token,
        &jsonwebtoken::DecodingKey::from_secret(jwt_secret.as_bytes()),
        &jsonwebtoken::Validation::default(),
    )
    .map_err(|e| {
        tracing::debug!("Invalid JWT token: {:?}", e);
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "Invalid token",
                "message": "Token is invalid or expired"
            })),
        )
    })?;

    let user_id: i32 = token_data.claims.sub.parse().map_err(|_| {
        tracing::error!("Invalid user ID in token");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "Invalid token data"
            })),
        )
    })?;

    // Query user from database
    use sea_orm::Value as SeaValue;

    let query = "SELECT id, username, auth_provider, is_admin, avatar_url, github_id 
                 FROM users 
                 WHERE id = $1";

    let user_result = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            query,
            vec![SeaValue::Int(Some(user_id))],
        ))
        .await
        .map_err(|e| {
            tracing::error!("Database error: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Database error"})),
            )
        })?;

    let user_row = user_result.ok_or_else(|| {
        tracing::debug!("User not found: {}", user_id);
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "User not found",
                "message": "User account no longer exists"
            })),
        )
    })?;

    // Extract user data
    let id: i32 = user_row.try_get("", "id").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to read user data"})),
        )
    })?;

    let username: String = user_row.try_get("", "username").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to read user data"})),
        )
    })?;

    let auth_provider: String = user_row
        .try_get("", "auth_provider")
        .unwrap_or_else(|_| "local".to_string());
    let is_admin: bool = user_row.try_get("", "is_admin").unwrap_or(false);
    let avatar_url: String = user_row
        .try_get("", "avatar_url")
        .unwrap_or_else(|_| "https://github.com/ghost.png".to_string());
    let github_id: Option<i64> = user_row.try_get("", "github_id").ok();

    tracing::info!("User info retrieved: {} (ID: {})", username, id);

    Ok(Json(json!({
        "id": id,
        "username": username,
        "display_name": username,
        "auth_provider": auth_provider,
        "is_admin": is_admin,
        "avatar_url": avatar_url,
        "github_id": github_id,
    })))
}

/// GET /api/auth/github/link
/// Redirect user to GitHub OAuth page for linking account
/// 支持动态环境检测，自动适配开发/生产环境
pub async fn github_link(
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    let client_id = env::var("GITHUB_CLIENT_ID").map_err(|_| {
        tracing::error!("GITHUB_CLIENT_ID environment variable not set");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "GitHub OAuth not configured",
                "message": "GITHUB_CLIENT_ID environment variable is not set. Please configure GitHub OAuth in .env file."
            })),
        )
    })?;

    let client_secret = env::var("GITHUB_CLIENT_SECRET").map_err(|_| {
        tracing::error!("GITHUB_CLIENT_SECRET environment variable not set");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "GitHub OAuth not configured",
                "message": "GITHUB_CLIENT_SECRET environment variable is not set. Please configure GitHub OAuth in .env file."
            })),
        )
    })?;

    // 使用智能URL构建器，支持环境变量和请求头检测
    let redirect_url = OAuthUrlBuilder::get_github_redirect_url(Some(&headers));

    let client = BasicClient::new(
        ClientId::new(client_id),
        Some(ClientSecret::new(client_secret)),
        AuthUrl::new("https://github.com/login/oauth/authorize".to_string()).unwrap(),
        Some(TokenUrl::new("https://github.com/login/oauth/access_token".to_string()).unwrap()),
    )
    .set_redirect_uri(RedirectUrl::new(redirect_url).unwrap());

    // Use state to indicate this is a link request
    let (auth_url, _csrf_token) = client
        .authorize_url(|| CsrfToken::new("link_account".to_string()))
        .add_scope(Scope::new("read:user".to_string()))
        .add_scope(Scope::new("user:email".to_string()))
        .url();

    Ok(Redirect::to(auth_url.as_str()))
}

/// POST /api/auth/link-github
/// Link GitHub account to local admin (called after OAuth callback)
/// 🔒 SECURITY FIX: user_id is extracted from JWT token, not from request body
#[derive(Debug, Deserialize)]
pub struct LinkGitHubRequest {
    pub code: String,
    // ✅ P1 安全修复：移除 user_id 字段
    // 原因：客户端提供的 user_id 不可信，攻击者可以伪造
    // 现在从 JWT token 中提取 user_id，确保身份真实性
}

pub async fn link_github_account(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap, // ✅ 添加 HeaderMap 参数用于提取 JWT
    Json(request): Json<LinkGitHubRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // ✅ P1 安全修复：从 JWT token 提取 user_id，而不是信任客户端
    use crate::middleware::auth::verify_jwt_token;

    let claims = verify_jwt_token(&headers).map_err(|_err_response| {
        tracing::error!("Failed to verify JWT token for link-github operation");
        // verify_jwt_token 返回 Box<Response>，我们需要解包
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "Unauthorized",
                "message": "Invalid or missing authentication token. Please login first."
            })),
        )
    })?;

    // 从 JWT 的 sub (subject) 字段提取 user_id
    let user_id: i32 = claims.sub.parse().map_err(|e| {
        tracing::error!("Invalid user ID in JWT token: {:?}", e);
        (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Invalid token",
                "message": "User ID in token is invalid"
            })),
        )
    })?;

    tracing::info!(
        "🔗 Linking GitHub account for authenticated user: {} (from JWT token, not client)",
        user_id
    );

    // Verify user is local admin
    use sea_orm::Value as SeaValue;

    let user_query = "SELECT id, username, auth_provider, is_admin 
                      FROM users 
                      WHERE id = $1 AND auth_provider = 'local' AND is_admin = true";

    let user_result = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            user_query,
            vec![SeaValue::Int(Some(user_id))], // ✅ 使用从 JWT 提取的 user_id
        ))
        .await
        .map_err(|e| {
            tracing::error!("Database error: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Database error"})),
            )
        })?;

    let _user_row = user_result.ok_or_else(|| {
        tracing::warn!(
            "User not found or not local admin: {} (JWT verified but admin check failed)",
            user_id
        );
        (
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Permission denied",
                "message": "Only local administrator can link GitHub account"
            })),
        )
    })?;

    // Exchange code for GitHub access token
    let client_id = env::var("GITHUB_CLIENT_ID").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "GitHub OAuth not configured"})),
        )
    })?;

    let client_secret = env::var("GITHUB_CLIENT_SECRET").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "GitHub OAuth not configured"})),
        )
    })?;

    // 使用智能URL构建器（账户链接流程也需要正确的回调URL）
    let redirect_url = OAuthUrlBuilder::get_github_redirect_url(None);

    let client = BasicClient::new(
        ClientId::new(client_id),
        Some(ClientSecret::new(client_secret)),
        AuthUrl::new("https://github.com/login/oauth/authorize".to_string()).unwrap(),
        Some(TokenUrl::new("https://github.com/login/oauth/access_token".to_string()).unwrap()),
    )
    .set_redirect_uri(RedirectUrl::new(redirect_url).unwrap());

    let token_result = client
        .exchange_code(AuthorizationCode::new(request.code))
        .request_async(async_http_client)
        .await
        .map_err(|e| {
            tracing::error!("Failed to exchange code: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to exchange authorization code"})),
            )
        })?;

    let access_token = token_result.access_token().secret();

    // Get GitHub user info
    let http_client = reqwest::Client::new();
    let github_user: GitHubUser = http_client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "Myriad-App")
        .send()
        .await
        .map_err(|e| {
            tracing::error!("Failed to get GitHub user info: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to get GitHub user info"})),
            )
        })?
        .json()
        .await
        .map_err(|e| {
            tracing::error!("Failed to parse GitHub user info: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to parse GitHub user info"})),
            )
        })?;

    // 先删除可能存在的独立 GitHub 用户记录（避免冲突）
    let delete_result = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "DELETE FROM users WHERE github_id = $1 AND auth_provider = 'github'",
            vec![SeaValue::BigInt(Some(github_user.id))],
        ))
        .await;

    if let Ok(result) = delete_result {
        if result.rows_affected() > 0 {
            tracing::info!(
                "🗑️  Deleted existing GitHub user record (github_id: {}) before linking to admin",
                github_user.id
            );
        }
    }

    // Update user: set linked_github_id and disable local login
    let update_query = "UPDATE users
                        SET linked_github_id = $1,
                            local_login_disabled = true,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $2
                        RETURNING id";

    db.query_one(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        update_query,
        vec![
            SeaValue::BigInt(Some(github_user.id)),
            SeaValue::Int(Some(user_id)), // ✅ 使用从 JWT 提取的 user_id
        ],
    ))
    .await
    .map_err(|e| {
        tracing::error!("Failed to link GitHub account: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to link GitHub account"})),
        )
    })?;

    tracing::info!(
        "✅ GitHub account linked successfully: {} -> {} (github_id: {}) [JWT-verified user_id]",
        user_id, // ✅ 使用从 JWT 提取的 user_id
        github_user.login,
        github_user.id
    );

    Ok(Json(json!({
        "success": true,
        "message": "GitHub account linked successfully. Local login has been disabled.",
        "github_username": github_user.login,
        "github_id": github_user.id
    })))
}

/// POST /api/auth/logout
/// Logout user and invalidate session
/// 不需要认证，彻底清理Cookie
pub async fn logout() -> impl IntoResponse {
    tracing::info!("🚪 User logout - clearing auth cookie");

    // 清除 HttpOnly Cookie（设置为空值+立即过期+删除标记）
    // 使用 Expires 和 Max-Age 双重保险确保Cookie被删除
    let cookie_value = "auth_token=deleted; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT";

    let mut response = Json(json!({
        "success": true,
        "message": "Logged out successfully"
    }))
    .into_response();

    response
        .headers_mut()
        .insert(header::SET_COOKIE, cookie_value.parse().unwrap());

    tracing::info!("✅ Auth cookie cleared");
    response
}

// Helper function to hash token
#[allow(dead_code)]
fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}
