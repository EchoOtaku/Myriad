use axum::{extract::State, http::StatusCode, Json};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize, Deserialize)]
pub struct ConfigResponse {
    pub platforms: Vec<PlatformConfig>,
    pub ai_config: AiConfig,
    pub fetch_config: FetchConfig,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PlatformConfig {
    pub name: String,
    pub enabled: bool,
    pub has_token: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiConfig {
    pub provider: String,
    pub model: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FetchConfig {
    pub auto_fetch: bool,
    pub interval_hours: u32,
}

pub async fn get_config(
    State(_db): State<DatabaseConnection>,
) -> (StatusCode, Json<Value>) {
    // TODO: Fetch from database
    let config = ConfigResponse {
        platforms: vec![
            PlatformConfig {
                name: "GitHub".to_string(),
                enabled: true,
                has_token: std::env::var("GITHUB_TOKEN").is_ok(),
            },
            PlatformConfig {
                name: "Twitter".to_string(),
                enabled: false,
                has_token: std::env::var("TWITTER_BEARER_TOKEN").is_ok(),
            },
            PlatformConfig {
                name: "LinkedIn".to_string(),
                enabled: false,
                has_token: std::env::var("LINKEDIN_ACCESS_TOKEN").is_ok(),
            },
        ],
        ai_config: AiConfig {
            provider: "OpenAI".to_string(),
            model: std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4".to_string()),
            enabled: std::env::var("OPENAI_API_KEY").is_ok(),
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
    };

    (StatusCode::OK, Json(json!(config)))
}

pub async fn update_config(
    State(_db): State<DatabaseConnection>,
    Json(_payload): Json<Value>,
) -> (StatusCode, Json<Value>) {
    // TODO: Update database
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "Configuration updated successfully"
        })),
    )
}
