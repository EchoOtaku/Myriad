use axum::{extract::State, http::StatusCode, Json};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigResponse {
    pub platforms: Vec<PlatformConfig>,
    pub ai_config: AiConfig,
    pub fetch_config: FetchConfig,
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
pub struct FetchConfig {
    pub auto_fetch: bool,
    pub interval_hours: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UiConfig {
    pub wallpaper_url: String,
    pub wallpaper_blur: u32,
    pub theme: String,
    pub primary_color: String,
    pub secondary_color: String,
    pub config_fields: Vec<ConfigField>,
}

pub async fn get_config(
    State(_db): State<DatabaseConnection>,
) -> (StatusCode, Json<Value>) {
    let config = ConfigResponse {
        platforms: vec![
            PlatformConfig {
                name: "GitHub".to_string(),
                enabled: std::env::var("GITHUB_USERNAME").is_ok(),
                has_token: std::env::var("GITHUB_TOKEN").is_ok(),
                icon: "".to_string(),
                description: "Track repositories, stars, and contributions".to_string(),
                config_fields: vec![
                    ConfigField {
                        key: "username".to_string(),
                        label: "GitHub Username".to_string(),
                        field_type: "text".to_string(),
                        value: std::env::var("GITHUB_USERNAME").unwrap_or_default(),
                        placeholder: "octocat".to_string(),
                        required: true,
                    },
                    ConfigField {
                        key: "token".to_string(),
                        label: "Personal Access Token (Optional)".to_string(),
                        field_type: "password".to_string(),
                        value: std::env::var("GITHUB_TOKEN").unwrap_or_default(),
                        placeholder: "ghp_xxxxxxxxxxxx (Increases API rate limit)".to_string(),
                        required: false,
                    },
                ],
            },
            PlatformConfig {
                name: "Bilibili".to_string(),
                enabled: std::env::var("BILIBILI_UID").is_ok(),
                has_token: std::env::var("BILIBILI_UID").is_ok(),
                icon: "".to_string(),
                description: "Track your Bilibili favorites, anime, and viewing history".to_string(),
                config_fields: vec![
                    ConfigField {
                        key: "uid".to_string(),
                        label: "User ID (UID)".to_string(),
                        field_type: "number".to_string(),
                        value: std::env::var("BILIBILI_UID").unwrap_or_default(),
                        placeholder: "123456789".to_string(),
                        required: true,
                    },
                ],
            },
            PlatformConfig {
                name: "Steam".to_string(),
                enabled: std::env::var("STEAM_API_KEY").is_ok(),
                has_token: std::env::var("STEAM_API_KEY").is_ok(),
                icon: "".to_string(),
                description: "Sync your Steam library, wishlist, and gaming stats".to_string(),
                config_fields: vec![
                    ConfigField {
                        key: "api_key".to_string(),
                        label: "Steam API Key".to_string(),
                        field_type: "password".to_string(),
                        value: std::env::var("STEAM_API_KEY").unwrap_or_default(),
                        placeholder: "Get from steamcommunity.com/dev/apikey".to_string(),
                        required: true,
                    },
                    ConfigField {
                        key: "steam_id".to_string(),
                        label: "Steam ID".to_string(),
                        field_type: "text".to_string(),
                        value: std::env::var("STEAM_ID").unwrap_or_default(),
                        placeholder: "76561198XXXXXXXXX".to_string(),
                        required: true,
                    },
                ],
            },
            PlatformConfig {
                name: "X".to_string(),
                enabled: std::env::var("TWITTER_USERNAME").is_ok(),
                has_token: std::env::var("TWITTER_BEARER_TOKEN").is_ok(),
                icon: "".to_string(),
                description: "Analyze tweets and engagement from the past year".to_string(),
                config_fields: vec![
                    ConfigField {
                        key: "username".to_string(),
                        label: "X Username".to_string(),
                        field_type: "text".to_string(),
                        value: std::env::var("TWITTER_USERNAME").unwrap_or_default(),
                        placeholder: "elonmusk".to_string(),
                        required: true,
                    },
                    ConfigField {
                        key: "bearer_token".to_string(),
                        label: "Bearer Token".to_string(),
                        field_type: "password".to_string(),
                        value: std::env::var("TWITTER_BEARER_TOKEN").unwrap_or_default(),
                        placeholder: "Get from developer.twitter.com".to_string(),
                        required: true,
                    },
                ],
            },
        ],
        ai_config: AiConfig {
            provider: "Gemini".to_string(),
            model: std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-pro".to_string()),
            api_key: std::env::var("GEMINI_API_KEY").unwrap_or_default(),
            enabled: std::env::var("GEMINI_API_KEY").is_ok(),
            config_fields: vec![
                ConfigField {
                    key: "api_key".to_string(),
                    label: "Gemini API Key".to_string(),
                    field_type: "password".to_string(),
                    value: std::env::var("GEMINI_API_KEY").unwrap_or_default(),
                    placeholder: "Get from https://makersuite.google.com/app/apikey".to_string(),
                    required: true,
                },
                ConfigField {
                    key: "model".to_string(),
                    label: "Model Name".to_string(),
                    field_type: "text".to_string(),
                    value: std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-pro".to_string()),
                    placeholder: "gemini-pro, gemini-pro-vision, gemini-1.5-flash, etc.".to_string(),
                    required: true,
                },
            ],
        },
        fetch_config: FetchConfig {
            auto_fetch: std::env::var("ENABLE_AUTO_FETCH")
                .unwrap_or_else(|_| "false".to_string())
                .parse()
                .unwrap_or(false),
            interval_hours: std::env::var("FETCH_INTERVAL_HOURS")
                .unwrap_or_else(|_| "24".to_string())
                .parse()
                .unwrap_or(24),
        },
        ui_config: UiConfig {
            wallpaper_url: std::env::var("UI_WALLPAPER_URL")
                .unwrap_or_else(|_| "https://images.unsplash.com/photo-1579546929518-9e396f3cc809".to_string()),
            wallpaper_blur: std::env::var("UI_WALLPAPER_BLUR")
                .unwrap_or_else(|_| "3".to_string())
                .parse()
                .unwrap_or(3),
            theme: std::env::var("UI_THEME").unwrap_or_else(|_| "dark".to_string()),
            primary_color: std::env::var("UI_PRIMARY_COLOR").unwrap_or_else(|_| "#6366f1".to_string()),
            secondary_color: std::env::var("UI_SECONDARY_COLOR").unwrap_or_else(|_| "#8b5cf6".to_string()),
            config_fields: vec![
                ConfigField {
                    key: "wallpaper_url".to_string(),
                    label: "Wallpaper URL".to_string(),
                    field_type: "text".to_string(),
                    value: std::env::var("UI_WALLPAPER_URL")
                        .unwrap_or_else(|_| "https://images.unsplash.com/photo-1579546929518-9e396f3cc809".to_string()),
                    placeholder: "URL to wallpaper image or API endpoint".to_string(),
                    required: false,
                },
                ConfigField {
                    key: "wallpaper_blur".to_string(),
                    label: "Wallpaper Blur (0-10)".to_string(),
                    field_type: "number".to_string(),
                    value: std::env::var("UI_WALLPAPER_BLUR").unwrap_or_else(|_| "3".to_string()),
                    placeholder: "3".to_string(),
                    required: false,
                },
            ],
        },
    };

    (StatusCode::OK, Json(json!(config)))
}

pub async fn update_config(
    State(_db): State<DatabaseConnection>,
    Json(payload): Json<ConfigResponse>,
) -> (StatusCode, Json<Value>) {
    tracing::info!("Updating configuration");
    
    // 保存所有配置到环境变量文件
    match save_all_configs(&payload).await {
        Ok(_) => {
            tracing::info!("Configuration saved successfully");
            (StatusCode::OK, Json(json!({
                "success": true, 
                "message": "Configuration saved successfully! Please restart backend to apply changes."
            })))
        }
        Err(e) => {
            tracing::error!("Failed to save configuration: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({
                "success": false, 
                "message": format!("Failed to save configuration: {}", e)
            })))
        }
    }
}

