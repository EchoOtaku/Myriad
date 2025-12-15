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

        // UI 配置
        if let Some(v) = map.get("ui_wallpaper_url") {
            config.ui_wallpaper_url = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("ui_wallpaper_blur") {
            if let Some(n) = v.as_i64() {
                config.ui_wallpaper_blur = n as i32;
            }
        }
        if let Some(v) = map.get("ui_wallpaper_parallax") {
            if let Some(b) = v.as_bool() {
                config.ui_wallpaper_parallax = b;
            }
        }
        // Evocative 壁纸动效
        if let Some(v) = map.get("ui_evocative_parallax") {
            if let Some(b) = v.as_bool() {
                config.ui_evocative_parallax = b;
            }
        }
        if let Some(v) = map.get("ui_evocative_dynamic_blur") {
            if let Some(b) = v.as_bool() {
                config.ui_evocative_dynamic_blur = b;
            }
        }
        if let Some(v) = map.get("ui_evocative_ripple") {
            if let Some(b) = v.as_bool() {
                config.ui_evocative_ripple = b;
            }
        }
        if let Some(v) = map.get("ui_evocative_fps") {
            if let Some(n) = v.as_i64() {
                config.ui_evocative_fps = n as i32;
            }
        }
        if let Some(v) = map.get("ui_evocative_ripple_quality") {
            if let Some(n) = v.as_f64() {
                config.ui_evocative_ripple_quality = n;
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

        // AI 图片生成配置
        if let Some(v) = map.get("ai_image_provider") {
            if let Some(s) = v.as_str() {
                config.ai_image_provider = s.to_string();
            }
        }
        if let Some(v) = map.get("ai_image_model") {
            if let Some(s) = v.as_str() {
                config.ai_image_model = s.to_string();
            }
        }
        if let Some(v) = map.get("ai_image_width") {
            if let Some(n) = v.as_i64() {
                config.ai_image_width = n as i32;
            }
        }
        if let Some(v) = map.get("ai_image_height") {
            if let Some(n) = v.as_i64() {
                config.ai_image_height = n as i32;
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

        // 站点 URL 配置
        if let Some(v) = map.get("base_url") {
            config.base_url = v.as_str().map(|s| s.to_string());
        }

        // 仪表盘配置
        if let Some(v) = map.get("dashboard_layout") {
            // 如果是字符串直接使用，如果是对象/数组则转为字符串
            if let Some(s) = v.as_str() {
                config.dashboard_layout = Some(s.to_string());
            } else {
                config.dashboard_layout = Some(v.to_string());
            }
        }
        if let Some(v) = map.get("dashboard_title") {
            if let Some(s) = v.as_str() {
                config.dashboard_title = Some(s.to_string());
            }
        }
        if let Some(v) = map.get("custom_platforms") {
            if let Some(s) = v.as_str() {
                config.custom_platforms = Some(s.to_string());
            } else {
                config.custom_platforms = Some(v.to_string());
            }
        }

        // 控制面板小组件配置
        if let Some(v) = map.get("control_panel_layout") {
            if let Some(s) = v.as_str() {
                config.control_panel_layout = Some(s.to_string());
            } else {
                config.control_panel_layout = Some(v.to_string());
            }
        }
        if let Some(v) = map.get("control_panel_rows") {
            if let Some(n) = v.as_i64() {
                config.control_panel_rows = n as i32;
            }
        }

        // Tapp 多窗口方案配置
        if let Some(v) = map.get("tapp_window_schemes") {
            if let Some(s) = v.as_str() {
                config.tapp_window_schemes = Some(s.to_string());
            } else {
                config.tapp_window_schemes = Some(v.to_string());
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

        // ========== Tapp 权限下放配置 ==========
        // 普通用户 elevated 权限 (10个, platform:write 和 platform:register 已升为 privileged)
        if let Some(v) = map.get("user_perm_ai_generate") {
            if let Some(b) = v.as_bool() {
                config.user_perm_ai_generate = b;
            }
        }
        if let Some(v) = map.get("user_perm_ai_analyze") {
            if let Some(b) = v.as_bool() {
                config.user_perm_ai_analyze = b;
            }
        }
        if let Some(v) = map.get("user_perm_ai_chat") {
            if let Some(b) = v.as_bool() {
                config.user_perm_ai_chat = b;
            }
        }
        if let Some(v) = map.get("user_perm_ai_image") {
            if let Some(b) = v.as_bool() {
                config.user_perm_ai_image = b;
            }
        }
        if let Some(v) = map.get("user_perm_report_write") {
            if let Some(b) = v.as_bool() {
                config.user_perm_report_write = b;
            }
        }
        if let Some(v) = map.get("user_perm_network_fetch") {
            if let Some(b) = v.as_bool() {
                config.user_perm_network_fetch = b;
            }
        }
        if let Some(v) = map.get("user_perm_media_control") {
            if let Some(b) = v.as_bool() {
                config.user_perm_media_control = b;
            }
        }
        if let Some(v) = map.get("user_perm_component_theme") {
            if let Some(b) = v.as_bool() {
                config.user_perm_component_theme = b;
            }
        }
        if let Some(v) = map.get("user_perm_shortcut_register") {
            if let Some(b) = v.as_bool() {
                config.user_perm_shortcut_register = b;
            }
        }
        if let Some(v) = map.get("user_perm_event_publish") {
            if let Some(b) = v.as_bool() {
                config.user_perm_event_publish = b;
            }
        }

        // 游客 elevated 权限 (10个, platform:write 和 platform:register 已升为 privileged)
        if let Some(v) = map.get("guest_perm_ai_generate") {
            if let Some(b) = v.as_bool() {
                config.guest_perm_ai_generate = b;
            }
        }
        if let Some(v) = map.get("guest_perm_ai_analyze") {
            if let Some(b) = v.as_bool() {
                config.guest_perm_ai_analyze = b;
            }
        }
        if let Some(v) = map.get("guest_perm_ai_chat") {
            if let Some(b) = v.as_bool() {
                config.guest_perm_ai_chat = b;
            }
        }
        if let Some(v) = map.get("guest_perm_ai_image") {
            if let Some(b) = v.as_bool() {
                config.guest_perm_ai_image = b;
            }
        }
        if let Some(v) = map.get("guest_perm_report_write") {
            if let Some(b) = v.as_bool() {
                config.guest_perm_report_write = b;
            }
        }
        if let Some(v) = map.get("guest_perm_network_fetch") {
            if let Some(b) = v.as_bool() {
                config.guest_perm_network_fetch = b;
            }
        }
        if let Some(v) = map.get("guest_perm_media_control") {
            if let Some(b) = v.as_bool() {
                config.guest_perm_media_control = b;
            }
        }
        if let Some(v) = map.get("guest_perm_component_theme") {
            if let Some(b) = v.as_bool() {
                config.guest_perm_component_theme = b;
            }
        }
        if let Some(v) = map.get("guest_perm_shortcut_register") {
            if let Some(b) = v.as_bool() {
                config.guest_perm_shortcut_register = b;
            }
        }
        if let Some(v) = map.get("guest_perm_event_publish") {
            if let Some(b) = v.as_bool() {
                config.guest_perm_event_publish = b;
            }
        }

        // ========== 网络代理配置 ==========
        if let Some(v) = map.get("proxy_enabled") {
            if let Some(b) = v.as_bool() {
                config.proxy_enabled = b;
            }
        }
        if let Some(v) = map.get("proxy_url") {
            config.proxy_url = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("proxy_bypass") {
            config.proxy_bypass = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("gemini_base_url") {
            config.gemini_base_url = v.as_str().map(|s| s.to_string());
        }
        if let Some(v) = map.get("github_api_base_url") {
            config.github_api_base_url = v.as_str().map(|s| s.to_string());
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
}
