use axum::{
    extract::Request,
    http::{header, HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use jsonwebtoken::{decode, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::env;

/// JWT Claims structure (must match auth.rs)
#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,      // User ID
    pub username: String, // Username
    pub exp: i64,         // Expiration time
    pub iat: i64,         // Issued at
}

/// Authentication middleware - verifies JWT token
/// Returns 401 if token is missing or invalid
pub async fn auth_middleware(req: Request, next: Next) -> Response {
    let headers = req.headers();

    match verify_jwt_token(headers) {
        Ok(_claims) => {
            // Token is valid, proceed to next handler
            next.run(req).await
        }
        Err(error_response) => *error_response,
    }
}

/// Admin-only middleware - verifies JWT token and checks admin status
/// Returns 403 if user is not an admin
///
/// Note: This middleware is reserved for future use when admin-only endpoints are needed.
/// Currently not used in routes, but kept for future expansion.
#[allow(dead_code)]
pub async fn admin_middleware(req: Request, next: Next) -> Response {
    let headers = req.headers();

    match verify_jwt_token(headers) {
        Ok(claims) => {
            // TODO: Check if user is admin from database
            // For now, we'll check if username matches admin pattern or add is_admin claim
            // You should add is_admin to JWT Claims structure

            // Temporary: Allow all authenticated users (should be fixed)
            // In production, query database to verify admin status:
            // SELECT is_admin FROM users WHERE id = claims.sub

            tracing::warn!(
                "⚠️  Admin check not fully implemented for user: {}. Allowing access.",
                claims.username
            );

            next.run(req).await
        }
        Err(error_response) => *error_response,
    }
}

/// Verify JWT token from Authorization header or Cookie
fn verify_jwt_token(headers: &HeaderMap) -> Result<Claims, Box<Response>> {
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
            tracing::warn!("Missing or invalid Authorization header/cookie");
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
        tracing::warn!("Invalid JWT token: {:?}", e);
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
#[allow(dead_code)]
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
