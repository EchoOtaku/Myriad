//! WebSocket Origin checks for cookie-authenticated upgrades.
//!
//! CSRF middleware only covers mutating HTTP methods. Browser WS upgrades are
//! GET and send `auth_token` cookies automatically — Origin allowlisting is
//! defense-in-depth against cross-site WS CSRF.

use axum::Json;
use axum::http::{HeaderMap, StatusCode};
use serde_json::json;

/// Reject browser cookie sessions when `Origin` is missing or not allowlisted.
///
/// - **Allowlisted Origin** (CORS / site origins): ok
/// - **Missing Origin**: allow only when this looks like a non-browser client
/// (no `Sec-Fetch-Mode: websocket` / no cookie-style `Cookie` header is too
/// weak). We require Origin when a `Cookie` header is present.
/// - **Disallowed Origin**: 403
pub fn assert_ws_origin_for_cookie_session(
    headers: &HeaderMap,
    allowed_origins: &[String],
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    let has_cookie = headers
        .get(axum::http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|c| !c.trim().is_empty());

    let origin = headers
        .get(axum::http::header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    // Bearer-only clients often omit Origin; cookie sessions must present one.
    if !has_cookie {
        return Ok(());
    }

    let Some(origin) = origin else {
        tracing::warn!("Rejected cookie-session WebSocket upgrade without Origin");
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Forbidden",
                "message": "WebSocket Origin required for cookie sessions"
            })),
        ));
    };

    if origin_allowed(origin, allowed_origins) {
        return Ok(());
    }

    tracing::warn!(%origin, "Rejected WebSocket upgrade with disallowed Origin");
    Err((
        StatusCode::FORBIDDEN,
        Json(json!({
            "error": "Forbidden",
            "message": "WebSocket Origin not allowed"
        })),
    ))
}

fn origin_allowed(origin: &str, allowed: &[String]) -> bool {
    if allowed.iter().any(|a| a.trim() == origin) {
        return true;
    }
    // Development defaults when allowed list empty (matches router CORS fallback).
    // Production must not accept localhost when CORS was never configured.
    if allowed.is_empty() {
        let is_production = std::env::var("ENVIRONMENT")
            .map(|s| s.trim() == "production")
            .unwrap_or(false);
        if is_production {
            return false;
        }
        matches!(
            origin,
            "http://localhost:1102"
                | "http://localhost:1103"
                | "http://127.0.0.1:1102"
                | "http://127.0.0.1:1103"
        )
    } else {
        false
    }
}

/// Read allowed origins from the process config Arc (same list as CORS).
pub async fn allowed_origins_from_global_config() -> Vec<String> {
    let cfg = crate::GLOBAL_CONFIG.read().await;
    cfg.cors_origins.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn allows_bearer_without_origin() {
        let headers = HeaderMap::new();
        assert!(assert_ws_origin_for_cookie_session(&headers, &[]).is_ok());
    }

    #[test]
    fn rejects_cookie_without_origin() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::COOKIE,
            HeaderValue::from_static("auth_token=abc"),
        );
        assert!(assert_ws_origin_for_cookie_session(&headers, &[]).is_err());
    }

    #[test]
    fn allows_cookie_with_dev_origin() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::COOKIE,
            HeaderValue::from_static("auth_token=abc"),
        );
        headers.insert(
            axum::http::header::ORIGIN,
            HeaderValue::from_static("http://localhost:1102"),
        );
        // Empty allowed list → dev localhost fallback (skip if ENVIRONMENT=production).
        if std::env::var("ENVIRONMENT")
            .map(|s| s.trim() == "production")
            .unwrap_or(false)
        {
            assert!(assert_ws_origin_for_cookie_session(&headers, &[]).is_err());
        } else {
            assert!(assert_ws_origin_for_cookie_session(&headers, &[]).is_ok());
        }
    }

    #[test]
    fn rejects_cookie_with_foreign_origin() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::COOKIE,
            HeaderValue::from_static("auth_token=abc"),
        );
        headers.insert(
            axum::http::header::ORIGIN,
            HeaderValue::from_static("https://evil.example"),
        );
        let allowed = vec!["https://my.site".to_string()];
        assert!(assert_ws_origin_for_cookie_session(&headers, &allowed).is_err());
    }

    #[test]
    fn empty_allowed_list_localhost_helper() {
        // Pure allowlist path: non-empty list never uses localhost fallback.
        assert!(!origin_allowed(
            "http://localhost:1102",
            &["https://my.site".to_string()]
        ));
        assert!(origin_allowed(
            "https://my.site",
            &["https://my.site".to_string()]
        ));
    }
}
