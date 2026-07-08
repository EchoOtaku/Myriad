use axum::{extract::State, http::StatusCode, Json};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigResponse {
    pub platforms: Vec<PlatformConfig>,
    pub ai_config: AiConfig,
    pub report_config: ReportConfig,
    pub ui_config: UiConfig,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlatformConfig {
    pub name: String,
    pub enabled: bool,
    pub has_token: bool,
    pub config_fields: Vec<ConfigField>,
    pub description: String,
    pub icon: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigField {
    pub key: String,
    pub label: String,
    pub field_type: String,
    pub value: String,
    pub placeholder: String,
    pub required: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiConfig {
    pub provider: String,
    pub model: String,
    pub api_key: String,
    pub enabled: bool,
    // AI 图片生成配置
    pub image_provider: String,
    pub config_fields: Vec<ConfigField>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct ReportConfig {
    pub topic_style: String,
    pub config_fields: Vec<ConfigField>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UiConfig {
    pub wallpaper_url: String,
    pub wallpaper_blur: u32,
    pub wallpaper_parallax: bool,
    // Evocative 壁纸动效
    pub evocative_parallax: bool,
    pub evocative_dynamic_blur: bool,
    pub evocative_ripple: bool,
    pub evocative_fps: u32,
    pub evocative_ripple_quality: f64,
    pub theme: String,
    pub primary_color: String,
    pub secondary_color: String,
    pub pet_enabled: bool,
    pub pet_image_url: String,
    // 网络代理配置
    pub proxy_enabled: bool,
    pub proxy_url: String,
    pub proxy_bypass: String,
    pub gemini_base_url: String,
    pub github_api_base_url: String,
    pub config_fields: Vec<ConfigField>,
}

fn resolve_platform_enabled(explicit_enabled: Option<bool>, fallback_enabled: bool) -> bool {
    explicit_enabled.unwrap_or(fallback_enabled)
}

/// 按管理员配置的平台顺序对平台列表排序。
/// `order` 中的平台按其顺序排在前面，未列出的平台保持原有默认顺序排在最后。
fn sort_platforms_by_order(platforms: &mut [PlatformConfig], order: Option<&Vec<String>>) {
    let Some(order) = order else { return };
    let rank = |name: &str| -> usize {
        order
            .iter()
            .position(|n| n.eq_ignore_ascii_case(name))
            .unwrap_or(usize::MAX)
    };
    // 稳定排序：未列出的平台（rank == MAX）保持彼此间的默认相对顺序
    platforms.sort_by_key(|p| rank(&p.name));
}

pub async fn get_config(State(db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    // 优先从数据库读取配置
    let config_service = crate::services::config_service::ConfigService::new(db.clone());
    let db_config = config_service.load_config().await.ok();

    // 辅助函数：优先使用数据库值，否则使用环境变量
    // Helper to get string value from database or environment
    let get_value = |db_val: Option<String>, env_key: &str| -> String {
        db_val
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| std::env::var(env_key).unwrap_or_default())
    };

    // Helper to mask sensitive values (passwords, API keys, tokens)
    // SECURITY: Do not expose any real characters to prevent key type detection
    let mask_sensitive = |value: String| -> String {
        if value.is_empty() {
            value
        } else {
            // Show only fixed-length mask without exposing real characters
            "••••••••".to_string()
        }
    };

    let has_bangumi_username = db_config
        .as_ref()
        .and_then(|c| c.bangumi_username.as_ref())
        .is_some()
        || std::env::var("BANGUMI_USERNAME").is_ok();
    let has_bangumi_access_token = db_config
        .as_ref()
        .and_then(|c| c.bangumi_access_token.as_ref())
        .is_some()
        || std::env::var("BANGUMI_ACCESS_TOKEN").is_ok();
    let has_bangumi_identity = has_bangumi_username || has_bangumi_access_token;
    let github_enabled = resolve_platform_enabled(
        db_config.as_ref().and_then(|c| c.github_enabled),
        db_config
            .as_ref()
            .and_then(|c| c.github_username.as_ref())
            .is_some()
            || std::env::var("GITHUB_USERNAME").is_ok(),
    );
    let bilibili_enabled = resolve_platform_enabled(
        db_config.as_ref().and_then(|c| c.bilibili_enabled),
        db_config
            .as_ref()
            .and_then(|c| c.bilibili_uid.as_ref())
            .is_some()
            || std::env::var("BILIBILI_UID").is_ok(),
    );
    let steam_enabled = resolve_platform_enabled(
        db_config.as_ref().and_then(|c| c.steam_enabled),
        db_config
            .as_ref()
            .and_then(|c| c.steam_api_key.as_ref())
            .is_some()
            || std::env::var("STEAM_API_KEY").is_ok(),
    );
    let netease_enabled = resolve_platform_enabled(
        db_config.as_ref().and_then(|c| c.netease_enabled),
        db_config
            .as_ref()
            .and_then(|c| c.netease_user_id.as_ref())
            .is_some()
            || std::env::var("NETEASE_USER_ID").is_ok(),
    );
    let bangumi_enabled = resolve_platform_enabled(
        db_config.as_ref().and_then(|c| c.bangumi_enabled),
        has_bangumi_identity,
    );

    let config = ConfigResponse {
        platforms: vec![
            PlatformConfig {
                name: "GitHub".to_string(),
                enabled: github_enabled,
                has_token: db_config
                    .as_ref()
                    .and_then(|c| c.github_token.as_ref())
                    .is_some()
                    || std::env::var("GITHUB_TOKEN").is_ok(),
                icon: "".to_string(),
                description: "Track repositories, stars, and contributions".to_string(),
                config_fields: vec![
                    ConfigField {
                        key: "username".to_string(),
                        label: "GitHub Username".to_string(),
                        field_type: "text".to_string(),
                        value: get_value(
                            db_config.as_ref().and_then(|c| c.github_username.clone()),
                            "GITHUB_USERNAME",
                        ),
                        placeholder: "octocat".to_string(),
                        required: true,
                    },
                    ConfigField {
                        key: "token".to_string(),
                        label: "Personal Access Token (Optional)".to_string(),
                        field_type: "password".to_string(),
                        value: mask_sensitive(get_value(
                            db_config.as_ref().and_then(|c| c.github_token.clone()),
                            "GITHUB_TOKEN",
                        )),
                        placeholder: "ghp_xxxxxxxxxxxx (Increases API rate limit)".to_string(),
                        required: false,
                    },
                ],
            },
            PlatformConfig {
                name: "Bilibili".to_string(),
                enabled: bilibili_enabled,
                has_token: db_config
                    .as_ref()
                    .and_then(|c| c.bilibili_uid.as_ref())
                    .is_some()
                    || std::env::var("BILIBILI_UID").is_ok(),
                icon: "".to_string(),
                description: "Track your Bilibili favorites, anime, and viewing history"
                    .to_string(),
                config_fields: vec![ConfigField {
                    key: "uid".to_string(),
                    label: "User ID (UID)".to_string(),
                    field_type: "number".to_string(),
                    value: get_value(
                        db_config.as_ref().and_then(|c| c.bilibili_uid.clone()),
                        "BILIBILI_UID",
                    ),
                    placeholder: "123456789".to_string(),
                    required: true,
                }],
            },
            PlatformConfig {
                name: "Steam".to_string(),
                enabled: steam_enabled,
                has_token: db_config
                    .as_ref()
                    .and_then(|c| c.steam_api_key.as_ref())
                    .is_some()
                    || std::env::var("STEAM_API_KEY").is_ok(),
                icon: "".to_string(),
                description: "Sync your Steam library, wishlist, and gaming stats".to_string(),
                config_fields: vec![
                    ConfigField {
                        key: "api_key".to_string(),
                        label: "Steam API Key".to_string(),
                        field_type: "password".to_string(),
                        value: mask_sensitive(get_value(
                            db_config.as_ref().and_then(|c| c.steam_api_key.clone()),
                            "STEAM_API_KEY",
                        )),
                        placeholder: "Get from steamcommunity.com/dev/apikey".to_string(),
                        required: true,
                    },
                    ConfigField {
                        key: "steam_id".to_string(),
                        label: "Steam ID".to_string(),
                        field_type: "text".to_string(),
                        value: get_value(
                            db_config.as_ref().and_then(|c| c.steam_id.clone()),
                            "STEAM_ID",
                        ),
                        placeholder: "76561198XXXXXXXXX".to_string(),
                        required: true,
                    },
                ],
            },
            PlatformConfig {
                name: "Netease Music".to_string(),
                enabled: netease_enabled,
                has_token: db_config
                    .as_ref()
                    .and_then(|c| c.netease_user_id.as_ref())
                    .is_some()
                    || std::env::var("NETEASE_USER_ID").is_ok(),
                icon: "".to_string(),
                description: "Sync your liked songs and music taste from Netease Cloud Music"
                    .to_string(),
                config_fields: vec![ConfigField {
                    key: "user_id".to_string(),
                    label: "User ID".to_string(),
                    field_type: "number".to_string(),
                    value: get_value(
                        db_config.as_ref().and_then(|c| c.netease_user_id.clone()),
                        "NETEASE_USER_ID",
                    ),
                    placeholder: "Your Netease Cloud Music user ID".to_string(),
                    required: true,
                }],
            },
            PlatformConfig {
                name: "Bangumi".to_string(),
                enabled: bangumi_enabled,
                has_token: has_bangumi_identity,
                icon: "".to_string(),
                description: "Sync your Bangumi collection, ratings, and watching status"
                    .to_string(),
                config_fields: vec![
                    ConfigField {
                        key: "username".to_string(),
                        label: "Bangumi Username".to_string(),
                        field_type: "text".to_string(),
                        value: get_value(
                            db_config.as_ref().and_then(|c| c.bangumi_username.clone()),
                            "BANGUMI_USERNAME",
                        ),
                        placeholder: "your Bangumi username".to_string(),
                        required: false,
                    },
                    ConfigField {
                        key: "access_token".to_string(),
                        label: "Access Token".to_string(),
                        field_type: "password".to_string(),
                        value: mask_sensitive(get_value(
                            db_config
                                .as_ref()
                                .and_then(|c| c.bangumi_access_token.clone()),
                            "BANGUMI_ACCESS_TOKEN",
                        )),
                        placeholder: "Bearer token for private collections".to_string(),
                        required: false,
                    },
                    ConfigField {
                        key: "user_agent".to_string(),
                        label: "User-Agent".to_string(),
                        field_type: "text".to_string(),
                        value: get_value(
                            db_config
                                .as_ref()
                                .and_then(|c| c.bangumi_user_agent.clone()),
                            "BANGUMI_USER_AGENT",
                        ),
                        placeholder: "haru/Myriad".to_string(),
                        required: false,
                    },
                ],
            },
        ],
        ai_config: AiConfig {
            provider: db_config
                .as_ref()
                .map(|c| c.ai_provider.clone())
                .unwrap_or_else(|| {
                    std::env::var("AI_PROVIDER").unwrap_or_else(|_| "gemini".to_string())
                }),
            model: db_config
                .as_ref()
                .map(|c| c.gemini_model.clone())
                .unwrap_or_else(|| {
                    std::env::var("GEMINI_MODEL")
                        .unwrap_or_else(|_| "gemini-3-flash-preview".to_string())
                }),
            api_key: get_value(
                db_config.as_ref().and_then(|c| c.gemini_api_key.clone()),
                "GEMINI_API_KEY",
            ),
            enabled: db_config
                .as_ref()
                .and_then(|c| c.gemini_api_key.as_ref())
                .is_some()
                || db_config
                    .as_ref()
                    .and_then(|c| c.openai_api_key.as_ref())
                    .is_some()
                || std::env::var("GEMINI_API_KEY").is_ok()
                || std::env::var("OPENAI_API_KEY").is_ok(),
            config_fields: vec![
                ConfigField {
                    key: "provider".to_string(),
                    label: "AI Provider".to_string(),
                    field_type: "select".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.ai_provider.clone())
                        .unwrap_or_else(|| {
                            std::env::var("AI_PROVIDER").unwrap_or_else(|_| "openai".to_string())
                        }),
                    placeholder: "openai".to_string(),
                    required: true,
                },
                ConfigField {
                    key: "gemini_api_key".to_string(),
                    label: "Gemini API Key".to_string(),
                    field_type: "password".to_string(),
                    value: mask_sensitive(get_value(
                        db_config.as_ref().and_then(|c| c.gemini_api_key.clone()),
                        "GEMINI_API_KEY",
                    )),
                    placeholder: "Get from https://makersuite.google.com/app/apikey".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "gemini_model".to_string(),
                    label: "Gemini Model Name".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.gemini_model.clone())
                        .unwrap_or_else(|| {
                            std::env::var("GEMINI_MODEL")
                                .unwrap_or_else(|_| "gemini-3.5-flash".to_string())
                        }),
                    placeholder: "gemini-3.5-flash, gemini-3.1-pro-preview, gemini-2.5-flash, etc."
                        .to_string(),
                    required: false,
                },
                ConfigField {
                    key: "openai_api_key".to_string(),
                    label: "OpenAI API Key".to_string(),
                    field_type: "password".to_string(),
                    value: mask_sensitive(get_value(
                        db_config.as_ref().and_then(|c| c.openai_api_key.clone()),
                        "OPENAI_API_KEY",
                    )),
                    placeholder: "OpenAI API Key or compatible service key".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "openai_model".to_string(),
                    label: "OpenAI Model Name".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.openai_model.clone())
                        .unwrap_or_else(|| {
                            std::env::var("OPENAI_MODEL")
                                .unwrap_or_else(|_| "minimax/minimax-m3".to_string())
                        }),
                    placeholder: "minimax/minimax-m3, gpt-5.5, etc.".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "openai_base_url".to_string(),
                    label: "OpenAI Base URL".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.openai_base_url.clone())
                        .unwrap_or_else(|| {
                            std::env::var("OPENAI_BASE_URL")
                                .unwrap_or_else(|_| "https://openrouter.ai/api/v1".to_string())
                        }),
                    placeholder:
                        "https://openrouter.ai/api/v1 (base URL only, no /chat/completions)"
                            .to_string(),
                    required: false,
                },
                // Pro 模型配置
                ConfigField {
                    key: "pro_enabled".to_string(),
                    label: "Enable Pro Model".to_string(),
                    field_type: "boolean".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.pro_enabled.to_string())
                        .unwrap_or_else(|| "false".to_string()),
                    placeholder: "false".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "pro_provider".to_string(),
                    label: "【Pro Model】AI Provider".to_string(),
                    field_type: "select".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.pro_ai_provider.clone())
                        .unwrap_or_else(|| {
                            std::env::var("PRO_AI_PROVIDER")
                                .unwrap_or_else(|_| "openai".to_string())
                        }),
                    placeholder: "openai".to_string(),
                    required: true,
                },
                ConfigField {
                    key: "pro_gemini_api_key".to_string(),
                    label: "【Pro Model】Gemini API Key".to_string(),
                    field_type: "password".to_string(),
                    value: mask_sensitive(get_value(
                        db_config
                            .as_ref()
                            .and_then(|c| c.pro_gemini_api_key.clone()),
                        "PRO_GEMINI_API_KEY",
                    )),
                    placeholder: "Pro model Gemini API Key (leave empty to reuse standard)"
                        .to_string(),
                    required: false,
                },
                ConfigField {
                    key: "pro_gemini_model".to_string(),
                    label: "【Pro Model】Gemini Model Name".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.pro_gemini_model.clone())
                        .unwrap_or_else(|| {
                            std::env::var("PRO_GEMINI_MODEL")
                                .unwrap_or_else(|_| "gemini-3.1-pro-preview".to_string())
                        }),
                    placeholder: "gemini-3.1-pro-preview, gemini-3-flash-preview, etc.".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "pro_openai_api_key".to_string(),
                    label: "【Pro Model】OpenAI API Key".to_string(),
                    field_type: "password".to_string(),
                    value: mask_sensitive(get_value(
                        db_config
                            .as_ref()
                            .and_then(|c| c.pro_openai_api_key.clone()),
                        "PRO_OPENAI_API_KEY",
                    )),
                    placeholder: "Pro model OpenAI API Key (leave empty to reuse standard)"
                        .to_string(),
                    required: false,
                },
                ConfigField {
                    key: "pro_openai_model".to_string(),
                    label: "【Pro Model】OpenAI Model Name".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.pro_openai_model.clone())
                        .unwrap_or_else(|| {
                            std::env::var("PRO_OPENAI_MODEL")
                                .unwrap_or_else(|_| "anthropic/claude-opus-4.8".to_string())
                        }),
                    placeholder: "anthropic/claude-opus-4.8, gpt-5.5, etc.".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "pro_openai_base_url".to_string(),
                    label: "【Pro Model】OpenAI Base URL".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.pro_openai_base_url.clone())
                        .unwrap_or_else(|| {
                            std::env::var("PRO_OPENAI_BASE_URL")
                                .unwrap_or_else(|_| "https://openrouter.ai/api/v1".to_string())
                        }),
                    placeholder: "https://api.openai.com/v1 (leave empty to reuse standard)"
                        .to_string(),
                    required: false,
                },
                // AI 图片生成配置
                ConfigField {
                    key: "ai_image_provider".to_string(),
                    label: "Image Provider".to_string(),
                    field_type: "select".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.ai_image_provider.clone())
                        .unwrap_or_else(|| {
                            std::env::var("AI_IMAGE_PROVIDER")
                                .unwrap_or_else(|_| "pollinations".to_string())
                        }),
                    placeholder: "pollinations or pixai".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "ai_image_model".to_string(),
                    label: "Image Model (Pollinations)".to_string(),
                    field_type: "select".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.ai_image_model.clone())
                        .unwrap_or_else(|| {
                            std::env::var("AI_IMAGE_MODEL")
                                .unwrap_or_else(|_| "1983308862240288769".to_string())
                        }),
                    placeholder: "1983308862240288769".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "ai_image_width".to_string(),
                    label: "Image Width".to_string(),
                    field_type: "number".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.ai_image_width.to_string())
                        .unwrap_or_else(|| {
                            std::env::var("AI_IMAGE_WIDTH").unwrap_or_else(|_| "768".to_string())
                        }),
                    placeholder: "768".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "ai_image_height".to_string(),
                    label: "Image Height".to_string(),
                    field_type: "number".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.ai_image_height.to_string())
                        .unwrap_or_else(|| {
                            std::env::var("AI_IMAGE_HEIGHT").unwrap_or_else(|_| "1280".to_string())
                        }),
                    placeholder: "1280".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "pixai_api_key".to_string(),
                    label: "PixAI API Key".to_string(),
                    field_type: "password".to_string(),
                    value: mask_sensitive(get_value(
                        db_config.as_ref().and_then(|c| c.pixai_api_key.clone()),
                        "PIXAI_API_KEY",
                    )),
                    placeholder: "Get from platform.pixai.art".to_string(),
                    required: false,
                },
                // 腾讯云语音服务配置 (TTS/ASR)
                ConfigField {
                    key: "tencent_secret_id".to_string(),
                    label: "Tencent Cloud Secret ID".to_string(),
                    field_type: "password".to_string(),
                    value: mask_sensitive(get_value(
                        db_config.as_ref().and_then(|c| c.tencent_secret_id.clone()),
                        "TENCENT_SECRET_ID",
                    )),
                    placeholder: "Get from https://console.cloud.tencent.com/cam/capi".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "tencent_secret_key".to_string(),
                    label: "Tencent Cloud Secret Key".to_string(),
                    field_type: "password".to_string(),
                    value: mask_sensitive(get_value(
                        db_config
                            .as_ref()
                            .and_then(|c| c.tencent_secret_key.clone()),
                        "TENCENT_SECRET_KEY",
                    )),
                    placeholder: "Keep this secret secure".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "tencent_region".to_string(),
                    label: "Tencent Cloud Region".to_string(),
                    field_type: "select".to_string(),
                    value: get_value(
                        db_config.as_ref().and_then(|c| c.tencent_region.clone()),
                        "TENCENT_REGION",
                    ),
                    placeholder: "ap-guangzhou".to_string(),
                    required: false,
                },
            ],
            image_provider: db_config
                .as_ref()
                .map(|c| c.ai_image_provider.clone())
                .unwrap_or_else(|| {
                    std::env::var("AI_IMAGE_PROVIDER")
                        .unwrap_or_else(|_| "pollinations".to_string())
                }),
        },
        report_config: ReportConfig {
            topic_style: db_config
                .as_ref()
                .map(|c| c.topic_style.clone())
                .unwrap_or_else(|| {
                    std::env::var("TOPIC_STYLE").unwrap_or_else(|_| "balanced".to_string())
                }),
            config_fields: vec![ConfigField {
                key: "topic_style".to_string(),
                label: "Report Topic Style".to_string(),
                field_type: "select".to_string(),
                value: db_config
                    .as_ref()
                    .map(|c| c.topic_style.clone())
                    .unwrap_or_else(|| {
                        std::env::var("TOPIC_STYLE").unwrap_or_else(|_| "balanced".to_string())
                    }),
                placeholder: "balanced".to_string(),
                required: true,
            }],
        },
        ui_config: UiConfig {
            wallpaper_url: get_value(
                db_config.as_ref().and_then(|c| c.ui_wallpaper_url.clone()),
                "UI_WALLPAPER_URL",
            ),
            wallpaper_blur: db_config
                .as_ref()
                .map(|c| c.ui_wallpaper_blur as u32)
                .unwrap_or_else(|| {
                    std::env::var("UI_WALLPAPER_BLUR")
                        .unwrap_or_else(|_| "3".to_string())
                        .parse::<u32>()
                        .unwrap_or(3)
                }),
            wallpaper_parallax: db_config
                .as_ref()
                .map(|c| c.ui_wallpaper_parallax)
                .unwrap_or_else(|| {
                    std::env::var("UI_WALLPAPER_PARALLAX")
                        .unwrap_or_else(|_| "true".to_string())
                        .parse()
                        .unwrap_or(true)
                }),
            // Evocative 壁纸动效
            evocative_parallax: db_config
                .as_ref()
                .map(|c| c.ui_evocative_parallax)
                .unwrap_or_else(|| {
                    std::env::var("UI_EVOCATIVE_PARALLAX")
                        .unwrap_or_else(|_| "true".to_string())
                        .parse()
                        .unwrap_or(true)
                }),
            evocative_dynamic_blur: db_config
                .as_ref()
                .map(|c| c.ui_evocative_dynamic_blur)
                .unwrap_or_else(|| {
                    std::env::var("UI_EVOCATIVE_DYNAMIC_BLUR")
                        .unwrap_or_else(|_| "false".to_string())
                        .parse()
                        .unwrap_or(false)
                }),
            evocative_ripple: db_config
                .as_ref()
                .map(|c| c.ui_evocative_ripple)
                .unwrap_or_else(|| {
                    std::env::var("UI_EVOCATIVE_RIPPLE")
                        .unwrap_or_else(|_| "false".to_string())
                        .parse()
                        .unwrap_or(false)
                }),
            evocative_fps: db_config
                .as_ref()
                .map(|c| c.ui_evocative_fps as u32)
                .unwrap_or_else(|| {
                    std::env::var("UI_EVOCATIVE_FPS")
                        .unwrap_or_else(|_| "30".to_string())
                        .parse()
                        .unwrap_or(30)
                }),
            evocative_ripple_quality: db_config
                .as_ref()
                .map(|c| c.ui_evocative_ripple_quality)
                .unwrap_or_else(|| {
                    std::env::var("UI_EVOCATIVE_RIPPLE_QUALITY")
                        .unwrap_or_else(|_| "0.85".to_string())
                        .parse()
                        .unwrap_or(0.85)
                }),
            theme: db_config
                .as_ref()
                .and_then(|c| c.ui_theme.clone())
                .unwrap_or_else(|| {
                    std::env::var("UI_THEME").unwrap_or_else(|_| "dark".to_string())
                }),
            primary_color: db_config
                .as_ref()
                .and_then(|c| c.ui_primary_color.clone())
                .unwrap_or_else(|| {
                    std::env::var("UI_PRIMARY_COLOR").unwrap_or_else(|_| "#6366f1".to_string())
                }),
            secondary_color: db_config
                .as_ref()
                .and_then(|c| c.ui_secondary_color.clone())
                .unwrap_or_else(|| {
                    std::env::var("UI_SECONDARY_COLOR").unwrap_or_else(|_| "#8b5cf6".to_string())
                }),
            pet_enabled: db_config
                .as_ref()
                .map(|c| c.pet_enabled)
                .unwrap_or_else(|| {
                    std::env::var("PET_ENABLED")
                        .unwrap_or_else(|_| "true".to_string())
                        .parse()
                        .unwrap_or(true)
                }),
            pet_image_url: get_value(
                db_config.as_ref().and_then(|c| c.pet_image_url.clone()),
                "PET_IMAGE_URL",
            ),
            // 网络代理配置
            proxy_enabled: db_config.as_ref().map(|c| c.proxy_enabled).unwrap_or(false),
            proxy_url: db_config
                .as_ref()
                .and_then(|c| c.proxy_url.clone())
                .unwrap_or_default(),
            proxy_bypass: db_config
                .as_ref()
                .and_then(|c| c.proxy_bypass.clone())
                .unwrap_or_default(),
            gemini_base_url: db_config
                .as_ref()
                .and_then(|c| c.gemini_base_url.clone())
                .unwrap_or_default(),
            github_api_base_url: db_config
                .as_ref()
                .and_then(|c| c.github_api_base_url.clone())
                .unwrap_or_default(),
            config_fields: vec![
                ConfigField {
                    key: "wallpaper_url".to_string(),
                    label: "Wallpaper URL".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(
                        db_config.as_ref().and_then(|c| c.ui_wallpaper_url.clone()),
                        "UI_WALLPAPER_URL",
                    ),
                    placeholder: "URL to wallpaper image or API endpoint".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "wallpaper_blur".to_string(),
                    label: "Wallpaper Blur (0-10)".to_string(),
                    field_type: "number".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.ui_wallpaper_blur.to_string())
                        .unwrap_or_else(|| {
                            std::env::var("UI_WALLPAPER_BLUR").unwrap_or_else(|_| "3".to_string())
                        }),
                    placeholder: "3".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "wallpaper_parallax".to_string(),
                    label: "壁纸视差效果".to_string(),
                    field_type: "checkbox".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.ui_wallpaper_parallax.to_string())
                        .unwrap_or_else(|| {
                            std::env::var("UI_WALLPAPER_PARALLAX")
                                .unwrap_or_else(|_| "true".to_string())
                        }),
                    placeholder: "true".to_string(),
                    required: false,
                },
                // Evocative 壁纸动效配置
                ConfigField {
                    key: "evocative_parallax".to_string(),
                    label: "微动效果".to_string(),
                    field_type: "checkbox".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.ui_evocative_parallax.to_string())
                        .unwrap_or_else(|| {
                            std::env::var("UI_EVOCATIVE_PARALLAX")
                                .unwrap_or_else(|_| "true".to_string())
                        }),
                    placeholder: "true".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "evocative_dynamic_blur".to_string(),
                    label: "动态模糊".to_string(),
                    field_type: "checkbox".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.ui_evocative_dynamic_blur.to_string())
                        .unwrap_or_else(|| {
                            std::env::var("UI_EVOCATIVE_DYNAMIC_BLUR")
                                .unwrap_or_else(|_| "false".to_string())
                        }),
                    placeholder: "false".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "evocative_ripple".to_string(),
                    label: "涟漪效果".to_string(),
                    field_type: "checkbox".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.ui_evocative_ripple.to_string())
                        .unwrap_or_else(|| {
                            std::env::var("UI_EVOCATIVE_RIPPLE")
                                .unwrap_or_else(|_| "false".to_string())
                        }),
                    placeholder: "false".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "evocative_fps".to_string(),
                    label: "动效帧率".to_string(),
                    field_type: "select".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.ui_evocative_fps.to_string())
                        .unwrap_or_else(|| {
                            std::env::var("UI_EVOCATIVE_FPS").unwrap_or_else(|_| "30".to_string())
                        }),
                    placeholder: "30".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "evocative_ripple_quality".to_string(),
                    label: "涟漪画质".to_string(),
                    field_type: "select".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.ui_evocative_ripple_quality.to_string())
                        .unwrap_or_else(|| {
                            std::env::var("UI_EVOCATIVE_RIPPLE_QUALITY")
                                .unwrap_or_else(|_| "0.85".to_string())
                        }),
                    placeholder: "0.85".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "pet_enabled".to_string(),
                    label: "Enable Pet Mascot".to_string(),
                    field_type: "checkbox".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.pet_enabled.to_string())
                        .unwrap_or_else(|| {
                            std::env::var("PET_ENABLED").unwrap_or_else(|_| "true".to_string())
                        }),
                    placeholder: "true".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "pet_image_url".to_string(),
                    label: "Pet Image URL".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(
                        db_config.as_ref().and_then(|c| c.pet_image_url.clone()),
                        "PET_IMAGE_URL",
                    ),
                    placeholder: "URL to pet character image".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "site_title".to_string(),
                    label: "网站标题".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(
                        db_config.as_ref().and_then(|c| c.site_title.clone()),
                        "SITE_TITLE",
                    ),
                    placeholder: "Myriad - A myriad of lights, in one place.".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "site_description".to_string(),
                    label: "网站描述".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(
                        db_config.as_ref().and_then(|c| c.site_description.clone()),
                        "SITE_DESCRIPTION",
                    ),
                    placeholder: "A myriad of lights, in one place.".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "site_favicon".to_string(),
                    label: "网站图标 URL".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(
                        db_config.as_ref().and_then(|c| c.site_favicon.clone()),
                        "SITE_FAVICON",
                    ),
                    placeholder: "/favicon.webp 或 https://example.com/icon.png（支持站外链接）"
                        .to_string(),
                    required: false,
                },
                ConfigField {
                    key: "site_icp".to_string(),
                    label: "ICP 备案号".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .and_then(|c| c.site_icp.clone())
                        .unwrap_or_default(),
                    placeholder: "如：京ICP备12345678号".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "site_gongan".to_string(),
                    label: "公安备案号".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .and_then(|c| c.site_gongan.clone())
                        .unwrap_or_default(),
                    placeholder: "如：京公网安备11010802012345号".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "cloud_sponsors".to_string(),
                    label: "云赞助商".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .and_then(|c| c.cloud_sponsors.clone())
                        .unwrap_or_default(),
                    placeholder: "cloudflare,edgeone,upyun（多个用逗号分隔）".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "github_client_id".to_string(),
                    label: "GitHub OAuth Client ID".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(
                        db_config.as_ref().and_then(|c| c.github_client_id.clone()),
                        "GITHUB_CLIENT_ID",
                    ),
                    placeholder: "GitHub OAuth Application Client ID".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "github_client_secret".to_string(),
                    label: "GitHub OAuth Client Secret".to_string(),
                    field_type: "password".to_string(),
                    value: mask_sensitive(get_value(
                        db_config
                            .as_ref()
                            .and_then(|c| c.github_client_secret.clone()),
                        "GITHUB_CLIENT_SECRET",
                    )),
                    placeholder: "GitHub OAuth Application Client Secret".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "base_url".to_string(),
                    label: "Site Base URL".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .and_then(|c| c.base_url.clone())
                        .unwrap_or_default(),
                    placeholder: "https://yourdomain.com (用于生成 OAuth 回调 URL)".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "music_enabled".to_string(),
                    label: "Enable Music Player".to_string(),
                    field_type: "checkbox".to_string(),
                    value: get_value(
                        db_config.as_ref().and_then(|c| c.music_enabled.clone()),
                        "MUSIC_ENABLED",
                    ),
                    placeholder: "false".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "music_source".to_string(),
                    label: "Music Source".to_string(),
                    field_type: "select".to_string(),
                    value: get_value(
                        db_config.as_ref().and_then(|c| c.music_source.clone()),
                        "MUSIC_SOURCE",
                    ),
                    placeholder: "netease or qq".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "music_playlist_id".to_string(),
                    label: "Playlist ID".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(
                        db_config.as_ref().and_then(|c| c.music_playlist_id.clone()),
                        "MUSIC_PLAYLIST_ID",
                    ),
                    placeholder: "Playlist ID from music platform".to_string(),
                    required: false,
                },
                // 网络代理配置
                ConfigField {
                    key: "proxy_enabled".to_string(),
                    label: "启用网络代理".to_string(),
                    field_type: "checkbox".to_string(),
                    value: db_config
                        .as_ref()
                        .map(|c| c.proxy_enabled.to_string())
                        .unwrap_or_else(|| "false".to_string()),
                    placeholder: "false".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "proxy_url".to_string(),
                    label: "代理服务器地址".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .and_then(|c| c.proxy_url.clone())
                        .unwrap_or_default(),
                    placeholder: "http://127.0.0.1:7890 或 socks5://127.0.0.1:1080".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "proxy_bypass".to_string(),
                    label: "代理绕过列表".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .and_then(|c| c.proxy_bypass.clone())
                        .unwrap_or_default(),
                    placeholder: "localhost,127.0.0.1,.local".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "gemini_base_url".to_string(),
                    label: "Gemini API 基础 URL".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .and_then(|c| c.gemini_base_url.clone())
                        .unwrap_or_default(),
                    placeholder: "https://generativelanguage.googleapis.com (留空使用默认)"
                        .to_string(),
                    required: false,
                },
                ConfigField {
                    key: "github_api_base_url".to_string(),
                    label: "GitHub API 基础 URL".to_string(),
                    field_type: "text".to_string(),
                    value: db_config
                        .as_ref()
                        .and_then(|c| c.github_api_base_url.clone())
                        .unwrap_or_default(),
                    placeholder: "https://api.github.com (留空使用默认)".to_string(),
                    required: false,
                },
            ],
        },
    };

    let mut config = config;
    sort_platforms_by_order(
        &mut config.platforms,
        db_config.as_ref().and_then(|c| c.platform_order.as_ref()),
    );

    (StatusCode::OK, Json(json!(config)))
}

