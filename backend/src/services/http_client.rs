//! 统一的 HTTP 客户端工厂
//!
//! 为所有需要访问外部 API 的服务提供统一的 HTTP 客户端，
//! 支持代理配置，方便中国大陆服务器访问外部服务。

use once_cell::sync::Lazy;
use reqwest::{Client, Proxy};
use std::sync::RwLock;
use std::time::Duration;

/// Shared Tapp outbound HTTP client (pooled, fixed timeouts, no dynamic proxy).
///
/// Used by declared-API / geo helpers and AI image fetch paths. Lives in services
/// so `tapp_api_service` does not import `crate::api::tapp_runtime`.
pub static TAPP_HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(Duration::from_secs(90))
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Myriad-Tapp/1.0")
        .build()
        .expect("Failed to create Tapp HTTP client")
});

/// 全局 HTTP 客户端（带代理支持）
static GLOBAL_HTTP_CLIENT: Lazy<RwLock<Option<Client>>> = Lazy::new(|| RwLock::new(None));

/// 代理配置
#[derive(Debug, Clone, Default)]
#[allow(dead_code)]
pub struct ProxyConfig {
    /// 是否启用代理
    pub enabled: bool,
    /// 代理 URL（如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080）
    pub proxy_url: Option<String>,
    /// 不使用代理的域名列表
    pub bypass_list: Vec<String>,
}

impl ProxyConfig {
    /// 从动态配置加载代理设置
    pub async fn from_dynamic_config() -> Self {
        use crate::GLOBAL_DYNAMIC_CONFIG;

        let config = GLOBAL_DYNAMIC_CONFIG.read().await;
        Self {
            enabled: config.proxy_enabled,
            proxy_url: config.proxy_url.clone().filter(|s| !s.is_empty()),
            bypass_list: config
                .proxy_bypass
                .clone()
                .map(|s| s.split(',').map(|s| s.trim().to_string()).collect())
                .unwrap_or_default(),
        }
    }

    /// 判断指定 URL 是否应该绕过代理
    #[allow(dead_code)]
    pub fn should_bypass(&self, url: &str) -> bool {
        for domain in &self.bypass_list {
            if url.contains(domain) {
                return true;
            }
        }
        false
    }

    /// 判断是否应该使用代理
    pub fn should_use_proxy(&self) -> bool {
        self.enabled && self.proxy_url.is_some()
    }
}

/// Apply dynamic proxy config (URL + NO_PROXY-style bypass) onto a client builder.
///
/// Shared by the global client factory, long-running clients, AiAnalyzer, and
/// Tencent speech so bypass list behavior stays consistent.
pub fn apply_proxy(
    mut builder: reqwest::ClientBuilder,
    proxy_config: &ProxyConfig,
) -> Result<reqwest::ClientBuilder, reqwest::Error> {
    if proxy_config.should_use_proxy() {
        if let Some(proxy_url) = &proxy_config.proxy_url {
            tracing::info!("🌐 Configuring HTTP proxy: {}", proxy_url);

            let mut proxy = Proxy::all(proxy_url)?;

            // Wire NO_PROXY-style bypass into reqwest (was log-only before).
            if !proxy_config.bypass_list.is_empty() {
                let bypass_str = proxy_config
                    .bypass_list
                    .iter()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join(",");
                tracing::debug!("🚫 Proxy bypass list: {}", bypass_str);
                if let Some(no_proxy) = reqwest::NoProxy::from_string(&bypass_str) {
                    proxy = proxy.no_proxy(Some(no_proxy));
                }
            }

            builder = builder.proxy(proxy);
        }
    } else {
        tracing::debug!("🔒 Proxy disabled, using direct connection");
    }
    Ok(builder)
}

/// 创建带代理支持的 HTTP 客户端
pub fn create_client_with_proxy(proxy_config: &ProxyConfig) -> Result<Client, reqwest::Error> {
    let builder = Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Myriad/1.0");

    apply_proxy(builder, proxy_config)?.build()
}

/// 创建不使用代理的 HTTP 客户端
#[allow(dead_code)]
pub fn create_client_no_proxy() -> Result<Client, reqwest::Error> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("Myriad/1.0")
        .no_proxy()
        .build()
}

