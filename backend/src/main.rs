use axum::{
    extract::Request,
    http::StatusCode,
    middleware::{from_fn, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde_json::json;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod config;
mod db;
mod middleware;
mod models;
mod oauth_url_builder;
mod services;

use config::{AppConfig, DynamicConfig};
use services::config_service::ConfigService;
use std::sync::atomic::{AtomicBool, Ordering};

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
    // Initialize tracing
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "myriad_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("🚀 Starting Myriad Backend v{}", env!("CARGO_PKG_VERSION"));

    run_server().await?;

    tracing::info!("👋 Backend shutdown complete");
    Ok(())
}

async fn run_server() -> anyhow::Result<()> {
    // Load configuration
    dotenvy::dotenv().ok();
    let config = AppConfig::from_env()?;

    // Initialize global config
    *GLOBAL_CONFIG.write().await = config.clone();
    tracing::info!("✅ Configuration loaded and cached globally");

    // Validate OAuth configuration
    use oauth_url_builder::OAuthUrlBuilder;
    if let Err(e) = OAuthUrlBuilder::validate_github_oauth_config() {
        tracing::warn!("⚠️  GitHub OAuth validation warning: {}", e);
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

                // Load dynamic configuration from database
                let config_service = ConfigService::new(db.clone());

                // Migrate environment variables to database if not already present
                match config_service.migrate_from_env().await {
                    Ok(_) => {
                        tracing::info!("✅ Environment variables synced to database");
                    }
                    Err(e) => {
                        tracing::warn!("⚠️  Failed to migrate env to database: {}", e);
                    }
                }

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

                tracing::info!("🌐 Starting in FULL MODE - all features available");
                *DB_CONNECTION.write().await = Some(db);
                CONFIG_MODE.store(false, Ordering::Relaxed);
            }
            Err(e) => {
                tracing::warn!("⚠️  Database connection failed: {}", e);
                tracing::info!("🔧 Starting in CONFIGURATION MODE");
                tracing::info!("📝 Only setup and configuration endpoints are available");
                tracing::info!("💡 Configure database via: POST /api/setup/database-config");
                CONFIG_MODE.store(true, Ordering::Relaxed);
            }
        }
    } else {
        tracing::warn!("⚠️  No database URL configured");
        tracing::info!("🔧 Starting in CONFIGURATION MODE");
        tracing::info!("📝 Only setup and configuration endpoints are available");
        tracing::info!("💡 Configure database via: POST /api/setup/database-config");
        CONFIG_MODE.store(true, Ordering::Relaxed);
    }

    // Start unified server with all routes (middleware will block based on CONFIG_MODE)
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
        // ✅ P0 安全修复：移除 database-config 从白名单
        // 原因：这个端点太危险，必须由函数内部的 CONFIG_MODE 检查保护
        // 如果在白名单中，任何人都可以在 CONFIG_MODE 时修改数据库配置
        // "/api/setup/database-config",  // ❌ 已移除 - 使用内部检查
        "/api/setup/init-database",
        "/api/setup/create-admin",
        "/api/system/status",
        "/api/system/reload-config",
        "/api/auth/login",           // Allow login endpoint
        "/api/auth/me",              // Allow user info endpoint (for login state check)
        "/api/auth/logout",          // Allow logout endpoint
        "/api/auth/change-password", // Allow change password endpoint
    ];

    // If in config mode and path is not whitelisted, return 503
    if CONFIG_MODE.load(Ordering::Relaxed) && !allowed_paths.iter().any(|p| path.starts_with(p)) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Service in configuration mode",
                "message": "服务器正在配置模式，请先完成数据库配置和初始化",
                "configure_endpoint": "/api/setup/database-config",
                "hint": "After configuration, the service will automatically reload"
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
                    "site_title": "Myriad - 数字自我发现",
                    "site_description": "一键聚合你的多平台数据，生成AI个人分析报告",
                    "site_favicon": "/favicon.svg"
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
                    "persona_image_enabled": true,
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
            "http://localhost:4321"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
            "http://localhost:3000"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
            "http://127.0.0.1:4321"
                .parse::<axum::http::HeaderValue>()
                .unwrap(),
            "http://127.0.0.1:3000"
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

    // Build unified API router with all routes
    // All routes are registered, but DB-dependent routes use wrappers
    // that dynamically fetch DB connection from global state
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
        // Authentication routes (use wrapper for dynamic DB access)
        .route("/api/auth/login", post(local_login_wrapper))
        .route("/api/auth/me", get(get_current_user_wrapper))
        .route(
            "/api/auth/logout",
            post(logout_wrapper), // 不需要认证中间件
        )
        .route(
            "/api/auth/change-password",
            post(change_password_wrapper).route_layer(from_fn(middleware::auth::auth_middleware)),
        )
        // Configuration routes (use wrapper for dynamic DB access) - 🔒 REQUIRE AUTHENTICATION
        .route(
            "/api/config",
            get(get_config_wrapper)
                .post(update_config_wrapper)
                .route_layer(from_fn(middleware::auth::auth_middleware)),
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
        .route("/api/profile/metadata", get(get_raw_metadata_wrapper));

    // Add DB-dependent routes if we have a connection
    // These routes require more complex state handling so keep them conditional for now
    if let Some(db) = db_opt {
        let db_router = Router::new()
            .route("/api/auth/github/login", get(api::auth::github_login))
            .route("/api/auth/github/callback", get(api::auth::github_callback))
            .route(
                "/api/auth/github/link",
                get(api::auth::github_link).route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/auth/link-github",
                post(api::auth::link_github_account)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
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
            // Virtual persona routes - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/persona/generate",
                post(api::persona::generate_persona)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/persona/generate-image",
                post(api::persona::generate_image)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route("/api/persona/list", get(api::persona::get_persona_list))
            .route(
                "/api/persona/delete",
                post(api::persona::delete_persona)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            // Profile report routes (complex ones still conditional) - 🔒 REQUIRE AUTHENTICATION
            .route(
                "/api/profile/fetch-all",
                post(api::profile::fetch_all_data)
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
                "/api/profile/reports/:id",
                get(api::profile::get_report_by_id)
                    .delete(api::profile::delete_report_by_id)
                    .route_layer(from_fn(middleware::auth::auth_middleware)),
            )
            .route(
                "/api/profile/reports/:id/cards",
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
            // Library data route
            .route("/api/library", get(api::profile::get_library_data))
            // Image proxy route
            .route("/api/proxy/image", get(api::proxy::proxy_image))
            // Client geo location route
            .route("/api/proxy/client-geo", get(api::proxy::get_client_geo))
            // Music proxy routes
            .route(
                "/api/proxy/music/netease/playlist/:id",
                get(api::proxy::proxy_netease_playlist),
            )
            .route(
                "/api/proxy/music/netease/lyrics/:id",
                get(api::proxy::proxy_netease_lyrics),
            )
            .route(
                "/api/proxy/music/netease/audio/:id",
                get(api::proxy::proxy_netease_audio),
            )
            .route(
                "/api/proxy/music/qq/playlist/:id",
                get(api::proxy::proxy_qq_playlist),
            )
            .route(
                "/api/proxy/music/qq/lyrics/:id",
                get(api::proxy::proxy_qq_lyrics),
            )
            // Bilibili API routes
            .route("/api/bilibili/user", get(api::bilibili::get_bilibili_user))
            .route(
                "/api/bilibili/user/:uid",
                get(api::bilibili::get_bilibili_user_info),
            )
            .route(
                "/api/bilibili/favorites/:uid",
                get(api::bilibili::get_bilibili_favorites),
            )
            .route(
                "/api/bilibili/bangumi/:uid",
                get(api::bilibili::get_bilibili_bangumi),
            )
            .route(
                "/api/bilibili/bangumi/all/:uid",
                get(api::bilibili::get_all_bilibili_bangumi),
            )
            // Steam API routes
            .route("/api/steam/user", get(api::steam::get_steam_user))
            .route("/api/steam/user/info", get(api::steam::get_steam_user_info))
            .route("/api/steam/games", get(api::steam::get_steam_games))
            .route(
                "/api/steam/wishlist/:steam_id",
                get(api::steam::get_steam_wishlist),
            )
            .route("/api/steam/stats", get(api::steam::get_steam_stats))
            .with_state(db);

        // Merge with base router
        api_router = api_router.merge(db_router);
    }

    // Apply middleware and layers
    let api_router = api_router
        .layer(from_fn(config_mode_middleware))
        .layer(from_fn(middleware::csrf::csrf_middleware)) // ✅ 安全修复 P0: CSRF 防护
        .layer(from_fn(middleware::rate_limit::rate_limit_middleware)) // Rate limiting
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // Now the type is unified, convert to Router<()> by applying route matching
    let app: Router = if std::path::Path::new(&config.frontend_dist_path).exists() {
        tracing::info!("Serving frontend from: {}", config.frontend_dist_path);
        api_router.fallback_service(ServeDir::new(&config.frontend_dist_path))
    } else {
        tracing::warn!("Frontend dist path not found, serving API only");
        api_router
    };

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
                                    *DB_CONNECTION.write().await = Some(db);

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
    tracing::info!("🚀 Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;

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
}