pub async fn update_config(
    State(db): State<DatabaseConnection>,
    Json(payload): Json<ConfigResponse>,
) -> (StatusCode, Json<Value>) {
    tracing::info!("Updating configuration");

    // 1. 保存到数据库
    let config_service = crate::services::config_service::ConfigService::new(db.clone());
    if let Err(e) = save_to_database(&config_service, &payload).await {
        tracing::error!("Failed to save configuration to database: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": format!("Failed to save configuration to database: {}", e)
            })),
        );
    }
    tracing::info!("✅ Configuration saved to database");

    // 2. 保存到 .env 文件（向后兼容）
    let response = match save_all_configs(&payload).await {
        Ok(_) => {
            tracing::info!("✅ Configuration saved to .env file");
            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "message": "Configuration saved successfully! Changes will be applied automatically within a few seconds."
                })),
            )
        }
        Err(e) => {
            tracing::error!("Failed to save configuration to .env: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "message": format!("Failed to save configuration: {}", e)
                })),
            )
        }
    };

    // 3. 更新全局动态配置缓存
    match config_service.load_config().await {
        Ok(dynamic_config) => {
            *crate::GLOBAL_DYNAMIC_CONFIG.write().await = dynamic_config;
            tracing::info!("✅ Global dynamic configuration cache updated");

            // 3.1 重载全局 HTTP 客户端（以应用新的代理配置）
            crate::services::http_client::reload_global_client().await;
            tracing::info!("✅ Global HTTP client reloaded with new proxy settings");

            // 3.2 兼容旧配置保存路径：如果 github_client_id/secret 仍由
            // /api/config 写入，也要让 OAuth provider 列表立即生效。
            crate::services::oauth::registry::REGISTRY.reload().await;
            tracing::info!("✅ OAuth provider registry reloaded");
        }
        Err(e) => {
            tracing::warn!("⚠️ Failed to reload dynamic config into cache: {}", e);
        }
    }

    // 4. 触发配置重载标志(虽然数据库连接可能不变,但确保其他服务知道配置已更新)
    crate::api::system::CONFIG_RELOAD_REQUESTED.store(true, std::sync::atomic::Ordering::Relaxed);

    tracing::info!(
        "🔄 Configuration reload flag set - changes will be picked up within 2-3 seconds"
    );

    response
}

