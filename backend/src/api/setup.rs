use axum::{extract::State, http::StatusCode, Json};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use sea_orm_migration::MigratorTrait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::fs;
use std::path::PathBuf;

/// Setup status response
#[derive(Debug, Serialize, Deserialize)]
pub struct SetupStatus {
    pub is_setup_required: bool,
    pub has_database: bool,
    pub has_admin_user: bool,
    pub missing_configs: Vec<String>,
}

/// GET /api/setup/status
/// Check if initial setup is required
pub async fn check_setup_status(
    State(db): State<DatabaseConnection>,
) -> Result<Json<SetupStatus>, (StatusCode, Json<Value>)> {
    tracing::info!("Checking setup status");

    // Check if database tables exist
    let has_database = check_database_tables(&db).await;

    // Check if admin user exists (first user)
    let has_admin_user = if has_database {
        check_admin_user_exists(&db).await
    } else {
        false
    };

    // Collect missing configurations
    let mut missing_configs = Vec::new();

    if !has_database {
        missing_configs.push("Database tables not initialized".to_string());
    }
    if !has_admin_user {
        missing_configs.push("No admin user registered".to_string());
    }

    // Setup is only required if database or admin user is missing
    let is_setup_required = !has_database || !has_admin_user;

    let status = SetupStatus {
        is_setup_required,
        has_database,
        has_admin_user,
        missing_configs,
    };

    tracing::info!("Setup status: {:?}", status);

    Ok(Json(status))
}

/// GET /api/setup/config
/// Get safe configuration info (no secrets)
pub async fn get_setup_config() -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let config_guard = crate::GLOBAL_DYNAMIC_CONFIG.read().await;

    let config = json!({
        "database_url_set": env::var("DATABASE_URL").is_ok(),
        "server_host": env::var("SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
        "server_port": env::var("SERVER_PORT").unwrap_or_else(|_| "3000".to_string()),
        "github_oauth": {
            "client_id_set": config_guard.github_client_id.is_some(),
            "client_secret_set": config_guard.github_client_secret.is_some(),
            "redirect_url": config_guard.github_redirect_url.clone(),
        },
        "gemini_api": {
            "api_key_set": config_guard.gemini_api_key.is_some(),
            "model": config_guard.gemini_model.clone(),
        },
    });

    Ok(Json(config))
}

// Helper functions

/// Check if required database tables exist
async fn check_database_tables(db: &DatabaseConnection) -> bool {
    // Check multiple critical tables to ensure migrations completed
    // Using platforms table since it's the first migration (001)
    let result = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'platforms'
            ) as platforms_exists,
            EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'users'
            ) as users_exists",
            vec![],
        ))
        .await;

    match result {
        Ok(Some(row)) => {
            let platforms_exists: bool = row.try_get("", "platforms_exists").unwrap_or(false);
            let users_exists: bool = row.try_get("", "users_exists").unwrap_or(false);

            // Both tables should exist for complete setup
            let exists = platforms_exists && users_exists;
            tracing::info!(
                "Database tables check - platforms: {}, users: {}, complete: {}",
                platforms_exists,
                users_exists,
                exists
            );
            exists
        }
        Ok(None) => {
            tracing::warn!("No rows returned when checking database tables");
            false
        }
        Err(e) => {
            tracing::error!("Error checking database tables: {:?}", e);
            false
        }
    }
}

/// Check if an admin user exists (local admin with auth_provider='local')
async fn check_admin_user_exists(db: &DatabaseConnection) -> bool {
    // Query to check if local admin exists
    let result = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT EXISTS (SELECT 1 FROM users WHERE auth_provider = 'local' AND is_admin = true LIMIT 1) as admin_exists",
            vec![],
        ))
        .await;

    match result {
        Ok(Some(row)) => {
            let exists: bool = row.try_get("", "admin_exists").unwrap_or(false);
            tracing::info!("Local admin user exists: {}", exists);
            exists
        }
        Ok(None) => {
            tracing::warn!("No rows returned when checking admin user");
            false
        }
        Err(e) => {
            tracing::error!("Error checking admin user: {:?}", e);
            false
        }
    }
}

