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
use sea_orm::DatabaseConnection;
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
    // For now, we'll use raw SQL as a placeholder
    // You should create proper SeaORM models for users and sessions tables

    // Create or update user in database
    // This is pseudocode - implement with SeaORM
    let user_id = 1; // Placeholder

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
    State(_db): State<DatabaseConnection>,
    // TODO: Extract user from JWT middleware
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // This will be implemented with auth middleware
    // For now, return placeholder
    Ok(Json(json!({
        "id": 1,
        "username": "placeholder",
        "avatar_url": "https://github.com/ghost.png"
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