/// 保存配置到数据库
async fn save_to_database(
    config_service: &crate::services::config_service::ConfigService,
    config: &ConfigResponse,
) -> Result<(), Box<dyn std::error::Error>> {
    use serde_json::Value as JsonValue;
    use std::collections::HashMap;

    let mut updates: HashMap<String, JsonValue> = HashMap::new();

    // Helper to check if a value is masked
    let is_masked = |value: &str| -> bool {
        value.starts_with("••") || value.starts_with("**") || value == "********"
    };

    // 保存平台配置
    for platform in &config.platforms {
        match platform.name.as_str() {
            "GitHub" => {
                updates.insert(
                    "github_enabled".to_string(),
                    JsonValue::Bool(platform.enabled),
                );
                for field in &platform.config_fields {
                    let key = match field.key.as_str() {
                        "username" => "github_username",
                        "token" => "github_token",
                        _ => continue,
                    };
                    // 🔒 忽略屏蔽值（前端返回的掩码）
                    if !field.value.is_empty() && !is_masked(&field.value) {
                        updates.insert(key.to_string(), JsonValue::String(field.value.clone()));
                    }
                }
            }
            "Bilibili" => {
                updates.insert(
                    "bilibili_enabled".to_string(),
                    JsonValue::Bool(platform.enabled),
                );
                for field in &platform.config_fields {
                    if field.key == "uid" && !field.value.is_empty() {
                        updates.insert(
                            "bilibili_uid".to_string(),
                            JsonValue::String(field.value.clone()),
                        );
                    }
                }
            }
            "Steam" => {
                updates.insert(
                    "steam_enabled".to_string(),
                    JsonValue::Bool(platform.enabled),
                );
                for field in &platform.config_fields {
                    let key = match field.key.as_str() {
                        "api_key" => "steam_api_key",
                        "steam_id" => "steam_id",
                        _ => continue,
                    };
                    // 🔒 忽略屏蔽值（前端返回的掩码）
                    if !field.value.is_empty() && !is_masked(&field.value) {
                        updates.insert(key.to_string(), JsonValue::String(field.value.clone()));
                    }
                }
            }
            "Netease Music" => {
                updates.insert(
                    "netease_enabled".to_string(),
                    JsonValue::Bool(platform.enabled),
                );
                for field in &platform.config_fields {
                    if field.key == "user_id" && !field.value.is_empty() {
                        updates.insert(
                            "netease_user_id".to_string(),
                            JsonValue::String(field.value.clone()),
                        );
                    }
                }
            }
            "Bangumi" => {
                updates.insert(
                    "bangumi_enabled".to_string(),
                    JsonValue::Bool(platform.enabled),
                );
                for field in &platform.config_fields {
                    let key = match field.key.as_str() {
                        "username" => "bangumi_username",
                        "access_token" => "bangumi_access_token",
                        "user_agent" => "bangumi_user_agent",
                        _ => continue,
                    };
                    if !field.value.is_empty() && !is_masked(&field.value) {
                        updates.insert(key.to_string(), JsonValue::String(field.value.clone()));
                    }
                }
            }
            _ => {}
        }
    }

    // 保存平台展示顺序（按前端提交的平台数组顺序）
    if !config.platforms.is_empty() {
        let platform_order: Vec<String> = config.platforms.iter().map(|p| p.name.clone()).collect();
        if let Ok(order_value) = serde_json::to_value(&platform_order) {
            updates.insert("platform_order".to_string(), order_value);
        }
    }

    // 保存 AI 配置
    for field in &config.ai_config.config_fields {
        let (key, json_value) = match field.key.as_str() {
            "provider" => ("ai_provider", JsonValue::String(field.value.clone())),
            "gemini_api_key" => ("gemini_api_key", JsonValue::String(field.value.clone())),
            "gemini_model" => ("gemini_model", JsonValue::String(field.value.clone())),
            "openai_api_key" => ("openai_api_key", JsonValue::String(field.value.clone())),
            "openai_model" => ("openai_model", JsonValue::String(field.value.clone())),
            "openai_base_url" => ("openai_base_url", JsonValue::String(field.value.clone())),
            // Pro 模型配置
            "pro_enabled" => ("pro_enabled", JsonValue::Bool(field.value == "true")),
            "pro_provider" => ("pro_ai_provider", JsonValue::String(field.value.clone())),
            "pro_gemini_api_key" => ("pro_gemini_api_key", JsonValue::String(field.value.clone())),
            "pro_gemini_model" => ("pro_gemini_model", JsonValue::String(field.value.clone())),
            "pro_openai_api_key" => ("pro_openai_api_key", JsonValue::String(field.value.clone())),
            "pro_openai_model" => ("pro_openai_model", JsonValue::String(field.value.clone())),
            "pro_openai_base_url" => (
                "pro_openai_base_url",
                JsonValue::String(field.value.clone()),
            ),
            // AI 图片生成配置
            "ai_image_provider" => ("ai_image_provider", JsonValue::String(field.value.clone())),
            "ai_image_model" => ("ai_image_model", JsonValue::String(field.value.clone())),
            "ai_image_width" => {
                if let Ok(n) = field.value.parse::<i64>() {
                    ("ai_image_width", JsonValue::Number(n.into()))
                } else {
                    continue;
                }
            }
            "ai_image_height" => {
                if let Ok(n) = field.value.parse::<i64>() {
                    ("ai_image_height", JsonValue::Number(n.into()))
                } else {
                    continue;
                }
            }
            "pixai_api_key" => ("pixai_api_key", JsonValue::String(field.value.clone())),
            // 腾讯云语音服务配置 (TTS/ASR)
            "tencent_secret_id" => ("tencent_secret_id", JsonValue::String(field.value.clone())),
            "tencent_secret_key" => ("tencent_secret_key", JsonValue::String(field.value.clone())),
            "tencent_region" => ("tencent_region", JsonValue::String(field.value.clone())),
            _ => continue,
        };
        // 🔒 忽略屏蔽值（前端返回的掩码）- 保持数据库原值不变
        if !field.value.is_empty() && !is_masked(&field.value) {
            updates.insert(key.to_string(), json_value);
        }
    }

    // 保存报告配置
    for field in &config.report_config.config_fields {
        if field.key == "topic_style" && !field.value.is_empty() {
            updates.insert(
                "topic_style".to_string(),
                JsonValue::String(field.value.clone()),
            );
        }
    }

    // 保存 UI 配置
    for field in &config.ui_config.config_fields {
        let (key, json_value) = match field.key.as_str() {
            "wallpaper_url" => ("ui_wallpaper_url", JsonValue::String(field.value.clone())),
            "wallpaper_blur" => {
                if let Ok(n) = field.value.parse::<i64>() {
                    ("ui_wallpaper_blur", JsonValue::Number(n.into()))
                } else {
                    continue;
                }
            }
            "wallpaper_parallax" => {
                let enabled = field.value == "true";
                ("ui_wallpaper_parallax", JsonValue::Bool(enabled))
            }
            // Evocative 壁纸动效
            "evocative_parallax" => {
                let enabled = field.value == "true";
                ("ui_evocative_parallax", JsonValue::Bool(enabled))
            }
            "evocative_dynamic_blur" => {
                let enabled = field.value == "true";
                ("ui_evocative_dynamic_blur", JsonValue::Bool(enabled))
            }
            "evocative_ripple" => {
                let enabled = field.value == "true";
                ("ui_evocative_ripple", JsonValue::Bool(enabled))
            }
            "evocative_fps" => {
                if let Ok(n) = field.value.parse::<i64>() {
                    ("ui_evocative_fps", JsonValue::Number(n.into()))
                } else {
                    continue;
                }
            }
            "evocative_ripple_quality" => {
                if let Ok(n) = field.value.parse::<f64>() {
                    ("ui_evocative_ripple_quality", JsonValue::from(n))
                } else {
                    continue;
                }
            }
            "pet_enabled" => {
                let enabled = field.value == "true";
                ("pet_enabled", JsonValue::Bool(enabled))
            }
            "pet_image_url" => ("pet_image_url", JsonValue::String(field.value.clone())),
            "site_title" => ("site_title", JsonValue::String(field.value.clone())),
            "site_description" => ("site_description", JsonValue::String(field.value.clone())),
            "site_favicon" => ("site_favicon", JsonValue::String(field.value.clone())),
            "github_client_id" => ("github_client_id", JsonValue::String(field.value.clone())),
            "github_client_secret" => (
                "github_client_secret",
                JsonValue::String(field.value.clone()),
            ),
            "base_url" => ("base_url", JsonValue::String(field.value.clone())),
            "music_enabled" => {
                let enabled = field.value == "true";
                ("music_enabled", JsonValue::Bool(enabled))
            }
            "music_source" => ("music_source", JsonValue::String(field.value.clone())),
            "music_playlist_id" => ("music_playlist_id", JsonValue::String(field.value.clone())),
            // 网络代理配置
            "proxy_enabled" => {
                let enabled = field.value == "true";
                ("proxy_enabled", JsonValue::Bool(enabled))
            }
            "proxy_url" => ("proxy_url", JsonValue::String(field.value.clone())),
            "proxy_bypass" => ("proxy_bypass", JsonValue::String(field.value.clone())),
            "gemini_base_url" => ("gemini_base_url", JsonValue::String(field.value.clone())),
            "github_api_base_url" => (
                "github_api_base_url",
                JsonValue::String(field.value.clone()),
            ),
            // 站点备案和云赞助商（允许清空）
            "site_icp" | "site_gongan" | "cloud_sponsors" => {
                updates.insert(field.key.clone(), JsonValue::String(field.value.clone()));
                continue;
            }
            _ => continue,
        };
        // 🔒 忽略屏蔽值（前端返回的掩码）- github_client_secret 是敏感字段
        if !field.value.is_empty() && !is_masked(&field.value) {
            updates.insert(key.to_string(), json_value);
        }
    }

    // 批量更新到数据库
    config_service.update_configs(updates).await?;
    Ok(())
}

