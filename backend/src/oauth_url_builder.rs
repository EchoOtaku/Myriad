/// OAuth 配置结构体
/// 统一存储 GitHub OAuth 相关配置
#[derive(Debug, Clone)]
pub struct GitHubOAuthConfig {
    pub client_id: String,
    pub client_secret: String,
    pub redirect_url: String,
}

/// 站点配置 - 统一管理 base_url 相关功能
///
/// 设计原则：
/// 1. 数据库优先，配置为空时回退到环境变量
/// 2. base_url 承担多种功能：OAuth 回调、Cookie Secure 判断、前端重定向等
pub struct SiteConfig;

impl SiteConfig {
    /// 获取站点 base_url
    ///
    /// # 优先级
    /// 1. 数据库 DynamicConfig.base_url
    /// 2. 环境变量 BASE_URL 或 FRONTEND_URL
    /// 3. 开发默认值 http://localhost:4321
    pub async fn get_base_url() -> String {
        use crate::GLOBAL_DYNAMIC_CONFIG;
        use std::env;

        // 1. 优先从数据库读取
        let config = GLOBAL_DYNAMIC_CONFIG.read().await;
        if let Some(url) = &config.base_url {
            if !url.is_empty() {
                tracing::debug!("📍 Using base_url from database: {}", url);
                return url.trim_end_matches('/').to_string();
            }
        }
        drop(config); // 释放锁

        // 2. 回退到环境变量 BASE_URL
        if let Ok(url) = env::var("BASE_URL") {
            if !url.is_empty() {
                tracing::debug!("📍 Using BASE_URL from env: {}", url);
                return url.trim_end_matches('/').to_string();
            }
        }

        // 3. 回退到环境变量 FRONTEND_URL
        if let Ok(url) = env::var("FRONTEND_URL") {
            if !url.is_empty() {
                tracing::debug!("📍 Using FRONTEND_URL from env: {}", url);
                return url.trim_end_matches('/').to_string();
            }
        }

        // 4. 开发默认值
        tracing::warn!("⚠️ No base_url configured, using localhost default");
        "http://localhost:4321".to_string()
    }

    /// 判断是否为生产环境（HTTPS）
    ///
    /// 根据 base_url 是否以 https:// 开头判断
    pub async fn is_production() -> bool {
        let base_url = Self::get_base_url().await;
        base_url.starts_with("https://")
    }
}

/// OAuth URL构建器
///
/// 设计原则：
/// 1. OAuth 凭证：数据库优先，回退到环境变量
/// 2. redirect_url：自动从 base_url 生成
pub struct OAuthUrlBuilder;

impl OAuthUrlBuilder {
    /// 获取 GitHub OAuth 完整配置
    ///
    /// # 配置来源优先级
    /// - github_client_id: 数据库 > 环境变量
    /// - github_client_secret: 数据库 > 环境变量
    /// - redirect_url: 自动从 base_url 生成
    pub async fn get_github_oauth_config() -> Result<GitHubOAuthConfig, String> {
        use crate::GLOBAL_DYNAMIC_CONFIG;
        use std::env;

        let config = GLOBAL_DYNAMIC_CONFIG.read().await;

        // client_id: 数据库 > 环境变量
        let client_id = config
            .github_client_id
            .clone()
            .filter(|s| !s.is_empty())
            .or_else(|| env::var("GITHUB_CLIENT_ID").ok().filter(|s| !s.is_empty()))
            .ok_or_else(|| {
                "GitHub OAuth not configured: missing client_id. \
                Please configure in Settings > OAuth or set GITHUB_CLIENT_ID env."
                    .to_string()
            })?;

        // client_secret: 数据库 > 环境变量
        let client_secret = config
            .github_client_secret
            .clone()
            .filter(|s| !s.is_empty())
            .or_else(|| {
                env::var("GITHUB_CLIENT_SECRET")
                    .ok()
                    .filter(|s| !s.is_empty())
            })
            .ok_or_else(|| {
                "GitHub OAuth not configured: missing client_secret. \
                Please configure in Settings > OAuth or set GITHUB_CLIENT_SECRET env."
                    .to_string()
            })?;

        drop(config); // 释放锁

        // redirect_url: 自动从 base_url 生成
        let base_url = SiteConfig::get_base_url().await;
        let redirect_url = format!("{}/api/auth/github/callback", base_url);

        tracing::info!(
            "🔐 GitHub OAuth config - client_id: {}..., redirect_url: {}",
            &client_id[..8.min(client_id.len())],
            redirect_url
        );

        Ok(GitHubOAuthConfig {
            client_id,
            client_secret,
            redirect_url,
        })
    }

    /// 获取前端 URL（用于 OAuth 成功后重定向）
    pub async fn get_frontend_url() -> String {
        SiteConfig::get_base_url().await
    }

    /// 验证 OAuth 配置（启动时调用）
    pub async fn validate_github_oauth_config() -> Result<(), String> {
        let base_url = SiteConfig::get_base_url().await;

        // 检查 base_url
        if base_url.contains("localhost") {
            tracing::warn!(
                "⚠️ base_url is localhost: {} - not suitable for production",
                base_url
            );
            tracing::warn!("   Set BASE_URL env or configure in Settings > Site");
        } else {
            tracing::info!("✅ Site base_url: {}", base_url);
        }

        // 检查 OAuth 凭证
        match Self::get_github_oauth_config().await {
            Ok(config) => {
                tracing::info!("✅ GitHub OAuth configured");
                tracing::info!("   redirect_url: {}", config.redirect_url);
                tracing::info!("   ⚠️ Ensure this URL is registered in GitHub OAuth App!");
            }
            Err(e) => {
                tracing::warn!("⚠️ GitHub OAuth not configured: {}", e);
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    // 测试需要模拟数据库，这里暂时跳过
}