/// 获取或创建全局 HTTP 客户端
///
/// 注意：这个客户端会在配置重载时更新
#[allow(dead_code)]
pub async fn get_global_client() -> Client {
    // 先尝试读取现有客户端
    {
        let guard = GLOBAL_HTTP_CLIENT.read().unwrap();
        if let Some(client) = guard.as_ref() {
            return client.clone();
        }
    }

    // 需要创建新客户端
    let proxy_config = ProxyConfig::from_dynamic_config().await;
    let client = create_client_with_proxy(&proxy_config).unwrap_or_else(|e| {
        tracing::error!("Failed to create HTTP client with proxy: {}", e);
        create_client_no_proxy().expect("Failed to create HTTP client")
    });

    // 存储并返回
    {
        let mut guard = GLOBAL_HTTP_CLIENT.write().unwrap();
        *guard = Some(client.clone());
    }

    client
}

/// 创建适合图片生成等长耗时上游请求的客户端。
///
/// 图片模型一次请求可能接近两分钟，因此不能复用普通 API 的 30 秒超时；
/// 代理来源仍与全局动态配置一致。
///
/// 目前由本地未合并的 `image_generation` 提供方使用；主线仍保留符号以免
/// 下游 WIP 反复分叉，故允许 dead_code。
#[allow(dead_code)]
pub async fn get_long_running_client() -> Client {
    // Image + long LLM-backed image APIs regularly exceed 2–3 minutes.
    let request_timeout = Duration::from_secs(360);
    let proxy_config = ProxyConfig::from_dynamic_config().await;
    let builder = Client::builder()
        .timeout(request_timeout)
        .connect_timeout(Duration::from_secs(15))
        .user_agent("Myriad-ImageGeneration/1.0");
    let builder = apply_proxy(builder, &proxy_config).unwrap_or_else(|error| {
        tracing::error!(%error, "Failed to apply proxy to long-running HTTP client");
        Client::builder()
            .timeout(request_timeout)
            .connect_timeout(Duration::from_secs(15))
            .user_agent("Myriad-ImageGeneration/1.0")
    });
    builder.build().unwrap_or_else(|error| {
        tracing::error!(%error, "Failed to create long-running HTTP client");
        Client::builder()
            .timeout(request_timeout)
            .connect_timeout(Duration::from_secs(15))
            .user_agent("Myriad-ImageGeneration/1.0")
            .build()
            .expect("Failed to create fallback image-generation HTTP client")
    })
}

/// 重新加载全局 HTTP 客户端（配置更新时调用）
pub async fn reload_global_client() {
    let proxy_config = ProxyConfig::from_dynamic_config().await;

    match create_client_with_proxy(&proxy_config) {
        Ok(client) => {
            let mut guard = GLOBAL_HTTP_CLIENT.write().unwrap();
            *guard = Some(client);
            tracing::info!("✅ Global HTTP client reloaded with new proxy config");
        }
        Err(e) => {
            tracing::error!("❌ Failed to reload HTTP client: {}", e);
        }
    }
}

/// GitHub API 相关的 URL 构建器
#[allow(dead_code)]
pub struct GitHubApiUrl;

#[allow(dead_code)]
impl GitHubApiUrl {
    /// 获取 GitHub API 基础 URL
    pub async fn get_api_base() -> String {
        use crate::GLOBAL_DYNAMIC_CONFIG;

        let config = GLOBAL_DYNAMIC_CONFIG.read().await;
        config
            .github_api_base_url
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "https://api.github.com".to_string())
    }

    /// 获取 GitHub OAuth 授权 URL
    pub async fn get_oauth_authorize_url() -> String {
        // GitHub OAuth 授权必须使用官方地址
        "https://github.com/login/oauth/authorize".to_string()
    }

    /// 获取 GitHub OAuth Token URL
    pub async fn get_oauth_token_url() -> String {
        // GitHub OAuth Token 交换必须使用官方地址
        "https://github.com/login/oauth/access_token".to_string()
    }

    /// 构建用户 API URL
    pub async fn user_url(username: &str) -> String {
        format!("{}/users/{}", Self::get_api_base().await, username)
    }

    /// 构建用户仓库 API URL
    pub async fn user_repos_url(username: &str, page: u32) -> String {
        format!(
            "{}/users/{}/repos?per_page=100&page={}&sort=updated",
            Self::get_api_base().await,
            username,
            page
        )
    }
}

/// Gemini API 相关的 URL 构建器
#[allow(dead_code)]
pub struct GeminiApiUrl;

