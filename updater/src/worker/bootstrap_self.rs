//! Self-update bootstrap entrypoint.
//!
//! When the user wants to upgrade the updater itself, they invoke a fresh image with
//! `myriad-updater --bootstrap-self`. This binary:
//!   1. Reads the current host .env, learns its own desired UPDATER_TAG (already set by the
//!      caller — typically the previous updater wrote it before exiting).
//!   2. Runs `docker compose up -d updater` so the new updater image replaces the old.
//!
//! It deliberately does *nothing else*: no maintenance, no business updates.

use std::path::Path;
use std::process::Stdio;

use anyhow::{Context, Result};
use tracing::info;

pub async fn run(compose_dir: &Path, env_file: &Path) -> Result<()> {
    info!(
        compose_dir = %compose_dir.display(),
        env_file = %env_file.display(),
        "bootstrap-self: replacing updater container"
    );

    // Try `docker compose` v2 first, fall back to v1.
    let v2_status = tokio::process::Command::new("docker")
        .arg("compose")
        .arg("--env-file")
        .arg(env_file)
        .arg("-p")
        .arg(
            std::env::var("COMPOSE_PROJECT_NAME")
                .as_deref()
                .unwrap_or("myriad"),
        )
        .arg("up")
        .arg("-d")
        .arg("--no-deps")
        .arg("updater")
        .current_dir(compose_dir)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .await;

    let v2_ok = matches!(v2_status, Ok(s) if s.success());
    if !v2_ok {
        let v1_status = tokio::process::Command::new("docker-compose")
            .arg("--env-file")
            .arg(env_file)
            .arg("-p")
            .arg(
                std::env::var("COMPOSE_PROJECT_NAME")
                    .as_deref()
                    .unwrap_or("myriad"),
            )
            .arg("up")
            .arg("-d")
            .arg("--no-deps")
            .arg("updater")
            .current_dir(compose_dir)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .await
            .context("spawn docker-compose v1 fallback")?;
        if !v1_status.success() {
            anyhow::bail!("bootstrap-self: docker-compose up failed (status {v1_status:?})");
        }
    }

    info!("bootstrap-self: new updater container deployed");
    Ok(())
}