/// POST /api/setup/init-database
/// Run database migrations (will drop and recreate if tables exist)
///
/// ⚠️ SECURITY WARNING: This endpoint can DROP all database tables!
/// ✅ PROTECTION: Only accessible during CONFIG_MODE OR if setup is not completed
pub async fn init_database(
    State(db): State<DatabaseConnection>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // ✅ SECURITY CHECK: Prevent re-initialization if setup is already completed
    // Check if admin user exists (indicates setup is complete)
    let admin_exists = check_admin_user_exists(&db).await;

    if admin_exists {
        tracing::error!(
            "🚨 Database initialization REJECTED: Admin user already exists (setup completed)"
        );
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Setup already completed",
                "message": "Database has been initialized and admin user exists. This endpoint is disabled for security. If you need to reinitialize, please delete the admin user from the database first."
            })),
        ));
    }

    // 安全检查：如果不在配置模式，记录警告
    let config_mode = crate::CONFIG_MODE.load(std::sync::atomic::Ordering::Relaxed);

    if !config_mode {
        tracing::warn!(
            "⚠️ Database initialization requested in FULL MODE - proceeding as no admin exists yet"
        );
    }

    tracing::info!("Running database migrations");

    // Check if tables already exist
    let result = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'platforms'
            ) as platforms_exists,
            EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'users'
            ) as users_exists",
            vec![],
        ))
        .await;

    let mut tables_existed = false;

    if let Ok(Some(row)) = result {
        let platforms_exists: bool = row.try_get("", "platforms_exists").unwrap_or(false);
        let users_exists: bool = row.try_get("", "users_exists").unwrap_or(false);

        if platforms_exists || users_exists {
            tables_existed = true;
            tracing::warn!(
                "⚠️ Existing tables detected - platforms: {}, users: {}. Will drop and recreate.",
                platforms_exists,
                users_exists
            );

            // Drop all tables in reverse order to handle foreign key constraints
            let tables_to_drop = vec![
                "reports",
                "fetch_jobs",
                "api_keys",
                "configurations",
                "analysis_results",
                "user_activities",
                "user_profiles",
                "users",
                "platforms",
            ];

            for table in tables_to_drop {
                let drop_result = db
                    .execute(Statement::from_string(
                        DatabaseBackend::Postgres,
                        format!("DROP TABLE IF EXISTS {} CASCADE", table),
                    ))
                    .await;

                match drop_result {
                    Ok(_) => tracing::info!("✅ Dropped table: {}", table),
                    Err(e) => tracing::warn!("⚠️ Failed to drop table {}: {:?}", table, e),
                }
            }

            // CRITICAL: Clear migration history so migrations can run again
            let clear_migrations = db
                .execute(Statement::from_string(
                    DatabaseBackend::Postgres,
                    "DELETE FROM seaql_migrations".to_string(),
                ))
                .await;

            match clear_migrations {
                Ok(_) => tracing::info!("🗑️ Cleared migration history from seaql_migrations"),
                Err(e) => tracing::warn!("⚠️ Failed to clear migration history: {:?}", e),
            }

            tracing::info!("🗑️ All existing tables dropped and migration history cleared");
        }
    }

    // Check if seaql_migrations has entries but business tables don't exist
    // This indicates a corrupted state that needs to be fixed
    let migrations_check = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT 
                (SELECT COUNT(*) FROM seaql_migrations) as migration_count,
                EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'platforms') as platforms_exists,
                EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users') as users_exists",
            vec![],
        ))
        .await;

    if let Ok(Some(row)) = migrations_check {
        let migration_count: i64 = row.try_get("", "migration_count").unwrap_or(0);
        let platforms_exists: bool = row.try_get("", "platforms_exists").unwrap_or(false);
        let users_exists: bool = row.try_get("", "users_exists").unwrap_or(false);

        if migration_count > 0 && (!platforms_exists || !users_exists) {
            tracing::warn!(
                "⚠️ Detected corrupted state: {} migrations recorded but tables missing (platforms: {}, users: {})",
                migration_count, platforms_exists, users_exists
            );
            tracing::warn!("🔧 Clearing migration history to allow re-execution");

            let clear_result = db
                .execute(Statement::from_string(
                    DatabaseBackend::Postgres,
                    "DELETE FROM seaql_migrations".to_string(),
                ))
                .await;

            match clear_result {
                Ok(_) => tracing::info!("✅ Migration history cleared successfully"),
                Err(e) => tracing::error!("❌ Failed to clear migration history: {:?}", e),
            }
        }
    } // Import the migrator from migrations module
    use crate::db::Migrator;

    let migrations = <Migrator as MigratorTrait>::migrations();
    tracing::info!(
        "🚀 Starting database migrations with {} migrations",
        migrations.len()
    );

    // Log each migration name
    for (i, migration) in migrations.iter().enumerate() {
        tracing::info!("  Migration {}: {}", i + 1, migration.name());
    }

    // Check existing migrations in seaql_migrations table
    let existing_migrations = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT version FROM seaql_migrations ORDER BY version",
            vec![],
        ))
        .await;

    if let Ok(rows) = existing_migrations {
        let versions: Vec<String> = rows
            .iter()
            .filter_map(|row| row.try_get::<String>("", "version").ok())
            .collect();
        if !versions.is_empty() {
            tracing::info!("📝 Existing migrations in seaql_migrations: {:?}", versions);
        } else {
            tracing::info!("📝 No existing migrations found, will run all migrations");
        }
    }

    match Migrator::up(&db, None).await {
        Ok(_) => {
            tracing::info!("✅ Database migrations completed successfully");

            // List all tables in the database
            let tables_result = db
                .query_all(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
                    vec![],
                ))
                .await;

            if let Ok(rows) = tables_result {
                let table_names: Vec<String> = rows
                    .iter()
                    .filter_map(|row| row.try_get::<String>("", "table_name").ok())
                    .collect();
                tracing::info!("📋 Tables in database: {:?}", table_names);
            }

            // Verify tables were created
            let verify_result = db
                .query_one(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    "SELECT 
                        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') as total_tables,
                        EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users') as users_exists,
                        EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'platforms') as platforms_exists,
                        EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'configurations') as configurations_exists",
                    vec![],
                ))
                .await;

            let (total_tables, users_exists, platforms_exists, configurations_exists) =
                if let Ok(Some(row)) = verify_result {
                    (
                        row.try_get::<i64>("", "total_tables").unwrap_or(0),
                        row.try_get::<bool>("", "users_exists").unwrap_or(false),
                        row.try_get::<bool>("", "platforms_exists").unwrap_or(false),
                        row.try_get::<bool>("", "configurations_exists")
                            .unwrap_or(false),
                    )
                } else {
                    (0, false, false, false)
                };

            tracing::info!(
                "📊 Database verification - Total tables: {}, Users: {}, Platforms: {}, Configurations: {}",
                total_tables, users_exists, platforms_exists, configurations_exists
            );

            let message = if tables_existed {
                "数据库表已重新初始化"
            } else {
                "数据库初始化完成"
            };

            Ok(Json(json!({
                "success": true,
                "message": message,
                "recreated": tables_existed,
                "verification": {
                    "total_tables": total_tables,
                    "users_table": users_exists,
                    "platforms_table": platforms_exists,
                    "configurations_table": configurations_exists
                }
            })))
        }
        Err(e) => {
            tracing::error!("❌ Database migration failed: {:?}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Database migration failed",
                    "message": "数据库迁移失败，请检查数据库连接和权限设置"
                })),
            ))
        }
    }
}