#[allow(dead_code)]
impl GeminiApiUrl {
    /// 获取 Gemini API 基础 URL
    pub async fn get_base() -> String {
        use crate::GLOBAL_DYNAMIC_CONFIG;

        let config = GLOBAL_DYNAMIC_CONFIG.read().await;
        config
            .gemini_base_url
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "https://generativelanguage.googleapis.com".to_string())
    }

    /// 构建内容生成 API URL
    pub async fn generate_content_url(model: &str) -> String {
        format!(
            "{}/v1beta/models/{}:generateContent",
            Self::get_base().await,
            model
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::GLOBAL_DYNAMIC_CONFIG;
    use lazy_static::lazy_static;
    use tokio::sync::Mutex;

    lazy_static! {
        static ref TEST_MUTEX: Mutex<()> = Mutex::new(());
    }

    #[test]
    fn test_proxy_bypass() {
        let config = ProxyConfig {
            enabled: true,
            proxy_url: Some("http://127.0.0.1:7890".to_string()),
            bypass_list: vec![
                "localhost".to_string(),
                "bilibili.com".to_string(),
                "127.0.0.1".to_string(),
            ],
        };

        assert!(config.should_bypass("http://localhost:1103"));
        assert!(config.should_bypass("https://api.bilibili.com/x/web"));
        assert!(config.should_bypass("http://127.0.0.1:8080"));
        assert!(!config.should_bypass("https://api.github.com"));
        assert!(!config.should_bypass("https://api.openai.com"));
    }

    #[test]
    fn create_client_with_proxy_accepts_bypass_list() {
        let config = ProxyConfig {
            enabled: true,
            proxy_url: Some("http://127.0.0.1:9".to_string()),
            bypass_list: vec!["localhost".into(), "127.0.0.1".into(), "bilibili.com".into()],
        };
        // Must not ignore bypass: building with NoProxy must succeed.
        create_client_with_proxy(&config).expect("client with proxy + bypass");
    }

    #[test]
    fn apply_proxy_disabled_and_missing_url_stay_direct() {
        let disabled = ProxyConfig {
            enabled: false,
            proxy_url: Some("http://127.0.0.1:9".to_string()),
            bypass_list: vec![],
        };
        assert!(!disabled.should_use_proxy());
        apply_proxy(reqwest::Client::builder(), &disabled)
            .expect("disabled")
            .build()
            .expect("build");
        let no_url = ProxyConfig {
            enabled: true,
            proxy_url: None,
            bypass_list: vec!["localhost".into()],
        };
        assert!(!no_url.should_use_proxy());
        apply_proxy(reqwest::Client::builder(), &no_url)
            .expect("no url")
            .build()
            .expect("build");
    }

    #[test]
    fn apply_proxy_rejects_invalid_proxy_url() {
        let bad = ProxyConfig {
            enabled: true,
            proxy_url: Some("not a valid proxy url".to_string()),
            bypass_list: vec![],
        };
        assert!(bad.should_use_proxy());
        assert!(apply_proxy(reqwest::Client::builder(), &bad).is_err());
    }

    #[tokio::test]
    async fn github_api_base_url_should_follow_dynamic_config_runtime() {
        let _guard = TEST_MUTEX.lock().await;
        let original = { GLOBAL_DYNAMIC_CONFIG.read().await.clone() };

        {
            let mut config = GLOBAL_DYNAMIC_CONFIG.write().await;
            config.github_api_base_url = Some("https://mirror.example.com".to_string());
        }

        let base = GitHubApiUrl::get_api_base().await;
        assert_eq!(base, "https://mirror.example.com");

        {
            let mut config = GLOBAL_DYNAMIC_CONFIG.write().await;
            *config = original;
        }
    }

    #[tokio::test]
    async fn github_api_user_url_should_use_dynamic_base() {
        let _guard = TEST_MUTEX.lock().await;
        let original = { GLOBAL_DYNAMIC_CONFIG.read().await.clone() };

        {
            let mut config = GLOBAL_DYNAMIC_CONFIG.write().await;
            config.github_api_base_url = Some("https://mirror.local".to_string());
        }

        let url = GitHubApiUrl::user_url("octocat").await;
        assert_eq!(url, "https://mirror.local/users/octocat");

        {
            let mut config = GLOBAL_DYNAMIC_CONFIG.write().await;
            *config = original;
        }
    }
}
