use axum::{
    extract::{FromRequest, Request},
    http::StatusCode,
    middleware::{from_fn, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod config;
mod db;
mod federation;
mod middleware;
mod models;
mod oauth_url_builder;
mod services;

use config::{AppConfig, DynamicConfig};
use sea_orm::ConnectionTrait;
use services::config_service::ConfigService;
use std::sync::atomic::{AtomicBool, Ordering}; // P1: 用于数据库健康检查

// Global flag to indicate if server is running in configuration mode
pub static CONFIG_MODE: AtomicBool = AtomicBool::new(false);

// Global database connection (None in config mode, Some in full mode)
pub static DB_CONNECTION: once_cell::sync::Lazy<Arc<RwLock<Option<sea_orm::DatabaseConnection>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(None)));

// Global core configuration (hot-reloadable)
pub static GLOBAL_CONFIG: once_cell::sync::Lazy<Arc<RwLock<AppConfig>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(AppConfig::default())));

// Global dynamic configuration from database (hot-reloadable)
pub static GLOBAL_DYNAMIC_CONFIG: once_cell::sync::Lazy<Arc<RwLock<DynamicConfig>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(DynamicConfig::default())));

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env before any component reads environment variables.
    dotenvy::dotenv().ok();

    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "myriad_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("🚀 Starting Myriad Backend v{}", env!("CARGO_PKG_VERSION"));

    // Record process start time for /health.uptime_seconds.
    api::mark_startup();

    // Initialise the updater proxy client. None if env not set; routes still register
    // and return a clean 503.
    let updater_client = services::updater_client::UpdaterClient::from_env();
    if let Some(c) = &updater_client {
        tracing::info!(
            base_url = %c.base_url(),
            has_token = c.has_token(),
            "updater client configured"
        );
        // Best-effort reachability probe. Don't block startup — the updater container may
        // still be coming up, and admin routes return 503 cleanly when unreachable.
        let probe = c.clone();
        tokio::spawn(async move {
            match probe.ping().await {
                Ok(_) => tracing::info!("updater /healthz: reachable"),
                Err(e) => {
                    tracing::warn!(err = %e, "updater /healthz: unreachable on startup (will retry on demand)")
                }
            }
        });
    } else {
        tracing::info!(
            "no updater client configured (set MYRIAD_UPDATER_URL/UPDATE_TOKEN to enable)"
        );
    }
    api::updater_admin::init(updater_client);

    run_server().await?;

    tracing::info!("👋 Backend shutdown complete");
    Ok(())
}

async fn run_server() -> anyhow::Result<()> {
    // Load configuration
    let config = AppConfig::from_env()?;

    // Initialize global config
    *GLOBAL_CONFIG.write().await = config.clone();
    tracing::info!("✅ Configuration loaded and cached globally");

    // ✅ 安全修复: 验证 JWT 密钥强度
    match std::env::var("JWT_SECRET") {
        Ok(secret) => {
            if secret.len() < 32 {
                tracing::error!(
                    "🚨 JWT_SECRET is too weak ({} chars). Minimum 32 characters required for security.",
                    secret.len()
                );
                if std::env::var("ENVIRONMENT").unwrap_or_default() == "production" {
                    anyhow::bail!(
                        "JWT_SECRET must be at least 32 characters in production environment"
                    );
                } else {
                    tracing::warn!("⚠️  Continuing with weak JWT_SECRET in development mode. DO NOT use in production!");
                }
            } else {
                tracing::info!("✅ JWT_SECRET strength validated ({} chars)", secret.len());
            }
        }
        Err(_) => {
            tracing::warn!("⚠️  JWT_SECRET not configured. Authentication features will not work.");
        }
    }

    // Try to initialize database connection if URL is configured
    if !config.database_url.is_empty() {
        match db::connection::establish_connection(&config.database_url).await {
            Ok(db) => {
                tracing::info!("✅ Database connection established");

                // Run database migrations automatically on startup (idempotent - skips already applied migrations)
                use sea_orm_migration::MigratorTrait;
                tracing::debug!("Checking for pending database migrations...");
                match migration::Migrator::up(&db, None).await {
                    Ok(_) => {
                        tracing::info!("✅ Database migrations up to date");
                    }
                    Err(e) => {
                        // Log the error but don't stop the service
                        // Migrations might fail if tables already exist from manual setup
                        tracing::warn!("⚠️  Database migration check failed: {}", e);
                        tracing::info!("Continuing with existing database schema...");
                    }
                }

                // Auto-complete missing schema fields (safe, idempotent operation)
                if let Err(e) = db::schema_check::ensure_schema(&db).await {
                    tracing::warn!("⚠️  Schema check failed: {}", e);
                    tracing::info!("Continuing with existing schema...");
                }

                // Load dynamic configuration from database
                let config_service = ConfigService::new(db.clone());

                // Load the merged configuration
                match config_service.load_config().await {
                    Ok(dynamic_config) => {
                        *GLOBAL_DYNAMIC_CONFIG.write().await = dynamic_config;
                        tracing::info!("✅ Dynamic configuration loaded from database");
                    }
                    Err(e) => {
                        tracing::warn!("⚠️  Failed to load dynamic config: {}", e);
                        tracing::info!("Using default configuration");
                    }
                }

                // Validate GitHub OAuth configuration (after database config is loaded)
                // This is informational only - OAuth will work if configured in database
                use oauth_url_builder::OAuthUrlBuilder;
                if let Err(e) = OAuthUrlBuilder::validate_github_oauth_config().await {
                    tracing::debug!("ℹ️  GitHub OAuth status: {}", e);
                }

                // 🔐 Load OAuth provider registry (GitHub + future OIDC providers)
                services::oauth::registry::init().await;
                tracing::info!(
                    "✅ OAuth providers loaded: {}",
                    services::oauth::registry::REGISTRY.list().await.len()
                );

                // Initialize Tapp scheduler engine
                api::tapp_scheduler::init_scheduler(db.clone()).await;
                tracing::info!("✅ Tapp scheduler engine initialized");

                // Initialize Brew scheduler engine (RSS/Atom feed updates)
                services::brew_scheduler::init_brew_scheduler(db.clone()).await;
                tracing::info!("✅ Brew scheduler engine initialized");

                // Initialize Agent identity system (SOUL.md / USER.md)
                let agent_data_dir = std::path::PathBuf::from("data/agent");
                services::agent::identity::init_identity(agent_data_dir.clone()).await;
                tracing::info!("✅ Agent identity system initialized");

                // Initialize Agent skill system
                services::agent::skill::init_skills(agent_data_dir.join("skills")).await;
                tracing::info!("✅ Agent skill system initialized");

                // Initialize Agent skill evolution system
                services::agent::skill_evolution::init_skill_evolution(
                    agent_data_dir.join("skills"),
                )
                .await;
                tracing::info!("✅ Agent skill evolution system initialized");

                // Initialize Agent memory system
                services::agent::memory::init_memory(agent_data_dir.join("memory")).await;
                tracing::info!("✅ Agent memory system initialized");

                // Initialize Agent notification system
                services::agent::notifications::init_notifications();
                tracing::info!("✅ Agent notification system initialized");

                // Initialize MCP (Model Context Protocol) client
                services::agent::mcp::init_mcp(&agent_data_dir.join("mcp_servers.json")).await;
                tracing::info!("✅ MCP client initialized");

                // Initialize Agent task store (DB persistence + recovery)
                services::agent::init_task_store(db.clone()).await;
                tracing::info!("✅ Agent task store initialized");

                // Initialize Agent heartbeat system
                services::agent::heartbeat::init_heartbeat(agent_data_dir.join("HEARTBEAT.md"))
                    .await;
                tracing::info!("✅ Agent heartbeat system initialized");

                // Spawn confirmation cleanup background worker
                tokio::spawn(async {
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
                    loop {
                        interval.tick().await;
                        services::agent::cleanup_expired_confirmations().await;
                    }
                });
                tracing::info!("✅ Agent confirmation cleanup worker started");

                // Spawn heartbeat background worker
                {
                    let heartbeat_db = db.clone();
                    tokio::spawn(async move {
                        // Heartbeat 独立 Semaphore（上限 2，防止风暴）
                        let semaphore = Arc::new(tokio::sync::Semaphore::new(2));
                        let mut interval =
                            tokio::time::interval(std::time::Duration::from_secs(60));

                        loop {
                            interval.tick().await;

                            let hb = match services::agent::heartbeat::get_heartbeat() {
                                Some(hb) => hb,
                                None => continue,
                            };

                            let due_tasks = hb.check_due_tasks().await;
                            for task in due_tasks {
                                let permit = match semaphore.clone().try_acquire_owned() {
                                    Ok(p) => p,
                                    Err(_) => {
                                        tracing::warn!(
                                            "[Heartbeat] Concurrency limit reached, deferring task '{}'",
                                            task.id
                                        );
                                        continue;
                                    }
                                };

                                let task_db = heartbeat_db.clone();
                                let hb_ref = hb.clone();
                                tokio::spawn(async move {
                                    let _permit = permit; // 持有到任务完成
                                    tracing::info!(
                                        task_id = %task.id,
                                        "[Heartbeat] Executing due task: {}",
                                        task.name
                                    );

                                    let request = services::agent::UserRequest {
                                        raw_input: task.action.clone(),
                                        timestamp: chrono::Utc::now(),
                                        user_id: 0, // 系统用户
                                        context: None,
                                    };

                                    let agent = services::agent::Agent::new(task_db).await;
                                    let task_name = task.name.clone();
                                    match agent.process(request).await {
                                        Ok(response) => {
                                            let result_summary = response
                                                .message
                                                .chars()
                                                .take(100)
                                                .collect::<String>();
                                            hb_ref.record_result(&task.id, &result_summary).await;
                                            // 推送通知
                                            if let Some(nm) = services::agent::notifications::get_notification_manager() {
                                                nm.notify_heartbeat_result(&task_name, &result_summary, true).await;
                                            }
                                            tracing::info!(
                                                task_id = %task.id,
                                                "[Heartbeat] Task completed: {}",
                                                result_summary
                                            );
                                        }
                                        Err(e) => {
                                            let err_msg = format!("ERROR: {}", e);
                                            hb_ref.record_result(&task.id, &err_msg).await;
                                            // 推送失败通知
                                            if let Some(nm) = services::agent::notifications::get_notification_manager() {
                                                nm.notify_heartbeat_result(&task_name, &err_msg, false).await;
                                            }
                                            tracing::warn!(
                                                task_id = %task.id,
                                                error = %e,
                                                "[Heartbeat] Task failed"
                                            );
                                        }
                                    }
                                });
                            }
                        }
                    });
                    tracing::info!("✅ Heartbeat background worker started");
                }

                // Spawn skill evolution pruning worker (daily)
                tokio::spawn(async move {
                    // 初始延迟 1 小时，避免启动时负担
                    tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(86400));
                    loop {
                        interval.tick().await;
                        // 清理过期 Skill
                        if let Some(evolution) =
                            services::agent::skill_evolution::get_skill_evolution()
                        {
                            let pruned = evolution.prune_skills().await;
                            if !pruned.is_empty() {
                                tracing::info!(
                                    "[SkillEvolution] Pruned {} low-quality skills: {:?}",
                                    pruned.len(),
                                    pruned
                                );
                            }
                        }
                        // 清理过期记忆日志（保留 30 天）
                        if let Some(mem) = services::agent::memory::get_memory() {
                            mem.cleanup_old_logs(30).await;
                        }
                    }
                });
                tracing::info!("✅ Skill evolution pruning worker started");

                // Initialize Federation delivery worker (MFP Activity delivery queue)
                federation::delivery::spawn_delivery_worker(db.clone());
                tracing::info!("✅ Federation delivery worker started");

                tracing::info!("🌐 Starting in FULL MODE - all features available");
                *DB_CONNECTION.write().await = Some(db);
                CONFIG_MODE.store(false, Ordering::Relaxed);
            }
            Err(e) => {
                tracing::warn!("⚠️  Database connection failed: {}", e);
                tracing::info!("🔧 Starting in CONFIGURATION MODE");
                tracing::info!("📝 Only setup/status/bootstrap auth endpoints are available");
                tracing::info!(
                    "💡 Configure database via POST /api/setup/database-config; the service will restart to load the full route table"
                );
                CONFIG_MODE.store(true, Ordering::Relaxed);
            }
        }
    } else {
        tracing::warn!("⚠️  No database URL configured");
        tracing::info!("🔧 Starting in CONFIGURATION MODE");
        tracing::info!("📝 Only setup/status/bootstrap auth endpoints are available");
        tracing::info!(
            "💡 Configure database via POST /api/setup/database-config; the service will restart to load the full route table"
        );
        CONFIG_MODE.store(true, Ordering::Relaxed);
    }

    // Start the unified server. If this process booted without a DB, setup writes
    // DATABASE_URL and exits so the supervisor can restart with the full route table.
    start_unified_server(config).await
}

