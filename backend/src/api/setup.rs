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
    pub has_github_oauth: bool,
    pub has_gemini_api: bool,
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

    // Check GitHub OAuth configuration
    let has_github_oauth = check_github_oauth_config();

    // Check Gemini API configuration
    let has_gemini_api = check_gemini_api_config();

    // Collect missing configurations
    let mut missing_configs = Vec::new();

    if !has_database {
        missing_configs.push("Database tables not initialized".to_string());
    }
    if !has_admin_user {
        missing_configs.push("No admin user registered".to_string());
    }

    // GitHub OAuth and Gemini API are optional - just note if missing
    if !has_github_oauth {
        missing_configs.push("GitHub OAuth not configured (optional)".to_string());
    }
    if !has_gemini_api {
        missing_configs.push("Gemini API key not configured (optional)".to_string());
    }

    // Setup is only required if database or admin user is missing
    let is_setup_required = !has_database || !has_admin_user;

    let status = SetupStatus {
        is_setup_required,
        has_database,
        has_admin_user,
        has_github_oauth,
        has_gemini_api,
        missing_configs,
    };

    tracing::info!("Setup status: {:?}", status);

    Ok(Json(status))
}

/// GET /api/setup/config
/// Get safe configuration info (no secrets)
pub async fn get_setup_config() -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let config = json!({
        "database_url_set": env::var("DATABASE_URL").is_ok(),
        "server_host": env::var("SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
        "server_port": env::var("SERVER_PORT").unwrap_or_else(|_| "3000".to_string()),
        "github_oauth": {
            "client_id_set": env::var("GITHUB_CLIENT_ID").is_ok(),
            "client_secret_set": env::var("GITHUB_CLIENT_SECRET").is_ok(),
            "redirect_url": env::var("GITHUB_REDIRECT_URL")
                .unwrap_or_else(|_| "http://localhost:3000/api/auth/github/callback".to_string()),
        },
        "gemini_api": {
            "api_key_set": env::var("GEMINI_API_KEY").is_ok(),
            "model": env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-pro".to_string()),
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

/// Check if GitHub OAuth is configured
fn check_github_oauth_config() -> bool {
    let client_id = env::var("GITHUB_CLIENT_ID").ok();
    let client_secret = env::var("GITHUB_CLIENT_SECRET").ok();

    let has_config = client_id
        .as_ref()
        .is_some_and(|id| !id.is_empty() && !id.contains("your_"))
        && client_secret
            .as_ref()
            .is_some_and(|secret| !secret.is_empty() && !secret.contains("your_"));

    tracing::info!("GitHub OAuth configured: {}", has_config);
    has_config
}

/// Check if Gemini API is configured
fn check_gemini_api_config() -> bool {
    let api_key = env::var("GEMINI_API_KEY").ok();

    let has_config = api_key
        .as_ref()
        .is_some_and(|key| !key.is_empty() && !key.contains("your-"));

    tracing::info!("Gemini API configured: {}", has_config);
    has_config
}

/// POST /api/setup/init-database
/// Run database migrations (will drop and recreate if tables exist)
pub async fn init_database(
    State(db): State<DatabaseConnection>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
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
                    "message": format!("迁移失败: {}", e)
                })),
            ))
        }
    }
}

/// POST /api/setup/init-env
/// Initialize .env file from .env.example
pub async fn initialize_env_file() -> Result<Json<Value>, (StatusCode, Json<Value>)> {
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
                "message": ".env file initialized from template",
                "path": env_path.display().to_string()
            })))
        }
        Err(e) => {
            tracing::error!("Failed to create .env file: {:?}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Failed to create .env file",
                    "message": e.to_string()
                })),
            ))
        }
    }
}

/// Environment configuration update request
#[derive(Debug, Deserialize)]
pub struct EnvUpdateRequest {
    pub database_url: Option<String>,
    pub server_host: Option<String>,
    pub server_port: Option<String>,
    pub rust_log: Option<String>,
    pub jwt_secret: Option<String>,
    pub github_client_id: Option<String>,
    pub github_client_secret: Option<String>,
    pub github_redirect_url: Option<String>,
    pub frontend_url: Option<String>,
    pub gemini_api_key: Option<String>,
    pub gemini_model: Option<String>,
    pub topic_style: Option<String>,
    pub github_username: Option<String>,
    pub github_token: Option<String>,
    pub bilibili_uid: Option<String>,
    pub steam_api_key: Option<String>,
    pub steam_id: Option<String>,
    pub twitter_username: Option<String>,
    pub twitter_bearer_token: Option<String>,
    pub netease_user_id: Option<String>,
}

/// POST /api/setup/update-env
/// Update .env file with new configuration
pub async fn update_env_file(
    Json(config): Json<EnvUpdateRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
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
                    "message": e.to_string()
                })),
            ));
        }
    };

    // Update configuration values
    let mut updated_content = content;

    // Helper macro to update env values
    macro_rules! update_env_var {
        ($field:expr, $key:expr) => {
            if let Some(value) = $field {
                updated_content = update_env_variable(&updated_content, $key, &value);
            }
        };
    }

    update_env_var!(config.database_url, "DATABASE_URL");
    update_env_var!(config.server_host, "SERVER_HOST");
    update_env_var!(config.server_port, "SERVER_PORT");
    update_env_var!(config.rust_log, "RUST_LOG");
    update_env_var!(config.jwt_secret, "JWT_SECRET");
    update_env_var!(config.github_client_id, "GITHUB_CLIENT_ID");
    update_env_var!(config.github_client_secret, "GITHUB_CLIENT_SECRET");
    update_env_var!(config.github_redirect_url, "GITHUB_REDIRECT_URL");
    update_env_var!(config.frontend_url, "FRONTEND_URL");
    update_env_var!(config.gemini_api_key, "GEMINI_API_KEY");
    update_env_var!(config.gemini_model, "GEMINI_MODEL");
    update_env_var!(config.topic_style, "TOPIC_STYLE");
    update_env_var!(config.github_username, "GITHUB_USERNAME");
    update_env_var!(config.github_token, "GITHUB_TOKEN");
    update_env_var!(config.bilibili_uid, "BILIBILI_UID");
    update_env_var!(config.steam_api_key, "STEAM_API_KEY");
    update_env_var!(config.steam_id, "STEAM_ID");
    update_env_var!(config.twitter_username, "TWITTER_USERNAME");
    update_env_var!(config.twitter_bearer_token, "TWITTER_BEARER_TOKEN");
    update_env_var!(config.netease_user_id, "NETEASE_USER_ID");

    // Write updated content back to .env
    match fs::write(&env_path, updated_content) {
        Ok(_) => {
            tracing::info!(".env file updated successfully");
            Ok(Json(json!({
                "success": true,
                "message": "Configuration updated successfully. Please restart the backend for changes to take effect.",
                "path": env_path.display().to_string()
            })))
        }
        Err(e) => {
            tracing::error!("Failed to write .env file: {:?}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "error": "Failed to write .env file",
                    "message": e.to_string()
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
pub async fn save_database_config(
    Json(config): Json<DatabaseConfigRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::info!("Saving database configuration");

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
                        "message": e.to_string()
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
                        "message": e.to_string()
                    })),
                ));
            }

            return Ok(Json(json!({
                "success": true,
                "message": "Database configuration saved successfully. Please restart the backend to connect to the database.",
                "path": env_path.display().to_string()
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
                    "message": e.to_string()
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
                    "message": e.to_string()
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
