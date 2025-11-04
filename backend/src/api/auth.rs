use axum::{
    extract::{Query, State},
    http::StatusCode,
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

// JWT Claims structure
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,      // User ID
    pub username: String, // GitHub username
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
pub async fn github_login() -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
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

    let redirect_url = env::var("GITHUB_REDIRECT_URL")
        .unwrap_or_else(|_| "http://localhost:3000/api/auth/github/callback".to_string());

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
pub async fn github_callback(
    Query(params): Query<AuthCallbackQuery>,
    State(_db): State<DatabaseConnection>,
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
    let redirect_url = env::var("GITHUB_REDIRECT_URL")
        .unwrap_or_else(|_| "http://localhost:3000/api/auth/github/callback".to_string());
    let frontend_url =
        env::var("FRONTEND_URL").unwrap_or_else(|_| "http://localhost:4321".to_string());

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

    // Check if this is the first user (will become admin)
    let count_result = _db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT COUNT(*) as count FROM users",
            vec![],
        ))
        .await
        .map_err(|e| {
            tracing::error!("Failed to check user count: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Database error"})),
            )
        })?;

    let user_count: i64 = count_result
        .and_then(|row| row.try_get("", "count").ok())
        .unwrap_or(0);

    // GitHub OAuth users are always normal users (is_admin = false)
    let is_admin = false;

    tracing::info!("GitHub user registration. User count: {}. Admin status: false (GitHub users cannot be admin)", user_count);

    // Create or update user in database
    use sea_orm::Value as SeaValue;

    let insert_query = "INSERT INTO users (github_id, username, display_name, email, avatar_url, github_profile_url, bio, location, company, is_admin, auth_provider, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'github', CURRENT_TIMESTAMP)
         ON CONFLICT (github_id)
         DO UPDATE SET
           username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           email = EXCLUDED.email,
           avatar_url = EXCLUDED.avatar_url,
           github_profile_url = EXCLUDED.github_profile_url,
           bio = EXCLUDED.bio,
           location = EXCLUDED.location,
           company = EXCLUDED.company,
           last_login_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
         RETURNING id";

    let user_result = _db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            insert_query,
            vec![
                SeaValue::BigInt(Some(user_info.id)),
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
                SeaValue::Bool(Some(is_admin)),
            ],
        ))
        .await
        .map_err(|e| {
            tracing::error!("Failed to create/update user: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to save user to database"})),
            )
        })?;

    let user_id: i32 = user_result
        .and_then(|row| row.try_get("", "id").ok())
        .ok_or_else(|| {
            tracing::error!("Failed to get user ID from query result");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to get user ID"})),
            )
        })?;

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

    // Redirect to frontend with token
    let redirect_url = format!("{}/?token={}", frontend_url, token);
    Ok(Redirect::to(&redirect_url))
}

/// GET /api/auth/me
/// Get current user info from JWT
pub async fn get_current_user(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Extract JWT token from Authorization header
    let token = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or_else(|| {
            tracing::warn!("Missing or invalid Authorization header");
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
        tracing::warn!("Invalid JWT token: {:?}", e);
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
        tracing::warn!("User not found: {}", user_id);
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
pub async fn github_link() -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
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

    let redirect_url = env::var("GITHUB_REDIRECT_URL")
        .unwrap_or_else(|_| "http://localhost:3000/api/auth/github/callback".to_string());

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
#[derive(Debug, Deserialize)]
pub struct LinkGitHubRequest {
    pub code: String,
    pub user_id: i32, // Local admin user ID from JWT
}

pub async fn link_github_account(
    State(db): State<DatabaseConnection>,
    Json(request): Json<LinkGitHubRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::info!("Linking GitHub account for user ID: {}", request.user_id);

    // Verify user is local admin
    use sea_orm::Value as SeaValue;

    let user_query = "SELECT id, username, auth_provider, is_admin 
                      FROM users 
                      WHERE id = $1 AND auth_provider = 'local' AND is_admin = true";

    let user_result = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            user_query,
            vec![SeaValue::Int(Some(request.user_id))],
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
        tracing::warn!("User not found or not local admin: {}", request.user_id);
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

    let redirect_url = env::var("GITHUB_REDIRECT_URL")
        .unwrap_or_else(|_| "http://localhost:3000/api/auth/github/callback".to_string());

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
            SeaValue::Int(Some(request.user_id)),
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
        "✅ GitHub account linked successfully: {} -> {}",
        request.user_id,
        github_user.login
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
pub async fn logout(State(_db): State<DatabaseConnection>) -> Json<Value> {
    // TODO: Invalidate session token in database
    Json(json!({
        "success": true,
        "message": "Logged out successfully"
    }))
}

// Helper function to hash token
#[allow(dead_code)]
fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}