/// 保存所有配置到 .env 文件
async fn save_all_configs(config: &ConfigResponse) -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;
    use std::path::Path;

    // 读取现有的 .env 文件（如果存在）
    let env_path = Path::new(".env");
    let mut env_content = if env_path.exists() {
        // 尝试读取文件，如果失败则从字节读取并替换非 UTF-8 字符
        match fs::read_to_string(env_path) {
            Ok(content) => content,
            Err(e) => {
                tracing::warn!("Failed to read .env as UTF-8: {}, attempting to recover", e);
                // 读取字节并尝试转换，替换无效字符
                let bytes = fs::read(env_path)?;
                String::from_utf8_lossy(&bytes).into_owned()
            }
        }
    } else {
        String::new()
    };

    // 保存平台配置
    for platform in &config.platforms {
        match platform.name.as_str() {
            "GitHub" => {
                for field in &platform.config_fields {
                    let key = match field.key.as_str() {
                        "username" => "GITHUB_USERNAME",
                        "token" => "GITHUB_TOKEN",
                        _ => continue,
                    };
                    env_content = update_env_var(&env_content, key, &field.value);
                }
            }
            "Bilibili" => {
                for field in &platform.config_fields {
                    if field.key == "uid" {
                        env_content = update_env_var(&env_content, "BILIBILI_UID", &field.value);
                    }
                }
            }
            "Steam" => {
                for field in &platform.config_fields {
                    let key = match field.key.as_str() {
                        "api_key" => "STEAM_API_KEY",
                        "steam_id" => "STEAM_ID",
                        _ => continue,
                    };
                    env_content = update_env_var(&env_content, key, &field.value);
                }
            }
            "Netease Music" => {
                for field in &platform.config_fields {
                    if field.key == "user_id" {
                        env_content = update_env_var(&env_content, "NETEASE_USER_ID", &field.value);
                    }
                }
            }
            "Bangumi" => {
                for field in &platform.config_fields {
                    let key = match field.key.as_str() {
                        "username" => "BANGUMI_USERNAME",
                        "access_token" => "BANGUMI_ACCESS_TOKEN",
                        "user_agent" => "BANGUMI_USER_AGENT",
                        _ => continue,
                    };
                    env_content = update_env_var(&env_content, key, &field.value);
                }
            }
            _ => {}
        }
    }

    // 保存 AI 配置
    for field in &config.ai_config.config_fields {
        let key = match field.key.as_str() {
            "provider" => "AI_PROVIDER",
            "gemini_api_key" => "GEMINI_API_KEY",
            "gemini_model" => "GEMINI_MODEL",
            "openai_api_key" => "OPENAI_API_KEY",
            "openai_model" => "OPENAI_MODEL",
            "openai_base_url" => "OPENAI_BASE_URL",
            // Pro 模型配置
            "pro_enabled" => "PRO_ENABLED",
            "pro_provider" => "PRO_AI_PROVIDER",
            "pro_gemini_api_key" => "PRO_GEMINI_API_KEY",
            "pro_gemini_model" => "PRO_GEMINI_MODEL",
            "pro_openai_api_key" => "PRO_OPENAI_API_KEY",
            "pro_openai_model" => "PRO_OPENAI_MODEL",
            "pro_openai_base_url" => "PRO_OPENAI_BASE_URL",
            // AI 图片生成配置
            "ai_image_provider" => "AI_IMAGE_PROVIDER",
            "ai_image_model" => "AI_IMAGE_MODEL",
            "ai_image_width" => "AI_IMAGE_WIDTH",
            "ai_image_height" => "AI_IMAGE_HEIGHT",
            "pixai_api_key" => "PIXAI_API_KEY",
            _ => continue,
        };
        env_content = update_env_var(&env_content, key, &field.value);
    }

    // 保存报告配置
    for field in &config.report_config.config_fields {
        let key = match field.key.as_str() {
            "topic_style" => "TOPIC_STYLE",
            _ => continue,
        };
        env_content = update_env_var(&env_content, key, &field.value);
    }

    // 保存 UI 配置
    for field in &config.ui_config.config_fields {
        let key = match field.key.as_str() {
            "wallpaper_url" => "UI_WALLPAPER_URL",
            "wallpaper_blur" => "UI_WALLPAPER_BLUR",
            "wallpaper_parallax" => "UI_WALLPAPER_PARALLAX",
            // Evocative 壁纸动效
            "evocative_parallax" => "UI_EVOCATIVE_PARALLAX",
            "evocative_dynamic_blur" => "UI_EVOCATIVE_DYNAMIC_BLUR",
            "evocative_ripple" => "UI_EVOCATIVE_RIPPLE",
            "evocative_fps" => "UI_EVOCATIVE_FPS",
            "evocative_ripple_quality" => "UI_EVOCATIVE_RIPPLE_QUALITY",
            "image_gen_enabled" => "IMAGE_GEN_ENABLED",
            "image_gen_model" => "IMAGE_GEN_MODEL",
            "image_gen_width" => "IMAGE_GEN_WIDTH",
            "image_gen_height" => "IMAGE_GEN_HEIGHT",
            "pet_enabled" => "PET_ENABLED",
            "pet_image_url" => "PET_IMAGE_URL",
            "site_title" => "SITE_TITLE",
            "site_description" => "SITE_DESCRIPTION",
            "site_favicon" => "SITE_FAVICON",
            "github_client_id" => "GITHUB_CLIENT_ID",
            "github_client_secret" => "GITHUB_CLIENT_SECRET",
            "base_url" => "BASE_URL",
            "music_enabled" => "MUSIC_ENABLED",
            "music_source" => "MUSIC_SOURCE",
            "music_playlist_id" => "MUSIC_PLAYLIST_ID",
            // 网络代理配置
            "proxy_enabled" => "PROXY_ENABLED",
            "proxy_url" => "PROXY_URL",
            "proxy_bypass" => "PROXY_BYPASS",
            "gemini_base_url" => "GEMINI_BASE_URL",
            "github_api_base_url" => "GITHUB_API_BASE_URL",
            _ => continue,
        };
        env_content = update_env_var(&env_content, key, &field.value);
    }

    // 写回 .env 文件，确保使用 UTF-8 编码
    // 在 Windows 上，确保换行符为 LF，避免编码问题
    let env_content_normalized = env_content.replace("\r\n", "\n");

    // 验证内容是否为有效的 UTF-8
    if !env_content_normalized.is_ascii() {
        tracing::debug!("Config contains non-ASCII characters, ensuring UTF-8 validity");
    }

    fs::write(env_path, env_content_normalized.as_bytes())?;
    tracing::info!("✅ Configuration saved to .env file");

    // 重新加载环境变量
    if let Err(e) = dotenvy::from_path_override(env_path) {
        tracing::warn!("⚠️ Failed to reload .env file after saving config: {}", e);
    } else {
        tracing::info!("♻️ Environment variables reloaded after config save");
    }

    // 触发配置重载标志(虽然数据库连接可能不变,但确保其他服务知道配置已更新)
    crate::api::system::CONFIG_RELOAD_REQUESTED.store(true, std::sync::atomic::Ordering::Relaxed);

    tracing::info!(
        "🔄 Configuration reload flag set - changes will be picked up within 2-3 seconds"
    );

    Ok(())
}

