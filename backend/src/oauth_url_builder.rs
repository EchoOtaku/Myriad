use axum::http::HeaderMap;
use std::env;

/// OAuth URL构建器 - 自动适配各种生产环境
///
/// 支持的环境配置方式（按优先级从高到低）：
/// 1. GITHUB_REDIRECT_URL 环境变量（完整URL）
/// 2. 从请求头动态检测（支持反向代理）
/// 3. 手动配置的 BASE_URL + 路径
/// 4. 开发环境默认值
pub struct OAuthUrlBuilder;

impl OAuthUrlBuilder {
    /// 获取GitHub OAuth回调URL
    ///
    /// # 优先级
    /// 1. `GITHUB_REDIRECT_URL` - 显式配置的回调URL（推荐用于生产环境）
    /// 2. 动态检测 - 从请求头检测 (X-Forwarded-Proto + X-Forwarded-Host + Host)
    /// 3. `BASE_URL` + "/api/auth/github/callback" - 基础URL配置
    /// 4. 开发环境默认值 - http://localhost:3000/api/auth/github/callback
    ///
    /// # 生产环境最佳实践
    /// ```bash
    /// # 方式1：显式配置（最安全，推荐）
    /// GITHUB_REDIRECT_URL=https://yourdomain.com/api/auth/github/callback
    ///
    /// # 方式2：使用基础URL（适合多环境）
    /// BASE_URL=https://yourdomain.com
    ///
    /// # 方式3：依赖反向代理头（Nginx/Caddy等）
    /// # 确保代理配置正确转发请求头
    /// ```
    pub fn get_github_redirect_url(headers: Option<&HeaderMap>) -> String {
        // 1. 优先使用显式配置的回调URL
        if let Ok(url) = env::var("GITHUB_REDIRECT_URL") {
            if !url.is_empty() && url != "http://localhost:3000/api/auth/github/callback" {
                tracing::debug!("Using explicit GITHUB_REDIRECT_URL: {}", url);
                return url;
            }
        }

        // 2. 尝试从请求头动态检测（支持反向代理）
        if let Some(headers) = headers {
            if let Some(url) = Self::detect_url_from_headers(headers) {
                let redirect_url = format!("{}/api/auth/github/callback", url);
                tracing::debug!("Detected redirect URL from headers: {}", redirect_url);
                return redirect_url;
            }
        }

        // 3. 使用 BASE_URL 配置
        if let Ok(base_url) = env::var("BASE_URL") {
            if !base_url.is_empty() {
                let url = base_url.trim_end_matches('/');
                let redirect_url = format!("{}/api/auth/github/callback", url);
                tracing::debug!("Using BASE_URL: {}", redirect_url);
                return redirect_url;
            }
        }

        // 4. 开发环境默认值
        let default_url = "http://localhost:3000/api/auth/github/callback".to_string();
        tracing::warn!(
            "No OAuth redirect URL configured, using default: {}. \
            For production, please set GITHUB_REDIRECT_URL or BASE_URL",
            default_url
        );
        default_url
    }

    /// 获取前端URL（用于OAuth成功后重定向）
    ///
    /// # 优先级
    /// 1. `FRONTEND_URL` - 显式配置的前端URL
    /// 2. 动态检测 - 从请求头检测
    /// 3. `BASE_URL` - 基础URL配置
    /// 4. 开发环境默认值
    pub fn get_frontend_url(headers: Option<&HeaderMap>) -> String {
        // 1. 显式配置的前端URL
        if let Ok(url) = env::var("FRONTEND_URL") {
            if !url.is_empty() && url != "http://localhost:4321" {
                tracing::debug!("Using explicit FRONTEND_URL: {}", url);
                return url.trim_end_matches('/').to_string();
            }
        }

        // 2. 从请求头动态检测
        if let Some(headers) = headers {
            if let Some(url) = Self::detect_url_from_headers(headers) {
                tracing::debug!("Detected frontend URL from headers: {}", url);
                return url;
            }
        }

        // 3. 使用 BASE_URL
        if let Ok(base_url) = env::var("BASE_URL") {
            if !base_url.is_empty() {
                let url = base_url.trim_end_matches('/').to_string();
                tracing::debug!("Using BASE_URL for frontend: {}", url);
                return url;
            }
        }

        // 4. 开发环境默认值
        let default_url = "http://localhost:4321".to_string();
        tracing::warn!(
            "No frontend URL configured, using default: {}. \
            For production, please set FRONTEND_URL or BASE_URL",
            default_url
        );
        default_url
    }

