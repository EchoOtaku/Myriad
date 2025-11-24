use serde::{Deserialize, Serialize};
use std::env;

/// 核心应用配置（从环境变量读取）
/// 这些是应用启动所必需的基础设施配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    /// 数据库连接URL
    pub database_url: String,
    /// 服务器监听地址
    pub server_host: String,
    /// 服务器监听端口
    pub server_port: u16,
    /// 前端静态文件路径
    pub frontend_dist_path: String,
    /// JWT密钥
    pub jwt_secret: String,
    /// CORS允许的源
    pub cors_origins: Vec<String>,
    /// 基础URL（用于自动生成OAuth回调等URL）
    pub base_url: Option<String>,
    /// 前端URL（用于OAuth成功后重定向）
    pub frontend_url: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            database_url: String::new(),
            server_host: "127.0.0.1".to_string(),
            server_port: 3000,
            frontend_dist_path: "../frontend/dist".to_string(),
            jwt_secret: String::new(),
            cors_origins: vec![
                "http://localhost:4321".to_string(),
                "http://localhost:3000".to_string(),
            ],
            base_url: None,
            frontend_url: None,
        }
    }
}

impl AppConfig {
    /// 从环境变量加载配置
    pub fn from_env() -> anyhow::Result<Self> {
        let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| String::new());

        // Validate JWT secret strength in production
        if !jwt_secret.is_empty() {
            Self::validate_jwt_secret(&jwt_secret)?;
        }

        Ok(Self {
            database_url: env::var("DATABASE_URL").unwrap_or_else(|_| String::new()),
            server_host: env::var("SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            server_port: env::var("SERVER_PORT")
                .ok()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "3000".to_string())
                .parse()?,
            frontend_dist_path: env::var("FRONTEND_DIST_PATH")
                .unwrap_or_else(|_| "../frontend/dist".to_string()),
            jwt_secret,
            cors_origins: env::var("CORS_ORIGINS")
                .unwrap_or_else(|_| "http://localhost:4321,http://localhost:3000".to_string())
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            base_url: env::var("BASE_URL").ok().filter(|s| !s.is_empty()),
            frontend_url: env::var("FRONTEND_URL").ok().filter(|s| !s.is_empty()),
        })
    }

    /// 验证 JWT Secret 强度
    fn validate_jwt_secret(secret: &str) -> anyhow::Result<()> {
        // Minimum length check (32 characters recommended)
        if secret.len() < 32 {
            anyhow::bail!(
                "JWT_SECRET is too weak. Must be at least 32 characters. \
                Generate a strong secret with: openssl rand -base64 32"
            );
        }

        // Warn if using obvious weak values
        let weak_secrets = [
            "secret",
            "your-secret-key-here",
            "change-me",
            "changeme",
            "your_secret_key_here",
            "your-secret-key-here-change-in-production",
        ];

        let secret_lower = secret.to_lowercase();
        if weak_secrets.iter().any(|&weak| secret_lower.contains(weak)) {
            anyhow::bail!(
                "JWT_SECRET contains weak/default value. \
                Generate a strong secret with: openssl rand -base64 32"
            );
        }

        Ok(())
    }

    /// 验证配置是否完整
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.database_url.is_empty() {
            anyhow::bail!("DATABASE_URL is required");
        }
        if self.jwt_secret.is_empty() {
            anyhow::bail!("JWT_SECRET is required");
        }

        Self::validate_jwt_secret(&self.jwt_secret)?;

        Ok(())
    }
}

/// 应用级配置（从数据库读取）
/// 这些配置可以在运行时通过API修改
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DynamicConfig {
    // AI 配置
    pub ai_provider: String,
    pub gemini_api_key: Option<String>,
    pub gemini_model: String,
    pub openai_api_key: Option<String>,
    pub openai_model: String,
    pub openai_base_url: String,
    pub deepseek_api_key: Option<String>,
    pub deepseek_model: String,
    pub openai_max_tokens: i32,
    pub topic_style: String,

    // 平台配置
    pub github_token: Option<String>,
    pub github_username: Option<String>,
    pub bilibili_uid: Option<String>,
    pub steam_api_key: Option<String>,
    pub steam_id: Option<String>,
    pub netease_user_id: Option<String>,
    pub twitter_bearer_token: Option<String>,
    pub linkedin_access_token: Option<String>,

    // UI 配置
    pub ui_wallpaper_url: Option<String>,
    pub ui_wallpaper_blur: i32,
    pub ui_theme: Option<String>,
    pub ui_primary_color: Option<String>,
    pub ui_secondary_color: Option<String>,
    pub pet_enabled: bool,
    pub pet_image_url: Option<String>,

    // 站点元数据
    pub site_title: Option<String>,
    pub site_description: Option<String>,
    pub site_favicon: Option<String>,

    // 音乐配置
    pub music_enabled: Option<String>,
    pub music_source: Option<String>,
    pub music_playlist_id: Option<String>,

    // Twitter 额外字段
    pub twitter_username: Option<String>,

    // 功能配置
    pub persona_image_enabled: bool,
    pub persona_image_provider: String, // "pollinations" 或 "imaginepro"
    pub persona_image_model: String,
    pub persona_image_width: i32,
    pub persona_image_height: i32,
    pub imaginepro_api_key: Option<String>,
    pub imaginepro_callback_url: Option<String>,
    pub enable_auto_fetch: bool,
    pub fetch_interval_hours: i32,

    // OAuth 配置
    pub github_client_id: Option<String>,
    pub github_client_secret: Option<String>,
    pub github_redirect_url: String,

    // 仪表盘配置
    pub dashboard_layout: Option<String>,
    pub dashboard_title: Option<String>,
}

impl Default for DynamicConfig {
    fn default() -> Self {
        Self {
            ai_provider: "gemini".to_string(),
            gemini_api_key: None,
            gemini_model: "gemini-2.0-flash-exp".to_string(),
            openai_api_key: None,
            openai_model: "gpt-4".to_string(),
            openai_base_url: "https://api.openai.com/v1".to_string(),
            deepseek_api_key: None,
            deepseek_model: "deepseek-chat".to_string(),
            openai_max_tokens: 2000,
            topic_style: "balanced".to_string(),

            github_token: None,
            github_username: None,
            bilibili_uid: None,
            steam_api_key: None,
            steam_id: None,
            netease_user_id: None,
            twitter_bearer_token: None,
            linkedin_access_token: None,

            ui_wallpaper_url: None,
            ui_wallpaper_blur: 3,
            ui_theme: None,
            ui_primary_color: None,
            ui_secondary_color: None,
            pet_enabled: true,
            pet_image_url: None,

            site_title: None,
            site_description: None,
            site_favicon: None,

            music_enabled: None,
            music_source: None,
            music_playlist_id: None,

            twitter_username: None,

            persona_image_enabled: true,
            persona_image_provider: "pollinations".to_string(),
            persona_image_model: "flux-anime".to_string(),
            persona_image_width: 512,
            persona_image_height: 768,
            imaginepro_api_key: None,
            imaginepro_callback_url: None,
            enable_auto_fetch: false,
            fetch_interval_hours: 24,

            github_client_id: None,
            github_client_secret: None,
            github_redirect_url: "http://localhost:3000/api/auth/github/callback".to_string(),

            dashboard_layout: None,
            dashboard_title: None,
        }
    }
}
