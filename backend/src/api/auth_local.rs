use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::State,
    http::{header, StatusCode},
    response::IntoResponse,
    Json,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{encode, EncodingKey, Header};
use regex::Regex;
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;

use super::auth::Claims;

/// Request to create admin account
#[derive(Debug, Deserialize)]
pub struct CreateAdminRequest {
    pub username: String,
    pub password: String,
}

/// Request for local login
#[derive(Debug, Deserialize)]
pub struct LocalLoginRequest {
    pub username: String,
    pub password: String,
}

/// Request to change password
#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub old_password: String,
    pub new_password: String,
}

/// Response with JWT token
#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserInfo,
}

/// User information
#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub id: i32,
    pub username: String,
    pub is_admin: bool,
    pub auth_provider: String,
}

/// POST /api/setup/create-admin
/// Create the local administrator account (only during setup)
/// ✅ PROTECTION: Checks if admin already exists and prevents duplicate creation
pub async fn create_admin(
    State(db): State<DatabaseConnection>,
    Json(request): Json<CreateAdminRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::info!("Creating local admin account: {}", request.username);

    // Validate username
    validate_username(&request.username)?;

    // Validate password
    validate_password(&request.password)?;

    // ✅ SECURITY CHECK: Check if a local admin already exists
    let admin_exists_result = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT EXISTS (SELECT 1 FROM users WHERE auth_provider = 'local' AND is_admin = true) as exists",
            vec![],
        ))
        .await
        .map_err(|e| {
            tracing::error!("Failed to check existing admin: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Database error"})),
            )
        })?;

    let admin_exists: bool = admin_exists_result
        .and_then(|row| row.try_get("", "exists").ok())
        .unwrap_or(false);

    if admin_exists {
        tracing::error!(
            "🚨 Admin account creation REJECTED: Admin already exists (security protection)"
        );
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": "Admin account already exists",
                "message": "Only one local administrator account is allowed. Setup has been completed."
            })),
        ));
    }

    // Hash password using Argon2id
    let password_hash = hash_password(&request.password)?;

    // Insert admin user
    use sea_orm::Value as SeaValue;

    let insert_query = "INSERT INTO users (
        username, 
        auth_provider, 
        password_hash, 
        is_admin, 
        github_id,
        avatar_url,
        created_at, 
        updated_at
    ) VALUES ($1, $2, $3, $4, NULL, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING id";

    let user_result = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            insert_query,
            vec![
                SeaValue::String(Some(Box::new(request.username.clone()))),
                SeaValue::String(Some(Box::new("local".to_string()))),
                SeaValue::String(Some(Box::new(password_hash))),
                SeaValue::Bool(Some(true)),
                SeaValue::String(Some(Box::new(
                    "https://ui-avatars.com/api/?name=Admin&background=4f46e5&color=fff"
                        .to_string(),
                ))),
            ],
        ))
        .await
        .map_err(|e| {
            tracing::error!("Failed to create admin user: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to create admin account"})),
            )
        })?;

    let user_id: i32 = user_result
        .and_then(|row| row.try_get("", "id").ok())
        .ok_or_else(|| {
            tracing::error!("Failed to get user ID");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to create admin account"})),
            )
        })?;

    tracing::info!(
        "✅ Local admin account created: {} (ID: {})",
        request.username,
        user_id
    );

    Ok(Json(json!({
        "success": true,
        "message": "Admin account created successfully",
        "user_id": user_id
    })))
}

/// POST /api/auth/login
/// Local login endpoint
pub async fn local_login(
    State(db): State<DatabaseConnection>,
    Json(request): Json<LocalLoginRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<Value>)> {
    tracing::info!("Local login attempt: {}", request.username);

    // Query user by username
    use sea_orm::Value as SeaValue;

    let query = "SELECT id, username, password_hash, is_admin, auth_provider, local_login_disabled 
                 FROM users 
                 WHERE username = $1 AND auth_provider = 'local'";

    let user_result = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            query,
            vec![SeaValue::String(Some(Box::new(request.username.clone())))],
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
        tracing::warn!("User not found: {}", request.username);
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": "Invalid credentials",
                "message": "Username or password is incorrect"
            })),
        )
    })?;

    // Extract user data
    let user_id: i32 = user_row.try_get("", "id").map_err(|_| {
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

    let password_hash: String = user_row.try_get("", "password_hash").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to read user data"})),
        )
    })?;

    let is_admin: bool = user_row.try_get("", "is_admin").unwrap_or(false);

    let local_login_disabled: bool = user_row
        .try_get("", "local_login_disabled")
        .unwrap_or(false);

    // Check if local login is disabled
    if local_login_disabled {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Local login disabled",
                "message": "This account has been linked to GitHub. Please use GitHub OAuth to login."
            })),
        ));
    }

    // Verify password
    verify_password(&request.password, &password_hash)?;

    // Update last login timestamp
    let _ = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1",
            vec![SeaValue::Int(Some(user_id))],
        ))
        .await;

    // Generate JWT token
    let jwt_secret = env::var("JWT_SECRET").map_err(|_| {
        tracing::error!("JWT_SECRET not set");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Server configuration error"})),
        )
    })?;

    let claims = Claims {
        sub: user_id.to_string(),
        username: username.clone(),
        is_admin, // ✅ 安全修复 P0: 从数据库读取 is_admin
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

    tracing::info!("✅ Local login successful: {}", username);

    // 设置 HttpOnly Cookie
    // 使用 SameSite=Lax 保持与 OAuth 登录一致
    // 使用 SiteConfig 判断是否为生产环境（基于 base_url 是否为 HTTPS）
    use crate::oauth_url_builder::SiteConfig;
    let is_production = SiteConfig::is_production().await;
    let cookie_value = format!(
        "auth_token={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000{}",
        token,
        if is_production { "; Secure" } else { "" }
    );

    let response = Json(AuthResponse {
        token: token.clone(),
        user: UserInfo {
            id: user_id,
            username,
            is_admin,
            auth_provider: "local".to_string(),
        },
    });

    // 构建包含 Set-Cookie 的响应
    let mut response = response.into_response();
    response
        .headers_mut()
        .insert(header::SET_COOKIE, cookie_value.parse().unwrap());

    Ok(response)
}

