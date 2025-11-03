use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub database_url: String,
    pub server_host: String,
    pub server_port: u16,
    pub frontend_dist_path: String,
    pub gemini_api_key: String,
    pub gemini_model: String,
    pub image_gen_enabled: bool,
    pub image_gen_model: String,
    pub topic_style: String,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://myriad:password@localhost:5432/myriad".to_string()),
            server_host: env::var("SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            server_port: env::var("SERVER_PORT")
                .unwrap_or_else(|_| "3000".to_string())
                .parse()?,
            frontend_dist_path: env::var("FRONTEND_DIST_PATH")
                .unwrap_or_else(|_| "../frontend/dist".to_string()),
            gemini_api_key: env::var("GEMINI_API_KEY").unwrap_or_else(|_| String::new()),
            gemini_model: env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-pro".to_string()),
            image_gen_enabled: env::var("IMAGE_GEN_ENABLED")
                .unwrap_or_else(|_| "true".to_string())
                .parse()
                .unwrap_or(true),
            image_gen_model: env::var("IMAGE_GEN_MODEL").unwrap_or_else(|_| "flux".to_string()),
            topic_style: env::var("TOPIC_STYLE").unwrap_or_else(|_| "balanced".to_string()),
        })
    }
}
