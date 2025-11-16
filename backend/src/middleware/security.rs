use axum::{extract::Request, http::header, middleware::Next, response::Response};
use std::env;

/// Security headers middleware - adds CSP and other security headers
pub async fn security_headers_middleware(req: Request, next: Next) -> Response {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();

    // Content Security Policy (CSP)
    let is_production =
        env::var("ENVIRONMENT").unwrap_or_else(|_| "development".to_string()) == "production";

    let csp = if is_production {
        // PRODUCTION: Strict CSP for executable content, relaxed for assets
        concat!(
            "default-src 'self'; ",
            "script-src 'self'; ", // STRICT: No unsafe-inline/unsafe-eval
            "style-src 'self' 'unsafe-inline' https:; ", // Allow external stylesheets and inline
            "img-src * data: blob:; ", // RELAXED: Allow all image sources
            "font-src 'self' data: https: blob:; ", // RELAXED: Allow external fonts
            "media-src 'self' https: blob:; ", // RELAXED: Allow external media
            "connect-src 'self' https:; ", // Allow external API calls
            "object-src 'none'; ", // STRICT: No plugins
            "base-uri 'self'; ",   // STRICT: Prevent base tag injection
            "form-action 'self'; ", // STRICT: Forms to same origin only
            "frame-ancestors 'none'; ", // STRICT: Prevent clickjacking
            "frame-src 'none'; ",  // STRICT: No iframes
            "worker-src 'self' blob:; ", // Allow service workers
            "manifest-src 'self'; ", // PWA manifest
            "upgrade-insecure-requests; "  // Force HTTPS
        )
    } else {
        // DEVELOPMENT: Relaxed CSP for hot reload and dev tools
        concat!(
            "default-src 'self'; ",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; ", // Dev tools need eval
            "style-src 'self' 'unsafe-inline' https:; ",
            "img-src * data: blob:; ",
            "font-src 'self' data: https: blob:; ",
            "media-src 'self' https: blob:; ",
            "connect-src 'self' ws: wss: https:; ", // WebSocket for HMR
            "object-src 'none'; ",
            "base-uri 'self'; ",
            "worker-src 'self' blob:; "
        )
    };

    if is_production || env::var("ENABLE_CSP_DEV").unwrap_or_default() == "true" {
        headers.insert(header::CONTENT_SECURITY_POLICY, csp.parse().unwrap());
        tracing::debug!(
            "CSP enabled: {}",
            if is_production {
                "production"
            } else {
                "development"
            }
        );
    } else {
        tracing::debug!("CSP disabled in development mode (set ENABLE_CSP_DEV=true to enable)");
    }

    // X-Content-Type-Options: 防止MIME类型嗅探
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, "nosniff".parse().unwrap());

    // X-Frame-Options: 防止点击劫持
    headers.insert(header::X_FRAME_OPTIONS, "DENY".parse().unwrap());

    // X-XSS-Protection: XSS过滤器（虽然现代浏览器已不需要，但为了兼容性保留）
    headers.insert(
        "X-XSS-Protection".parse::<header::HeaderName>().unwrap(),
        "1; mode=block".parse().unwrap(),
    );

    // Referrer-Policy: 控制Referrer信息泄漏
    headers.insert(
        header::REFERRER_POLICY,
        "strict-origin-when-cross-origin".parse().unwrap(),
    );

    // Permissions-Policy: 禁用不需要的浏览器功能
    headers.insert(
        "Permissions-Policy".parse::<header::HeaderName>().unwrap(),
        "geolocation=(), microphone=(), camera=()".parse().unwrap(),
    );

    // Strict-Transport-Security: 强制HTTPS（仅生产环境）
    if is_production {
        headers.insert(
            header::STRICT_TRANSPORT_SECURITY,
            "max-age=31536000; includeSubDomains".parse().unwrap(),
        );
    }

    response
}
