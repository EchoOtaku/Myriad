use axum::{extract::State, http::StatusCode, Json};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigResponse {
    pub platforms: Vec<PlatformConfig>,
    pub ai_config: AiConfig,
    pub report_config: ReportConfig,
    pub persona_config: PersonaConfig,
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
    pub config_fields: Vec<ConfigField>,
}
#[derive(Debug, Serialize, Deserialize)]
pub struct ReportConfig {
    pub topic_style: String,
    pub config_fields: Vec<ConfigField>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PersonaConfig {
    pub enabled: bool,
    pub provider: String,
    pub config_fields: Vec<ConfigField>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UiConfig {
    pub wallpaper_url: String,
    pub wallpaper_blur: u32,
    pub theme: String,
    pub primary_color: String,
    pub secondary_color: String,
    pub pet_enabled: bool,
    pub pet_image_url: String,
    pub config_fields: Vec<ConfigField>,
}

pub async fn get_config(State(db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    // 优先从数据库读取配置
    let config_service = crate::services::config_service::ConfigService::new(db.clone());
    let db_config = config_service.load_config().await.ok();
    
    // 辅助函数：优先使用数据库值，否则使用环境变量
    // Helper to get string value from database or environment
    let get_value = |db_val: Option<String>, env_key: &str| -> String {
        db_val.filter(|v| !v.is_empty())
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
    
    let config = ConfigResponse {
        platforms: vec![
            PlatformConfig {
                name: "GitHub".to_string(),
                enabled: db_config.as_ref().and_then(|c| c.github_username.as_ref()).is_some() 
                    || std::env::var("GITHUB_USERNAME").is_ok(),
                has_token: db_config.as_ref().and_then(|c| c.github_token.as_ref()).is_some() 
                    || std::env::var("GITHUB_TOKEN").is_ok(),
                icon: "".to_string(),
                description: "Track repositories, stars, and contributions".to_string(),
                config_fields: vec![
                    ConfigField {
                        key: "username".to_string(),
                        label: "GitHub Username".to_string(),
                        field_type: "text".to_string(),
                        value: get_value(db_config.as_ref().and_then(|c| c.github_username.clone()), "GITHUB_USERNAME"),
                        placeholder: "octocat".to_string(),
                        required: true,
                    },
                    ConfigField {
                        key: "token".to_string(),
                        label: "Personal Access Token (Optional)".to_string(),
                        field_type: "password".to_string(),
                        value: mask_sensitive(get_value(db_config.as_ref().and_then(|c| c.github_token.clone()), "GITHUB_TOKEN")),
                        placeholder: "ghp_xxxxxxxxxxxx (Increases API rate limit)".to_string(),
                        required: false,
                    },
                ],
            },
            PlatformConfig {
                name: "Bilibili".to_string(),
                enabled: db_config.as_ref().and_then(|c| c.bilibili_uid.as_ref()).is_some() 
                    || std::env::var("BILIBILI_UID").is_ok(),
                has_token: db_config.as_ref().and_then(|c| c.bilibili_uid.as_ref()).is_some() 
                    || std::env::var("BILIBILI_UID").is_ok(),
                icon: "".to_string(),
                description: "Track your Bilibili favorites, anime, and viewing history"
                    .to_string(),
                config_fields: vec![ConfigField {
                    key: "uid".to_string(),
                    label: "User ID (UID)".to_string(),
                    field_type: "number".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.bilibili_uid.clone()), "BILIBILI_UID"),
                    placeholder: "123456789".to_string(),
                    required: true,
                }],
            },
            PlatformConfig {
                name: "Steam".to_string(),
                enabled: db_config.as_ref().and_then(|c| c.steam_api_key.as_ref()).is_some() 
                    || std::env::var("STEAM_API_KEY").is_ok(),
                has_token: db_config.as_ref().and_then(|c| c.steam_api_key.as_ref()).is_some() 
                    || std::env::var("STEAM_API_KEY").is_ok(),
                icon: "".to_string(),
                description: "Sync your Steam library, wishlist, and gaming stats".to_string(),
                config_fields: vec![
                    ConfigField {
                        key: "api_key".to_string(),
                        label: "Steam API Key".to_string(),
                        field_type: "password".to_string(),
                        value: mask_sensitive(get_value(db_config.as_ref().and_then(|c| c.steam_api_key.clone()), "STEAM_API_KEY")),
                        placeholder: "Get from steamcommunity.com/dev/apikey".to_string(),
                        required: true,
                    },
                    ConfigField {
                        key: "steam_id".to_string(),
                        label: "Steam ID".to_string(),
                        field_type: "text".to_string(),
                        value: get_value(db_config.as_ref().and_then(|c| c.steam_id.clone()), "STEAM_ID"),
                        placeholder: "76561198XXXXXXXXX".to_string(),
                        required: true,
                    },
                ],
            },
            PlatformConfig {
                name: "X".to_string(),
                enabled: db_config.as_ref().and_then(|c| c.twitter_username.as_ref()).is_some()
                    || std::env::var("TWITTER_USERNAME").is_ok(),
                has_token: db_config.as_ref().and_then(|c| c.twitter_bearer_token.as_ref()).is_some() 
                    || std::env::var("TWITTER_BEARER_TOKEN").is_ok(),
                icon: "".to_string(),
                description: "Analyze tweets and engagement from the past year".to_string(),
                config_fields: vec![
                    ConfigField {
                        key: "username".to_string(),
                        label: "X Username".to_string(),
                        field_type: "text".to_string(),
                        value: get_value(db_config.as_ref().and_then(|c| c.twitter_username.clone()), "TWITTER_USERNAME"),
                        placeholder: "elonmusk".to_string(),
                        required: true,
                    },
                    ConfigField {
                        key: "bearer_token".to_string(),
                        label: "Bearer Token".to_string(),
                        field_type: "password".to_string(),
                        value: mask_sensitive(get_value(db_config.as_ref().and_then(|c| c.twitter_bearer_token.clone()), "TWITTER_BEARER_TOKEN")),
                        placeholder: "Get from developer.twitter.com".to_string(),
                        required: true,
                    },
                ],
            },
            PlatformConfig {
                name: "Netease Music".to_string(),
                enabled: db_config.as_ref().and_then(|c| c.netease_user_id.as_ref()).is_some() 
                    || std::env::var("NETEASE_USER_ID").is_ok(),
                has_token: db_config.as_ref().and_then(|c| c.netease_user_id.as_ref()).is_some() 
                    || std::env::var("NETEASE_USER_ID").is_ok(),
                icon: "".to_string(),
                description: "Sync your liked songs and music taste from Netease Cloud Music"
                    .to_string(),
                config_fields: vec![ConfigField {
                    key: "user_id".to_string(),
                    label: "User ID".to_string(),
                    field_type: "number".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.netease_user_id.clone()), "NETEASE_USER_ID"),
                    placeholder: "Your Netease Cloud Music user ID".to_string(),
                    required: true,
                }],
            },
        ],
        ai_config: AiConfig {
            provider: db_config.as_ref().map(|c| c.ai_provider.clone()).unwrap_or_else(|| std::env::var("AI_PROVIDER").unwrap_or_else(|_| "gemini".to_string())),
            model: db_config.as_ref().map(|c| c.gemini_model.clone()).unwrap_or_else(|| std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-pro".to_string())),
            api_key: get_value(db_config.as_ref().and_then(|c| c.gemini_api_key.clone()), "GEMINI_API_KEY"),
            enabled: db_config.as_ref().and_then(|c| c.gemini_api_key.as_ref()).is_some()
                || db_config.as_ref().and_then(|c| c.openai_api_key.as_ref()).is_some()
                || std::env::var("GEMINI_API_KEY").is_ok()
                || std::env::var("OPENAI_API_KEY").is_ok(),
            config_fields: vec![
                ConfigField {
                    key: "provider".to_string(),
                    label: "AI Provider".to_string(),
                    field_type: "select".to_string(),
                    value: db_config.as_ref().map(|c| c.ai_provider.clone()).unwrap_or_else(|| std::env::var("AI_PROVIDER").unwrap_or_else(|_| "gemini".to_string())),
                    placeholder: "gemini".to_string(),
                    required: true,
                },
                ConfigField {
                    key: "gemini_api_key".to_string(),
                    label: "Gemini API Key".to_string(),
                    field_type: "password".to_string(),
                    value: mask_sensitive(get_value(db_config.as_ref().and_then(|c| c.gemini_api_key.clone()), "GEMINI_API_KEY")),
                    placeholder: "Get from https://makersuite.google.com/app/apikey".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "gemini_model".to_string(),
                    label: "Gemini Model Name".to_string(),
                    field_type: "text".to_string(),
                    value: db_config.as_ref().map(|c| c.gemini_model.clone()).unwrap_or_else(|| std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-pro".to_string())),
                    placeholder: "gemini-pro, gemini-1.5-flash, gemini-1.5-pro, etc.".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "openai_api_key".to_string(),
                    label: "OpenAI API Key".to_string(),
                    field_type: "password".to_string(),
                    value: mask_sensitive(get_value(db_config.as_ref().and_then(|c| c.openai_api_key.clone()), "OPENAI_API_KEY")),
                    placeholder: "OpenAI API Key or compatible service key".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "openai_model".to_string(),
                    label: "OpenAI Model Name".to_string(),
                    field_type: "text".to_string(),
                    value: db_config.as_ref().map(|c| c.openai_model.clone()).unwrap_or_else(|| std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-3.5-turbo".to_string())),
                    placeholder: "gpt-3.5-turbo, gpt-4, gpt-4-turbo, etc.".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "openai_base_url".to_string(),
                    label: "OpenAI Base URL".to_string(),
                    field_type: "text".to_string(),
                    value: db_config.as_ref().map(|c| c.openai_base_url.clone()).unwrap_or_else(|| std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| "https://api.openai.com/v1".to_string())),
                    placeholder: "https://api.openai.com/v1 or https://api.deepseek.com (base URL only, no /chat/completions)".to_string(),
                    required: false,
                },
            ],
        },
        report_config: ReportConfig {
            topic_style: db_config.as_ref().map(|c| c.topic_style.clone()).unwrap_or_else(|| std::env::var("TOPIC_STYLE").unwrap_or_else(|_| "balanced".to_string())),
            config_fields: vec![ConfigField {
                key: "topic_style".to_string(),
                label: "Report Topic Style".to_string(),
                field_type: "select".to_string(),
                value: db_config.as_ref().map(|c| c.topic_style.clone()).unwrap_or_else(|| std::env::var("TOPIC_STYLE").unwrap_or_else(|_| "balanced".to_string())),
                placeholder: "balanced".to_string(),
                required: true,
            }],
        },
        persona_config: PersonaConfig {
            enabled: db_config.as_ref().map(|c| c.persona_image_enabled).unwrap_or_else(|| std::env::var("PERSONA_IMAGE_ENABLED").unwrap_or_else(|_| "true".to_string()).parse().unwrap_or(true)),
            provider: db_config.as_ref().map(|c| c.persona_image_provider.clone()).unwrap_or_else(|| std::env::var("PERSONA_IMAGE_PROVIDER").unwrap_or_else(|_| "pollinations".to_string())),
            config_fields: vec![
                ConfigField {
                    key: "persona_image_enabled".to_string(),
                    label: "Enable Virtual Persona".to_string(),
                    field_type: "checkbox".to_string(),
                    value: db_config.as_ref().map(|c| c.persona_image_enabled.to_string()).unwrap_or_else(|| std::env::var("PERSONA_IMAGE_ENABLED").unwrap_or_else(|_| "true".to_string())),
                    placeholder: "true".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "persona_image_provider".to_string(),
                    label: "Image Provider".to_string(),
                    field_type: "select".to_string(),
                    value: db_config.as_ref().map(|c| c.persona_image_provider.clone()).unwrap_or_else(|| std::env::var("PERSONA_IMAGE_PROVIDER").unwrap_or_else(|_| "pollinations".to_string())),
                    placeholder: "pollinations or imaginepro".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "persona_image_model".to_string(),
                    label: "Image Model (Pollinations)".to_string(),
                    field_type: "select".to_string(),
                    value: db_config.as_ref().map(|c| c.persona_image_model.clone()).unwrap_or_else(|| std::env::var("PERSONA_IMAGE_MODEL").unwrap_or_else(|_| "flux-anime".to_string())),
                    placeholder: "flux-anime".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "persona_image_width".to_string(),
                    label: "Image Width".to_string(),
                    field_type: "number".to_string(),
                    value: db_config.as_ref().map(|c| c.persona_image_width.to_string()).unwrap_or_else(|| std::env::var("PERSONA_IMAGE_WIDTH").unwrap_or_else(|_| "512".to_string())),
                    placeholder: "512".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "persona_image_height".to_string(),
                    label: "Image Height".to_string(),
                    field_type: "number".to_string(),
                    value: db_config.as_ref().map(|c| c.persona_image_height.to_string()).unwrap_or_else(|| std::env::var("PERSONA_IMAGE_HEIGHT").unwrap_or_else(|_| "768".to_string())),
                    placeholder: "768".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "imaginepro_api_key".to_string(),
                    label: "ImaginePro API Key".to_string(),
                    field_type: "password".to_string(),
                    value: mask_sensitive(get_value(db_config.as_ref().and_then(|c| c.imaginepro_api_key.clone()), "IMAGINEPRO_API_KEY")),
                    placeholder: "Required for Midjourney generation".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "imaginepro_callback_url".to_string(),
                    label: "ImaginePro Callback URL".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.imaginepro_callback_url.clone()), "IMAGINEPRO_CALLBACK_URL"),
                    placeholder: "Optional webhook endpoint".to_string(),
                    required: false,
                },
            ],
        },
        ui_config: UiConfig {
            wallpaper_url: get_value(db_config.as_ref().and_then(|c| c.ui_wallpaper_url.clone()), "UI_WALLPAPER_URL"),
            wallpaper_blur: db_config.as_ref().map(|c| c.ui_wallpaper_blur as u32).unwrap_or_else(|| std::env::var("UI_WALLPAPER_BLUR").unwrap_or_else(|_| "3".to_string()).parse::<u32>().unwrap_or(3)),
            theme: db_config.as_ref().and_then(|c| c.ui_theme.clone()).unwrap_or_else(|| std::env::var("UI_THEME").unwrap_or_else(|_| "dark".to_string())),
            primary_color: db_config.as_ref().and_then(|c| c.ui_primary_color.clone()).unwrap_or_else(|| std::env::var("UI_PRIMARY_COLOR").unwrap_or_else(|_| "#6366f1".to_string())),
            secondary_color: db_config.as_ref().and_then(|c| c.ui_secondary_color.clone()).unwrap_or_else(|| std::env::var("UI_SECONDARY_COLOR").unwrap_or_else(|_| "#8b5cf6".to_string())),
            pet_enabled: db_config.as_ref().map(|c| c.pet_enabled).unwrap_or_else(|| std::env::var("PET_ENABLED").unwrap_or_else(|_| "true".to_string()).parse().unwrap_or(true)),
            pet_image_url: get_value(db_config.as_ref().and_then(|c| c.pet_image_url.clone()), "PET_IMAGE_URL"),
            config_fields: vec![
                ConfigField {
                    key: "wallpaper_url".to_string(),
                    label: "Wallpaper URL".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.ui_wallpaper_url.clone()), "UI_WALLPAPER_URL"),
                    placeholder: "URL to wallpaper image or API endpoint".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "wallpaper_blur".to_string(),
                    label: "Wallpaper Blur (0-10)".to_string(),
                    field_type: "number".to_string(),
                    value: db_config.as_ref().map(|c| c.ui_wallpaper_blur.to_string()).unwrap_or_else(|| std::env::var("UI_WALLPAPER_BLUR").unwrap_or_else(|_| "3".to_string())),
                    placeholder: "3".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "pet_enabled".to_string(),
                    label: "Enable Pet Mascot".to_string(),
                    field_type: "checkbox".to_string(),
                    value: db_config.as_ref().map(|c| c.pet_enabled.to_string()).unwrap_or_else(|| std::env::var("PET_ENABLED").unwrap_or_else(|_| "true".to_string())),
                    placeholder: "true".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "pet_image_url".to_string(),
                    label: "Pet Image URL".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.pet_image_url.clone()), "PET_IMAGE_URL"),
                    placeholder: "URL to pet character image".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "site_title".to_string(),
                    label: "网站标题".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.site_title.clone()), "SITE_TITLE"),
                    placeholder: "Myriad - 数字自我发现".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "site_description".to_string(),
                    label: "网站描述".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.site_description.clone()), "SITE_DESCRIPTION"),
                    placeholder: "一键聚合你的多平台数据，生成AI个人分析报告".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "site_favicon".to_string(),
                    label: "网站图标 URL".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.site_favicon.clone()), "SITE_FAVICON"),
                    placeholder: "/favicon.svg 或 https://example.com/icon.png（支持站外链接）".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "github_client_id".to_string(),
                    label: "GitHub OAuth Client ID".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.github_client_id.clone()), "GITHUB_CLIENT_ID"),
                    placeholder: "GitHub OAuth Application Client ID".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "github_client_secret".to_string(),
                    label: "GitHub OAuth Client Secret".to_string(),
                    field_type: "password".to_string(),
                    value: mask_sensitive(get_value(db_config.as_ref().and_then(|c| c.github_client_secret.clone()), "GITHUB_CLIENT_SECRET")),
                    placeholder: "GitHub OAuth Application Client Secret".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "github_redirect_url".to_string(),
                    label: "GitHub OAuth Redirect URL".to_string(),
                    field_type: "text".to_string(),
                    value: std::env::var("GITHUB_REDIRECT_URL").unwrap_or_else(|_| {
                        "http://localhost:3000/api/auth/github/callback".to_string()
                    }),
                    placeholder: "http://localhost:3000/api/auth/github/callback".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "music_enabled".to_string(),
                    label: "Enable Music Player".to_string(),
                    field_type: "checkbox".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.music_enabled.clone()), "MUSIC_ENABLED"),
                    placeholder: "false".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "music_source".to_string(),
                    label: "Music Source".to_string(),
                    field_type: "select".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.music_source.clone()), "MUSIC_SOURCE"),
                    placeholder: "netease or qq".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "music_playlist_id".to_string(),
                    label: "Playlist ID".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.music_playlist_id.clone()), "MUSIC_PLAYLIST_ID"),
                    placeholder: "Playlist ID from music platform".to_string(),
                    required: false,
                },
            ],
        },
    };

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
    match save_all_configs(&payload).await {
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
    }
}