/// 保存所有配置到 .env 文件
async fn save_all_configs(config: &ConfigResponse) -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;
    use std::path::Path;
    
    // 读取现有的 .env 文件（如果存在）
    let env_path = Path::new(".env");
    let mut env_content = if env_path.exists() {
        fs::read_to_string(env_path)?
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
            _ => {}
        }
    }
    
    // 保存 AI 配置
    for field in &config.ai_config.config_fields {
        let key = match field.key.as_str() {
            "api_key" => "GEMINI_API_KEY",
            "model" => "GEMINI_MODEL",
            _ => continue,
        };
        env_content = update_env_var(&env_content, key, &field.value);
    }
    
    // 保存 UI 配置
    for field in &config.ui_config.config_fields {
        let key = match field.key.as_str() {
            "wallpaper_url" => "UI_WALLPAPER_URL",
            "wallpaper_blur" => "UI_WALLPAPER_BLUR",
            _ => continue,
        };
        env_content = update_env_var(&env_content, key, &field.value);
    }
    
    // 写回 .env 文件
    fs::write(env_path, env_content)?;
    
    Ok(())
}

/// 更新或添加环境变量
fn update_env_var(content: &str, key: &str, value: &str) -> String {
    let mut lines: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let key_prefix = format!("{}=", key);
    let new_line = if value.is_empty() {
        format!("# {}=", key)  // 空值时注释掉
    } else {
        format!("{}={}", key, value)
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
                return (StatusCode::BAD_REQUEST, Json(json!({"success": false, "message": "Username is required"})));
            }
            
            let token = config["token"].as_str().filter(|s| !s.is_empty());
            
            // 调用 GitHub API 验证
            let fetcher = crate::services::fetcher::PlatformFetcher::new();
            match fetcher.fetch_github_user(username, token).await {
                Ok(user_info) => {
                    let name = user_info["name"].as_str().unwrap_or(username);
                    let followers = user_info["followers"].as_i64().unwrap_or(0);
                    let repos = user_info["public_repos"].as_i64().unwrap_or(0);
                    (StatusCode::OK, Json(json!({
                        "success": true, 
                        "message": format!("✓ GitHub user '{}' verified. {} followers, {} repos", name, followers, repos)
                    })))
                }
                Err(e) => {
                    (StatusCode::BAD_REQUEST, Json(json!({
                        "success": false, 
                        "message": format!("✗ Failed to verify GitHub user: {}", e)
                    })))
                }
            }
        }
        "Bilibili" => {
            let uid = config["uid"].as_str().unwrap_or("");
            if uid.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({"success": false, "message": "UID is required"})));
            }
            
            // 尝试解析 UID 为数字
            let uid_i64 = match uid.parse::<i64>() {
                Ok(n) => n,
                Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({"success": false, "message": "Invalid UID format"}))),
            };
            
            // 实际调用 Bilibili API 验证
            let fetcher = crate::services::fetcher::PlatformFetcher::new();
            match fetcher.fetch_bilibili_user(uid_i64).await {
                Ok(user_info) => {
                    (StatusCode::OK, Json(json!({
                        "success": true, 
                        "message": format!("✓ Bilibili UID {} is valid. User: {}", uid, user_info.name)
                    })))
                }
                Err(e) => {
                    (StatusCode::BAD_REQUEST, Json(json!({
                        "success": false, 
                        "message": format!("✗ Failed to verify Bilibili UID: {}", e)
                    })))
                }
            }
        }
        "Steam" => {
            let api_key = config["api_key"].as_str().unwrap_or("");
            let steam_id = config["steam_id"].as_str().unwrap_or("");
            if api_key.is_empty() || steam_id.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({"success": false, "message": "API Key and Steam ID are required"})));
            }
            
            // 调用 Steam API 验证
            let fetcher = crate::services::fetcher::PlatformFetcher::new();
            match fetcher.fetch_steam_user(api_key, steam_id).await {
                Ok(user_info) => {
                    (StatusCode::OK, Json(json!({
                        "success": true, 
                        "message": format!("✓ Steam user '{}' verified", user_info.personaname)
                    })))
                }
                Err(e) => {
                    (StatusCode::BAD_REQUEST, Json(json!({
                        "success": false, 
                        "message": format!("✗ Failed to verify Steam: {}", e)
                    })))
                }
            }
        }
        "X" => {
            let username = config["username"].as_str().unwrap_or("");
            let bearer_token = config["bearer_token"].as_str().unwrap_or("");
            if username.is_empty() || bearer_token.is_empty() {
                return (StatusCode::BAD_REQUEST, Json(json!({"success": false, "message": "Username and Bearer Token are required"})));
            }
            
            // 调用 X API 验证
            let fetcher = crate::services::fetcher::PlatformFetcher::new();
            match fetcher.fetch_twitter_user(username, bearer_token).await {
                Ok(user_info) => {
                    let name = user_info["data"]["name"].as_str().unwrap_or(username);
                    let followers = user_info["data"]["public_metrics"]["followers_count"].as_i64().unwrap_or(0);
                    (StatusCode::OK, Json(json!({
                        "success": true, 
                        "message": format!("✓ X user '{}' verified. {} followers", name, followers)
                    })))
                }
                Err(e) => {
                    (StatusCode::BAD_REQUEST, Json(json!({
                        "success": false, 
                        "message": format!("✗ Failed to verify X user: {}", e)
                    })))
                }
            }
        }
        _ => (StatusCode::OK, Json(json!({"success": false, "message": "Platform test not implemented yet"}))),
    }
}