/// 更新或添加环境变量
fn update_env_var(content: &str, key: &str, value: &str) -> String {
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let key_prefix = format!("{}=", key);

    // 处理值：如果包含空格、特殊字符或中文，用引号包裹
    let sanitized_value = if value.is_empty() {
        String::new()
    } else if value.contains(' ')
        || value.contains('#')
        || value.contains('\n')
        || value.chars().any(|c| c > '\u{007F}')
    // 包含非 ASCII 字符
    {
        // 转义内部的引号和反斜杠
        let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
        format!("\"{}\"", escaped)
    } else {
        value.to_string()
    };

    let new_line = if value.is_empty() {
        format!("# {}=", key) // 空值时注释掉
    } else {
        format!("{}={}", key, sanitized_value)
    };

    // 查找是否已存在该键
    let mut found = false;
    for line in &mut lines {
        if line.starts_with(&key_prefix) || line.starts_with(&format!("# {}", key_prefix)) {
            *line = new_line.clone();
            found = true;
            break;
        }
    }

    // 如果不存在，添加到末尾
    if !found {
        lines.push(new_line);
    }

    lines.join("\n") + "\n"
}

pub async fn test_platform(
    State(_db): State<DatabaseConnection>,
    Json(payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let platform = payload["platform"].as_str().unwrap_or("");
    let config = &payload["config"];

    match platform {
        "GitHub" => {
            let username = config["username"].as_str().unwrap_or("");
            if username.is_empty() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"success": false, "message": "Username is required"})),
                );
            }

            let token = config["token"].as_str().filter(|s| !s.is_empty());

            // 调用 GitHub API 验证
            let fetcher = crate::services::fetcher::PlatformFetcher::new().await;
            match fetcher.fetch_github_user(username, token).await {
                Ok(user_info) => {
                    let name = user_info["name"].as_str().unwrap_or(username);
                    let followers = user_info["followers"].as_i64().unwrap_or(0);
                    let repos = user_info["public_repos"].as_i64().unwrap_or(0);
                    (
                        StatusCode::OK,
                        Json(json!({
                            "success": true,
                            "message": format!("✓ GitHub user '{}' verified. {} followers, {} repos", name, followers, repos)
                        })),
                    )
                }
                Err(e) => (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "success": false,
                        "message": format!("✗ Failed to verify GitHub user: {}", e)
                    })),
                ),
            }
        }
        "Bilibili" => {
            let uid = config["uid"].as_str().unwrap_or("");
            if uid.is_empty() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"success": false, "message": "UID is required"})),
                );
            }

            // 尝试解析 UID 为数字
            let uid_i64 = match uid.parse::<i64>() {
                Ok(n) => n,
                Err(_) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({"success": false, "message": "Invalid UID format"})),
                    );
                }
            };

            // 实际调用 Bilibili API 验证
            let fetcher = crate::services::fetcher::PlatformFetcher::new().await;
            match fetcher.fetch_bilibili_user(uid_i64).await {
                Ok(user_info) => (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "message": format!("✓ Bilibili UID {} is valid. User: {}", uid, user_info.name)
                    })),
                ),
                Err(e) => (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "success": false,
                        "message": format!("✗ Failed to verify Bilibili UID: {}", e)
                    })),
                ),
            }
        }
        "Steam" => {
            let api_key = config["api_key"].as_str().unwrap_or("");
            let steam_id = config["steam_id"].as_str().unwrap_or("");
            if api_key.is_empty() || steam_id.is_empty() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"success": false, "message": "API Key and Steam ID are required"})),
                );
            }

            // 调用 Steam API 验证
            let fetcher = crate::services::fetcher::PlatformFetcher::new().await;
            match fetcher.fetch_steam_user(api_key, steam_id).await {
                Ok(user_info) => (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "message": format!("✓ Steam user '{}' verified", user_info.personaname)
                    })),
                ),
                Err(e) => (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "success": false,
                        "message": format!("✗ Failed to verify Steam: {}", e)
                    })),
                ),
            }
        }
        "Netease Music" => {
            let user_id = config["user_id"].as_str().unwrap_or("");
            if user_id.is_empty() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"success": false, "message": "User ID is required"})),
                );
            }

            // 尝试解析 User ID 为数字
            let user_id_i64 = match user_id.parse::<i64>() {
                Ok(n) => n,
                Err(_) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({"success": false, "message": "Invalid User ID format"})),
                    );
                }
            };

            // 调用网易云音乐 API 验证
            let fetcher = crate::services::fetcher::PlatformFetcher::new().await;
            match fetcher.fetch_netease_user(user_id_i64).await {
                Ok(user_info) => {
                    let nickname = user_info["profile"]["nickname"]
                        .as_str()
                        .unwrap_or("Unknown");
                    let playlist_count =
                        user_info["profile"]["playlistCount"].as_i64().unwrap_or(0);
                    (
                        StatusCode::OK,
                        Json(json!({
                            "success": true,
                            "message": format!("✓ Netease Music user '{}' verified. {} playlists", nickname, playlist_count)
                        })),
                    )
                }
                Err(e) => (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "success": false,
                        "message": format!("✗ Failed to verify Netease Music user: {}", e)
                    })),
                ),
            }
        }
        "Bangumi" => {
            let username = config["username"].as_str().unwrap_or("");
            let access_token = config["access_token"]
                .as_str()
                .filter(|s| !s.is_empty() && !s.contains('•') && !s.contains('*'));
            let user_agent = config["user_agent"].as_str().filter(|s| !s.is_empty());
            if username.is_empty() && access_token.is_none() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(
                        json!({"success": false, "message": "Username or access token is required"}),
                    ),
                );
            }

            let fetcher = crate::services::fetcher::PlatformFetcher::new().await;
            let result = if username.is_empty() {
                fetcher
                    .fetch_bangumi_me(access_token.unwrap_or_default(), user_agent)
                    .await
            } else {
                fetcher
                    .fetch_bangumi_user(username, access_token, user_agent)
                    .await
            };

            match result {
                Ok(user_info) => {
                    let display_name = user_info["nickname"]
                        .as_str()
                        .or_else(|| user_info["username"].as_str())
                        .unwrap_or(username);
                    (
                        StatusCode::OK,
                        Json(json!({
                            "success": true,
                            "message": format!("✓ Bangumi user '{}' verified", display_name)
                        })),
                    )
                }
                Err(e) => (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "success": false,
                        "message": format!("✗ Failed to verify Bangumi user: {}", e)
                    })),
                ),
            }
        }
        _ => (
            StatusCode::OK,
            Json(json!({"success": false, "message": "Platform test not implemented yet"})),
        ),
    }
}

