use std::sync::Arc;

use anyhow::Result;
use clap::Parser;
use tracing::{error, info, warn};

use myriad_updater::{
    api, config::Config, docker::DockerClient, log as logging, probe, self_version, state::StateDir,
    worker::{Worker, WorkerCli},
};

#[derive(Debug, Parser)]
#[command(name = "myriad-updater", version = self_version(), about = "Myriad self-update daemon")]
struct Cli {
    /// Path to state directory (bind-mounted from host).
    #[arg(long, env = "UPDATER_STATE_DIR", default_value = "/state")]
    state_dir: std::path::PathBuf,

    /// Path to the host's compose project directory (mounted at /host/compose).
    #[arg(long, env = "UPDATER_COMPOSE_DIR", default_value = "/host/compose")]
    compose_dir: std::path::PathBuf,

    /// Path to the host's .env file inside the container.
    #[arg(long, env = "UPDATER_ENV_FILE", default_value = "/host/.env")]
    env_file: std::path::PathBuf,

    /// Path to the host's pgdata directory inside the container.
    #[arg(long, env = "UPDATER_PGDATA", default_value = "/host/pgdata")]
    pgdata: std::path::PathBuf,

    /// Listen address.
    #[arg(long, env = "UPDATER_LISTEN", default_value = "0.0.0.0:9090")]
    listen: String,

    /// Optional: bootstrap-self mode (used during self-update; see spec §14.2).
    #[arg(long)]
    bootstrap_self: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    logging::init();

    info!(version = self_version(), "myriad-updater starting");

    if cli.bootstrap_self {
        return myriad_updater::worker::bootstrap_self::run(&cli.compose_dir, &cli.env_file).await;
    }

    // Phase 1: load config & open state. Failures here are fatal.
    let config = Config::load_from_env().map_err(|e| {
        error!(err = %e, "failed to load updater config (.env.updater)");
        e
    })?;
    let state = Arc::new(StateDir::open(&cli.state_dir)?);

    // Phase 2: env-probe (compose binary, docker, pgdata fs type, etc.).
    // Any unsupported environment must fail loudly *before* we serve any API.
    let env_probe = probe::run_all(&probe::ProbeInputs {
        compose_dir: cli.compose_dir.clone(),
        env_file: cli.env_file.clone(),
        pgdata: cli.pgdata.clone(),
    })
    .await?;
    state.write_env_probe(&env_probe)?;
    if let Some(err) = env_probe.fatal_error() {
        error!(%err, "environment probe failed: refusing to start");
        anyhow::bail!("environment probe failed: {err}");
    }
    for w in env_probe.warnings() {
        warn!(%w, "environment warning");
    }

    // Phase 3: docker client (bollard).
    let docker = Arc::new(DockerClient::connect().await?);

    // Phase 4: recover any in-flight job per §7.1.
    let recovery = Worker::recover_or_idle(state.clone(), docker.clone()).await?;
    info!(recovered = ?recovery, "state recovery complete");

    // Phase 5: spawn worker.
    let worker_cli = WorkerCli {
        state_dir: cli.state_dir.clone(),
        compose_dir: cli.compose_dir.clone(),
        env_file: cli.env_file.clone(),
        pgdata: cli.pgdata.clone(),
        listen: cli.listen.clone(),
    };
    let worker = Arc::new(Worker::new(state.clone(), docker.clone(), config.clone(), worker_cli));
    let worker_handle = worker.clone().spawn();

    // Phase 6: serve API.
    let api_state = api::ApiState {
        worker: worker.clone(),
        state: state.clone(),
        config: config.clone(),
    };
    let app = api::router(api_state);

    let listener = tokio::net::TcpListener::bind(&worker.cli().listen).await?;
    info!(addr = %worker.cli().listen, "HTTP API listening");

    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
        info!("shutdown signal received");
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await?;

    worker.shutdown().await;
    let _ = worker_handle.await;
    Ok(())
}
