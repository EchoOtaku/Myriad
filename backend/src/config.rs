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
    pub openai_max_tokens: i32,
    pub topic_style: String,

    // 平台配置
    pub github_token: Option<String>,
    pub github_username: Option<String>,
    pub bilibili_uid: Option<String>,
    pub steam_api_key: Option<String>,
    pub steam_id: Option<String>,
    pub netease_user_id: Option<String>,

    // Tapp 外部 API 密钥（用于 Tapp API 声明系统）
    pub openweather_api_key: Option<String>,

    // UI 配置
    pub ui_wallpaper_url: Option<String>,
    pub ui_wallpaper_blur: i32,
    pub ui_wallpaper_parallax: bool,
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

    // AI 图片生成配置（从虚拟人设移动过来）
    pub ai_image_provider: String, // "pollinations" 或 "imaginepro"
    pub ai_image_model: String,
    pub ai_image_width: i32,
    pub ai_image_height: i32,
    pub imaginepro_api_key: Option<String>,
    pub imaginepro_callback_url: Option<String>,

    // 自动数据获取配置
    pub enable_auto_fetch: bool,
    pub fetch_interval_hours: i32,

    // OAuth 配置
    pub github_client_id: Option<String>,
    pub github_client_secret: Option<String>,
    pub github_redirect_url: String,

    // 站点 URL 配置（用于自动生成 OAuth 回调等 URL）
    pub base_url: Option<String>,

    // 仪表盘配置
    pub dashboard_layout: Option<String>,
    pub dashboard_title: Option<String>,
    pub custom_platforms: Option<String>, // 自定义社交平台数据 (JSON)

    // 控制面板小组件配置
    pub control_panel_layout: Option<String>,
    pub control_panel_rows: i32,

    // Tapp 多窗口方案配置
    pub tapp_window_schemes: Option<String>, // 窗口方案数据 (JSON)

    // ========== Tapp 权限下放配置 ==========
    // 基于 Tapp 系统的 elevated 级别权限（共12个）
    // 这些权限默认只有管理员可用，可以配置下放给普通用户或游客
    // 注意：basic 级别权限（10个）默认所有用户都有
    // 注意：privileged 级别权限（component:agent, platform:write, platform:register）始终只限管理员

    // ===== 普通用户可使用的 elevated 权限 (10个) =====
    /// ai:generate - AI 生成内容
    pub user_perm_ai_generate: bool,
    /// ai:analyze - AI 分析数据
    pub user_perm_ai_analyze: bool,
    /// ai:chat - AI 对话
    pub user_perm_ai_chat: bool,
    /// ai:image - AI 图片生成
    pub user_perm_ai_image: bool,
    /// report:write - 写入/生成报告
    pub user_perm_report_write: bool,
    /// network:fetch - 发起网络请求
    pub user_perm_network_fetch: bool,
    /// media:control - 控制媒体播放
    pub user_perm_media_control: bool,
    /// component:theme - 注册主题组件
    pub user_perm_component_theme: bool,
    /// shortcut:register - 注册快捷键
    pub user_perm_shortcut_register: bool,
    /// event:publish - 发布事件
    pub user_perm_event_publish: bool,

    // ===== 游客可使用的 elevated 权限 (10个，platform:write 和 platform:register 已升为 privileged) =====
    /// ai:generate - AI 生成内容（游客）
    pub guest_perm_ai_generate: bool,
    /// ai:analyze - AI 分析数据（游客）
    pub guest_perm_ai_analyze: bool,
    /// ai:chat - AI 对话（游客）
    pub guest_perm_ai_chat: bool,
    /// ai:image - AI 图片生成（游客）
    pub guest_perm_ai_image: bool,
    /// report:write - 写入/生成报告（游客）
    pub guest_perm_report_write: bool,
    /// network:fetch - 发起网络请求（游客）
    pub guest_perm_network_fetch: bool,
    /// media:control - 控制媒体播放（游客）
    pub guest_perm_media_control: bool,
    /// component:theme - 注册主题组件（游客）
    pub guest_perm_component_theme: bool,
    /// shortcut:register - 注册快捷键（游客）
    pub guest_perm_shortcut_register: bool,
    /// event:publish - 发布事件（游客）
    pub guest_perm_event_publish: bool,

    // ===== AI 使用限额配置（当权限已下放时生效） =====
    // 这些限额只对非管理员用户生效，管理员无限制
    /// 普通用户每日 AI 调用次数限制（所有 AI 权限共享）
    pub user_ai_daily_calls: i32,
    /// 普通用户每日 AI Token 限制
    pub user_ai_daily_tokens: i32,
    /// 普通用户 AI 调用冷却时间（秒）
    pub user_ai_cooldown_seconds: i32,

    /// 游客每日 AI 调用次数限制
    pub guest_ai_daily_calls: i32,
    /// 游客每日 AI Token 限制
    pub guest_ai_daily_tokens: i32,
    /// 游客 AI 调用冷却时间（秒）
    pub guest_ai_cooldown_seconds: i32,
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
            openai_max_tokens: 2000,
            topic_style: "balanced".to_string(),

            github_token: None,
            github_username: None,
            bilibili_uid: None,
            steam_api_key: None,
            steam_id: None,
            netease_user_id: None,

            // Tapp 外部 API 密钥
            openweather_api_key: None,

            ui_wallpaper_url: None,
            ui_wallpaper_blur: 3,
            ui_wallpaper_parallax: true,
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

            // AI 图片生成配置
            ai_image_provider: "pollinations".to_string(),
            ai_image_model: "flux-anime".to_string(),
            ai_image_width: 512,
            ai_image_height: 768,
            imaginepro_api_key: None,
            imaginepro_callback_url: None,
            enable_auto_fetch: false,
            fetch_interval_hours: 24,

            github_client_id: None,
            github_client_secret: None,
            github_redirect_url: String::new(), // 自动从 base_url 生成

            base_url: None,

            dashboard_layout: None,
            dashboard_title: None,
            custom_platforms: None,

            control_panel_layout: None,
            control_panel_rows: 2,

            tapp_window_schemes: None,

            // ===== 普通用户 elevated 权限默认值 (10个) =====
            // 默认全部关闭，管理员可选择性开放
            user_perm_ai_generate: false,
            user_perm_ai_analyze: false,
            user_perm_ai_chat: false,
            user_perm_ai_image: false,
            user_perm_report_write: false,
            user_perm_network_fetch: false,
            user_perm_media_control: false,
            user_perm_component_theme: false,
            user_perm_shortcut_register: false,
            user_perm_event_publish: false,

            // ===== 游客 elevated 权限默认值 =====
            // 默认全部关闭
            guest_perm_ai_generate: false,
            guest_perm_ai_analyze: false,
            guest_perm_ai_chat: false,
            guest_perm_ai_image: false,
            guest_perm_report_write: false,
            guest_perm_network_fetch: false,
            guest_perm_media_control: false,
            guest_perm_component_theme: false,
            guest_perm_shortcut_register: false,
            guest_perm_event_publish: false,

            // ===== AI 使用限额默认值 =====
            // 普通用户: 每日 50 次调用, 20000 tokens, 5 秒冷却
            user_ai_daily_calls: 50,
            user_ai_daily_tokens: 20000,
            user_ai_cooldown_seconds: 5,

            // 游客: 每日 10 次调用, 5000 tokens, 10 秒冷却
            guest_ai_daily_calls: 10,
            guest_ai_daily_tokens: 5000,
            guest_ai_cooldown_seconds: 10,
        }
    }
}