/// 获取公开的网站元数据（不需要认证）
/// 直接从环境变量读取（配置保存时已经写入 .env 并重新加载）
/// 优先级：.env 文件（通过 save_all_configs 保存） > 默认值
pub async fn get_site_metadata(State(db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    // 优先从数据库读取站点元数据配置
    let config_service = crate::services::config_service::ConfigService::new(db.clone());
    let db_config = config_service.load_config().await.ok();

    let get_value = |db_val: Option<String>, env_key: &str, default: &str| -> String {
        let from_db = db_val.filter(|v| !v.is_empty());
        let from_env = std::env::var(env_key).ok();
        let has_db = from_db.is_some();
        let has_env = from_env.is_some();
        let result = from_db.or(from_env).unwrap_or_else(|| default.to_string());

        tracing::debug!(
            "[元数据] {}: db={}, env={}, result={}",
            env_key,
            has_db,
            has_env,
            result
        );

        result
    };

    let metadata = json!({
        "site_title": get_value(
            db_config.as_ref().and_then(|c| c.site_title.clone()),
            "SITE_TITLE",
            "Myriad - A myriad of lights, in one place."
        ),
        "site_description": get_value(
            db_config.as_ref().and_then(|c| c.site_description.clone()),
            "SITE_DESCRIPTION",
            "A myriad of lights, in one place."
        ),
        "site_favicon": get_value(
            db_config.as_ref().and_then(|c| c.site_favicon.clone()),
            "SITE_FAVICON",
            "/favicon.webp"
        ),
    });

    (StatusCode::OK, Json(metadata))
}

/// 获取公开的平台配置（不包含敏感信息，仅用于社交链接显示）
/// 🔓 公开端点 - 不需要认证
pub async fn get_public_config(State(db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    // 优先从数据库读取配置
    let config_service = crate::services::config_service::ConfigService::new(db.clone());
    let db_config = config_service.load_config().await.ok();

    // 辅助函数：优先使用数据库值，否则使用环境变量
    let get_value = |db_val: Option<String>, env_key: &str| -> String {
        db_val
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| std::env::var(env_key).unwrap_or_default())
    };

    let github_enabled = resolve_platform_enabled(
        db_config.as_ref().and_then(|c| c.github_enabled),
        db_config
            .as_ref()
            .and_then(|c| c.github_username.as_ref())
            .is_some()
            || std::env::var("GITHUB_USERNAME").is_ok(),
    );
    let bilibili_enabled = resolve_platform_enabled(
        db_config.as_ref().and_then(|c| c.bilibili_enabled),
        db_config
            .as_ref()
            .and_then(|c| c.bilibili_uid.as_ref())
            .is_some()
            || std::env::var("BILIBILI_UID").is_ok(),
    );
    let steam_enabled = resolve_platform_enabled(
        db_config.as_ref().and_then(|c| c.steam_enabled),
        db_config
            .as_ref()
            .and_then(|c| c.steam_id.as_ref())
            .is_some()
            || std::env::var("STEAM_ID").is_ok(),
    );
    let netease_enabled = resolve_platform_enabled(
        db_config.as_ref().and_then(|c| c.netease_enabled),
        db_config
            .as_ref()
            .and_then(|c| c.netease_user_id.as_ref())
            .is_some()
            || std::env::var("NETEASE_USER_ID").is_ok(),
    );
    let bangumi_enabled = resolve_platform_enabled(
        db_config.as_ref().and_then(|c| c.bangumi_enabled),
        db_config
            .as_ref()
            .and_then(|c| c.bangumi_username.as_ref())
            .is_some()
            || db_config
                .as_ref()
                .and_then(|c| c.bangumi_access_token.as_ref())
                .is_some()
            || std::env::var("BANGUMI_USERNAME").is_ok()
            || std::env::var("BANGUMI_ACCESS_TOKEN").is_ok(),
    );

    // 只返回公开可见的平台配置字段（不包含 API 密钥等敏感信息）
    let public_platforms = vec![
        PlatformConfig {
            name: "GitHub".to_string(),
            enabled: github_enabled,
            has_token: false, // 不暴露是否有 token
            icon: "".to_string(),
            description: "".to_string(),
            config_fields: vec![ConfigField {
                key: "username".to_string(),
                label: "".to_string(),
                field_type: "text".to_string(),
                value: get_value(
                    db_config.as_ref().and_then(|c| c.github_username.clone()),
                    "GITHUB_USERNAME",
                ),
                placeholder: "".to_string(),
                required: false,
            }],
        },
        PlatformConfig {
            name: "Bilibili".to_string(),
            enabled: bilibili_enabled,
            has_token: false,
            icon: "".to_string(),
            description: "".to_string(),
            config_fields: vec![ConfigField {
                key: "uid".to_string(),
                label: "".to_string(),
                field_type: "number".to_string(),
                value: get_value(
                    db_config.as_ref().and_then(|c| c.bilibili_uid.clone()),
                    "BILIBILI_UID",
                ),
                placeholder: "".to_string(),
                required: false,
            }],
        },
        PlatformConfig {
            name: "Steam".to_string(),
            enabled: steam_enabled,
            has_token: false,
            icon: "".to_string(),
            description: "".to_string(),
            config_fields: vec![ConfigField {
                key: "steam_id".to_string(),
                label: "".to_string(),
                field_type: "text".to_string(),
                value: get_value(
                    db_config.as_ref().and_then(|c| c.steam_id.clone()),
                    "STEAM_ID",
                ),
                placeholder: "".to_string(),
                required: false,
            }],
        },
        PlatformConfig {
            name: "Netease Music".to_string(),
            enabled: netease_enabled,
            has_token: false,
            icon: "".to_string(),
            description: "".to_string(),
            config_fields: vec![ConfigField {
                key: "user_id".to_string(),
                label: "".to_string(),
                field_type: "number".to_string(),
                value: get_value(
                    db_config.as_ref().and_then(|c| c.netease_user_id.clone()),
                    "NETEASE_USER_ID",
                ),
                placeholder: "".to_string(),
                required: false,
            }],
        },
        PlatformConfig {
            name: "Bangumi".to_string(),
            enabled: bangumi_enabled,
            has_token: false,
            icon: "".to_string(),
            description: "".to_string(),
            config_fields: vec![ConfigField {
                key: "username".to_string(),
                label: "".to_string(),
                field_type: "text".to_string(),
                value: get_value(
                    db_config.as_ref().and_then(|c| c.bangumi_username.clone()),
                    "BANGUMI_USERNAME",
                ),
                placeholder: "".to_string(),
                required: false,
            }],
        },
    ];

    let mut public_platforms = public_platforms;
    sort_platforms_by_order(
        &mut public_platforms,
        db_config.as_ref().and_then(|c| c.platform_order.as_ref()),
    );

    let response = json!({
        "platforms": public_platforms
    });

    (StatusCode::OK, Json(response))
}

/// 获取公开的 UI 配置（萌宠、虚拟人设等）
/// 🔓 公开端点 - 不需要认证
pub async fn get_public_ui_config(
    State(db): State<DatabaseConnection>,
) -> (StatusCode, Json<Value>) {
    // 优先从数据库读取配置
    let config_service = crate::services::config_service::ConfigService::new(db.clone());
    let db_config = config_service.load_config().await.ok();

    let get_value = |db_val: Option<String>, env_key: &str| -> String {
        db_val
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| std::env::var(env_key).unwrap_or_default())
    };

    let ui_config = json!({
        "pet_enabled": db_config.as_ref().map(|c| c.pet_enabled).unwrap_or_else(||
            std::env::var("PET_ENABLED").unwrap_or_else(|_| "true".to_string()).parse().unwrap_or(true)
        ),
        "pet_image_url": get_value(
            db_config.as_ref().and_then(|c| c.pet_image_url.clone()),
            "PET_IMAGE_URL"
        ),
        "wallpaper_url": get_value(
            db_config.as_ref().and_then(|c| c.ui_wallpaper_url.clone()),
            "UI_WALLPAPER_URL"
        ),
        "wallpaper_blur": db_config.as_ref().map(|c| c.ui_wallpaper_blur as u32).unwrap_or_else(||
            std::env::var("UI_WALLPAPER_BLUR").unwrap_or_else(|_| "3".to_string()).parse::<u32>().unwrap_or(3)
        ),
        "wallpaper_parallax": db_config.as_ref().map(|c| c.ui_wallpaper_parallax).unwrap_or_else(||
            std::env::var("UI_WALLPAPER_PARALLAX").unwrap_or_else(|_| "true".to_string()).parse().unwrap_or(true)
        ),
        // Evocative 壁纸动效
        "evocative_parallax": db_config.as_ref().map(|c| c.ui_evocative_parallax).unwrap_or_else(||
            std::env::var("UI_EVOCATIVE_PARALLAX").unwrap_or_else(|_| "true".to_string()).parse().unwrap_or(true)
        ),
        "evocative_dynamic_blur": db_config.as_ref().map(|c| c.ui_evocative_dynamic_blur).unwrap_or_else(||
            std::env::var("UI_EVOCATIVE_DYNAMIC_BLUR").unwrap_or_else(|_| "false".to_string()).parse().unwrap_or(false)
        ),
        "evocative_ripple": db_config.as_ref().map(|c| c.ui_evocative_ripple).unwrap_or_else(||
            std::env::var("UI_EVOCATIVE_RIPPLE").unwrap_or_else(|_| "false".to_string()).parse().unwrap_or(false)
        ),
        "evocative_fps": db_config.as_ref().map(|c| c.ui_evocative_fps as u32).unwrap_or_else(||
            std::env::var("UI_EVOCATIVE_FPS").unwrap_or_else(|_| "30".to_string()).parse::<u32>().unwrap_or(30)
        ),
        "evocative_ripple_quality": db_config.as_ref().map(|c| c.ui_evocative_ripple_quality).unwrap_or_else(||
            std::env::var("UI_EVOCATIVE_RIPPLE_QUALITY").unwrap_or_else(|_| "0.85".to_string()).parse::<f64>().unwrap_or(0.85)
        ),
        "music_enabled": get_value(
            db_config.as_ref().and_then(|c| c.music_enabled.clone()),
            "MUSIC_ENABLED"
        ),
        "music_source": get_value(
            db_config.as_ref().and_then(|c| c.music_source.clone()),
            "MUSIC_SOURCE"
        ),
        "music_playlist_id": get_value(
            db_config.as_ref().and_then(|c| c.music_playlist_id.clone()),
            "MUSIC_PLAYLIST_ID"
        ),
        "dashboard_layout": db_config.as_ref().and_then(|c| c.dashboard_layout.clone()),
        "dashboard_title": db_config.as_ref().and_then(|c| c.dashboard_title.clone()),
        "custom_platforms": db_config.as_ref().and_then(|c| c.custom_platforms.clone()),
        "control_panel_layout": db_config.as_ref().and_then(|c| c.control_panel_layout.clone()),
        "control_panel_rows": db_config.as_ref().map(|c| c.control_panel_rows).unwrap_or(2),
        "tapp_window_schemes": db_config.as_ref().and_then(|c| c.tapp_window_schemes.clone()),
        // 标题字体样式设置
        "title_font": db_config.as_ref().and_then(|c| c.title_font.clone()),
        "title_font_size": db_config.as_ref().and_then(|c| c.title_font_size),
        "title_color": db_config.as_ref().and_then(|c| c.title_color.clone()),
        // 站点信息（用于底部显示）
        "site_icp": db_config.as_ref().and_then(|c| c.site_icp.clone()),
        "site_gongan": db_config.as_ref().and_then(|c| c.site_gongan.clone()),
        "cloud_sponsors": db_config.as_ref().and_then(|c| c.cloud_sponsors.clone()),
    });

    (StatusCode::OK, Json(ui_config))
}

