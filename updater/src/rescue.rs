//! Rescue CLI implementations. These do NOT require the updater HTTP API to be alive —
//! they operate on `/state` and the docker daemon directly. Spec §16.3.

use std::path::PathBuf;
use std::process::Stdio;

use anyhow::{Context as _, Result};
use tracing::info;

use crate::snapshot::SnapshotManager;
use crate::state::StateDir;

pub struct Context {
    pub state: StateDir,
    pub compose_dir: PathBuf,
    pub env_file: PathBuf,
    pub pgdata: PathBuf,
}

pub async fn status(ctx: &Context) -> Result<()> {
    let u = ctx.state.read_updater()?;
    let m = ctx.state.read_maintenance()?;
    let cur = ctx.state.read_current_job()?;
    let snaps = ctx.state.read_snapshots()?;
    let out = serde_json::json!({
        "updater_version": crate::self_version(),
        "updater": u,
        "maintenance": m,
        "current_job": cur,
        "snapshots": snaps,
    });
    println!("{}", serde_json::to_string_pretty(&out)?);
    Ok(())
}

pub async fn exit_maintenance(ctx: &Context, force: bool) -> Result<()> {
    if !force {
        anyhow::bail!("refusing without --force; this will discard maintenance state");
    }
    ctx.state.clear_maintenance()?;
    ctx.state.set_current_job(None)?;
    ctx.state.append_history("rescue: exit_maintenance via CLI")?;
    info!("maintenance cleared");
    Ok(())
}

pub async fn rollback(ctx: &Context, snapshot_id: &str) -> Result<()> {
    let snap = SnapshotManager {
        state: &ctx.state,
        pgdata: ctx.pgdata.clone(),
    };
    let snapshots = ctx.state.read_snapshots()?;
    if !snapshots.items.iter().any(|s| s.id == snapshot_id) {
        anyhow::bail!("snapshot {snapshot_id} not present in snapshots.json");
    }

    info!(snapshot = snapshot_id, "rescue rollback: stopping services");
    compose_v2_or_v1(ctx, &["stop", "-t", "30", "frontend", "backend"]).await?;
    compose_v2_or_v1(ctx, &["stop", "-t", "60", "postgres"]).await?;
    snap.restore(snapshot_id).await?;
    compose_v2_or_v1(ctx, &["start", "postgres"]).await?;
    compose_v2_or_v1(ctx, &["up", "-d", "--no-deps", "backend", "frontend"]).await?;
    ctx.state.clear_maintenance()?;
    ctx.state.set_current_job(None)?;
    ctx.state
        .append_history(&format!("rescue rollback to snapshot {snapshot_id}"))?;
    info!("rescue rollback complete");
    Ok(())
}

pub async fn diagnose(ctx: &Context, output: &PathBuf) -> Result<()> {
    let dir = tempfile::tempdir()?;
    let staging = dir.path().join("diagnostics");
    std::fs::create_dir_all(&staging)?;

    // Copy state files (excluding snapshots/, which can be huge).
    for entry in std::fs::read_dir(ctx.state.root())? {
        let entry = entry?;
        let name = entry.file_name();
        if name == "snapshots" {
            continue;
        }
        let target = staging.join(&name);
        if entry.file_type()?.is_dir() {
            copy_dir_recursively(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }

    // docker compose ps + docker images.
    let _ = run_capture(
        "docker",
        &["images", "--format", "{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.Size}}"],
    )
    .await
    .map(|s| std::fs::write(staging.join("docker-images.txt"), s));
    let _ = run_capture("docker", &["info"])
        .await
        .map(|s| std::fs::write(staging.join("docker-info.txt"), s));

    // tar.gz it.
    let status = tokio::process::Command::new("tar")
        .arg("-czf")
        .arg(output)
        .arg("-C")
        .arg(dir.path())
        .arg("diagnostics")
        .status()
        .await
        .context("spawn tar")?;
    if !status.success() {
        anyhow::bail!("tar exited with {status:?}");
    }
    println!("wrote {}", output.display());
    Ok(())
}

pub async fn forget_job(ctx: &Context) -> Result<()> {
    ctx.state.set_current_job(None)?;
    ctx.state.append_history("rescue: forget_job via CLI")?;
    info!("current_job cleared");
    Ok(())
}

pub async fn clean_snapshots(ctx: &Context, keep: usize) -> Result<()> {
    let snap = SnapshotManager {
        state: &ctx.state,
        pgdata: ctx.pgdata.clone(),
    };
    let removed = snap.prune(keep)?;
    println!("removed snapshots: {removed:?}");
    Ok(())
}

async fn compose_v2_or_v1(ctx: &Context, args: &[&str]) -> Result<()> {
    let project =
        std::env::var("COMPOSE_PROJECT_NAME").unwrap_or_else(|_| "myriad".into());

    let v2 = tokio::process::Command::new("docker")
        .arg("compose")
        .arg("--env-file")
        .arg(&ctx.env_file)
        .arg("-p")
        .arg(&project)
        .args(args)
        .current_dir(&ctx.compose_dir)
        .status()
        .await;
    if let Ok(s) = v2 {
        if s.success() {
            return Ok(());
        }
    }
    let v1 = tokio::process::Command::new("docker-compose")
        .arg("--env-file")
        .arg(&ctx.env_file)
        .arg("-p")
        .arg(&project)
        .args(args)
        .current_dir(&ctx.compose_dir)
        .status()
        .await
        .context("spawn docker-compose")?;
    if !v1.success() {
        anyhow::bail!("compose {args:?} failed (status {v1:?})");
    }
    Ok(())
}

async fn run_capture(prog: &str, args: &[&str]) -> Result<Vec<u8>> {
    let out = tokio::process::Command::new(prog)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .context(format!("spawn {prog}"))?;
    Ok(out.stdout)
}

fn copy_dir_recursively(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursively(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