/// POST /api/auth/change-password
/// Change password for local account
pub async fn change_password(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Json(request): Json<ChangePasswordRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // Extract and validate JWT token from headers
    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Missing or invalid authorization header"})),
            )
        })?;

    let jwt_secret = env::var("JWT_SECRET").map_err(|_| {
        tracing::error!("JWT_SECRET not set");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Server configuration error"})),
        )
    })?;

    // Decode and validate token
    let claims = jsonwebtoken::decode::<Claims>(
        token,
        &jsonwebtoken::DecodingKey::from_secret(jwt_secret.as_bytes()),
        &jsonwebtoken::Validation::default(),
    )
    .map_err(|e| {
        tracing::warn!("Invalid JWT token: {:?}", e);
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Invalid or expired token"})),
        )
    })?
    .claims;

    let user_id = claims.sub.parse::<i32>().map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid user ID"})),
        )
    })?;

    tracing::info!("Password change request for user ID: {}", user_id);

    // Validate new password
    validate_password(&request.new_password)?;

    // Query user data
    use sea_orm::Value as SeaValue;

    let query = "SELECT username, password_hash, auth_provider, local_login_disabled 
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
            StatusCode::NOT_FOUND,
            Json(json!({"error": "User not found"})),
        )
    })?;

    let username: String = user_row.try_get("", "username").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to read user data"})),
        )
    })?;

    let auth_provider: String = user_row.try_get("", "auth_provider").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to read user data"})),
        )
    })?;

    // Only local accounts can change password
    if auth_provider != "local" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Operation not allowed",
                "message": "Only local accounts can change password"
            })),
        ));
    }

    let local_login_disabled: bool = user_row
        .try_get("", "local_login_disabled")
        .unwrap_or(false);

    // Check if local login is disabled (GitHub linked)
    if local_login_disabled {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Local login disabled",
                "message": "This account has been linked to GitHub. Password change is not allowed."
            })),
        ));
    }

    let current_password_hash: String = user_row.try_get("", "password_hash").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to read user data"})),
        )
    })?;

    // Verify old password
    verify_password(&request.old_password, &current_password_hash)?;

    // Hash new password
    let new_password_hash = hash_password(&request.new_password)?;

    // Update password
    let update_query =
        "UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2";

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        update_query,
        vec![
            SeaValue::String(Some(Box::new(new_password_hash))),
            SeaValue::Int(Some(user_id)),
        ],
    ))
    .await
    .map_err(|e| {
        tracing::error!("Failed to update password: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to update password"})),
        )
    })?;

    tracing::info!("✅ Password changed successfully for user: {}", username);

    Ok(Json(json!({
        "success": true,
        "message": "Password changed successfully"
    })))
}

// Helper functions

/// Validate username format
fn validate_username(username: &str) -> Result<(), (StatusCode, Json<Value>)> {
    if username.len() < 3 || username.len() > 20 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Invalid username",
                "message": "Username must be between 3 and 20 characters"
            })),
        ));
    }

    let regex = Regex::new(r"^[a-zA-Z0-9_]+$").unwrap();
    if !regex.is_match(username) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Invalid username",
                "message": "Username can only contain letters, numbers, and underscores"
            })),
        ));
    }

    Ok(())
}

/// Validate password strength
fn validate_password(password: &str) -> Result<(), (StatusCode, Json<Value>)> {
    if password.len() < 8 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Invalid password",
                "message": "Password must be at least 8 characters long"
            })),
        ));
    }

    // Check password complexity: must contain both letters and numbers
    let has_letter = password.chars().any(|c| c.is_alphabetic());
    let has_digit = password.chars().any(|c| c.is_numeric());

    if !has_letter || !has_digit {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Invalid password",
                "message": "Password must contain both letters and numbers for security"
            })),
        ));
    }

    Ok(())
}

/// Hash password using Argon2id
fn hash_password(password: &str) -> Result<String, (StatusCode, Json<Value>)> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();

    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| {
            tracing::error!("Failed to hash password: {:?}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Failed to process password"})),
            )
        })?
        .to_string();

    Ok(password_hash)
}

/// Verify password against hash
fn verify_password(password: &str, hash: &str) -> Result<(), (StatusCode, Json<Value>)> {
    let parsed_hash = PasswordHash::new(hash).map_err(|e| {
        tracing::error!("Failed to parse password hash: {:?}", e);
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to verify password"})),
        )
    })?;

    let argon2 = Argon2::default();

    argon2
        .verify_password(password.as_bytes(), &parsed_hash)
        .map_err(|_| {
            tracing::warn!("Password verification failed");
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "error": "Invalid credentials",
                    "message": "Username or password is incorrect"
                })),
            )
        })
}
