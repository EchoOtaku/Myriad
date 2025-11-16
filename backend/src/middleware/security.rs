use axum::{extract::Request, http::header, middleware::Next, response::Response};
use std::env;

/// Security headers middleware - adds CSP and other security headers
pub async fn security_headers_middleware(req: Request, next: Next) -> Response {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();

    // Content Security Policy (CSP)
    // 宽松模式：只限制脚本来源，防止XSS注入
    let csp = concat!(
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; ", // 只允许同源脚本和内联脚本
        "object-src 'none'; ",                               // 禁止 <object>, <embed>, <applet>
        "base-uri 'self'; ",                                 // 限制 <base> 标签
    );

    // 开发环境使用宽松的CSP
    let is_production =
        env::var("ENVIRONMENT").unwrap_or_else(|_| "development".to_string()) == "production";

    if is_production {
        headers.insert(header::CONTENT_SECURITY_POLICY, csp.parse().unwrap());
    } else {
        // 开发环境不启用CSP，避免热重载问题
        tracing::debug!("CSP disabled in development mode");
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
