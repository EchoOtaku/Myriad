use serde::{Deserialize, Serialize};
use std::env;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub database_url: String,
    pub server_host: String,
    pub server_port: u16,
    pub frontend_dist_path: String,
    pub openai_api_key: String,
    pub openai_model: String,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://myriad:password@localhost:5432/myriad".to_string()),
            server_host: env::var("SERVER_HOST")
                .unwrap_or_else(|_| "127.0.0.1".to_string()),
            server_port: env::var("SERVER_PORT")
                .unwrap_or_else(|_| "3000".to_string())
                .parse()?,
            frontend_dist_path: env::var("FRONTEND_DIST_PATH")
                .unwrap_or_else(|_| "../frontend/dist".to_string()),
            openai_api_key: env::var("OPENAI_API_KEY")
                .unwrap_or_else(|_| String::new()),
            openai_model: env::var("OPENAI_MODEL")
                .unwrap_or_else(|_| "gpt-4".to_string()),
        })
    }
}