/// POST /api/setup/init-env
/// Initialize .env file from .env.example
/// ✅ PROTECTION: Only accessible during CONFIG_MODE (checked by middleware)
pub async fn initialize_env_file() -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // ✅ SECURITY CHECK: Only allow in CONFIG_MODE
    let config_mode = crate::CONFIG_MODE.load(std::sync::atomic::Ordering::Relaxed);

    if !config_mode {
        tracing::error!(
            "🚨 Environment file initialization REJECTED: Not in CONFIG_MODE (security protection)"
        );
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Operation not allowed",
                "message": "Environment file initialization is only allowed in CONFIG_MODE. Please restart the application with CONFIG_MODE=true."
            })),
        ));
    }

    tracing::info!("Initializing .env file from .env.example");

    let env_example_path = get_env_example_path();
    let env_path = get_env_path();

    // Check if .env already exists
    if env_path.exists() {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": ".env file already exists",
                "message": "Please use the update endpoint to modify existing configuration"
            })),
        ));
    }

    // Check if .env.example exists
    if !env_example_path.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": ".env.example not found",
                "message": "Template file is missing"
            })),
        ));
    }

    // Copy .env.example to .env
    match fs::copy(&env_example_path, &env_path) {
        Ok(_) => {
            tracing::info!(".env file created successfully");
            Ok(Json(json!({
                "success": true,
                "message": ".env file initialized from template"
            })))
        }
        Err(e) => {
            tracing::error!("Failed to create .env file: {:?}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Failed to create .env file",
                    "message": "无法创建配置文件，请检查文件系统权限"
                })),
            ))
        }
    }
}

