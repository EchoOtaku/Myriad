use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 添加配置类别字段，用于分组管理
        manager
            .alter_table(
                Table::alter()
                    .table(Configurations::Table)
                    .add_column(
                        ColumnDef::new(Configurations::Category)
                            .string()
                            .default("general"),
                    )
                    .add_column(
                        ColumnDef::new(Configurations::IsEncrypted)
                            .boolean()
                            .default(false),
                    )
                    .to_owned(),
            )
            .await?;

        // 插入平台配置（API Keys）
        let platform_configs = vec![
            (
                "github_token",
                "null",
                "GitHub Personal Access Token",
                "platforms",
                true,
            ),
            (
                "github_username",
                "null",
                "GitHub Username",
                "platforms",
                false,
            ),
            (
                "bilibili_uid",
                "null",
                "Bilibili User ID",
                "platforms",
                false,
            ),
            (
                "steam_api_key",
                "null",
                "Steam Web API Key",
                "platforms",
                true,
            ),
            ("steam_id", "null", "Steam User ID", "platforms", false),
            (
                "netease_user_id",
                "null",
                "NetEase Cloud Music User ID",
                "platforms",
                false,
            ),
            (
                "twitter_bearer_token",
                "null",
                "Twitter API Bearer Token",
                "platforms",
                true,
            ),
            (
                "linkedin_access_token",
                "null",
                "LinkedIn Access Token",
                "platforms",
                true,
            ),
        ];

        for (key, value, desc, category, is_encrypted) in platform_configs {
            // Use raw SQL with ON CONFLICT to handle existing keys
            let sql = format!(
                "INSERT INTO configurations (key, value, description, category, is_encrypted, is_public) \
                 VALUES ('{}', '{}'::jsonb, '{}', '{}', {}, false) \
                 ON CONFLICT (key) DO NOTHING",
                key, value, desc, category, is_encrypted
            );
            manager.get_connection().execute_unprepared(&sql).await?;
        }

        // 插入 AI 配置
        let ai_configs = vec![
            (
                "ai_provider",
                "\"gemini\"",
                "AI Provider (gemini/openai/deepseek)",
                "ai",
                false,
            ),
            (
                "gemini_api_key",
                "null",
                "Google Gemini API Key",
                "ai",
                true,
            ),
            (
                "gemini_model",
                "\"gemini-2.0-flash-exp\"",
                "Gemini Model Name",
                "ai",
                false,
            ),
            ("openai_api_key", "null", "OpenAI API Key", "ai", true),
            (
                "openai_model",
                "\"gpt-4\"",
                "OpenAI Model Name",
                "ai",
                false,
            ),
            (
                "openai_base_url",
                "\"https://api.openai.com/v1\"",
                "OpenAI API Base URL",
                "ai",
                false,
            ),
            ("deepseek_api_key", "null", "DeepSeek API Key", "ai", true),
            (
                "deepseek_model",
                "\"deepseek-chat\"",
                "DeepSeek Model Name",
                "ai",
                false,
            ),
            (
                "openai_max_tokens",
                "2000",
                "Max tokens for AI responses",
                "ai",
                false,
            ),
            (
                "topic_style",
                "\"balanced\"",
                "Analysis topic style",
                "ai",
                false,
            ),
        ];

        for (key, value, desc, category, is_encrypted) in ai_configs {
            // Use raw SQL with ON CONFLICT to handle existing keys
            let sql = format!(
                "INSERT INTO configurations (key, value, description, category, is_encrypted, is_public) \
                 VALUES ('{}', '{}'::jsonb, '{}', '{}', {}, true) \
                 ON CONFLICT (key) DO NOTHING",
                key, value, desc, category, is_encrypted
            );
            manager.get_connection().execute_unprepared(&sql).await?;
        }

        // 插入 UI 配置
        let ui_configs = vec![
            (
                "ui_wallpaper_url",
                "null",
                "Background wallpaper URL",
                "ui",
                false,
            ),
            (
                "ui_wallpaper_blur",
                "3",
                "Wallpaper blur level",
                "ui",
                false,
            ),
            (
                "pet_enabled",
                "true",
                "Enable UI pet character",
                "ui",
                false,
            ),
            (
                "pet_image_url",
                "null",
                "Pet character image URL",
                "ui",
                false,
            ),
        ];

        for (key, value, desc, category, is_encrypted) in ui_configs {
            // Use raw SQL with ON CONFLICT to handle existing keys
            let sql = format!(
                "INSERT INTO configurations (key, value, description, category, is_encrypted, is_public) \
                 VALUES ('{}', '{}'::jsonb, '{}', '{}', {}, true) \
                 ON CONFLICT (key) DO NOTHING",
                key, value, desc, category, is_encrypted
            );
            manager.get_connection().execute_unprepared(&sql).await?;
        }

        // 插入图像生成配置
        let image_configs = vec![
            (
                "image_gen_enabled",
                "true",
                "Enable AI image generation",
                "features",
                false,
            ),
            (
                "image_gen_model",
                "\"flux-anime\"",
                "Image generation model",
                "features",
                false,
            ),
            (
                "image_gen_width",
                "512",
                "Generated image width",
                "features",
                false,
            ),
            (
                "image_gen_height",
                "512",
                "Generated image height",
                "features",
                false,
            ),
        ];

        for (key, value, desc, category, is_encrypted) in image_configs {
            // Use raw SQL with ON CONFLICT to handle existing keys
            let sql = format!(
                "INSERT INTO configurations (key, value, description, category, is_encrypted, is_public) \
                 VALUES ('{}', '{}'::jsonb, '{}', '{}', {}, true) \
                 ON CONFLICT (key) DO NOTHING",
                key, value, desc, category, is_encrypted
            );
            manager.get_connection().execute_unprepared(&sql).await?;
        }

        // 插入功能开关配置
        let feature_configs = vec![
            (
                "enable_auto_fetch",
                "false",
                "Enable automatic data fetching",
                "features",
                false,
            ),
            (
                "fetch_interval_hours",
                "24",
                "Auto-fetch interval in hours",
                "features",
                false,
            ),
        ];

        for (key, value, desc, category, is_encrypted) in feature_configs {
            // Use raw SQL with ON CONFLICT to handle existing keys
            let sql = format!(
                "INSERT INTO configurations (key, value, description, category, is_encrypted, is_public) \
                 VALUES ('{}', '{}'::jsonb, '{}', '{}', {}, true) \
                 ON CONFLICT (key) DO NOTHING",
                key, value, desc, category, is_encrypted
            );
            manager.get_connection().execute_unprepared(&sql).await?;
        }

        // OAuth 配置
        let oauth_configs = vec![
            (
                "github_client_id",
                "null",
                "GitHub OAuth Client ID",
                "oauth",
                false,
            ),
            (
                "github_client_secret",
                "null",
                "GitHub OAuth Client Secret",
                "oauth",
                true,
            ),
            (
                "github_redirect_url",
                "\"http://localhost:3000/api/auth/github/callback\"",
                "GitHub OAuth Redirect URL",
                "oauth",
                false,
            ),
        ];

        for (key, value, desc, category, is_encrypted) in oauth_configs {
            // Use raw SQL with ON CONFLICT to handle existing keys
            let sql = format!(
                "INSERT INTO configurations (key, value, description, category, is_encrypted, is_public) \
                 VALUES ('{}', '{}'::jsonb, '{}', '{}', {}, false) \
                 ON CONFLICT (key) DO NOTHING",
                key, value, desc, category, is_encrypted
            );
            manager.get_connection().execute_unprepared(&sql).await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // 删除新增的配置记录
        manager
            .exec_stmt(
                Query::delete()
                    .from_table(Configurations::Table)
                    .and_where(Expr::col(Configurations::Category).ne("general"))
                    .to_owned(),
            )
            .await?;

        // 删除新增的列
        manager
            .alter_table(
                Table::alter()
                    .table(Configurations::Table)
                    .drop_column(Configurations::Category)
                    .drop_column(Configurations::IsEncrypted)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
#[allow(dead_code)]
enum Configurations {
    Table,
    Key,
    Value,
    Description,
    Category,
    IsEncrypted,
    IsPublic,
}