/// 保存配置到数据库
async fn save_to_database(
    config_service: &crate::services::config_service::ConfigService,
    config: &ConfigResponse,
) -> Result<(), Box<dyn std::error::Error>> {
    use std::collections::HashMap;
    use serde_json::Value as JsonValue;

    let mut updates: HashMap<String, JsonValue> = HashMap::new();

    // 保存平台配置
    for platform in &config.platforms {
        match platform.name.as_str() {
            "GitHub" => {
                for field in &platform.config_fields {
                    let key = match field.key.as_str() {
                        "username" => "github_username",
                        "token" => "github_token",
                        _ => continue,
                    };
                    // 🔒 忽略屏蔽值（前端返回的掩码）
                    if !field.value.is_empty() && !field.value.starts_with("••") {
                        updates.insert(key.to_string(), JsonValue::String(field.value.clone()));
                    }
                }
            }
            "Bilibili" => {
                for field in &platform.config_fields {
                    if field.key == "uid" && !field.value.is_empty() {
                        updates.insert("bilibili_uid".to_string(), JsonValue::String(field.value.clone()));
                    }
                }
            }
            "Steam" => {
                for field in &platform.config_fields {
                    let key = match field.key.as_str() {
                        "api_key" => "steam_api_key",
                        "steam_id" => "steam_id",
                        _ => continue,
                    };
                    // 🔒 忽略屏蔽值（前端返回的掩码）
                    if !field.value.is_empty() && !field.value.starts_with("••") {
                        updates.insert(key.to_string(), JsonValue::String(field.value.clone()));
                    }
                }
            }
            "X" => {
                for field in &platform.config_fields {
                    let key = match field.key.as_str() {
                        "username" => "twitter_username",
                        "bearer_token" => "twitter_bearer_token",
                        _ => continue,
                    };
                    // 🔒 忽略屏蔽值（前端返回的掩码）
                    if !field.value.is_empty() && !field.value.starts_with("••") {
                        updates.insert(key.to_string(), JsonValue::String(field.value.clone()));
                    }
                }
            }
            "Netease Music" => {
                for field in &platform.config_fields {
                    if field.key == "user_id" && !field.value.is_empty() {
                        updates.insert("netease_user_id".to_string(), JsonValue::String(field.value.clone()));
                    }
                }
            }
            _ => {}
        }
    }

    // 保存 AI 配置
    for field in &config.ai_config.config_fields {
        let key = match field.key.as_str() {
            "provider" => "ai_provider",
            "gemini_api_key" => "gemini_api_key",
            "gemini_model" => "gemini_model",
            "openai_api_key" => "openai_api_key",
            "openai_model" => "openai_model",
            "openai_base_url" => "openai_base_url",
            _ => continue,
        };
        // 🔒 忽略屏蔽值（前端返回的掩码）- 保持数据库原值不变
        if !field.value.is_empty() && !field.value.starts_with("••") {
            updates.insert(key.to_string(), JsonValue::String(field.value.clone()));
        }
    }

    // 保存报告配置
    for field in &config.report_config.config_fields {
        if field.key == "topic_style" && !field.value.is_empty() {
            updates.insert("topic_style".to_string(), JsonValue::String(field.value.clone()));
        }
    }

    // 保存虚拟人设配置
    for field in &config.persona_config.config_fields {
        let (key, json_value) = match field.key.as_str() {
            "persona_image_enabled" => {
                let enabled = field.value == "true";
                ("persona_image_enabled", JsonValue::Bool(enabled))
            }
            "persona_image_provider" => ("persona_image_provider", JsonValue::String(field.value.clone())),
            "persona_image_model" => ("persona_image_model", JsonValue::String(field.value.clone())),
            "persona_image_width" => {
                if let Ok(n) = field.value.parse::<i64>() {
                    ("persona_image_width", JsonValue::Number(n.into()))
                } else {
                    continue;
                }
            }
            "persona_image_height" => {
                if let Ok(n) = field.value.parse::<i64>() {
                    ("persona_image_height", JsonValue::Number(n.into()))
                } else {
                    continue;
                }
            }
            "imaginepro_api_key" => ("imaginepro_api_key", JsonValue::String(field.value.clone())),
            "imaginepro_callback_url" => ("imaginepro_callback_url", JsonValue::String(field.value.clone())),
            _ => continue,
        };
        // 🔒 忽略屏蔽值（前端返回的掩码）
        if !field.value.is_empty() && !field.value.starts_with("••") {
            updates.insert(key.to_string(), json_value);
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
            "pet_enabled" => {
                let enabled = field.value == "true";
                ("pet_enabled", JsonValue::Bool(enabled))
            }
            "pet_image_url" => ("pet_image_url", JsonValue::String(field.value.clone())),
            "site_title" => ("site_title", JsonValue::String(field.value.clone())),
            "site_description" => ("site_description", JsonValue::String(field.value.clone())),
            "site_favicon" => ("site_favicon", JsonValue::String(field.value.clone())),
            "github_client_id" => ("github_client_id", JsonValue::String(field.value.clone())),
            "github_client_secret" => ("github_client_secret", JsonValue::String(field.value.clone())),
            "github_redirect_url" => ("github_redirect_url", JsonValue::String(field.value.clone())),
            "music_enabled" => {
                let enabled = field.value == "true";
                ("music_enabled", JsonValue::Bool(enabled))
            }
            "music_source" => ("music_source", JsonValue::String(field.value.clone())),
            "music_playlist_id" => ("music_playlist_id", JsonValue::String(field.value.clone())),
            _ => continue,
        };
        // 🔒 忽略屏蔽值（前端返回的掩码）- github_client_secret 是敏感字段
        if !field.value.is_empty() && !field.value.starts_with("••") {
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
            "X" => {
                for field in &platform.config_fields {
                    let key = match field.key.as_str() {
                        "username" => "TWITTER_USERNAME",
                        "bearer_token" => "TWITTER_BEARER_TOKEN",
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

    // 保存虚拟人设配置
    for field in &config.persona_config.config_fields {
        let key = match field.key.as_str() {
            "persona_image_enabled" => "PERSONA_IMAGE_ENABLED",
            "persona_image_provider" => "PERSONA_IMAGE_PROVIDER",
            "persona_image_model" => "PERSONA_IMAGE_MODEL",
            "persona_image_width" => "PERSONA_IMAGE_WIDTH",
            "persona_image_height" => "PERSONA_IMAGE_HEIGHT",
            "imaginepro_api_key" => "IMAGINEPRO_API_KEY",
            "imaginepro_callback_url" => "IMAGINEPRO_CALLBACK_URL",
            _ => continue,
        };
        env_content = update_env_var(&env_content, key, &field.value);
    }

    // 保存 UI 配置
    for field in &config.ui_config.config_fields {
        let key = match field.key.as_str() {
            "wallpaper_url" => "UI_WALLPAPER_URL",
            "wallpaper_blur" => "UI_WALLPAPER_BLUR",
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
            "github_redirect_url" => "GITHUB_REDIRECT_URL",
            "music_enabled" => "MUSIC_ENABLED",
            "music_source" => "MUSIC_SOURCE",
            "music_playlist_id" => "MUSIC_PLAYLIST_ID",
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
            let fetcher = crate::services::fetcher::PlatformFetcher::new();
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
                    )
                }
            };

            // 实际调用 Bilibili API 验证
            let fetcher = crate::services::fetcher::PlatformFetcher::new();
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
            let fetcher = crate::services::fetcher::PlatformFetcher::new();
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
        "X" => {
            let username = config["username"].as_str().unwrap_or("");
            let bearer_token = config["bearer_token"].as_str().unwrap_or("");
            if username.is_empty() || bearer_token.is_empty() {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(
                        json!({"success": false, "message": "Username and Bearer Token are required"}),
                    ),
                );
            }

            // 调用 X API 验证
            let fetcher = crate::services::fetcher::PlatformFetcher::new();
            match fetcher.fetch_twitter_user(username, bearer_token).await {
                Ok(user_info) => {
                    let name = user_info["data"]["name"].as_str().unwrap_or(username);
                    let followers = user_info["data"]["public_metrics"]["followers_count"]
                        .as_i64()
                        .unwrap_or(0);
                    (
                        StatusCode::OK,
                        Json(json!({
                            "success": true,
                            "message": format!("✓ X user '{}' verified. {} followers", name, followers)
                        })),
                    )
                }
                Err(e) => (
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "success": false,
                        "message": format!("✗ Failed to verify X user: {}", e)
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
                    )
                }
            };

            // 调用网易云音乐 API 验证
            let fetcher = crate::services::fetcher::PlatformFetcher::new();
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
            "Myriad - 数字自我发现"
        ),
        "site_description": get_value(
            db_config.as_ref().and_then(|c| c.site_description.clone()),
            "SITE_DESCRIPTION",
            "一键聚合你的多平台数据，生成AI个人分析报告"
        ),
        "site_favicon": get_value(
            db_config.as_ref().and_then(|c| c.site_favicon.clone()),
            "SITE_FAVICON",
            "/favicon.svg"
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
        db_val.filter(|v| !v.is_empty())
            .unwrap_or_else(|| std::env::var(env_key).unwrap_or_default())
    };
    
    // 只返回公开可见的平台配置字段（不包含 API 密钥等敏感信息）
    let public_platforms = vec![
        PlatformConfig {
            name: "GitHub".to_string(),
            enabled: db_config.as_ref().and_then(|c| c.github_username.as_ref()).is_some() 
                || std::env::var("GITHUB_USERNAME").is_ok(),
            has_token: false, // 不暴露是否有 token
            icon: "".to_string(),
            description: "".to_string(),
            config_fields: vec![
                ConfigField {
                    key: "username".to_string(),
                    label: "".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.github_username.clone()), "GITHUB_USERNAME"),
                    placeholder: "".to_string(),
                    required: false,
                },
            ],
        },
        PlatformConfig {
            name: "Bilibili".to_string(),
            enabled: db_config.as_ref().and_then(|c| c.bilibili_uid.as_ref()).is_some() 
                || std::env::var("BILIBILI_UID").is_ok(),
            has_token: false,
            icon: "".to_string(),
            description: "".to_string(),
            config_fields: vec![ConfigField {
                key: "uid".to_string(),
                label: "".to_string(),
                field_type: "number".to_string(),
                value: get_value(db_config.as_ref().and_then(|c| c.bilibili_uid.clone()), "BILIBILI_UID"),
                placeholder: "".to_string(),
                required: false,
            }],
        },
        PlatformConfig {
            name: "Steam".to_string(),
            enabled: db_config.as_ref().and_then(|c| c.steam_id.as_ref()).is_some() 
                || std::env::var("STEAM_ID").is_ok(),
            has_token: false,
            icon: "".to_string(),
            description: "".to_string(),
            config_fields: vec![
                ConfigField {
                    key: "steam_id".to_string(),
                    label: "".to_string(),
                    field_type: "text".to_string(),
                    value: get_value(db_config.as_ref().and_then(|c| c.steam_id.clone()), "STEAM_ID"),
                    placeholder: "".to_string(),
                    required: false,
                },
            ],
        },
        PlatformConfig {
            name: "Netease Music".to_string(),
            enabled: db_config.as_ref().and_then(|c| c.netease_user_id.as_ref()).is_some() 
                || std::env::var("NETEASE_USER_ID").is_ok(),
            has_token: false,
            icon: "".to_string(),
            description: "".to_string(),
            config_fields: vec![ConfigField {
                key: "user_id".to_string(),
                label: "".to_string(),
                field_type: "number".to_string(),
                value: get_value(db_config.as_ref().and_then(|c| c.netease_user_id.clone()), "NETEASE_USER_ID"),
                placeholder: "".to_string(),
                required: false,
            }],
        },
        // Pixiv 暂不支持（DynamicConfig 中没有对应字段）
    ];
    
    let response = json!({
        "platforms": public_platforms
    });

    (StatusCode::OK, Json(response))
}

/// 获取公开的 UI 配置（萌宠、虚拟人设等）
/// 🔓 公开端点 - 不需要认证
pub async fn get_public_ui_config(State(db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    // 优先从数据库读取配置
    let config_service = crate::services::config_service::ConfigService::new(db.clone());
    let db_config = config_service.load_config().await.ok();
    
    let get_value = |db_val: Option<String>, env_key: &str| -> String {
        db_val.filter(|v| !v.is_empty())
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
        "persona_image_enabled": db_config.as_ref().map(|c| c.persona_image_enabled).unwrap_or_else(|| 
            std::env::var("PERSONA_IMAGE_ENABLED").unwrap_or_else(|_| "true".to_string()).parse().unwrap_or(true)
        ),
        "wallpaper_url": get_value(
            db_config.as_ref().and_then(|c| c.ui_wallpaper_url.clone()),
            "UI_WALLPAPER_URL"
        ),
        "wallpaper_blur": db_config.as_ref().map(|c| c.ui_wallpaper_blur as u32).unwrap_or_else(|| 
            std::env::var("UI_WALLPAPER_BLUR").unwrap_or_else(|_| "3".to_string()).parse::<u32>().unwrap_or(3)
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
    });

    (StatusCode::OK, Json(ui_config))
}