/// Environment configuration update request
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct EnvUpdateRequest {
    // Core configuration (saved to .env)
    pub database_url: Option<String>,
    pub server_host: Option<String>,
    pub server_port: Option<String>,
    pub rust_log: Option<String>,
    pub jwt_secret: Option<String>,
    pub cors_origins: Option<String>,

    // Application configuration (saved to database) - kept for backward compatibility
    // These will be migrated to the database automatically
    pub gemini_api_key: Option<String>,
    pub gemini_model: Option<String>,
    pub openai_api_key: Option<String>,
    pub openai_model: Option<String>,
    pub openai_base_url: Option<String>,
    pub ai_provider: Option<String>,
    pub topic_style: Option<String>,
    pub github_username: Option<String>,
    pub github_token: Option<String>,
    pub bilibili_uid: Option<String>,
    pub steam_api_key: Option<String>,
    pub steam_id: Option<String>,
    pub netease_user_id: Option<String>,
    pub github_client_id: Option<String>,
    pub github_client_secret: Option<String>,
    pub github_redirect_url: Option<String>,
}

/// POST /api/setup/update-env
/// Update .env file with new configuration
/// ✅ PROTECTION: Only accessible during CONFIG_MODE (checked by middleware)
pub async fn update_env_file(
    Json(config): Json<EnvUpdateRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // ✅ SECURITY CHECK: Only allow in CONFIG_MODE
    let config_mode = crate::CONFIG_MODE.load(std::sync::atomic::Ordering::Relaxed);

    if !config_mode {
        tracing::error!(
            "🚨 Environment file update REJECTED: Not in CONFIG_MODE (security protection)"
        );
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Operation not allowed",
                "message": "Environment file updates are only allowed in CONFIG_MODE. Please restart the application with CONFIG_MODE=true to modify configuration."
            })),
        ));
    }

    tracing::info!("Updating .env file configuration");

    let env_path = get_env_path();

    // Check if .env exists
    if !env_path.exists() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": ".env file not found",
                "message": "Please initialize the configuration first"
            })),
        ));
    }

    // Read current .env file
    let content = match fs::read_to_string(&env_path) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to read .env file: {:?}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Failed to read .env file",
                    "message": "无法读取配置文件，请检查文件是否存在及权限设置"
                })),
            ));
        }
    };

    // Update configuration values
    let mut updated_content = content;

    // Helper macro to update env values (only for core config)
    macro_rules! update_env_var {
        ($field:expr, $key:expr) => {
            if let Some(value) = $field {
                updated_content = update_env_variable(&updated_content, $key, &value);
            }
        };
    }

    // Only update core configuration in .env
    update_env_var!(config.database_url, "DATABASE_URL");
    update_env_var!(config.server_host, "SERVER_HOST");
    update_env_var!(config.server_port, "SERVER_PORT");
    update_env_var!(config.rust_log, "RUST_LOG");
    update_env_var!(config.jwt_secret, "JWT_SECRET");
    update_env_var!(config.cors_origins, "CORS_ORIGINS");

    // Write updated content back to .env
    match fs::write(&env_path, updated_content) {
        Ok(_) => {
            tracing::info!(".env file updated successfully");

            // If database is available, save application configs there
            if let Some(db) = crate::DB_CONNECTION.read().await.as_ref() {
                use crate::services::config_service::ConfigService;
                use serde_json::json;
                use std::collections::HashMap;

                let config_service = ConfigService::new(db.clone());
                let mut db_updates = HashMap::new();

                // Map application configs to database
                if let Some(v) = config.ai_provider {
                    db_updates.insert("ai_provider".to_string(), json!(v));
                }
                if let Some(v) = config.gemini_api_key {
                    db_updates.insert("gemini_api_key".to_string(), json!(v));
                }
                if let Some(v) = config.gemini_model {
                    db_updates.insert("gemini_model".to_string(), json!(v));
                }
                if let Some(v) = config.openai_api_key {
                    db_updates.insert("openai_api_key".to_string(), json!(v));
                }
                if let Some(v) = config.openai_model {
                    db_updates.insert("openai_model".to_string(), json!(v));
                }
                if let Some(v) = config.openai_base_url {
                    db_updates.insert("openai_base_url".to_string(), json!(v));
                }
                if let Some(v) = config.topic_style {
                    db_updates.insert("topic_style".to_string(), json!(v));
                }
                if let Some(v) = config.github_username {
                    db_updates.insert("github_username".to_string(), json!(v));
                }
                if let Some(v) = config.github_token {
                    db_updates.insert("github_token".to_string(), json!(v));
                }
                if let Some(v) = config.bilibili_uid {
                    db_updates.insert("bilibili_uid".to_string(), json!(v));
                }
                if let Some(v) = config.steam_api_key {
                    db_updates.insert("steam_api_key".to_string(), json!(v));
                }
                if let Some(v) = config.steam_id {
                    db_updates.insert("steam_id".to_string(), json!(v));
                }
                if let Some(v) = config.netease_user_id {
                    db_updates.insert("netease_user_id".to_string(), json!(v));
                }
                if let Some(v) = config.github_client_id {
                    db_updates.insert("github_client_id".to_string(), json!(v));
                }
                if let Some(v) = config.github_client_secret {
                    db_updates.insert("github_client_secret".to_string(), json!(v));
                }
                if let Some(v) = config.github_redirect_url {
                    db_updates.insert("github_redirect_url".to_string(), json!(v));
                }

                if !db_updates.is_empty() {
                    if let Err(e) = config_service.update_configs(db_updates).await {
                        tracing::warn!("Failed to update database configs: {}", e);
                    } else {
                        // Reload dynamic config
                        if let Ok(new_config) = config_service.load_config().await {
                            *crate::GLOBAL_DYNAMIC_CONFIG.write().await = new_config;
                            tracing::info!("Dynamic configuration reloaded");
                        }
                    }
                }
            } else {
                // Check if we have any app config to save
                let has_app_config = config.ai_provider.is_some()
                    || config.gemini_api_key.is_some()
                    || config.gemini_model.is_some()
                    || config.openai_api_key.is_some()
                    || config.openai_model.is_some()
                    || config.openai_base_url.is_some()
                    || config.topic_style.is_some()
                    || config.github_username.is_some()
                    || config.github_token.is_some()
                    || config.bilibili_uid.is_some()
                    || config.steam_api_key.is_some()
                    || config.steam_id.is_some()
                    || config.netease_user_id.is_some()
                    || config.github_client_id.is_some()
                    || config.github_client_secret.is_some()
                    || config.github_redirect_url.is_some();

                if has_app_config {
                    tracing::warn!("⚠️ Application configuration received but Database is not connected. Settings will NOT be saved.");
                    return Ok(Json(json!({
                        "success": true,
                        "message": "Core configuration updated, but application settings could not be saved because the database is not connected.",
                        "warning": "Application settings (AI keys, etc.) were NOT saved. Please ensure the database is connected and try again.",
                        "path": env_path.display().to_string()
                    })));
                }
            }

            Ok(Json(json!({
                "success": true,
                "message": "Configuration updated successfully.",
                "path": env_path.display().to_string()
            })))
        }
        Err(e) => {
            tracing::error!("Failed to write .env file: {:?}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Failed to write .env file",
                    "message": "无法保存配置文件，请检查文件系统权限"
                })),
            ))
        }
    }
}