#[derive(Debug, Deserialize)]
pub struct DashboardConfigPayload {
    pub layout: Option<String>,
    pub title: Option<String>,
    pub custom_platforms: Option<String>,
    pub title_font: Option<String>,
    pub title_font_size: Option<f64>,
    pub title_color: Option<String>,
}

pub async fn update_dashboard_config(
    State(db): State<DatabaseConnection>,
    Json(payload): Json<DashboardConfigPayload>,
) -> (StatusCode, Json<Value>) {
    let config_service = crate::services::config_service::ConfigService::new(db);
    let mut updates = std::collections::HashMap::new();

    if let Some(layout) = payload.layout {
        updates.insert("dashboard_layout".to_string(), json!(layout));
    }

    if let Some(title) = payload.title {
        updates.insert("dashboard_title".to_string(), json!(title));
    }

    if let Some(custom_platforms) = payload.custom_platforms {
        updates.insert("custom_platforms".to_string(), json!(custom_platforms));
    }

    if let Some(title_font) = payload.title_font {
        updates.insert("title_font".to_string(), json!(title_font));
    }

    if let Some(title_font_size) = payload.title_font_size {
        updates.insert("title_font_size".to_string(), json!(title_font_size));
    }

    if let Some(title_color) = payload.title_color {
        updates.insert("title_color".to_string(), json!(title_color));
    }

    if let Err(e) = config_service.update_configs(updates).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": format!("Failed to update dashboard config: {}", e)
            })),
        );
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "Dashboard configuration updated successfully"
        })),
    )
}

#[derive(Debug, Deserialize)]
pub struct ControlPanelConfigPayload {
    pub control_panel_layout: Option<String>,
    pub control_panel_rows: Option<i32>,
}

pub async fn update_control_panel_config(
    State(db): State<DatabaseConnection>,
    Json(payload): Json<ControlPanelConfigPayload>,
) -> (StatusCode, Json<Value>) {
    let config_service = crate::services::config_service::ConfigService::new(db);
    let mut updates = std::collections::HashMap::new();

    if let Some(layout) = payload.control_panel_layout {
        updates.insert("control_panel_layout".to_string(), json!(layout));
    }

    if let Some(rows) = payload.control_panel_rows {
        updates.insert("control_panel_rows".to_string(), json!(rows));
    }

    if let Err(e) = config_service.update_configs(updates).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": format!("Failed to update control panel config: {}", e)
            })),
        );
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "Control panel configuration updated successfully"
        })),
    )
}

// ========== Tapp 窗口方案 API ==========

#[derive(Debug, Deserialize)]
pub struct TappWindowSchemesPayload {
    pub schemes: String,
}

pub async fn update_tapp_window_schemes(
    State(db): State<DatabaseConnection>,
    Json(payload): Json<TappWindowSchemesPayload>,
) -> (StatusCode, Json<Value>) {
    let config_service = crate::services::config_service::ConfigService::new(db);
    let mut updates = std::collections::HashMap::new();

    updates.insert("tapp_window_schemes".to_string(), json!(payload.schemes));

    if let Err(e) = config_service.update_configs(updates).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": format!("Failed to update tapp window schemes: {}", e)
            })),
        );
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "Tapp window schemes updated successfully"
        })),
    )
}

const MODULE_VISIBILITY_PREFERENCES_KEY: &str = "module_visibility_preferences";
const MODULE_VISIBILITY_KEYS: [&str; 4] = ["library", "brew", "reports", "tapp"];
const MODULE_VISIBILITY_LEVELS: [&str; 3] = ["all", "authenticated", "admin"];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModuleVisibilityPreferences {
    #[serde(default = "default_module_visibility_modules")]
    pub modules: std::collections::HashMap<String, String>,
}

fn default_module_visibility_modules() -> std::collections::HashMap<String, String> {
    std::collections::HashMap::from([
        ("library".to_string(), "all".to_string()),
        ("brew".to_string(), "all".to_string()),
        ("reports".to_string(), "all".to_string()),
        ("tapp".to_string(), "all".to_string()),
    ])
}

impl Default for ModuleVisibilityPreferences {
    fn default() -> Self {
        Self {
            modules: default_module_visibility_modules(),
        }
    }
}

impl ModuleVisibilityPreferences {
    fn normalized(mut self) -> Self {
        let defaults = default_module_visibility_modules();
        let mut normalized = std::collections::HashMap::new();

        for key in MODULE_VISIBILITY_KEYS {
            let value = self
                .modules
                .remove(key)
                .unwrap_or_else(|| defaults.get(key).cloned().unwrap_or_else(|| "all".into()));
            let value = if MODULE_VISIBILITY_LEVELS.contains(&value.as_str()) {
                value
            } else {
                defaults.get(key).cloned().unwrap_or_else(|| "all".into())
            };
            normalized.insert(key.to_string(), value);
        }

        self.modules = normalized;
        self
    }
}

async fn load_module_visibility_preferences(
    db: &DatabaseConnection,
) -> ModuleVisibilityPreferences {
    let sql = "SELECT value FROM configurations WHERE key = $1";
    let result = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            sql,
            vec![MODULE_VISIBILITY_PREFERENCES_KEY.into()],
        ))
        .await;

    match result {
        Ok(Some(row)) => match row.try_get::<Value>("", "value") {
            Ok(value) => serde_json::from_value::<ModuleVisibilityPreferences>(value)
                .map(ModuleVisibilityPreferences::normalized)
                .unwrap_or_else(|e| {
                    tracing::warn!(
                        "Invalid module visibility preferences, using defaults: {}",
                        e
                    );
                    ModuleVisibilityPreferences::default()
                }),
            Err(e) => {
                tracing::warn!("Failed to read module visibility preferences: {}", e);
                ModuleVisibilityPreferences::default()
            }
        },
        Ok(None) => ModuleVisibilityPreferences::default(),
        Err(e) => {
            tracing::warn!("Failed to load module visibility preferences: {}", e);
            ModuleVisibilityPreferences::default()
        }
    }
}

pub async fn get_module_visibility_preferences(
    State(db): State<DatabaseConnection>,
) -> (StatusCode, Json<Value>) {
    let preferences = load_module_visibility_preferences(&db).await;
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "preferences": preferences
        })),
    )
}

pub async fn update_module_visibility_preferences(
    State(db): State<DatabaseConnection>,
    Json(payload): Json<ModuleVisibilityPreferences>,
) -> (StatusCode, Json<Value>) {
    let preferences = payload.normalized();
    let config_service = crate::services::config_service::ConfigService::new(db);

    match config_service
        .update_config(
            MODULE_VISIBILITY_PREFERENCES_KEY,
            serde_json::to_value(&preferences).unwrap_or_else(|_| json!({})),
        )
        .await
    {
        Ok(_) => (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "preferences": preferences
            })),
        ),
        Err(e) => {
            tracing::error!("Failed to save module visibility preferences: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "message": "Failed to save module visibility preferences"
                })),
            )
        }
    }
}

// ========== 权限配置 API ==========

use crate::middleware::auth::extract_optional_claims;
use crate::services::permission_service::{TappPermissionService, UserRole};
use axum::http::HeaderMap;

/// 获取 Tapp 权限配置（公开端点）
/// 返回当前用户的权限等级和系统权限下放配置
#[axum::debug_handler]
pub async fn get_permissions(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
) -> (StatusCode, Json<Value>) {
    let config_service = crate::services::config_service::ConfigService::new(db);
    let config = match config_service.load_config().await {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "error": format!("Failed to load config: {}", e)
                })),
            );
        }
    };

    // 获取当前用户角色
    let claims = extract_optional_claims(&headers);
    let role = match &claims {
        Some(c) if c.is_admin => UserRole::Admin,
        Some(c) => {
            // 检查是否为游客（负数 ID）
            if let Ok(user_id) = c.sub.parse::<i32>() {
                if user_id < 0 {
                    UserRole::Guest
                } else {
                    UserRole::User
                }
            } else {
                UserRole::Guest
            }
        }
        None => UserRole::Guest,
    };

    // 获取用户可用的权限等级
    let allowed_levels: Vec<String> = TappPermissionService::get_allowed_levels(&config, role)
        .iter()
        .map(|l| format!("{:?}", l).to_lowercase())
        .collect();

    // 获取权限下放配置
    let perm_config = TappPermissionService::get_permission_config(&config);

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "role": role.as_str(),
            "allowed_levels": allowed_levels,
            "config": perm_config
        })),
    )
}

/// 更新 Tapp 权限下放配置（仅管理员）
#[derive(Debug, Deserialize)]
pub struct UpdatePermissionsPayload {
    // 普通用户 elevated 权限 (11个, platform:write 和 platform:register 已升为 privileged)
    pub user_perm_ai_generate: Option<bool>,
    pub user_perm_ai_analyze: Option<bool>,
    pub user_perm_ai_chat: Option<bool>,
    pub user_perm_ai_image: Option<bool>,
    pub user_perm_report_write: Option<bool>,
    pub user_perm_network_fetch: Option<bool>,
    pub user_perm_media_control: Option<bool>,
    pub user_perm_component_theme: Option<bool>,
    pub user_perm_shortcut_register: Option<bool>,
    pub user_perm_event_publish: Option<bool>,
    pub user_perm_scheduler_register: Option<bool>,
    // 游客 elevated 权限 (11个)
    pub guest_perm_ai_generate: Option<bool>,
    pub guest_perm_ai_analyze: Option<bool>,
    pub guest_perm_ai_chat: Option<bool>,
    pub guest_perm_ai_image: Option<bool>,
    pub guest_perm_report_write: Option<bool>,
    pub guest_perm_network_fetch: Option<bool>,
    pub guest_perm_media_control: Option<bool>,
    pub guest_perm_component_theme: Option<bool>,
    pub guest_perm_shortcut_register: Option<bool>,
    pub guest_perm_event_publish: Option<bool>,
    pub guest_perm_scheduler_register: Option<bool>,
    // AI 使用限额配置
    pub user_ai_daily_calls: Option<i32>,
    pub user_ai_daily_tokens: Option<i32>,
    pub user_ai_cooldown_seconds: Option<i32>,
    pub guest_ai_daily_calls: Option<i32>,
    pub guest_ai_daily_tokens: Option<i32>,
    pub guest_ai_cooldown_seconds: Option<i32>,
}

