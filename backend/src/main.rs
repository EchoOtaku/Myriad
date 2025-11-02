use axum::{
    routing::{get, post},
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
        .route("/api/config", get(api::config::get_config).post(api::config::update_config))
        .route("/api/config/test", post(api::config::test_platform))
        .route("/api/platforms", get(api::platforms::list_platforms))
        .route("/api/profiles", get(api::platforms::get_profiles))
        .route("/api/fetch", post(api::platforms::trigger_fetch))
        .route("/api/analysis", get(api::analysis::get_analysis).post(api::analysis::trigger_analysis))
        // Profile report routes
        .route("/api/profile/fetch-all", post(api::profile::fetch_all_data))
        .route("/api/profile/report", post(api::profile::generate_report).get(api::profile::get_report))
        // Bilibili API routes
        .route("/api/bilibili/user", get(api::bilibili::get_bilibili_user))
        .route("/api/bilibili/user/:uid", get(api::bilibili::get_bilibili_user_info))
        .route("/api/bilibili/favorites/:uid", get(api::bilibili::get_bilibili_favorites))
        .route("/api/bilibili/bangumi/:uid", get(api::bilibili::get_bilibili_bangumi))
        .route("/api/bilibili/bangumi/all/:uid", get(api::bilibili::get_all_bilibili_bangumi))
        // Steam API routes
        .route("/api/steam/user", get(api::steam::get_steam_user))
        .route("/api/steam/user/info", get(api::steam::get_steam_user_info))
        .route("/api/steam/games", get(api::steam::get_steam_games))
        .route("/api/steam/wishlist/:steam_id", get(api::steam::get_steam_wishlist))
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
    let host = config.server_host.parse::<std::net::IpAddr>()
        .unwrap_or_else(|_| std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));
    let addr = SocketAddr::new(host, config.server_port);
    tracing::info!("🚀 Server listening on http://{}", addr);
    
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