/// Middleware to check if route is allowed in configuration mode
async fn config_mode_middleware(req: Request, next: Next) -> Response {
    let path = req.uri().path();

    // Whitelist of paths that are allowed in configuration mode
    let allowed_paths = [
        "/health",
        "/api/setup/config",
        "/api/setup/status",
        "/api/setup/init-env",
        "/api/setup/update-env",
        "/api/setup/database-config", // ✅ 允许配置数据库（有内部认证检查）
        "/api/setup/init-database",
        "/api/setup/create-admin",
        "/api/system/status",
        "/api/auth/login",           // Allow login endpoint
        "/api/auth/me",              // Allow user info endpoint (for login state check)
        "/api/auth/logout",          // Allow logout endpoint
        "/api/auth/change-password", // Allow change password endpoint
        "/api/auth/register",        // PR #4: 公开注册（自身有 allow_local_registration 检查）
        "/api/auth/oauth/providers", // PR #2: 公开列出 OAuth providers
    ];

    // If in config mode and path is not whitelisted, return 503
    if CONFIG_MODE.load(Ordering::Relaxed) && !allowed_paths.iter().any(|p| path.starts_with(p)) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Service in configuration mode",
                "message": "服务器正在配置模式，请先完成数据库配置和初始化",
                "configure_endpoint": "/api/setup/database-config",
                "hint": "After configuration, the service restarts to load the full route table"
            })),
        )
            .into_response();
    }

    next.run(req).await
}

/// Wrapper for check_setup_status that gets DB from global state
async fn check_setup_status_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match api::setup::check_setup_status(axum::extract::State(db.clone())).await {
            Ok(response) => response.into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "Database connection not available. Please configure database first."
            })),
        )
            .into_response(),
    }
}

/// Wrapper for init_database that gets DB from global state
async fn init_database_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match api::setup::init_database(axum::extract::State(db.clone())).await {
            Ok(response) => response.into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "Database connection not available. Please configure database first."
            })),
        )
            .into_response(),
    }
}

/// Wrapper for create_admin that gets DB from global state
async fn create_admin_wrapper(
    Json(payload): Json<api::auth_local::CreateAdminRequest>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            match api::auth_local::create_admin(axum::extract::State(db.clone()), Json(payload))
                .await
            {
                Ok(response) => response.into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "Database connection not available. Please configure database first."
            })),
        )
            .into_response(),
    }
}

/// Wrapper for register that gets DB from global state (PR #4)
async fn register_wrapper(Json(payload): Json<api::auth_local::RegisterRequest>) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            match api::auth_local::register(axum::extract::State(db.clone()), Json(payload)).await {
                Ok(response) => response.into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，请先完成初始配置"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for set_password (PR #4)
async fn set_password_wrapper(
    headers: axum::http::HeaderMap,
    Json(payload): Json<api::auth_local::SetPasswordRequest>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match api::auth_local::set_password(
            axum::extract::State(db.clone()),
            headers,
            Json(payload),
        )
        .await
        {
            Ok(response) => response.into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// PR #6: Wrapper for admin_create_user
async fn admin_create_user_wrapper(
    headers: axum::http::HeaderMap,
    Json(payload): Json<api::auth_local::AdminCreateUserRequest>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match api::auth_local::admin_create_user(
            axum::extract::State(db.clone()),
            headers,
            Json(payload),
        )
        .await
        {
            Ok(response) => response.into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// PR #6: Wrapper for admin_list_users
async fn admin_list_users_wrapper(headers: axum::http::HeaderMap) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            match api::auth_local::admin_list_users(axum::extract::State(db.clone()), headers).await
            {
                Ok(response) => response.into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// Wrapper for toggle_local_login (PR #4)
async fn toggle_local_login_wrapper(
    headers: axum::http::HeaderMap,
    Json(payload): Json<api::auth_local::LocalLoginToggleRequest>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match api::auth_local::toggle_local_login(
            axum::extract::State(db.clone()),
            headers,
            Json(payload),
        )
        .await
        {
            Ok(response) => response.into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// Wrapper for local_login that gets DB from global state
async fn local_login_wrapper(Json(payload): Json<api::auth_local::LocalLoginRequest>) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            match api::auth_local::local_login(axum::extract::State(db.clone()), Json(payload))
                .await
            {
                Ok(response) => response.into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，请先完成初始配置"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for change_password that gets DB from global state
async fn change_password_wrapper(
    headers: axum::http::HeaderMap,
    Json(payload): Json<api::auth_local::ChangePasswordRequest>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            match api::auth_local::change_password(
                axum::extract::State(db.clone()),
                headers,
                Json(payload),
            )
            .await
            {
                Ok(response) => response.into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，请先完成初始配置"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_site_metadata that gets DB from global state
async fn get_site_metadata_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::config::get_site_metadata(axum::extract::State(db.clone())).await;
            (status, json).into_response()
        }
        None => {
            // 返回默认元数据，不需要数据库连接
            (
                StatusCode::OK,
                Json(json!({
                    "site_title": "Myriad - A myriad of lights, in one place.",
                    "site_description": "A myriad of lights, in one place.",
                    "site_favicon": "/favicon.webp"
                })),
            )
                .into_response()
        }
    }
}

/// Wrapper for get_public_config that gets DB from global state
/// 🔓 公开端点 - 返回脱敏的平台配置（仅用于社交链接显示）
async fn get_public_config_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::config::get_public_config(axum::extract::State(db.clone())).await;
            (status, json).into_response()
        }
        None => {
            // 没有数据库连接时返回空配置
            (
                StatusCode::OK,
                Json(json!({
                    "platforms": []
                })),
            )
                .into_response()
        }
    }
}

/// Wrapper for get_public_ui_config that gets DB from global state
/// 🔓 公开端点 - 返回公开的UI配置（萌宠、壁纸等）
async fn get_public_ui_config_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::config::get_public_ui_config(axum::extract::State(db.clone())).await;
            (status, json).into_response()
        }
        None => {
            // 没有数据库连接时返回默认配置
            (
                StatusCode::OK,
                Json(json!({
                    "pet_enabled": true,
                    "pet_image_url": "",
                    "wallpaper_url": "",
                    "wallpaper_blur": 3
                })),
            )
                .into_response()
        }
    }
}

/// Wrapper for get_config that gets DB from global state
async fn get_config_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) = api::config::get_config(axum::extract::State(db.clone())).await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，配置功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for update_config that gets DB from global state
async fn update_config_wrapper(Json(payload): Json<api::config::ConfigResponse>) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::config::update_config(axum::extract::State(db.clone()), Json(payload)).await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，配置功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for update_dashboard_config that gets DB from global state
async fn update_dashboard_config_wrapper(
    Json(payload): Json<api::config::DashboardConfigPayload>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) = api::config::update_dashboard_config(
                axum::extract::State(db.clone()),
                Json(payload),
            )
            .await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，配置功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for update_control_panel_config that gets DB from global state
async fn update_control_panel_config_wrapper(
    Json(payload): Json<api::config::ControlPanelConfigPayload>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) = api::config::update_control_panel_config(
                axum::extract::State(db.clone()),
                Json(payload),
            )
            .await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，配置功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for update_tapp_window_schemes that gets DB from global state
async fn update_tapp_window_schemes_wrapper(
    Json(payload): Json<api::config::TappWindowSchemesPayload>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) = api::config::update_tapp_window_schemes(
                axum::extract::State(db.clone()),
                Json(payload),
            )
            .await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，配置功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_module_visibility_preferences that gets DB from global state
async fn get_module_visibility_preferences_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::config::get_module_visibility_preferences(axum::extract::State(db.clone()))
                    .await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，模块可见性功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for update_module_visibility_preferences that gets DB from global state
async fn update_module_visibility_preferences_wrapper(
    Json(payload): Json<api::config::ModuleVisibilityPreferences>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) = api::config::update_module_visibility_preferences(
                axum::extract::State(db.clone()),
                Json(payload),
            )
            .await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，模块可见性功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_hitokoto_config that gets DB from global state
async fn get_hitokoto_config_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::config::get_hitokoto_config(axum::extract::State(db.clone())).await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，一言配置功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for update_hitokoto_config that gets DB from global state
async fn update_hitokoto_config_wrapper(
    Json(payload): Json<api::config::HitokotoConfig>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) = api::config::update_hitokoto_config(
                axum::extract::State(db.clone()),
                Json(payload),
            )
            .await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，一言配置功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_permissions that gets DB from global state
async fn get_permissions_wrapper(headers: axum::http::HeaderMap) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::config::get_permissions(axum::extract::State(db.clone()), headers).await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，权限功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for update_permissions that gets DB from global state
async fn update_permissions_wrapper(
    Json(payload): Json<api::config::UpdatePermissionsPayload>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::config::update_permissions(axum::extract::State(db.clone()), Json(payload))
                    .await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，权限功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// PR #6: Wrapper for get_oauth_providers (admin)
async fn get_oauth_providers_wrapper() -> Response {
    let (status, json) = api::config::get_oauth_providers().await;
    (status, json).into_response()
}

/// PR #6: Wrapper for update_oauth_providers (admin)
async fn update_oauth_providers_wrapper(
    Json(payload): Json<api::config::UpdateOAuthProvidersPayload>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) = api::config::update_oauth_providers(
                axum::extract::State(db.clone()),
                Json(payload),
            )
            .await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// Wrapper for test_platform that gets DB from global state
async fn test_platform_wrapper(Json(payload): Json<serde_json::Value>) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::config::test_platform(axum::extract::State(db.clone()), Json(payload)).await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，配置功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_current_user that gets DB from global state
async fn get_current_user_wrapper(headers: axum::http::HeaderMap) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            match api::auth::get_current_user(axum::extract::State(db.clone()), headers).await {
                Ok(response) => response.into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，认证功能暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for logout - no auth required, just clear cookie
async fn logout_wrapper() -> Response {
    api::auth::logout().await.into_response()
}

/// Wrapper for OAuth callback that gets DB from global state.
///
/// Keep the route registered even when DB is temporarily unavailable, so the
/// login surface gets a clear 503 instead of a route-table 404.
async fn oauth_provider_callback_wrapper(
    axum::extract::Path(slug): axum::extract::Path<String>,
    axum::extract::Query(params): axum::extract::Query<api::oauth::CallbackQuery>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match api::oauth::provider_callback(
            axum::extract::Path(slug),
            axum::extract::Query(params),
            axum::extract::State(db.clone()),
        )
        .await
        {
            Ok(response) => response,
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，OAuth 回调暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for OAuth identity unlink that gets DB from global state.
async fn oauth_provider_unlink_wrapper(
    axum::extract::Path((slug, identity_id)): axum::extract::Path<(String, i32)>,
    headers: axum::http::HeaderMap,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match api::oauth::provider_unlink(
            axum::extract::Path((slug, identity_id)),
            axum::extract::State(db.clone()),
            headers,
        )
        .await
        {
            Ok(json) => json.into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，OAuth 身份解绑暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for listing the current user's linked OAuth identities.
async fn oauth_list_my_identities_wrapper(headers: axum::http::HeaderMap) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            match api::oauth::list_my_identities(axum::extract::State(db.clone()), headers).await {
                Ok(json) => json.into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，OAuth 身份列表暂不可用"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_user_info that gets DB from global state
async fn get_user_info_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::profile::get_user_info(axum::extract::State(db.clone())).await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_cache_debug_info that gets DB from global state
#[cfg(debug_assertions)]
async fn get_cache_debug_info_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::profile::get_cache_debug_info(axum::extract::State(db.clone())).await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_batch_user_info that gets DB from global state
/// 批量获取用户信息 - 性能优化版本，减少多次API调用
async fn get_batch_user_info_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::profile::get_batch_user_info(axum::extract::State(db.clone())).await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_report that gets DB from global state
async fn get_report_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) = api::profile::get_report(axum::extract::State(db.clone())).await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for list_reports that gets DB from global state
async fn list_reports_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) = api::profile::list_reports(axum::extract::State(db.clone())).await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_raw_metadata that gets DB from global state
async fn get_raw_metadata_wrapper() -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let (status, json) =
                api::profile::get_raw_metadata(axum::extract::State(db.clone())).await;
            (status, json).into_response()
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_latest_report that gets DB from global state
async fn get_latest_report_wrapper(headers: axum::http::HeaderMap) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            match api::reports::get_latest_report(axum::extract::State(db.clone()), headers).await {
                Ok(json) => (StatusCode::OK, json).into_response(),
                Err(status) => {
                    (status, Json(json!({ "error": "Failed to get report" }))).into_response()
                }
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，无法获取报告"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_comprehensive_reports_list that gets DB from global state
async fn get_comprehensive_reports_list_wrapper(headers: axum::http::HeaderMap) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            match api::reports::get_comprehensive_reports_list(
                axum::extract::State(db.clone()),
                headers,
            )
            .await
            {
                Ok(json) => (StatusCode::OK, json).into_response(),
                Err(status) => (
                    status,
                    Json(json!({ "error": "Failed to get comprehensive reports" })),
                )
                    .into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，无法获取综合报告列表"
            })),
        )
            .into_response(),
    }
}

/// Wrapper for get_comprehensive_report_by_id that gets DB from global state
async fn get_comprehensive_report_by_id_wrapper(
    headers: axum::http::HeaderMap,
    axum::extract::Path(report_id): axum::extract::Path<i32>,
) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            match api::reports::get_comprehensive_report_by_id(
                axum::extract::State(db.clone()),
                headers,
                axum::extract::Path(report_id),
            )
            .await
            {
                Ok(json) => (StatusCode::OK, json).into_response(),
                Err(status) => (
                    status,
                    Json(json!({ "error": "Failed to get comprehensive report" })),
                )
                    .into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Database not connected",
                "message": "数据库未连接，无法获取综合报告详情"
            })),
        )
            .into_response(),
    }
}