#[axum::debug_handler]
pub async fn update_permissions(
    State(db): State<DatabaseConnection>,
    Json(payload): Json<UpdatePermissionsPayload>,
) -> (StatusCode, Json<Value>) {
    let config_service = crate::services::config_service::ConfigService::new(db);
    let mut updates = std::collections::HashMap::new();

    // 普通用户权限 (10个 elevated)
    if let Some(v) = payload.user_perm_ai_generate {
        updates.insert("user_perm_ai_generate".to_string(), json!(v));
    }
    if let Some(v) = payload.user_perm_ai_analyze {
        updates.insert("user_perm_ai_analyze".to_string(), json!(v));
    }
    if let Some(v) = payload.user_perm_ai_chat {
        updates.insert("user_perm_ai_chat".to_string(), json!(v));
    }
    if let Some(v) = payload.user_perm_ai_image {
        updates.insert("user_perm_ai_image".to_string(), json!(v));
    }
    if let Some(v) = payload.user_perm_report_write {
        updates.insert("user_perm_report_write".to_string(), json!(v));
    }
    if let Some(v) = payload.user_perm_network_fetch {
        updates.insert("user_perm_network_fetch".to_string(), json!(v));
    }
    if let Some(v) = payload.user_perm_media_control {
        updates.insert("user_perm_media_control".to_string(), json!(v));
    }
    if let Some(v) = payload.user_perm_component_theme {
        updates.insert("user_perm_component_theme".to_string(), json!(v));
    }
    if let Some(v) = payload.user_perm_shortcut_register {
        updates.insert("user_perm_shortcut_register".to_string(), json!(v));
    }
    if let Some(v) = payload.user_perm_event_publish {
        updates.insert("user_perm_event_publish".to_string(), json!(v));
    }
    if let Some(v) = payload.user_perm_scheduler_register {
        updates.insert("user_perm_scheduler_register".to_string(), json!(v));
    }

    // 游客权限 (11个 elevated)
    if let Some(v) = payload.guest_perm_ai_generate {
        updates.insert("guest_perm_ai_generate".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_perm_ai_analyze {
        updates.insert("guest_perm_ai_analyze".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_perm_ai_chat {
        updates.insert("guest_perm_ai_chat".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_perm_ai_image {
        updates.insert("guest_perm_ai_image".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_perm_report_write {
        updates.insert("guest_perm_report_write".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_perm_network_fetch {
        updates.insert("guest_perm_network_fetch".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_perm_media_control {
        updates.insert("guest_perm_media_control".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_perm_component_theme {
        updates.insert("guest_perm_component_theme".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_perm_shortcut_register {
        updates.insert("guest_perm_shortcut_register".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_perm_event_publish {
        updates.insert("guest_perm_event_publish".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_perm_scheduler_register {
        updates.insert("guest_perm_scheduler_register".to_string(), json!(v));
    }

    // AI 使用限额配置
    if let Some(v) = payload.user_ai_daily_calls {
        updates.insert("user_ai_daily_calls".to_string(), json!(v));
    }
    if let Some(v) = payload.user_ai_daily_tokens {
        updates.insert("user_ai_daily_tokens".to_string(), json!(v));
    }
    if let Some(v) = payload.user_ai_cooldown_seconds {
        updates.insert("user_ai_cooldown_seconds".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_ai_daily_calls {
        updates.insert("guest_ai_daily_calls".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_ai_daily_tokens {
        updates.insert("guest_ai_daily_tokens".to_string(), json!(v));
    }
    if let Some(v) = payload.guest_ai_cooldown_seconds {
        updates.insert("guest_ai_cooldown_seconds".to_string(), json!(v));
    }

    if updates.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "No permission settings provided"
            })),
        );
    }

    if let Err(e) = config_service.update_configs(updates).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": format!("Failed to update permissions: {}", e)
            })),
        );
    }

    // 刷新全局配置缓存
    match config_service.load_config().await {
        Ok(new_config) => {
            *crate::GLOBAL_DYNAMIC_CONFIG.write().await = new_config;
            tracing::info!("✅ Global dynamic config refreshed after permission update");
        }
        Err(e) => {
            tracing::warn!("⚠️ Failed to refresh global config: {}", e);
        }
    }

    tracing::info!("✅ Tapp permission delegation settings updated by admin");

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "Permission settings updated successfully"
        })),
    )
}

// ============================================================================
// PR #6: OAuth Providers + 本地注册开关 — 专用端点
// ============================================================================
// 详见 docs/oauth-refactor-plan.md §5、§7
//
// GitHub 可以作为 kind="github" 的 provider entry 配置；旧的
// github_client_id/github_client_secret 字段保留为兼容镜像。
// 这里集中处理 provider 列表 + 注册开关。

/// GET /api/config/oauth-providers
///
/// 返回 OIDC providers 列表 + 本地注册开关。
/// `client_secret` 字段在响应中被掩码（仅在数据库已设置时返回 `***`），
/// 前端不应展示明文；保存时若收到 `***` 表示用户没改，沿用旧值。
pub async fn get_oauth_providers() -> (StatusCode, Json<Value>) {
    let config = crate::GLOBAL_DYNAMIC_CONFIG.read().await;

    let mut providers: Vec<Value> = config
        .oauth_providers
        .iter()
        .map(|p| {
            json!({
                "slug": p.slug,
                "kind": p.kind,
                "display_name": p.display_name,
                "enabled": p.enabled,
                "client_id": p.client_id,
                "client_secret": if p.client_secret.is_empty() { "" } else { "***" },
                "scopes": p.scopes,
                "discovery_url": p.discovery_url,
                "icon_url": p.icon_url,
            })
        })
        .collect();

    // 自动迁移：若 legacy github_client_id 有值但 entries 里没有 slug="github"，
    // 合成一条只读 entry 展示给前端。客户端首次保存时会写到 oauth_providers。
    let has_github_entry = config.oauth_providers.iter().any(|p| p.slug == "github");
    if !has_github_entry {
        if let (Some(cid), Some(_csec)) = (
            config.github_client_id.as_ref().filter(|s| !s.is_empty()),
            config
                .github_client_secret
                .as_ref()
                .filter(|s| !s.is_empty()),
        ) {
            providers.insert(
                0,
                json!({
                    "slug": "github",
                    "kind": "github",
                    "display_name": "GitHub",
                    "enabled": true,
                    "client_id": cid,
                    "client_secret": "***",
                    "scopes": Vec::<String>::new(),
                    "discovery_url": null,
                    "icon_url": null,
                }),
            );
        }
    }

    (
        StatusCode::OK,
        Json(json!({
            "providers": providers,
            "allow_local_registration": config.allow_local_registration,
        })),
    )
}

#[derive(Debug, Deserialize)]
pub struct UpdateOAuthProvidersPayload {
    pub providers: Vec<crate::config::OAuthProviderEntry>,
    pub allow_local_registration: bool,
}

/// PUT /api/config/oauth-providers
///
/// 全量覆盖 providers 列表 + 注册开关。
/// 校验：
/// 1. slug 必填、URL-safe、不能重复
/// 2. kind="oidc" 时 discovery_url 必填
/// 3. client_secret 若为掩码 `***`，沿用现有 secret
///
/// 保存后触发 [`ProviderRegistry::reload`]。
pub async fn update_oauth_providers(
    State(db): State<DatabaseConnection>,
    Json(mut payload): Json<UpdateOAuthProvidersPayload>,
) -> (StatusCode, Json<Value>) {
    // 校验 + secret 回填
    let mut seen = std::collections::HashSet::new();
    {
        let current = crate::GLOBAL_DYNAMIC_CONFIG.read().await;
        for p in payload.providers.iter_mut() {
            let slug = p.slug.trim();
            if slug.is_empty() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": "Provider slug is required"})),
                );
            }
            // slug 必须 URL-safe（路由参数）：字母数字 + 连字符/下划线，2-32 字符
            if slug.len() > 32
                || !slug
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": format!("invalid slug '{}': only ASCII letters, digits, '-' and '_' allowed (max 32 chars)", slug)
                    })),
                );
            }
            p.slug = slug.to_string();
            if !seen.insert(p.slug.clone()) {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": format!("duplicate provider slug: {}", p.slug)})),
                );
            }
            if p.enabled && p.client_id.trim().is_empty() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": format!("provider '{}' requires client_id (disable it if not ready)", p.slug)
                    })),
                );
            }
            match p.kind.as_str() {
                "github" => { /* no extra requirements */ }
                "oidc" => {
                    if p.discovery_url.as_deref().unwrap_or("").trim().is_empty() {
                        return (
                            StatusCode::BAD_REQUEST,
                            Json(json!({
                                "error": format!("OIDC provider '{}' requires discovery_url", p.slug)
                            })),
                        );
                    }
                }
                other => {
                    return (
                        StatusCode::BAD_REQUEST,
                        Json(json!({
                            "error": format!("unsupported provider kind '{}'", other),
                            "message": "kind must be 'github' or 'oidc'"
                        })),
                    );
                }
            }
            // secret 回填：前端送 "***" 表示沿用
            if p.client_secret == "***" || p.client_secret.is_empty() {
                if let Some(existing) = current.oauth_providers.iter().find(|e| e.slug == p.slug) {
                    p.client_secret = existing.client_secret.clone();
                } else if p.kind == "github" && p.slug == "github" {
                    // 从 legacy 字段拿一次作为初值
                    if let Some(legacy) = current
                        .github_client_secret
                        .as_ref()
                        .filter(|s| !s.is_empty())
                    {
                        p.client_secret = legacy.clone();
                    } else {
                        p.client_secret.clear();
                    }
                } else {
                    p.client_secret.clear();
                }
            }

            // 启用的 provider 必须有 secret（兜底检查，回填后仍为空才报错）
            if p.enabled && p.client_secret.is_empty() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": format!("provider '{}' requires client_secret (disable it if not ready)", p.slug)
                    })),
                );
            }
        }
    }

    let config_service = crate::services::config_service::ConfigService::new(db);
    let mut updates = std::collections::HashMap::new();
    let providers_json = match serde_json::to_value(&payload.providers) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("Failed to serialize providers: {}", e)})),
            );
        }
    };
    updates.insert("oauth_providers".to_string(), providers_json);
    updates.insert(
        "allow_local_registration".to_string(),
        json!(payload.allow_local_registration),
    );

    // 兼容镜像：若 entries 里有 slug="github"，同时写到 legacy 平铺字段；
    // 反之则清空它们，让 registry 不会同时拿到两份冲突的凭证。
    if let Some(gh) = payload
        .providers
        .iter()
        .find(|p| p.slug == "github" && p.kind == "github")
    {
        updates.insert("github_client_id".to_string(), json!(gh.client_id));
        updates.insert("github_client_secret".to_string(), json!(gh.client_secret));
    } else {
        updates.insert("github_client_id".to_string(), json!(""));
        updates.insert("github_client_secret".to_string(), json!(""));
    }

    if let Err(e) = config_service.update_configs(updates).await {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": format!("Failed to save: {}", e)})),
        );
    }

    // 刷新全局配置缓存
    match config_service.load_config().await {
        Ok(new_config) => {
            *crate::GLOBAL_DYNAMIC_CONFIG.write().await = new_config;
            tracing::info!("✅ Global dynamic config refreshed (oauth providers)");
        }
        Err(e) => {
            tracing::warn!("⚠️ Failed to refresh global config: {}", e);
        }
    }

    // 热重载 OAuth 注册中心
    crate::services::oauth::registry::REGISTRY.reload().await;

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "providers_count": payload.providers.len(),
            "allow_local_registration": payload.allow_local_registration,
        })),
    )
}
