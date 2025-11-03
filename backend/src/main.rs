use axum::{
    routing::{delete, get, post},
    Router,
};
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod api;
mod config;
mod db;
mod error;
mod models;
mod services;

use config::AppConfig;

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

    // Load configuration
    dotenvy::dotenv().ok();
    let config = AppConfig::from_env()?;

    // Initialize database connection
    let db = db::connection::establish_connection(&config.database_url).await?;

    tracing::info!("Database connection established");

    // Build CORS layer
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Build API router
    let api_router = Router::new()
        .route("/health", get(api::health))
        // Authentication routes
        .route("/api/auth/github/login", get(api::auth::github_login))
        .route("/api/auth/github/callback", get(api::auth::github_callback))
        .route("/api/auth/me", get(api::auth::get_current_user))
        .route("/api/auth/logout", post(api::auth::logout))
        // Configuration routes
        .route(
            "/api/config",
            get(api::config::get_config).post(api::config::update_config),
        )
        .route("/api/config/test", post(api::config::test_platform))
        .route("/api/platforms", get(api::platforms::list_platforms))
        .route("/api/profiles", get(api::platforms::get_profiles))
        .route("/api/fetch", post(api::platforms::trigger_fetch))
        .route(
            "/api/analysis",
            get(api::analysis::get_analysis).post(api::analysis::trigger_analysis),
        )
        // Prompt generation for image AI
        .route("/api/prompt/generate", post(api::prompt::generate_prompt))
        // Profile report routes
        .route("/api/profile/fetch-all", post(api::profile::fetch_all_data))
        .route(
            "/api/profile/refresh",
            post(api::profile::refresh_platform_data),
        )
        .route(
            "/api/profile/report",
            post(api::profile::generate_report).get(api::profile::get_report),
        )
        .route("/api/profile/reports", get(api::profile::list_reports))
        .route(
            "/api/profile/reports/:id",
            get(api::profile::get_report_by_id).delete(api::profile::delete_report_by_id),
        )
        .route(
            "/api/profile/reports/:id/cards",
            delete(api::profile::delete_card_from_report),
        )
        .route(
            "/api/profile/reports/all",
            delete(api::profile::delete_all_reports),
        )
        .route("/api/profile/metadata", get(api::profile::get_raw_metadata))
        .route(
            "/api/profile/cache-debug",
            get(api::profile::get_cache_debug_info),
        )
        .route("/api/profile/user-info", get(api::profile::get_user_info))
        // Cache management routes
        .route(
            "/api/profile/cache",
            delete(api::profile::delete_platform_cache),
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
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(db);

    // Serve frontend static files in production
    let app = if std::path::Path::new(&config.frontend_dist_path).exists() {
        tracing::info!("Serving frontend from: {}", config.frontend_dist_path);
        Router::new()
            .nest("/", api_router)
            .fallback_service(ServeDir::new(&config.frontend_dist_path))
    } else {
        tracing::warn!("Frontend dist path not found, serving API only");
        api_router
    };

    // Start server
    let host = config
        .server_host
        .parse::<std::net::IpAddr>()
        .unwrap_or_else(|_| std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));
    let addr = SocketAddr::new(host, config.server_port);
    tracing::info!("🚀 Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