// ==================== Federation Wrappers ====================

async fn federation_admin_required(claims: &middleware::auth::Claims) -> Option<Response> {
    match middleware::auth::ensure_current_admin(claims).await {
        Ok(()) => None,
        Err((status, body)) => Some((status, body).into_response()),
    }
}

/// GET /api/federation/identity — 获取当前登录用户的联邦地址
async fn federation_identity_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };

    let identity = federation::actor::get_local_identity(&claims.username).await;
    (StatusCode::OK, Json(identity)).into_response()
}

/// POST /api/federation/follow — 关注远程用户
async fn federation_follow_wrapper(req: axum::extract::Request) -> Response {
    let claims = req.extensions().get::<middleware::auth::Claims>().cloned();
    let claims = match claims {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let body_bytes = match axum::body::Bytes::from_request(req, &()).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let payload: federation::follow::FollowRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid JSON"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::follow::follow_remote(user_id, &claims.username, db, &payload.target)
                .await
            {
                Ok(resp) => {
                    (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response()
                }
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// POST /api/federation/unfollow — 取消关注远程用户
async fn federation_unfollow_wrapper(req: axum::extract::Request) -> Response {
    let claims = req.extensions().get::<middleware::auth::Claims>().cloned();
    let claims = match claims {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let body_bytes = match axum::body::Bytes::from_request(req, &()).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let payload: federation::follow::FollowRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid JSON"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::follow::unfollow_remote(
                user_id,
                &claims.username,
                db,
                &payload.target,
            )
            .await
            {
                Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// GET /api/federation/following — 获取我关注的远程用户列表
async fn federation_following_list_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match get_follow_list(db, user_id, "outgoing").await {
                Ok(list) => (StatusCode::OK, Json(list)).into_response(),
                Err(e) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response()
                }
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// GET /api/federation/followers — 获取关注我的远程用户列表
async fn federation_followers_list_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match get_follow_list(db, user_id, "incoming").await {
                Ok(list) => (StatusCode::OK, Json(list)).into_response(),
                Err(e) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response()
                }
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// GET /api/federation/timeline — 获取联邦时间线
async fn federation_timeline_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match get_federation_timeline(db, user_id).await {
                Ok(timeline) => (StatusCode::OK, Json(timeline)).into_response(),
                Err(e) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": e}))).into_response()
                }
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

// ==================== Phase 2: Content Publishing Wrappers ====================

/// POST /api/federation/publish — 发布内容到联邦网络
async fn federation_publish_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let body_bytes = match axum::body::Bytes::from_request(req, &()).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let payload: federation::content::PublishRequest = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid JSON"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::content::publish_content(user_id, &claims.username, db, &payload)
                .await
            {
                Ok(resp) => {
                    (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response()
                }
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// POST /api/federation/unpublish — 取消发布
async fn federation_unpublish_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let body_bytes = match axum::body::Bytes::from_request(req, &()).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let payload: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid JSON"})),
            )
                .into_response()
        }
    };
    let content_type = payload["content_type"].as_str().unwrap_or("");
    let content_id = payload["content_id"].as_str().unwrap_or("");
    if content_type.is_empty() || content_id.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "content_type and content_id required"})),
        )
            .into_response();
    }
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::content::unpublish_content(
                user_id,
                &claims.username,
                db,
                content_type,
                content_id,
            )
            .await
            {
                Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// GET /api/federation/published — 获取已发布内容列表
async fn federation_published_list_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::content::list_published(user_id, db).await {
                Ok(items) => (
                    StatusCode::OK,
                    Json(json!({"items": items, "total": items.len()})),
                )
                    .into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

// ==================== Phase 3: Channel Wrapper Functions ====================

/// 创建 Channel
async fn federation_create_channel_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let body_bytes = match axum::body::Bytes::from_request(req, &()).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let payload: federation::channel::CreateChannelRequest =
        match serde_json::from_slice(&body_bytes) {
            Ok(p) => p,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": format!("Invalid JSON: {}", e)})),
                )
                    .into_response()
            }
        };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::channel::create_channel(user_id, &claims.username, db, &payload).await
            {
                Ok(resp) => {
                    (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response()
                }
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// Channel 列表
async fn federation_list_channels_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::channel::list_channels(user_id, &claims.username, db).await {
                Ok(channels) => (
                    StatusCode::OK,
                    Json(json!({"channels": channels, "total": channels.len()})),
                )
                    .into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// Channel 详情
async fn federation_get_channel_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let channel_id = req
        .uri()
        .path()
        .strip_prefix("/api/federation/channels/")
        .unwrap_or("")
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::channel::get_channel(user_id, &channel_id, db).await {
                Ok(detail) => {
                    (StatusCode::OK, Json(serde_json::to_value(detail).unwrap())).into_response()
                }
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// 关闭 Channel
async fn federation_close_channel_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let channel_id = req
        .uri()
        .path()
        .strip_prefix("/api/federation/channels/")
        .unwrap_or("")
        .strip_suffix("/close")
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::channel::close_channel(user_id, &claims.username, &channel_id, db)
                .await
            {
                Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// 接受 Channel
async fn federation_accept_channel_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let channel_id = req
        .uri()
        .path()
        .strip_prefix("/api/federation/channels/")
        .unwrap_or("")
        .strip_suffix("/accept")
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::channel::accept_channel(user_id, &claims.username, &channel_id, db)
                .await
            {
                Ok(resp) => (StatusCode::OK, Json(resp)).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// 发送消息
async fn federation_send_message_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let channel_id = req
        .uri()
        .path()
        .strip_prefix("/api/federation/channels/")
        .unwrap_or("")
        .strip_suffix("/messages")
        .unwrap_or("")
        .to_string();
    let body_bytes = match axum::body::Bytes::from_request(req, &()).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let payload: federation::channel::SendMessageRequest = match serde_json::from_slice(&body_bytes)
    {
        Ok(p) => p,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": format!("Invalid JSON: {}", e)})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::channel::send_message(
                user_id,
                &claims.username,
                &channel_id,
                db,
                &payload,
            )
            .await
            {
                Ok(resp) => {
                    (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response()
                }
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

/// 获取消息历史
async fn federation_get_messages_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let uri = req.uri().clone();
    let path = uri.path();
    let channel_id = path
        .strip_prefix("/api/federation/channels/")
        .unwrap_or("")
        .strip_suffix("/messages")
        .unwrap_or("")
        .to_string();
    // 解析查询参数
    let query_str = uri.query().unwrap_or("");
    let params: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(query_str.as_bytes())
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
    let before = params.get("before").map(|s| s.as_str());
    let limit = params.get("limit").and_then(|s| s.parse::<i64>().ok());

    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::channel::get_messages(user_id, &channel_id, db, before, limit).await {
                Ok(messages) => (
                    StatusCode::OK,
                    Json(json!({"messages": messages, "total": messages.len()})),
                )
                    .into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

// ==================== Phase 4: Room 多方通信 Wrapper ====================

async fn federation_create_room_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let body = match axum::body::to_bytes(req.into_body(), 1024 * 64).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let parsed: federation::room::CreateRoomRequest = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid JSON"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::create_room(user_id, &claims.username, db, &parsed).await {
                Ok(detail) => (StatusCode::OK, Json(json!(detail))).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_list_rooms_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::list_rooms(user_id, &claims.username, db).await {
                Ok(rooms) => (
                    StatusCode::OK,
                    Json(json!({"rooms": rooms, "total": rooms.len()})),
                )
                    .into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_get_room_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let room_id = path
        .strip_prefix("/api/federation/rooms/")
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::get_room(user_id, &claims.username, &room_id, db).await {
                Ok(detail) => (StatusCode::OK, Json(json!(detail))).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_update_room_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let room_id = path
        .strip_prefix("/api/federation/rooms/")
        .unwrap_or("")
        .to_string();
    let body = match axum::body::to_bytes(req.into_body(), 1024 * 64).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let parsed: federation::room::UpdateRoomRequest = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid JSON"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::update_room(user_id, &claims.username, &room_id, db, &parsed)
                .await
            {
                Ok(detail) => (StatusCode::OK, Json(json!(detail))).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_delete_room_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let room_id = path
        .strip_prefix("/api/federation/rooms/")
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::delete_room(user_id, &claims.username, &room_id, db).await {
                Ok(result) => (StatusCode::OK, Json(result)).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_get_room_members_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let room_id = path
        .strip_prefix("/api/federation/rooms/")
        .unwrap_or("")
        .strip_suffix("/members")
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::get_members(user_id, &claims.username, &room_id, db).await {
                Ok(members) => (
                    StatusCode::OK,
                    Json(json!({"members": members, "total": members.len()})),
                )
                    .into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_invite_room_member_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let room_id = path
        .strip_prefix("/api/federation/rooms/")
        .unwrap_or("")
        .strip_suffix("/invite")
        .unwrap_or("")
        .to_string();
    let body = match axum::body::to_bytes(req.into_body(), 1024 * 64).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let parsed: federation::room::InviteMemberRequest = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid JSON"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::invite_member(user_id, &claims.username, &room_id, db, &parsed)
                .await
            {
                Ok(result) => (StatusCode::OK, Json(result)).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_remove_room_member_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    // /api/federation/rooms/{room_id}/members/{actor} — actor is URL-encoded
    let after_rooms = path.strip_prefix("/api/federation/rooms/").unwrap_or("");
    let parts: Vec<&str> = after_rooms.splitn(2, "/members/").collect();
    let room_id = parts.first().copied().unwrap_or("").to_string();
    let target_actor = parts.get(1).copied().unwrap_or("");
    let target_actor_decoded = urlencoding::decode(target_actor)
        .unwrap_or_default()
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::remove_member(
                user_id,
                &claims.username,
                &room_id,
                &target_actor_decoded,
                db,
            )
            .await
            {
                Ok(result) => (StatusCode::OK, Json(result)).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_leave_room_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let room_id = path
        .strip_prefix("/api/federation/rooms/")
        .unwrap_or("")
        .strip_suffix("/leave")
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::leave_room(user_id, &claims.username, &room_id, db).await {
                Ok(result) => (StatusCode::OK, Json(result)).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_send_room_message_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let room_id = path
        .strip_prefix("/api/federation/rooms/")
        .unwrap_or("")
        .strip_suffix("/messages")
        .unwrap_or("")
        .to_string();
    let body = match axum::body::to_bytes(req.into_body(), 1024 * 64).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let parsed: federation::room::SendRoomMessageRequest = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid JSON"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::send_room_message(
                user_id,
                &claims.username,
                &room_id,
                db,
                &parsed,
            )
            .await
            {
                Ok(resp) => (StatusCode::OK, Json(json!(resp))).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_get_room_messages_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let uri = req.uri().clone();
    let path = uri.path();
    let room_id = path
        .strip_prefix("/api/federation/rooms/")
        .unwrap_or("")
        .strip_suffix("/messages")
        .unwrap_or("")
        .to_string();
    let query_str = uri.query().unwrap_or("");
    let params: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(query_str.as_bytes())
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
    let before = params.get("before").map(|s| s.as_str());
    let limit = params.get("limit").and_then(|s| s.parse::<i64>().ok());
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::get_room_messages(
                user_id,
                &claims.username,
                &room_id,
                db,
                before,
                limit,
            )
            .await
            {
                Ok(messages) => (
                    StatusCode::OK,
                    Json(json!({"messages": messages, "total": messages.len()})),
                )
                    .into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_pin_room_message_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let after_rooms = path.strip_prefix("/api/federation/rooms/").unwrap_or("");
    let parts: Vec<&str> = after_rooms.splitn(2, "/messages/").collect();
    let room_id = parts.first().copied().unwrap_or("").to_string();
    let message_encoded = parts
        .get(1)
        .copied()
        .unwrap_or("")
        .strip_suffix("/pin")
        .unwrap_or("");
    let message_id = urlencoding::decode(message_encoded)
        .unwrap_or_default()
        .to_string();
    let body = match axum::body::to_bytes(req.into_body(), 1024 * 16).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let parsed: federation::room::PinRoomMessageRequest = match serde_json::from_slice(&body) {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid JSON"})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::room::pin_room_message(
                user_id,
                &claims.username,
                &room_id,
                &message_id,
                db,
                &parsed,
            )
            .await
            {
                Ok(result) => (StatusCode::OK, Json(result)).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

// ==================== Phase 5: Ring 去中心化环网 ====================

async fn federation_create_ring_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    if let Some(resp) = federation_admin_required(&claims).await {
        return resp;
    }
    let body = match axum::body::to_bytes(req.into_body(), 65536).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let create_req: federation::ring::CreateRingRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": format!("Invalid JSON: {}", e)})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::ring::create_ring(user_id, db, &create_req).await {
                Ok(ring) => (StatusCode::CREATED, Json(json!(ring))).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_list_rings_wrapper(_req: axum::extract::Request) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::ring::list_rings(db).await {
            Ok(rings) => (
                StatusCode::OK,
                Json(json!({"rings": rings, "total": rings.len()})),
            )
                .into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_get_ring_wrapper(req: axum::extract::Request) -> Response {
    let path = req.uri().path().to_string();
    let ring_id = path
        .strip_prefix("/api/federation/rings/")
        .unwrap_or("")
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::ring::get_ring(&ring_id, db).await {
            Ok(ring) => (StatusCode::OK, Json(json!(ring))).into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_leave_ring_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    if let Some(resp) = federation_admin_required(&claims).await {
        return resp;
    }
    let path = req.uri().path().to_string();
    let ring_id = path
        .strip_prefix("/api/federation/rings/")
        .unwrap_or("")
        .strip_suffix("/leave")
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::ring::leave_ring(&ring_id, &claims.username, db).await {
            Ok(v) => (StatusCode::OK, Json(v)).into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_get_ring_peers_wrapper(req: axum::extract::Request) -> Response {
    let path = req.uri().path().to_string();
    let ring_id = path
        .strip_prefix("/api/federation/rings/")
        .unwrap_or("")
        .strip_suffix("/peers")
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::ring::get_peers(&ring_id, db).await {
            Ok(peers) => (
                StatusCode::OK,
                Json(json!({"peers": peers, "total": peers.len()})),
            )
                .into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_add_ring_peer_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    if let Some(resp) = federation_admin_required(&claims).await {
        return resp;
    }
    let path = req.uri().path().to_string();
    let ring_id = path
        .strip_prefix("/api/federation/rings/")
        .unwrap_or("")
        .strip_suffix("/peers")
        .unwrap_or("")
        .to_string();
    let body = match axum::body::to_bytes(req.into_body(), 65536).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let add_req: federation::ring::AddPeerRequest = match serde_json::from_slice(&body) {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": format!("Invalid JSON: {}", e)})),
            )
                .into_response()
        }
    };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            match federation::ring::add_peer(&ring_id, &claims.username, db, &add_req).await {
                Ok(v) => (StatusCode::OK, Json(v)).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_remove_ring_peer_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    if let Some(resp) = federation_admin_required(&claims).await {
        return resp;
    }
    let path = req.uri().path().to_string();
    let rest = path.strip_prefix("/api/federation/rings/").unwrap_or("");
    let parts: Vec<&str> = rest.splitn(3, '/').collect();
    let ring_id = parts.first().unwrap_or(&"").to_string();
    let peer_encoded = parts.get(2).unwrap_or(&"").to_string();
    let peer_url = urlencoding::decode(&peer_encoded)
        .unwrap_or_default()
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::ring::remove_peer(&ring_id, &peer_url, db).await {
            Ok(v) => (StatusCode::OK, Json(v)).into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_trigger_ring_sync_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    if let Some(resp) = federation_admin_required(&claims).await {
        return resp;
    }
    let path = req.uri().path().to_string();
    let ring_id = path
        .strip_prefix("/api/federation/rings/")
        .unwrap_or("")
        .strip_suffix("/sync")
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::ring::trigger_sync(&ring_id, &claims.username, db).await {
            Ok(v) => (StatusCode::OK, Json(v)).into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

// ==================== Phase 5 补全: Trust 策略管理 ====================

async fn federation_get_trust_policy_wrapper(_req: axum::extract::Request) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::trust::get_policy(db).await {
            Ok(v) => (StatusCode::OK, Json(v)).into_response(),
            Err((status, v)) => (status, Json(v)).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_list_instances_wrapper(_req: axum::extract::Request) -> Response {
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::trust::list_instances(db).await {
            Ok(v) => (StatusCode::OK, Json(v)).into_response(),
            Err((status, v)) => (status, Json(v)).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_update_instance_trust_wrapper(req: axum::extract::Request) -> Response {
    let body = match axum::body::to_bytes(req.into_body(), 65536).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let payload: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid JSON"})),
            )
                .into_response()
        }
    };
    let domain = match payload.get("domain").and_then(|v| v.as_str()) {
        Some(d) => d.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "domain required"})),
            )
                .into_response()
        }
    };
    let level = payload
        .get("trust_level")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i16;
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::trust::update_instance_trust(db, &domain, level).await {
            Ok(v) => (StatusCode::OK, Json(v)).into_response(),
            Err((status, v)) => (status, Json(v)).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_toggle_instance_block_wrapper(req: axum::extract::Request) -> Response {
    let body = match axum::body::to_bytes(req.into_body(), 65536).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let payload: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid JSON"})),
            )
                .into_response()
        }
    };
    let domain = match payload.get("domain").and_then(|v| v.as_str()) {
        Some(d) => d.to_string(),
        None => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "domain required"})),
            )
                .into_response()
        }
    };
    let block = payload
        .get("block")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::trust::toggle_instance_block(db, &domain, block).await {
            Ok(v) => (StatusCode::OK, Json(v)).into_response(),
            Err((status, v)) => (status, Json(v)).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

// ==================== Phase 5 补全: 文件传输 ====================

async fn federation_initiate_transfer_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let channel_id = path
        .strip_prefix("/api/federation/channels/")
        .unwrap_or("")
        .strip_suffix("/transfers")
        .unwrap_or("")
        .to_string();
    let body = match axum::body::to_bytes(req.into_body(), 65536).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let transfer_req: federation::file_transfer::InitTransferRequest =
        match serde_json::from_slice(&body) {
            Ok(r) => r,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": format!("Invalid JSON: {}", e)})),
                )
                    .into_response()
            }
        };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::file_transfer::initiate_transfer(
                user_id,
                &claims.username,
                &channel_id,
                db,
                &transfer_req,
            )
            .await
            {
                Ok(t) => (StatusCode::CREATED, Json(json!(t))).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_list_transfers_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let channel_id = path
        .strip_prefix("/api/federation/channels/")
        .unwrap_or("")
        .strip_suffix("/transfers")
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::file_transfer::list_transfers(
            &channel_id,
            claims.sub.parse().unwrap_or(0),
            db,
        )
        .await
        {
            Ok(transfers) => (
                StatusCode::OK,
                Json(json!({"transfers": transfers, "total": transfers.len()})),
            )
                .into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_get_transfer_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let transfer_id = path
        .strip_prefix("/api/federation/transfers/")
        .unwrap_or("")
        .split('/')
        .next()
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => match federation::file_transfer::get_transfer(
            &transfer_id,
            claims.sub.parse().unwrap_or(0),
            db,
        )
        .await
        {
            Ok(t) => (StatusCode::OK, Json(json!(t))).into_response(),
            Err((status, json)) => (status, json).into_response(),
        },
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_upload_chunk_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let transfer_id = path
        .strip_prefix("/api/federation/transfers/")
        .unwrap_or("")
        .strip_suffix("/chunks")
        .unwrap_or("")
        .to_string();
    let body = match axum::body::to_bytes(req.into_body(), 1048576).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid body"})),
            )
                .into_response()
        }
    };
    let chunk_req: federation::file_transfer::UploadChunkRequest =
        match serde_json::from_slice(&body) {
            Ok(r) => r,
            Err(e) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": format!("Invalid JSON: {}", e)})),
                )
                    .into_response()
            }
        };
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::file_transfer::upload_chunk(
                user_id,
                &claims.username,
                &transfer_id,
                db,
                &chunk_req,
            )
            .await
            {
                Ok(v) => (StatusCode::OK, Json(v)).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn federation_cancel_transfer_wrapper(req: axum::extract::Request) -> Response {
    let claims = match req.extensions().get::<middleware::auth::Claims>().cloned() {
        Some(c) => c,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Not authenticated"})),
            )
                .into_response()
        }
    };
    let path = req.uri().path().to_string();
    let transfer_id = path
        .strip_prefix("/api/federation/transfers/")
        .unwrap_or("")
        .strip_suffix("/cancel")
        .unwrap_or("")
        .to_string();
    let db_opt = DB_CONNECTION.read().await;
    match db_opt.as_ref() {
        Some(db) => {
            let user_id: i32 = claims.sub.parse().unwrap_or(0);
            match federation::file_transfer::cancel_transfer(user_id, &transfer_id, db).await {
                Ok(v) => (StatusCode::OK, Json(v)).into_response(),
                Err((status, json)) => (status, json).into_response(),
            }
        }
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error": "Database not connected"})),
        )
            .into_response(),
    }
}

async fn get_follow_list(
    db: &sea_orm::DatabaseConnection,
    user_id: i32,
    direction: &str,
) -> Result<serde_json::Value, String> {
    use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT ra.actor_url, ra.username, ra.domain, ra.display_name,
                      ra.avatar_url, f.status, f.created_at
               FROM federation_follows f
               JOIN federation_remote_actors ra ON ra.id = f.remote_actor_id
               WHERE f.user_id = $1 AND f.direction = $2
               ORDER BY f.created_at DESC"#,
            [user_id.into(), direction.into()],
        ))
        .await
        .map_err(|e| format!("DB error: {}", e))?;

    let list: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            json!({
                "actor_url": r.try_get::<String>("", "actor_url").unwrap_or_default(),
                "username": r.try_get::<String>("", "username").ok(),
                "domain": r.try_get::<String>("", "domain").unwrap_or_default(),
                "display_name": r.try_get::<String>("", "display_name").ok(),
                "avatar_url": r.try_get::<String>("", "avatar_url").ok(),
                "status": r.try_get::<String>("", "status").unwrap_or_default(),
            })
        })
        .collect();

    Ok(json!({"items": list, "total": list.len()}))
}

/// 查询联邦时间线
async fn get_federation_timeline(
    db: &sea_orm::DatabaseConnection,
    user_id: i32,
) -> Result<serde_json::Value, String> {
    use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT t.activity_id, t.activity_type, t.object_type,
                      t.content_preview, t.content_json, t.is_read, t.received_at,
                      ra.actor_url, ra.username, ra.domain, ra.display_name, ra.avatar_url
               FROM federation_timeline t
               LEFT JOIN federation_remote_actors ra ON ra.id = t.remote_actor_id
               WHERE t.user_id = $1
               ORDER BY t.received_at DESC
               LIMIT 50"#,
            [user_id.into()],
        ))
        .await
        .map_err(|e| format!("DB error: {}", e))?;

    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            json!({
                "activity_id": r.try_get::<String>("", "activity_id").unwrap_or_default(),
                "activity_type": r.try_get::<String>("", "activity_type").ok(),
                "object_type": r.try_get::<String>("", "object_type").ok(),
                "content_preview": r.try_get::<String>("", "content_preview").ok(),
                "is_read": r.try_get::<bool>("", "is_read").unwrap_or(false),
                "actor": {
                    "actor_url": r.try_get::<String>("", "actor_url").ok(),
                    "username": r.try_get::<String>("", "username").ok(),
                    "domain": r.try_get::<String>("", "domain").ok(),
                    "display_name": r.try_get::<String>("", "display_name").ok(),
                    "avatar_url": r.try_get::<String>("", "avatar_url").ok(),
                },
            })
        })
        .collect();

    Ok(json!({"items": items, "total": items.len()}))
}

/// Start unified server with all routes (middleware controls access based on mode)
async fn start_unified_server(config: AppConfig) -> anyhow::Result<()> {
    // Build CORS layer with security-first configuration
    use tower_http::cors::AllowOrigin;

    // Parse allowed origins from config
    let allowed_origins: Vec<axum::http::HeaderValue> = config
        .cors_origins
        .iter()
        .filter_map(|origin| origin.parse().ok())
        .collect();

    let cors = if allowed_origins.is_empty() {
        // Check if in production mode
        let is_production = std::env::var("ENVIRONMENT")
            .unwrap_or_else(|_| "development".to_string())
            == "production";

        if is_production {
            tracing::error!("🚨 SECURITY ERROR: CORS_ORIGINS must be configured in production!");
            tracing::error!("Set CORS_ORIGINS environment variable to your frontend domain(s)");
            tracing::error!(
                "Example: CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com"
            );
            panic!("CORS_ORIGINS is required in production mode for security");
        }

        tracing::warn!("⚠️ No CORS origins configured, using localhost-only for development");
        // Development mode: restrict to localhost
        let dev_origins = vec![
            "http://localhost:1102"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
            "http://localhost:1103"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
            "http://127.0.0.1:1102"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
            "http://127.0.0.1:1103"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
        ];
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(dev_origins))
            .allow_methods([
                axum::http::Method::GET,
                axum::http::Method::POST,
                axum::http::Method::PUT,
                axum::http::Method::DELETE,
                axum::http::Method::OPTIONS,
            ])
            .allow_headers([
                axum::http::header::CONTENT_TYPE,
                axum::http::header::AUTHORIZATION,
                axum::http::header::ACCEPT,
            ])
            .allow_credentials(true)
    } else {
        tracing::info!("✅ CORS configured for origins: {:?}", config.cors_origins);
        CorsLayer::new()
            .allow_origin(AllowOrigin::list(allowed_origins))
            .allow_methods([
                axum::http::Method::GET,
                axum::http::Method::POST,
                axum::http::Method::PUT,
                axum::http::Method::DELETE,
                axum::http::Method::OPTIONS,
            ])
            .allow_headers([
                axum::http::header::CONTENT_TYPE,
                axum::http::header::AUTHORIZATION,
                axum::http::header::ACCEPT,
            ])
            .allow_credentials(true)
    };

    // Get database connection (might be None in config mode)
    let db_opt = DB_CONNECTION.read().await.clone();

    // Build the unified API router. Core setup/auth/config routes are always
    // registered through wrappers. Larger DB route groups are added on full-mode
    // startup, so setup-mode database changes restart the process.
    let api_router = Router::new()
        .route("/health", get(api::health))
        // Setup routes (always available)
        .route("/api/setup/config", get(api::setup::get_setup_config))
        .route("/api/setup/status", get(check_setup_status_wrapper))
        .route("/api/setup/init-env", post(api::setup::initialize_env_file))
        // 添加安全头中间件到所有路由
        .layer(from_fn(middleware::security::security_headers_middleware))
        .route("/api/setup/update-env", post(api::setup::update_env_file))
        .route(
            "/api/setup/database-config",
            post(api::setup::save_database_config),
        )
        .route("/api/setup/init-database", post(init_database_wrapper))
        .route("/api/setup/create-admin", post(create_admin_wrapper))
        // System management routes
        // ⚠️ P2: system/status 暴露了一些系统信息，但为了监控保持公开（考虑移除敏感字段）
        .route("/api/system/status", get(api::system::system_status))
        .route(
            "/api/system/reload-config",
            post(api::system::reload_config)
                // ✅ P1 修复：配置重载应该只有 admin 可以触发
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // ✅ P2: 系统监控指标端点（内存、任务、连接等）- 🔒 需要管理员权限
        .route(
            "/api/metrics",
            get(api::metrics::get_metrics).route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // Authentication routes (use wrapper for dynamic DB access)
        .route("/api/auth/login", post(local_login_wrapper))
        .route("/api/auth/me", get(get_current_user_wrapper))
        .route(
            "/api/auth/logout",
            post(logout_wrapper), // 不需要认证中间件
        )
        // OAuth routes stay registered even if DB is temporarily unavailable,
        // keeping login/setup surfaces on 503 responses instead of 404s.
        .route("/api/auth/oauth/providers", get(api::oauth::list_providers))
        .route(
            "/api/auth/oauth/{slug}/login",
            get(api::oauth::provider_login),
        )
        .route(
            "/api/auth/oauth/{slug}/callback",
            get(oauth_provider_callback_wrapper),
        )
        .route(
            "/api/auth/oauth/{slug}/link",
            get(api::oauth::provider_link).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/auth/oauth/{slug}/unlink/{identity_id}",
            axum::routing::delete(oauth_provider_unlink_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/auth/identities",
            get(oauth_list_my_identities_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/auth/change-password",
            post(change_password_wrapper).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // PR #6: admin 用户管理（GET 列出 / POST 创建）— 仅管理员
        .route(
            "/api/admin/users",
            get(admin_list_users_wrapper)
                .post(admin_create_user_wrapper)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // PR #4: 公开注册（开关受 allow_local_registration 控制） + 后补密码 + 本地登录开关
        .route("/api/auth/register", post(register_wrapper))
        .route(
            "/api/auth/me/set-password",
            post(set_password_wrapper).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/auth/me/local-login",
            axum::routing::patch(toggle_local_login_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // Configuration routes (use wrapper for dynamic DB access) - 🔒 REQUIRE AUTHENTICATION
        .route(
            "/api/config",
            get(get_config_wrapper)
                .post(update_config_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/config/dashboard",
            post(update_dashboard_config_wrapper)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        .route(
            "/api/config/control-panel",
            post(update_control_panel_config_wrapper)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        .route(
            "/api/config/tapp-window-schemes",
            post(update_tapp_window_schemes_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)), // 登录用户可保存
        )
        .route(
            "/api/config/module-visibility",
            get(get_module_visibility_preferences_wrapper),
        )
        .route(
            "/api/config/module-visibility",
            put(update_module_visibility_preferences_wrapper)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // 一言配置 API（公开访问 - 单用户系统）
        .route(
            "/api/config/hitokoto",
            get(get_hitokoto_config_wrapper).put(update_hitokoto_config_wrapper),
        )
        // 权限配置 API
        .route("/api/config/permissions", get(get_permissions_wrapper)) // 🔓 公开端点：获取当前用户权限
        .route(
            "/api/config/permissions",
            post(update_permissions_wrapper)
                .route_layer(from_fn(middleware::auth::admin_middleware)), // 🔒 仅管理员
        )
        // PR #6: OAuth providers + 本地注册开关（仅管理员可读写）
        .route(
            "/api/config/oauth-providers",
            get(get_oauth_providers_wrapper)
                .put(update_oauth_providers_wrapper)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        .route(
            "/api/config/test",
            post(test_platform_wrapper).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route("/api/config/metadata", get(get_site_metadata_wrapper)) // 🔓 公开端点：网站元数据
        .route("/api/config/public", get(get_public_config_wrapper)) // 🔓 公开端点：平台公开信息（用于社交链接）
        .route("/api/config/ui", get(get_public_ui_config_wrapper)) // 🔓 公开端点：UI配置（萌宠、壁纸等）
        // ✅ 安全修复 P0: CSRF Token 获取端点
        .route("/api/csrf-token", get(middleware::csrf::get_csrf_token))
        // AI推荐API - 🔓 公开端点：图标推荐服务
        .route(
            "/api/ai/recommend-icon",
            post(api::ai_recommend::recommend_icon),
        )
        // Profile routes (use wrapper for dynamic DB access) - ALWAYS REGISTERED
        .route("/api/profile/user-info", get(get_user_info_wrapper))
        .route("/api/profile/batch", get(get_batch_user_info_wrapper)); // 🚀 性能优化：批量API

    // 🔧 DEBUG: Cache debug endpoint (only in debug mode)
    #[cfg(debug_assertions)]
    let api_router = api_router.route(
        "/api/profile/cache-debug",
        get(get_cache_debug_info_wrapper),
    );

    #[cfg(not(debug_assertions))]
    let api_router = api_router;

    let mut api_router = api_router
        .route("/api/profile/report", get(get_report_wrapper))
        .route("/api/profile/reports", get(list_reports_wrapper))
        .route("/api/profile/metadata", get(get_raw_metadata_wrapper))
        // ==================== Federation (MFP) 公开端点 ====================
        // Layer 1: 发现（无需认证）
        .route(
            "/.well-known/webfinger",
            get(federation::discovery::webfinger),
        )
        .route(
            "/.well-known/nodeinfo",
            get(federation::discovery::nodeinfo_wellknown),
        )
        .route("/nodeinfo/2.1", get(federation::discovery::nodeinfo))
        // Layer 2: Actor + Outbox + Collections（无需认证，AP 标准端点）
        .route("/users/{username}", get(federation::actor::get_actor))
        .route(
            "/users/{username}/avatar",
            get(federation::actor::get_avatar),
        )
        .nest_service(
            "/api/federation/avatar-cache",
            tower::ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::if_not_present(
                    axum::http::header::CACHE_CONTROL,
                    axum::http::HeaderValue::from_static("public, max-age=604800, immutable"),
                ))
                .service(ServeDir::new(&services::data_paths::paths().cache_images)),
        )
        .route(
            "/users/{username}/outbox",
            get(federation::outbox::get_outbox),
        )
        .route(
            "/users/{username}/followers",
            get(federation::actor::get_followers),
        )
        .route(
            "/users/{username}/following",
            get(federation::actor::get_following),
        )
        // Layer 2: Inbox（远程实例投递，通过 HTTP Signature 验证）
        .route(
            "/users/{username}/inbox",
            post(federation::inbox::post_inbox),
        )
        .route("/inbox", post(federation::inbox::post_shared_inbox))
        // ==================== Federation API（需认证）====================
        .route(
            "/api/federation/identity",
            get(federation_identity_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/follow",
            post(federation_follow_wrapper).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/unfollow",
            post(federation_unfollow_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/following",
            get(federation_following_list_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/followers",
            get(federation_followers_list_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/timeline",
            get(federation_timeline_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // ==================== Phase 2: Content Publishing ====================
        .route(
            "/api/federation/publish",
            post(federation_publish_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/unpublish",
            post(federation_unpublish_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/published",
            get(federation_published_list_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // ==================== Phase 3: Channel 实时通信 ====================
        .route(
            "/api/federation/channels",
            get(federation_list_channels_wrapper)
                .post(federation_create_channel_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/channels/{channel_id}",
            get(federation_get_channel_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/channels/{channel_id}/close",
            post(federation_close_channel_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/channels/{channel_id}/accept",
            post(federation_accept_channel_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/channels/{channel_id}/messages",
            get(federation_get_messages_wrapper)
                .post(federation_send_message_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/channels/{channel_id}/ws",
            get(federation::ws_gateway::channel_websocket)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // ==================== Phase 4: Room 多方通信 ====================
        .route(
            "/api/federation/rooms",
            get(federation_list_rooms_wrapper)
                .post(federation_create_room_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rooms/{room_id}",
            get(federation_get_room_wrapper)
                .put(federation_update_room_wrapper)
                .delete(federation_delete_room_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rooms/{room_id}/members",
            get(federation_get_room_members_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rooms/{room_id}/invite",
            post(federation_invite_room_member_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rooms/{room_id}/members/{actor}",
            delete(federation_remove_room_member_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rooms/{room_id}/leave",
            post(federation_leave_room_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rooms/{room_id}/messages",
            get(federation_get_room_messages_wrapper)
                .post(federation_send_room_message_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rooms/{room_id}/messages/{message_id}/pin",
            post(federation_pin_room_message_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rooms/{room_id}/ws",
            get(federation::ws_gateway::room_websocket)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // ==================== Phase 5: Ring 去中心化环网 ====================
        .route(
            "/api/federation/rings",
            get(federation_list_rings_wrapper)
                .post(federation_create_ring_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rings/{ring_id}",
            get(federation_get_ring_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rings/{ring_id}/leave",
            post(federation_leave_ring_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rings/{ring_id}/peers",
            get(federation_get_ring_peers_wrapper)
                .post(federation_add_ring_peer_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rings/{ring_id}/peers/{peer}",
            delete(federation_remove_ring_peer_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/rings/{ring_id}/sync",
            post(federation_trigger_ring_sync_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // ==================== Phase 5 补全: Trust 策略管理 ====================
        .route(
            "/api/federation/trust/policy",
            get(federation_get_trust_policy_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/trust/instances",
            get(federation_list_instances_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/trust/update",
            post(federation_update_instance_trust_wrapper)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        .route(
            "/api/federation/trust/block",
            post(federation_toggle_instance_block_wrapper)
                .route_layer(from_fn(middleware::auth::admin_middleware)),
        )
        // ==================== Phase 5 补全: 文件传输 ====================
        .route(
            "/api/federation/channels/{channel_id}/transfers",
            get(federation_list_transfers_wrapper)
                .post(federation_initiate_transfer_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/transfers/{transfer_id}",
            get(federation_get_transfer_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/transfers/{transfer_id}/chunks",
            post(federation_upload_chunk_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        .route(
            "/api/federation/transfers/{transfer_id}/cancel",
            post(federation_cancel_transfer_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
        );

    // Add DB-dependent routes if we have a connection
    // These routes require more complex state handling so keep them conditional for now
    if let Some(db) = db_opt {
        let db_router = Router::new()
            // 双层报告系统API - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/reports/platform",
                post(api::reports::generate_platform_reports)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            .route(
                "/api/reports/comprehensive",
                post(api::reports::generate_comprehensive_report)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            .route(
                "/api/reports/generate-all",
                post(api::reports::generate_all_reports)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            // Note: /api/reports/latest, /api/reports/comprehensive/list, /api/reports/comprehensive/{id}
            // are now registered above with wrappers in the main api_router
            .route(
                "/api/reports/comprehensive/{id}/delete",
                delete(api::reports::delete_comprehensive_report)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            // Note: /api/auth/me and /api/auth/logout are now registered above with wrappers
            // Note: /api/config routes are now registered above with wrappers, not here
            // Note: /api/profile/user-info, cache-debug, report, reports, metadata now registered above with wrappers
            .route("/api/platforms", get(api::platforms::list_platforms))
            .route("/api/profiles", get(api::platforms::get_profiles))
            .route(
                "/api/fetch",
                post(api::platforms::trigger_fetch)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/analysis",
                get(api::analysis::get_analysis)
                    .post(api::analysis::trigger_analysis)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // Prompt generation - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/prompt/generate",
                post(api::prompt::generate_prompt)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // 后台任务管理 API - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/tasks",
                post(api::tasks::submit_task)
                    .get(api::tasks::list_tasks)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tasks/{task_id}",
                get(api::tasks::get_task_status)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tasks/platform/{platform}",
                get(api::tasks::get_platform_task)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // 缓存管理 API - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/cache/status",
                get(api::cache::get_cache_status)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/cache/status/{platform}",
                get(api::cache::get_platform_cache_status)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/cache/{platform}",
                delete(api::cache::clear_platform_cache)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            .route(
                "/api/cache/clear",
                post(api::cache::clear_caches)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            .route(
                "/api/cache/all",
                delete(api::cache::clear_all_caches)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            // Profile report routes (complex ones still conditional) - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/profile/fetch-all",
                post(api::profile::fetch_all_data)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/profile/fetch-platform",
                post(api::profile::fetch_single_platform_data)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/profile/refresh",
                post(api::profile::refresh_platform_data)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/profile/report",
                post(api::profile::generate_report)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            .route(
                "/api/profile/reports/{id}",
                get(api::profile::get_report_by_id)
                    .delete(api::profile::delete_report_by_id)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/profile/reports/{id}/cards",
                delete(api::profile::delete_card_from_report)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/profile/reports/all",
                delete(api::profile::delete_all_reports)
                    .route_layer(from_fn(middleware::auth::admin_middleware)),
            )
            .route(
                "/api/profile/cache",
                delete(api::profile::delete_platform_cache)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // Library data route (公开访问 - 单用户系统)
            .route("/api/library", get(api::profile::get_library_data))
            .route(
                "/api/library/preferences",
                get(api::profile::get_library_source_preferences)
                    .put(api::profile::update_library_source_preferences),
            )
            // Recent activities route (公开访问 - 单用户系统)
            .route("/api/activities", get(api::profile::get_recent_activities))
            // Reports routes (读取端点公开访问，支持未认证用户)
            .route("/api/reports/latest", get(get_latest_report_wrapper))
            .route(
                "/api/reports/list",
                get(api::tapp_runtime::list_reports)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/reports/comprehensive/list",
                get(get_comprehensive_reports_list_wrapper),
            )
            .route(
                "/api/reports/comprehensive/{id}",
                get(get_comprehensive_report_by_id_wrapper),
            )
            // ============ Tapp 应用管理 API ============
            // 部分公开访问（游客可查看管理员的 Tapp），部分需要认证（在路由内部处理）
            .nest("/api/tapps", api::tapp_store::create_tapp_routes())
            // ============ Agent AI 任务编排 API ============
            // 自然语言任务分解、执行和监控
            .nest("/api/agent", api::agent::create_agent_routes())
            // ============ Brew 阅读 API ============
            // RSS/Atom 订阅管理、文章获取、阅读状态同步
            .nest("/api/brew", api::brew::create_brew_routes())
            // ============ Brewlia AI 增强 API ============
            // AI 词汇注释、内容摘要等增强阅读功能
            .nest("/api/brewlia", api::brewlia::create_brewlia_routes())
            // ============ 语音服务 API ============
            // 腾讯云 TTS 文本转语音、ASR 语音转文本
            .nest("/api/speech", api::speech::create_speech_routes())
            // ============ Tapp API ============
            // Platform data API - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/tapp/platform/{platform}/data",
                get(api::tapp_runtime::get_platform_data)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/platform/{platform}/stats",
                get(api::tapp_runtime::get_platform_stats)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/platform/{platform}/distribution/{dimension}",
                get(api::tapp_runtime::get_platform_distribution)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/platform/items",
                post(api::tapp_runtime::add_platform_item)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/platform/items/batch",
                post(api::tapp_runtime::add_platform_items_batch)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // AI API - � 支持权限下放（使用 optional_auth）
            .route(
                "/api/tapp/ai/generate",
                post(api::tapp_runtime::ai_generate)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/ai/analyze",
                post(api::tapp_runtime::ai_analyze)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/ai/image",
                post(api::tapp_runtime::ai_image_generate)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/ai/image/status",
                post(api::tapp_runtime::ai_image_task_status)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // ============ Tapp P0 扩展 API ============
            // Data Processing - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/tapp/data/transform",
                post(api::tapp_runtime::data_transform)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // Context API - 🔓 支持权限下放（公开信息）
            .route(
                "/api/tapp/context/app",
                get(api::tapp_runtime::get_context_app)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/context/user",
                get(api::tapp_runtime::get_context_user)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/context/player",
                get(api::tapp_runtime::get_context_player)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/context/navigation",
                get(api::tapp_runtime::get_context_navigation)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/context/system",
                get(api::tapp_runtime::get_context_system)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // ============ Tapp P1 扩展 API ============
            // AI Chat - 🔓 支持权限下放
            .route(
                "/api/tapp/ai/chat",
                post(api::tapp_runtime::ai_chat)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // Report CRUD - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/tapp/reports",
                post(api::tapp_runtime::create_report)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/reports/tapp/{tapp_id}",
                get(api::tapp_runtime::list_tapp_reports)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/reports/{tapp_id}/{report_id}",
                get(api::tapp_runtime::get_tapp_report)
                    .put(api::tapp_runtime::update_tapp_report)
                    .delete(api::tapp_runtime::delete_tapp_report)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // Media Control - 🔓 支持权限下放
            .route(
                "/api/tapp/media/control",
                post(api::tapp_runtime::media_control)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            .route(
                "/api/tapp/media/status",
                get(api::tapp_runtime::media_status)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // P2: Component Registration
            .route(
                "/api/tapp/components/register",
                post(api::tapp_runtime::register_component)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/components/{tapp_id}/{component_type}/{component_id}",
                delete(api::tapp_runtime::unregister_component)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/components/{tapp_id}",
                get(api::tapp_runtime::list_components)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/components/all/{component_type}",
                get(api::tapp_runtime::list_all_components_by_type)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // P2: Shortcut Registration
            .route(
                "/api/tapp/shortcuts/register",
                post(api::tapp_runtime::register_shortcut)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/shortcuts/{tapp_id}/{shortcut_id}",
                delete(api::tapp_runtime::unregister_shortcut)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/shortcuts",
                get(api::tapp_runtime::list_shortcuts)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // P2: Event Bus
            .route(
                "/api/tapp/events/publish",
                post(api::tapp_runtime::publish_event)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/events/subscriptions/{tapp_id}",
                get(api::tapp_runtime::get_event_subscriptions)
                    .put(api::tapp_runtime::update_event_subscriptions)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // Metrics & Rate Limit
            .route(
                "/api/tapp/metrics",
                get(api::tapp_runtime::get_tapp_metrics)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/metrics/reset",
                post(api::tapp_runtime::reset_tapp_metrics)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/rate-limit/{tapp_id}",
                get(api::tapp_runtime::get_rate_limit_status)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // ============ Tapp 定时任务 API ============
            // Scheduler - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/tapp/scheduler/tasks",
                get(api::tapp_scheduler::list_tasks)
                    .post(api::tapp_scheduler::register_task)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/scheduler/{tapp_id}/tasks",
                get(api::tapp_scheduler::list_tapp_tasks)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/scheduler/{tapp_id}/tasks/{task_id}",
                get(api::tapp_scheduler::get_task)
                    .delete(api::tapp_scheduler::unregister_task)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/scheduler/{tapp_id}/tasks/{task_id}/enable",
                post(api::tapp_scheduler::enable_task)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/scheduler/{tapp_id}/tasks/{task_id}/disable",
                post(api::tapp_scheduler::disable_task)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/scheduler/{tapp_id}/tasks/{task_id}/trigger",
                post(api::tapp_scheduler::trigger_task)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/tapp/scheduler/ws",
                get(api::tapp_scheduler::scheduler_websocket)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // ============ Tapp API 声明系统 ============
            // API Execute - 支持 public 和 protected 两级权限
            .route(
                "/api/tapp/{tapp_id}/api/{api_name}",
                post(api::tapp_runtime::execute_tapp_api)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // API List - 列出 Tapp 可用的 API
            .route(
                "/api/tapp/{tapp_id}/apis",
                get(api::tapp_runtime::list_tapp_apis)
                    .route_layer(from_fn(middleware::auth::optional_auth_middleware)),
            )
            // Context Geo - 公开 API，获取客户端地理位置
            .route(
                "/api/tapp/context/geo",
                get(api::tapp_runtime::get_context_geo),
            )
            // Image proxy route
            .route("/api/proxy/image", get(api::proxy::proxy_image))
            // Client geo location route
            .route("/api/proxy/client-geo", get(api::proxy::get_client_geo))
            // Hitokoto proxy route
            .route("/api/proxy/hitokoto", get(api::proxy::proxy_hitokoto))
            // Web content fetch proxy (for reading list from web search)
            .route(
                "/api/proxy/fetch-content",
                get(api::proxy::fetch_web_content),
            )
            // Music proxy routes
            .route(
                "/api/proxy/music/netease/playlist/{id}",
                get(api::proxy::proxy_netease_playlist),
            )
            .route(
                "/api/proxy/music/netease/lyrics/{id}",
                get(api::proxy::proxy_netease_lyrics),
            )
            .route(
                "/api/proxy/music/netease/lyrics-verbatim/{id}",
                get(api::proxy::proxy_netease_lyrics_verbatim),
            )
            .route(
                "/api/proxy/music/netease/song/{id}",
                get(api::proxy::proxy_netease_song),
            )
            .route(
                "/api/proxy/music/netease/audio/{id}",
                get(api::proxy::proxy_netease_audio),
            )
            .route(
                "/api/proxy/music/qq/playlist/{id}",
                get(api::proxy::proxy_qq_playlist),
            )
            .route(
                "/api/proxy/music/qq/lyrics/{id}",
                get(api::proxy::proxy_qq_lyrics),
            )
            .route(
                "/api/proxy/music/kugou/lyrics-verbatim",
                get(api::proxy::proxy_kugou_lyrics_verbatim),
            )
            // Bilibili API routes
            .route("/api/bilibili/user", get(api::bilibili::get_bilibili_user))
            .route(
                "/api/bilibili/user/{uid}",
                get(api::bilibili::get_bilibili_user_info),
            )
            .route(
                "/api/bilibili/favorites/{uid}",
                get(api::bilibili::get_bilibili_favorites),
            )
            .route(
                "/api/bilibili/bangumi/{uid}",
                get(api::bilibili::get_bilibili_bangumi),
            )
            .route(
                "/api/bilibili/bangumi/all/{uid}",
                get(api::bilibili::get_all_bilibili_bangumi),
            )
            // Bangumi API routes
            .route("/api/bangumi/user", get(api::bangumi::get_bangumi_user))
            .route(
                "/api/bangumi/user/{username}",
                get(api::bangumi::get_bangumi_user_info),
            )
            .route("/api/bangumi/me", get(api::bangumi::get_bangumi_me))
            .route(
                "/api/bangumi/collections/{username}",
                get(api::bangumi::get_bangumi_collections),
            )
            // Steam API routes
            .route("/api/steam/presence", get(api::steam::get_steam_presence))
            .route("/api/steam/user", get(api::steam::get_steam_user))
            .route("/api/steam/user/info", get(api::steam::get_steam_user_info))
            .route("/api/steam/games", get(api::steam::get_steam_games))
            .route(
                "/api/steam/wishlist/{steam_id}",
                get(api::steam::get_steam_wishlist),
            )
            .route("/api/steam/stats", get(api::steam::get_steam_stats))
            .route(
                "/api/steam/game/{app_id}",
                get(api::steam::get_steam_game_details),
            )
            .with_state(db);

        // Merge with base router
        api_router = api_router.merge(db_router);
    }

    // 🚀 Updater admin proxy routes (admin-only). Backend forwards to the updater container
    // and injects UPDATE_TOKEN server-side, so the browser never sees the secret.
    // See docs/updater-spec.md §13.
    {
        use middleware::auth::admin_middleware;
        api_router = api_router
            .route(
                "/api/admin/updater/status",
                get(api::updater_admin::status).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/available",
                get(api::updater_admin::available).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/jobs",
                get(api::updater_admin::jobs).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/jobs/{id}",
                get(api::updater_admin::job).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/snapshots",
                get(api::updater_admin::snapshots).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/update",
                post(api::updater_admin::trigger_update).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/rollback",
                post(api::updater_admin::rollback).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/diagnostics",
                get(api::updater_admin::diagnostics).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/rescue/exit-maintenance",
                post(api::updater_admin::exit_maintenance).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/rescue/forget-current",
                post(api::updater_admin::forget_current).route_layer(from_fn(admin_middleware)),
            )
            .route(
                "/api/admin/updater/self-update",
                post(api::updater_admin::self_update).route_layer(from_fn(admin_middleware)),
            );
    }

    // Apply middleware and layers
    let api_router = api_router
        .layer(from_fn(config_mode_middleware))
        .layer(from_fn(middleware::csrf::csrf_middleware)) // ✅ 安全修复 P0: CSRF 防护
        .layer(from_fn(middleware::rate_limit::rate_limit_middleware)) // Rate limiting
        .layer(axum::extract::DefaultBodyLimit::max(50 * 1024 * 1024)) // 🛡️ 防止OOM: 限制请求体最大50MB
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // Now the type is unified, convert to Router<()> by applying route matching
    let app: Router = if std::path::Path::new(&config.frontend_dist_path).exists() {
        tracing::info!("Serving frontend from: {}", config.frontend_dist_path);
        // SPA fallback: 任何 ServeDir 未匹配到的路径都返回 index.html，让 React Router 接管
        // 否则像 /register、/tapp/run/xxx 这类客户端路由会被静态文件服务直接 404。
        let index_html = std::path::Path::new(&config.frontend_dist_path).join("index.html");
        let serve_dir =
            ServeDir::new(&config.frontend_dist_path).not_found_service(ServeFile::new(index_html));
        api_router.fallback_service(serve_dir)
    } else {
        tracing::warn!("Frontend dist path not found, serving API only");
        api_router
    };

    // Spawn background task to clean up old tasks (防止内存泄漏)
    tokio::spawn(async {
        let mut cleanup_interval = tokio::time::interval(tokio::time::Duration::from_secs(300)); // 每5分钟
        loop {
            cleanup_interval.tick().await;
            services::background_processor::BACKGROUND_PROCESSOR
                .cleanup_old_tasks()
                .await;
            tracing::info!("🧹 Background task cleanup completed");
        }
    });

    // Spawn background task to monitor for config reload
    tokio::spawn(async move {
        let mut check_interval = tokio::time::interval(tokio::time::Duration::from_secs(2));
        loop {
            check_interval.tick().await;

            if api::system::is_config_reload_requested() {
                tracing::info!(
                    "🔄 Configuration reload detected - attempting to reconnect database"
                );
                api::system::reset_config_reload_flag();

                // Reload .env file with override to ensure latest values
                let env_path = std::path::PathBuf::from(".env");
                if let Err(e) = dotenvy::from_path_override(&env_path) {
                    tracing::warn!("⚠️ Failed to reload .env file: {}", e);
                } else {
                    tracing::info!("♻️ Environment variables reloaded from .env");
                }

                match AppConfig::from_env() {
                    Ok(new_config) => {
                        // Update global config FIRST for hot-reload
                        *GLOBAL_CONFIG.write().await = new_config.clone();
                        tracing::info!(
                            "♻️ Global configuration updated - AI API settings now live!"
                        );

                        if !new_config.database_url.is_empty() {
                            match db::connection::establish_connection(&new_config.database_url)
                                .await
                            {
                                Ok(db) => {
                                    tracing::info!("✅ Database connection established!");

                                    // Update global database connection
                                    *DB_CONNECTION.write().await = Some(db.clone());

                                    // Reload dynamic configuration from database
                                    let config_service = ConfigService::new(db);
                                    match config_service.load_config().await {
                                        Ok(dynamic_config) => {
                                            *GLOBAL_DYNAMIC_CONFIG.write().await = dynamic_config;
                                            tracing::info!(
                                                "✅ Dynamic configuration reloaded from database"
                                            );
                                        }
                                        Err(e) => {
                                            tracing::warn!(
                                                "⚠️  Failed to reload dynamic config: {}",
                                                e
                                            );
                                        }
                                    }

                                    // 🔐 Reload OAuth provider registry from new dynamic config
                                    services::oauth::registry::REGISTRY.reload().await;

                                    // Switch to full mode FIRST before logging
                                    CONFIG_MODE.store(false, Ordering::Relaxed);

                                    tracing::info!(
                                        "🎉 Switched from CONFIGURATION MODE to FULL MODE"
                                    );
                                    tracing::info!("✨ All API endpoints are now available!");
                                    tracing::info!(
                                        "🔓 Login endpoint is now accessible at /api/auth/login"
                                    );
                                }
                                Err(e) => {
                                    tracing::error!(
                                        "❌ Database connection failed after reload: {}",
                                        e
                                    );
                                    tracing::info!("🔧 Staying in configuration mode");
                                }
                            }
                        } else {
                            tracing::warn!("⚠️  DATABASE_URL still empty after reload");
                        }
                    }
                    Err(e) => {
                        tracing::error!("❌ Failed to reload configuration: {}", e);
                    }
                }
            }
        }
    });

    // Spawn database health check task (P1优化：定期健康检查和自动重连)
    tokio::spawn(async {
        let mut health_check_interval = tokio::time::interval(tokio::time::Duration::from_secs(60)); // 每分钟检查一次
        loop {
            health_check_interval.tick().await;

            let db_opt = DB_CONNECTION.read().await;
            if let Some(db) = db_opt.as_ref() {
                // 执行简单查询测试连接
                match db
                    .execute(sea_orm::Statement::from_string(
                        sea_orm::DatabaseBackend::Postgres,
                        "SELECT 1".to_owned(),
                    ))
                    .await
                {
                    Ok(_) => {
                        tracing::debug!("💚 Database health check passed");
                    }
                    Err(e) => {
                        tracing::error!("❌ Database health check failed: {}", e);

                        // 尝试重新连接
                        drop(db_opt); // 释放读锁

                        let config = GLOBAL_CONFIG.read().await;
                        if !config.database_url.is_empty() {
                            tracing::info!("🔄 Attempting to reconnect to database...");
                            match crate::db::connection::establish_connection(&config.database_url)
                                .await
                            {
                                Ok(new_db) => {
                                    *DB_CONNECTION.write().await = Some(new_db);
                                    tracing::info!("✅ Database reconnected successfully");
                                }
                                Err(e) => {
                                    tracing::error!("❌ Failed to reconnect to database: {}", e);
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    // Start server with the app (convert to service within start_server)
    start_server(config, app).await
}

/// Common server startup logic
async fn start_server(config: AppConfig, app: Router) -> anyhow::Result<()> {
    let host = config
        .server_host
        .parse::<std::net::IpAddr>()
        .unwrap_or_else(|_| std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));
    let addr = SocketAddr::new(host, config.server_port);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("🚀 Server listening on http://{}", addr);

    // Use graceful shutdown with ConnectInfo support
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

async fn shutdown_signal() {
    use tokio::signal;

    let ctrl_c = async {
        signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };

    #[cfg(unix)]
    let terminate = async {
        signal::unix::signal(signal::unix::SignalKind::terminate())
            .expect("failed to install signal handler")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {
            tracing::info!("Received Ctrl+C signal");
        },
        _ = terminate => {
            tracing::info!("Received terminate signal");
        },
    }

    tracing::info!("Starting graceful shutdown...");

    // 停止调度器引擎
    api::tapp_scheduler::shutdown_scheduler().await;
    services::brew_scheduler::shutdown_brew_scheduler().await;
}
