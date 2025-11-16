use crate::config::DynamicConfig;
use anyhow::{Context, Result};
use sea_orm::{ConnectionTrait, DatabaseConnection, Statement};
use serde_json::Value as JsonValue;
use std::collections::HashMap;

/// 配置服务 - 用于从数据库读写动态配置
pub struct ConfigService {
    db: DatabaseConnection,
}

impl ConfigService {
    pub fn new(db: DatabaseConnection) -> Self {
        Self { db }
    }

    /// 从数据库加载所有配置
    pub async fn load_config(&self) -> Result<DynamicConfig> {
        // 使用 ConnectionTrait 的方法进行查询
        let sql = "SELECT key, value FROM configurations";
        let rows = self
            .db
            .query_all(Statement::from_string(
                sea_orm::DatabaseBackend::Postgres,
                sql.to_string(),
            ))
            .await
            .context("Failed to load configurations from database")?;

        let mut config_map: HashMap<String, JsonValue> = HashMap::new();
        for row in rows {
            if let (Ok(key), Ok(value)) = (
                row.try_get::<String>("", "key"),
                row.try_get::<JsonValue>("", "value"),
            ) {
                config_map.insert(key, value);
            }
        }

        Ok(Self::parse_config(config_map))
    }

    /// 从配置映射解析为 DynamicConfig
    fn parse_config(map: HashMap<String, JsonValue>) -> DynamicConfig {
        let mut config = DynamicConfig::default();

        // AI 配置
        if let Some(v) = map.get("ai_provider") {
            if let Some(s) = v.as_str() {
                config.ai_provider = s.to_string();
            }
        }
        if let Some(v) = map.get("gemini_api_key") {
            config.gemini_api_key = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("gemini_model") {
            if let Some(s) = v.as_str() {
                config.gemini_model = s.to_string();
            }
        }
        if let Some(v) = map.get("openai_api_key") {
            config.openai_api_key = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("openai_model") {
            if let Some(s) = v.as_str() {
                config.openai_model = s.to_string();
            }
        }
        if let Some(v) = map.get("openai_base_url") {
            if let Some(s) = v.as_str() {
                config.openai_base_url = s.to_string();
            }
        }
        if let Some(v) = map.get("deepseek_api_key") {
            config.deepseek_api_key = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("deepseek_model") {
            if let Some(s) = v.as_str() {
                config.deepseek_model = s.to_string();
            }
        }
        if let Some(v) = map.get("openai_max_tokens") {
            if let Some(n) = v.as_i64() {
                config.openai_max_tokens = n as i32;
            }
        }
        if let Some(v) = map.get("topic_style") {
            if let Some(s) = v.as_str() {
                config.topic_style = s.to_string();
            }
        }

        // 平台配置
        if let Some(v) = map.get("github_token") {
            config.github_token = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("github_username") {
            config.github_username = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("bilibili_uid") {
            config.bilibili_uid = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("steam_api_key") {
            config.steam_api_key = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("steam_id") {
            config.steam_id = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("netease_user_id") {
            config.netease_user_id = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("twitter_bearer_token") {
            config.twitter_bearer_token = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("linkedin_access_token") {
            config.linkedin_access_token = v.as_str().map(|s| s.to_string());
        }

        // UI 配置
        if let Some(v) = map.get("ui_wallpaper_url") {
            config.ui_wallpaper_url = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("ui_wallpaper_blur") {
            if let Some(n) = v.as_i64() {
                config.ui_wallpaper_blur = n as i32;
            }
        }
        if let Some(v) = map.get("pet_enabled") {
            if let Some(b) = v.as_bool() {
                config.pet_enabled = b;
            }
        }
        if let Some(v) = map.get("pet_image_url") {
            config.pet_image_url = v.as_str().map(|s| s.to_string());
        }

        // 功能配置
        if let Some(v) = map.get("persona_image_enabled") {
            if let Some(b) = v.as_bool() {
                config.persona_image_enabled = b;
            }
        }
        if let Some(v) = map.get("persona_image_provider") {
            if let Some(s) = v.as_str() {
                config.persona_image_provider = s.to_string();
            }
        }
        if let Some(v) = map.get("persona_image_model") {
            if let Some(s) = v.as_str() {
                config.persona_image_model = s.to_string();
            }
        }
        if let Some(v) = map.get("persona_image_width") {
            if let Some(n) = v.as_i64() {
                config.persona_image_width = n as i32;
            }
        }
        if let Some(v) = map.get("persona_image_height") {
            if let Some(n) = v.as_i64() {
                config.persona_image_height = n as i32;
            }
        }
        if let Some(v) = map.get("imaginepro_api_key") {
            config.imaginepro_api_key = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("imaginepro_callback_url") {
            config.imaginepro_callback_url = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("enable_auto_fetch") {
            if let Some(b) = v.as_bool() {
                config.enable_auto_fetch = b;
            }
        }
        if let Some(v) = map.get("fetch_interval_hours") {
            if let Some(n) = v.as_i64() {
                config.fetch_interval_hours = n as i32;
            }
        }

        // OAuth 配置
        if let Some(v) = map.get("github_client_id") {
            config.github_client_id = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("github_client_secret") {
            config.github_client_secret = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("github_redirect_url") {
            if let Some(s) = v.as_str() {
                config.github_redirect_url = s.to_string();
            }
        }

        // 网站元数据配置
        if let Some(v) = map.get("site_title") {
            config.site_title = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("site_description") {
            config.site_description = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("site_favicon") {
            config.site_favicon = v.as_str().map(|s| s.to_string());
        }

        // 音乐配置
        if let Some(v) = map.get("music_enabled") {
            // music_enabled 在数据库中是布尔值，需要转换为字符串
            config.music_enabled = if let Some(b) = v.as_bool() {
                Some(b.to_string())
            } else {
                v.as_str().map(|s| s.to_string())
            };
        }
        if let Some(v) = map.get("music_source") {
            config.music_source = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("music_playlist_id") {
            config.music_playlist_id = v.as_str().map(|s| s.to_string());
        }

        config
    }

    /// 更新单个配置项
    pub async fn update_config(&self, key: &str, value: JsonValue) -> Result<()> {
        let sql = r#"
            INSERT INTO configurations (key, value, updated_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            ON CONFLICT (key) DO UPDATE
            SET value = $2, updated_at = CURRENT_TIMESTAMP
        "#;

        self.db
            .execute(Statement::from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                sql,
                vec![key.into(), value.into()],
            ))
            .await
            .context("Failed to update configuration")?;

        Ok(())
    }

    /// 批量更新配置
    pub async fn update_configs(&self, updates: HashMap<String, JsonValue>) -> Result<()> {
        let count = updates.len();
        for (key, value) in updates {
            self.update_config(&key, value).await?;
        }
        tracing::info!("✅ Updated {} configurations", count);
        Ok(())
    }

    /// 获取单个配置项
    #[allow(dead_code)]
    pub async fn get_config(&self, key: &str) -> Result<Option<JsonValue>> {
        let sql = "SELECT value FROM configurations WHERE key = $1";
        let result = self
            .db
            .query_one(Statement::from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                sql,
                vec![key.into()],
            ))
            .await?;

        if let Some(row) = result {
            if let Ok(value) = row.try_get::<JsonValue>("", "value") {
                return Ok(Some(value));
            }
        }

        Ok(None)
    }

    /// 获取某个类别的所有配置
    #[allow(dead_code)]
    pub async fn get_configs_by_category(
        &self,
        category: &str,
    ) -> Result<HashMap<String, JsonValue>> {
        let sql = "SELECT key, value FROM configurations WHERE category = $1";
        let rows = self
            .db
            .query_all(Statement::from_sql_and_values(
                sea_orm::DatabaseBackend::Postgres,
                sql,
                vec![category.into()],
            ))
            .await?;

        let mut config_map = HashMap::new();
        for row in rows {
            if let (Ok(key), Ok(value)) = (
                row.try_get::<String>("", "key"),
                row.try_get::<JsonValue>("", "value"),
            ) {
                config_map.insert(key, value);
            }
        }

        Ok(config_map)
    }

    /// 获取所有公开配置（用于前端）
    #[allow(dead_code)]
    pub async fn get_public_configs(&self) -> Result<HashMap<String, JsonValue>> {
        let sql = "SELECT key, value FROM configurations WHERE is_public = true";
        let rows = self
            .db
            .query_all(Statement::from_string(
                sea_orm::DatabaseBackend::Postgres,
                sql.to_string(),
            ))
            .await?;

        let mut config_map = HashMap::new();
        for row in rows {
            if let (Ok(key), Ok(value)) = (
                row.try_get::<String>("", "key"),
                row.try_get::<JsonValue>("", "value"),
            ) {
                config_map.insert(key, value);
            }
        }

        Ok(config_map)
    }

    /// 从环境变量迁移到数据库（仅在初次设置时使用）
    #[allow(dead_code)]
    pub async fn migrate_from_env(&self) -> Result<()> {
        let env_mappings = vec![
            ("AI_PROVIDER", "ai_provider"),
            ("GEMINI_API_KEY", "gemini_api_key"),
            ("GEMINI_MODEL", "gemini_model"),
            ("OPENAI_API_KEY", "openai_api_key"),
            ("OPENAI_MODEL", "openai_model"),
            ("OPENAI_BASE_URL", "openai_base_url"),
            ("DEEPSEEK_API_KEY", "deepseek_api_key"),
            ("DEEPSEEK_MODEL", "deepseek_model"),
            ("OPENAI_MAX_TOKENS", "openai_max_tokens"),
            ("TOPIC_STYLE", "topic_style"),
            ("GITHUB_TOKEN", "github_token"),
            ("GITHUB_USERNAME", "github_username"),
            ("BILIBILI_UID", "bilibili_uid"),
            ("STEAM_API_KEY", "steam_api_key"),
            ("STEAM_ID", "steam_id"),
            ("NETEASE_USER_ID", "netease_user_id"),
            ("TWITTER_BEARER_TOKEN", "twitter_bearer_token"),
            ("LINKEDIN_ACCESS_TOKEN", "linkedin_access_token"),
            ("UI_WALLPAPER_URL", "ui_wallpaper_url"),
            ("UI_WALLPAPER_BLUR", "ui_wallpaper_blur"),
            ("PET_ENABLED", "pet_enabled"),
            ("PET_IMAGE_URL", "pet_image_url"),
            ("PERSONA_IMAGE_ENABLED", "persona_image_enabled"),
            ("PERSONA_IMAGE_PROVIDER", "persona_image_provider"),
            ("PERSONA_IMAGE_MODEL", "persona_image_model"),
            ("PERSONA_IMAGE_WIDTH", "persona_image_width"),
            ("PERSONA_IMAGE_HEIGHT", "persona_image_height"),
            ("IMAGINEPRO_API_KEY", "imaginepro_api_key"),
            ("IMAGINEPRO_CALLBACK_URL", "imaginepro_callback_url"),
            ("ENABLE_AUTO_FETCH", "enable_auto_fetch"),
            ("FETCH_INTERVAL_HOURS", "fetch_interval_hours"),
            ("GITHUB_CLIENT_ID", "github_client_id"),
            ("GITHUB_CLIENT_SECRET", "github_client_secret"),
            ("GITHUB_REDIRECT_URL", "github_redirect_url"),
        ];

        let mut updates = HashMap::new();
        for (env_key, db_key) in env_mappings {
            if let Ok(value) = std::env::var(env_key) {
                if !value.is_empty() {
                    // 尝试解析为数字或布尔值
                    let json_value = if let Ok(n) = value.parse::<i64>() {
                        JsonValue::Number(n.into())
                    } else if let Ok(b) = value.parse::<bool>() {
                        JsonValue::Bool(b)
                    } else {
                        JsonValue::String(value)
                    };
                    updates.insert(db_key.to_string(), json_value);
                }
            }
        }

        if !updates.is_empty() {
            let count = updates.len();
            self.update_configs(updates).await?;
            tracing::info!("✅ Migrated {} configurations from .env to database", count);
        }

        Ok(())
    }
}