/// Database configuration request
#[derive(Debug, Deserialize)]
pub struct DatabaseConfigRequest {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
}

/// POST /api/setup/database-config
/// Save database configuration to .env file (专门用于配置数据库)
/// 🔒 安全保护：只能在 CONFIG_MODE 下修改数据库配置
pub async fn save_database_config(
    Json(config): Json<DatabaseConfigRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    // ✅ P0 安全修复：强制要求 CONFIG_MODE
    // 这是最危险的端点之一，它可以修改数据库连接
    // 如果不在 CONFIG_MODE，攻击者可以劫持整个数据库连接
    let config_mode = crate::CONFIG_MODE.load(std::sync::atomic::Ordering::Relaxed);

    if !config_mode {
        tracing::error!(
            "🚨 SECURITY: Database config change REJECTED - not in CONFIG_MODE. \n\
             This is a critical security protection. Database configuration can only be \n\
             modified during initial setup with CONFIG_MODE=true."
        );
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Operation not allowed",
                "message": "数据库配置只能在配置模式下修改。请使用 CONFIG_MODE=true 重启服务。",
                "reason": "Security protection: Database configuration is locked after initial setup",
                "hint": "Restart with CONFIG_MODE=true environment variable if you need to reconfigure the database"
            })),
        ));
    }

    tracing::info!("Saving database configuration (CONFIG_MODE verified)");

    // Construct DATABASE_URL
    let database_url = format!(
        "postgres://{}:{}@{}:{}/{}",
        config.username, config.password, config.host, config.port, config.database
    );

    tracing::info!("Database URL constructed (password masked)");

    let env_path = get_env_path();

    // If .env doesn't exist, create it from .env.example
    if !env_path.exists() {
        let env_example_path = get_env_example_path();
        if env_example_path.exists() {
            tracing::info!(".env not found, creating from .env.example");
            if let Err(e) = fs::copy(&env_example_path, &env_path) {
                tracing::error!("Failed to create .env from template: {:?}", e);
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "error": "Failed to create configuration file",
                        "message": "无法创建配置文件，请检查文件系统权限"
                    })),
                ));
            }
        } else {
            // Create a minimal .env file with just the database URL
            tracing::info!(".env.example not found, creating minimal .env");
            if let Err(e) = fs::write(&env_path, format!("DATABASE_URL={}\n", database_url)) {
                tracing::error!("Failed to create .env file: {:?}", e);
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "error": "Failed to create configuration file",
                        "message": "无法创建配置文件，请检查文件系统权限"
                    })),
                ));
            }

            return Ok(Json(json!({
                "success": true,
                "message": "Database configuration saved successfully."
            })));
        }
    }

    // Read and update existing .env file
    let content = match fs::read_to_string(&env_path) {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("Failed to read .env file: {:?}", e);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Failed to read configuration file",
                    "message": "无法读取配置文件，请检查文件系统权限"
                })),
            ));
        }
    };

    // Update DATABASE_URL
    let updated_content = update_env_variable(&content, "DATABASE_URL", &database_url);

    // Write back to file
    match fs::write(&env_path, updated_content) {
        Ok(_) => {
            tracing::info!("✅ Database configuration saved successfully");

            // Reload environment variables from the file
            if let Err(e) = dotenvy::from_path_override(&env_path) {
                tracing::warn!("⚠️ Failed to reload .env file: {}", e);
            } else {
                tracing::info!("♻️ Environment variables reloaded from .env");
            }

            // Trigger configuration reload
            crate::api::system::CONFIG_RELOAD_REQUESTED
                .store(true, std::sync::atomic::Ordering::Relaxed);

            tracing::info!("🔄 Configuration reload triggered");

            Ok(Json(json!({
                "success": true,
                "message": "Database configuration saved successfully. Reconnecting to database automatically...",
                "path": env_path.display().to_string(),
                "database_url_set": true,
                "reload_triggered": true,
                "note": "Configuration will be applied within 2-3 seconds."
            })))
        }
        Err(e) => {
            tracing::error!("Failed to write .env file: {:?}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Failed to save configuration",
                    "message": "无法保存配置文件，请检查文件系统权限"
                })),
            ))
        }
    }
}

// Helper functions

/// Get the path to .env.example
fn get_env_example_path() -> PathBuf {
    let mut path = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    path.push(".env.example");
    path
}

/// Get the path to .env
fn get_env_path() -> PathBuf {
    let mut path = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    path.push(".env");
    path
}

/// Update a single environment variable in the content
fn update_env_variable(content: &str, key: &str, value: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut result = Vec::new();
    let mut found = false;

    for line in lines {
        let trimmed = line.trim();

        // Skip comments and empty lines
        if trimmed.starts_with('#') || trimmed.is_empty() {
            result.push(line.to_string());
            continue;
        }

        // Check if this line contains our key
        if let Some(eq_pos) = trimmed.find('=') {
            let line_key = trimmed[..eq_pos].trim();
            if line_key == key {
                // Replace the value
                result.push(format!("{}={}", key, value));
                found = true;
                continue;
            }
        }

        result.push(line.to_string());
    }

    // If key wasn't found, append it
    if !found {
        result.push(format!("{}={}", key, value));
    }

    result.join("\n")
}
