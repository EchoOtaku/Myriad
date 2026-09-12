//! Standalone outbound delivery process. No routes, TAPP scheduler, persona ticks,
//! MCP children, or schema mutations are started by this entry point.
use std::{sync::Arc, time::Duration};

use axum::{extract::State, http::StatusCode, routing::get, Json, Router};
use sea_orm::{ConnectOptions, ConnectionTrait, Database, DatabaseConnection};
use serde_json::json;
use tokio::sync::watch;

use crate::{config::AppConfig, services::config_service::ConfigService};

#[derive(Clone)]
struct HealthState {
    db: DatabaseConnection,
    configured: Arc<std::sync::atomic::AtomicBool>,
}

fn connection_options(url: &str) -> ConnectOptions {
    let mut options = ConnectOptions::new(url.to_owned());
    options
        .min_connections(1)
        .max_connections(4)
        .connect_timeout(Duration::from_secs(10))
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(60))
        .sqlx_logging(false)
        .map_sqlx_postgres_opts(|opts| {
            opts.application_name("myriad-federation-worker").options([
                ("statement_timeout", "10000"),
                ("lock_timeout", "3000"),
                ("idle_in_transaction_session_timeout", "10000"),
            ])
        });
    options
}

pub async fn run() -> anyhow::Result<()> {
    use std::sync::atomic::{AtomicBool, Ordering};
    crate::services::data_key::init_existing()?;
    let config = AppConfig::from_env()?;
    anyhow::ensure!(
        !config.database_url.is_empty(),
        "federation-worker requires DATABASE_URL"
    );
    *crate::GLOBAL_CONFIG.write().await = config.clone();
    let db = Database::connect(connection_options(&config.database_url)).await?;
    // The web process owns migrations. Starting a worker against an incomplete
    // deployment fails before the first claim; the supervisor can retry later.
    let drift = crate::db::schema_check::report_schema_drift(&db).await?;
    anyhow::ensure!(
        drift.is_empty(),
        "federation-worker requires the current schema: {}",
        drift.summary()
    );
    crate::SCHEMA_READY.store(true, Ordering::Release);
    crate::services::tapp_registry::set_process_database(db.clone()).await;
    *crate::GLOBAL_DYNAMIC_CONFIG.write().await =
        ConfigService::new(db.clone()).load_config().await?;
    crate::services::agent::notifications::init_notification_publisher(db.clone()).await;

    let configured = Arc::new(AtomicBool::new(true));
    let state = HealthState {
        db: db.clone(),
        configured: configured.clone(),
    };
    let address = format!("{}:{}", config.server_host, config.server_port);
    let listener = tokio::net::TcpListener::bind(&address).await?;
    let (shutdown, mut stopped) = watch::channel(false);
    let app = Router::new()
        .route("/health", get(health))
        .with_state(state);
    let mut http = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                let _ = stopped.changed().await;
            })
            .await
    });
    let delivery_db = db.clone();
    let mut delivery = tokio::spawn(async move {
        super::delivery::run_delivery_worker(delivery_db).await;
        if !crate::services::federation_gate::federation_enabled() {
            // Healthy geographic idle still participates in the outer supervisor.
            std::future::pending::<()>().await;
        }
    });
    let mut refresh = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            // Public domain changes persist in the shared read-only data mount.
            // Reload both origin and DB settings independently of the web process.
            crate::api::site_domain::load_durable_site_public_env();
            let core = AppConfig::from_env()?;
            *crate::GLOBAL_CONFIG.write().await = core;
            match ConfigService::new(db.clone()).load_config().await {
                Ok(config) => {
                    *crate::GLOBAL_DYNAMIC_CONFIG.write().await = config;
                    configured.store(true, Ordering::Release);
                }
                Err(error) => {
                    configured.store(false, Ordering::Release);
                    // Stop claims instead of continuing indefinitely with stale policy.
                    return Err::<(), anyhow::Error>(error.into());
                }
            }
        }
    });
    tracing::info!(%address, "Federation delivery process ready");
    let result = tokio::select! {
        signal = termination_signal() => signal,
        result = &mut delivery => match result {
            Ok(()) => Err(anyhow::anyhow!("federation delivery loop stopped unexpectedly")),
            Err(error) => Err(error.into()),
        },
        result = &mut http => Err(anyhow::anyhow!("federation health server stopped: {result:?}")),
        result = &mut refresh => Err(anyhow::anyhow!("federation config refresh stopped: {result:?}")),
    };
    let _ = shutdown.send(true);
    // Cancel the local delivery future; its lease heartbeat drops with it.
    // An interrupted row remains recoverable under the existing lease protocol.
    delivery.abort();
    refresh.abort();
    if !http.is_finished() {
        if tokio::time::timeout(Duration::from_secs(5), &mut http)
            .await
            .is_err()
        {
            http.abort();
        }
    }
    result
}

async fn health(State(state): State<HealthState>) -> (StatusCode, Json<serde_json::Value>) {
    use std::sync::atomic::Ordering;
    let database = matches!(
        tokio::time::timeout(Duration::from_secs(2), state.db.ping()).await,
        Ok(Ok(()))
    );
    let ready = database && state.configured.load(Ordering::Acquire);
    (
        if ready {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        Json(json!({
            "role": "federation-worker", "ready": ready, "database": database,
            "version": crate::api::build_version(), "commit_sha": crate::api::build_commit_sha(),
            "federation_gate": crate::services::federation_gate::status(),
        })),
    )
}

async fn termination_signal() -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        tokio::select! { result = tokio::signal::ctrl_c() => result?, _ = term.recv() => {} }
    }
    #[cfg(not(unix))]
    tokio::signal::ctrl_c().await?;
    Ok(())
}
