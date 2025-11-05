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
        }
    }
}

impl AppConfig {
    /// 从环境变量加载配置
    pub fn from_env() -> anyhow::Result<Self> {
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
            jwt_secret: env::var("JWT_SECRET").unwrap_or_else(|_| String::new()),
            cors_origins: env::var("CORS_ORIGINS")
                .unwrap_or_else(|_| "http://localhost:4321,http://localhost:3000".to_string())
                .split(',')
                .map(|s| s.trim().to_string())
                .collect(),
        })
    }

    /// 验证配置是否完整
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.database_url.is_empty() {
            anyhow::bail!("DATABASE_URL is required");
        }
        if self.jwt_secret.is_empty() {
            anyhow::bail!("JWT_SECRET is required");
        }
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
    pub pet_enabled: bool,
    pub pet_image_url: Option<String>,

    // 功能配置
    pub image_gen_enabled: bool,
    pub image_gen_model: String,
    pub image_gen_width: i32,
    pub image_gen_height: i32,
    pub enable_auto_fetch: bool,
    pub fetch_interval_hours: i32,

    // OAuth 配置
    pub github_client_id: Option<String>,
    pub github_client_secret: Option<String>,
    pub github_redirect_url: String,
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
            pet_enabled: true,
            pet_image_url: None,

            image_gen_enabled: true,
            image_gen_model: "flux-anime".to_string(),
            image_gen_width: 512,
            image_gen_height: 512,
            enable_auto_fetch: false,
            fetch_interval_hours: 24,

            github_client_id: None,
            github_client_secret: None,
            github_redirect_url: "http://localhost:3000/api/auth/github/callback".to_string(),
        }
    }
}