    /// 从请求头检测完整URL（支持反向代理）
    ///
    /// # 支持的请求头
    /// - X-Forwarded-Proto: https
    /// - X-Forwarded-Host: yourdomain.com
    /// - Host: yourdomain.com
    /// - X-Forwarded-Prefix: /path (可选，支持子路径部署)
    ///
    /// # Nginx配置示例
    /// ```nginx
    /// location / {
    ///     proxy_pass http://backend:3000;
    ///     proxy_set_header Host $host;
    ///     proxy_set_header X-Forwarded-Proto $scheme;
    ///     proxy_set_header X-Forwarded-Host $host;
    ///     proxy_set_header X-Real-IP $remote_addr;
    /// }
    /// ```
    fn detect_url_from_headers(headers: &HeaderMap) -> Option<String> {
        // 检测协议 (http/https)
        let proto = headers
            .get("x-forwarded-proto")
            .and_then(|v| v.to_str().ok())
            .or_else(|| {
                // 备用：从 X-Forwarded-Ssl 判断
                headers
                    .get("x-forwarded-ssl")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| if v == "on" { Some("https") } else { None })
            })
            .unwrap_or("http");

        // 检测主机名
        let host = headers
            .get("x-forwarded-host")
            .and_then(|v| v.to_str().ok())
            .or_else(|| headers.get("host").and_then(|v| v.to_str().ok()))?;

        // 检测路径前缀（用于子路径部署）
        let prefix = headers
            .get("x-forwarded-prefix")
            .and_then(|v| v.to_str().ok())
            .filter(|s| !s.is_empty())
            .map(|s| s.trim_end_matches('/'))
            .unwrap_or("");

        // 构建完整URL
        let url = if prefix.is_empty() {
            format!("{}://{}", proto, host)
        } else {
            format!("{}://{}{}", proto, host, prefix)
        };

        tracing::debug!(
            "Detected URL from headers - proto: {}, host: {}, prefix: {}, final: {}",
            proto,
            host,
            prefix,
            url
        );

        Some(url)
    }

    /// 验证回调URL是否与GitHub OAuth配置匹配
    /// 用于启动时检查配置是否正确
    pub fn validate_github_oauth_config() -> Result<(), String> {
        let redirect_url = Self::get_github_redirect_url(None);

        // 检查是否使用了开发环境默认值
        if redirect_url == "http://localhost:3000/api/auth/github/callback" {
            tracing::warn!(
                "⚠️  GitHub OAuth using development default URL: {}",
                redirect_url
            );
            tracing::warn!("   For production, please configure:");
            tracing::warn!("   - GITHUB_REDIRECT_URL=https://yourdomain.com/api/auth/github/callback");
            tracing::warn!("   - Or BASE_URL=https://yourdomain.com");
        }

        // 检查URL格式
        if !redirect_url.starts_with("http://") && !redirect_url.starts_with("https://") {
            return Err(format!("Invalid redirect URL format: {}", redirect_url));
        }

        // 检查是否包含必要的路径
        if !redirect_url.contains("/api/auth/github/callback") {
            return Err(format!(
                "Redirect URL must end with /api/auth/github/callback, got: {}",
                redirect_url
            ));
        }

        // 生产环境检查：不应该使用 localhost
        if let Ok(env) = env::var("ENVIRONMENT") {
            if (env == "production" || env == "prod") && redirect_url.contains("localhost") {
                return Err(
                    "Production environment should not use localhost URLs. \
                    Please set GITHUB_REDIRECT_URL or BASE_URL to your domain."
                        .to_string(),
                );
            }
        }

        tracing::info!("✅ GitHub OAuth redirect URL validated: {}", redirect_url);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn test_explicit_redirect_url() {
        env::set_var("GITHUB_REDIRECT_URL", "https://example.com/api/auth/github/callback");
        let url = OAuthUrlBuilder::get_github_redirect_url(None);
        assert_eq!(url, "https://example.com/api/auth/github/callback");
        env::remove_var("GITHUB_REDIRECT_URL");
    }

    #[test]
    fn test_detect_from_headers_https() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));
        headers.insert("x-forwarded-host", HeaderValue::from_static("example.com"));

        let url = OAuthUrlBuilder::detect_url_from_headers(&headers);
        assert_eq!(url, Some("https://example.com".to_string()));
    }

    #[test]
    fn test_detect_from_headers_with_prefix() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));
        headers.insert("host", HeaderValue::from_static("example.com"));
        headers.insert("x-forwarded-prefix", HeaderValue::from_static("/app"));

        let url = OAuthUrlBuilder::detect_url_from_headers(&headers);
        assert_eq!(url, Some("https://example.com/app".to_string()));
    }

    #[test]
    fn test_base_url_fallback() {
        env::remove_var("GITHUB_REDIRECT_URL");
        env::set_var("BASE_URL", "https://myapp.com");

        let url = OAuthUrlBuilder::get_github_redirect_url(None);
        assert_eq!(url, "https://myapp.com/api/auth/github/callback");

        env::remove_var("BASE_URL");
    }

    #[test]
    fn test_frontend_url_explicit() {
        env::set_var("FRONTEND_URL", "https://app.example.com");
        let url = OAuthUrlBuilder::get_frontend_url(None);
        assert_eq!(url, "https://app.example.com");
        env::remove_var("FRONTEND_URL");
    }
}
