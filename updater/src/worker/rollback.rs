//! Rollback flow: restore pgdata snapshot, swap tag back, restart old containers.
//!
//! Two entry points:
//!  - [`run`]: a standalone rollback job triggered from the API.
//!  - [`execute_inline`]: called from inside the update flow when something fails post-swap.
//!
//! Tag restoration priority (last known good, never a hardcoded version):
//!  1. Explicit `swap_back_tag` from the update flow (value of `MYRIAD_TAG` before swap)
//!  2. Snapshot metadata `source_version` (recorded at snapshot create time)
//!  3. `updater.json.current_version` (only advanced after a successful health-checked update)
//!
//! If none of the above is available we leave `.env` unchanged (safe when swap never landed).

use std::sync::Arc;
use std::time::Duration;

use tracing::{error, info, warn};

use crate::docker::ComposeRunner;
use crate::env_file::EnvFile;
use crate::error::{Result, UpdaterError};
use crate::snapshot::SnapshotManager;
use crate::state::{JobStatus, Phase, StateDir};
use crate::version::DeployTag;
use crate::worker::{machine::PhaseRecorder, Worker};

pub async fn run(worker: Arc<Worker>, job_id: String, snapshot_id: String) -> Result<()> {
    let rec = PhaseRecorder {
        state: worker.state(),
        job_id: job_id.clone(),
        from_version: worker.state().read_updater()?.current_version.clone(),
        to_version: None,
    };
    rec.enter(Phase::RollbackInProgress, "updater.phase.rollback")?;
    rec.finish_step_ok()?;

    let compose = super::update::build_compose_runner_pub(&worker)?;
    let snap = SnapshotManager {
        state: worker.state(),
        pgdata: worker.cli().pgdata.clone(),
    };

    // Resolve from snapshot / last-good — never skip tag restore on standalone rollback
    // when metadata is available.
    match execute_inline(worker.clone(), &rec, &compose, &snap, &snapshot_id, None).await {
        Ok(restored) => {
            if let Some(v) = restored {
                let mut job = worker.state().read_job(&job_id)?;
                job.to_version = Some(v);
                worker.state().write_job(&job)?;
            }
            rec.finalize(JobStatus::Succeeded)?;
            crate::worker::machine::clear_maintenance(worker.state())?;
            Ok(())
        }
        Err(e) => {
            error!(err = %e, "standalone rollback failed");
            rec.finalize(JobStatus::NeedsManual)?;
            let mut m = worker.state().read_maintenance()?;
            m.phase = Phase::NeedsManual;
            m.bump_heartbeat();
            worker.state().write_maintenance(&m)?;
            Err(e)
        }
    }
}

/// Execute the core rollback steps.
///
/// Returns the version tag that was restored into `MYRIAD_TAG` (when known).
pub async fn execute_inline(
    worker: Arc<Worker>,
    rec: &PhaseRecorder<'_>,
    compose: &ComposeRunner,
    snap: &SnapshotManager<'_>,
    snapshot_id: &str,
    swap_back_tag: Option<&str>,
) -> Result<Option<DeployTag>> {
    info!(snapshot = snapshot_id, "rollback: stopping new containers");
    rec.enter(Phase::StopNew, "updater.phase.stop_new")?;
    let _ = compose.stop(&["frontend", "backend"], 30).await?;
    rec.finish_step_ok()?;

    rec.enter(Phase::RestoreSnapshot, "updater.phase.restore_snapshot")?;
    let _ = compose.stop(&["postgres"], 60).await?;
    snap.restore(snapshot_id).await?;
    let start_pg = compose.start(&["postgres"]).await?;
    if !start_pg.ok() {
        let err = format!("post-restore start postgres: {}", start_pg.error_summary());
        rec.finish_step_err(&err)?;
        return Err(UpdaterError::Internal(anyhow::anyhow!(err)));
    }
    rec.finish_step_ok()?;

    let prev_tag = resolve_previous_tag(worker.state(), snapshot_id, swap_back_tag)?;
    let restored_version = match &prev_tag {
        Some(tag) => {
            rec.enter(Phase::SwapTagBack, "updater.phase.swap_tag_back")?;
            let mut env = EnvFile::load(&worker.cli().env_file)?;
            let before = env.get("MYRIAD_TAG").unwrap_or("").to_string();
            env.set("MYRIAD_TAG", tag)?;
            env.save()?;
            info!(
                from = %before,
                to = %tag,
                "rollback: restored MYRIAD_TAG to last known good"
            );
            rec.finish_step_ok()?;
            DeployTag::parse(tag).ok()
        }
        None => {
            // `.env` write is atomic, so a pure pre-swap / failed-before-swap path can
            // legitimately have nothing to restore. Log and continue with whatever is in .env.
            warn!(
                snapshot = snapshot_id,
                "rollback: no previous MYRIAD_TAG resolved; leaving .env unchanged"
            );
            None
        }
    };

    rec.enter(Phase::StartOld, "updater.phase.start_old")?;
    let up = compose.up_detached(&["backend", "frontend"]).await?;
    if !up.ok() {
        let err = format!("start old failed: {}", up.error_summary());
        rec.finish_step_err(&err)?;
        return Err(UpdaterError::Internal(anyhow::anyhow!(err)));
    }
    rec.finish_step_ok()?;

    // Quick liveness probe (do NOT enforce version match — restored image may still be pulling).
    let start = std::time::Instant::now();
    let deadline = Duration::from_secs(300);
    while start.elapsed() < deadline {
        tokio::time::sleep(Duration::from_secs(2)).await;
        if let Ok((200, body)) = worker
            .docker()
            .http_probe("http://backend:1103/health", Duration::from_secs(5))
            .await
        {
            let json: serde_json::Value =
                serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
            if json.get("db_connected").and_then(|v| v.as_bool()) == Some(true) {
                // Persist last-known-good after a healthy rollback.
                if let Some(ref v) = restored_version {
                    let mut st = worker.state().read_updater()?;
                    st.current_version = Some(v.clone());
                    st.current_commit_sha = None;
                    worker.state().write_updater(&st)?;
                    if let Err(e) = worker.reconcile_current_deploy().await {
                        warn!(err = %e, "rollback restored version but commit reconciliation failed");
                    }
                }
                return Ok(restored_version);
            }
        }
        let _ = crate::worker::machine::heartbeat(worker.state());
    }
    Err(UpdaterError::Precondition(
        "rollback health probe exceeded 300s".into(),
    ))
}

/// Resolve the image tag that represented the last known good business version.
///
/// Order:
/// 1. Explicit preferred tag (captured by `swap_tag` before overwrite)
/// 2. Snapshot `source_version`
/// 3. `updater.json.current_version`
///
/// Returns `Ok(None)` only when no durable source knows the previous tag.
pub(crate) fn resolve_previous_tag(
    state: &StateDir,
    snapshot_id: &str,
    preferred: Option<&str>,
) -> Result<Option<String>> {
    if let Some(tag) = preferred.map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(Some(tag.to_string()));
    }

    let snaps = state.read_snapshots()?;
    if let Some(meta) = snaps.items.iter().find(|m| m.id == snapshot_id) {
        if let Some(v) = &meta.source_version {
            return Ok(Some(v.to_string()));
        }
    }

    if let Some(v) = state.read_updater()?.current_version {
        return Ok(Some(v.to_string()));
    }

    // Callers treat None as "leave .env alone".
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{SnapshotMeta, SnapshotsFile, StateDir, UpdaterStateFile};
    use chrono::Utc;
    use tempfile::tempdir;

    #[test]
    fn resolve_prefers_explicit_tag() {
        let dir = tempdir().unwrap();
        let state = StateDir::open(dir.path()).unwrap();
        let got = resolve_previous_tag(&state, "snap-x", Some("v1.2.3")).unwrap();
        assert_eq!(got.as_deref(), Some("v1.2.3"));
    }

    #[test]
    fn resolve_falls_back_to_snapshot_source_version() {
        let dir = tempdir().unwrap();
        let state = StateDir::open(dir.path()).unwrap();
        let mut sf = SnapshotsFile::default();
        sf.items.push(SnapshotMeta {
            id: "snap-abc".into(),
            created_at: Utc::now(),
            source_version: Some(DeployTag::parse("v0.9.0").unwrap()),
            size_bytes: 1,
            file_count: 1,
            keep: false,
            sample_sha256: None,
        });
        state.write_snapshots(&sf).unwrap();
        let got = resolve_previous_tag(&state, "snap-abc", None).unwrap();
        assert_eq!(got.as_deref(), Some("v0.9.0"));
    }

    #[test]
    fn resolve_falls_back_to_current_version() {
        let dir = tempdir().unwrap();
        let state = StateDir::open(dir.path()).unwrap();
        let st = UpdaterStateFile {
            current_version: Some(DeployTag::parse("v0.8.1").unwrap()),
            ..UpdaterStateFile::default()
        };
        state.write_updater(&st).unwrap();
        let got = resolve_previous_tag(&state, "snap-missing", None).unwrap();
        assert_eq!(got.as_deref(), Some("v0.8.1"));
    }

    #[test]
    fn resolve_explicit_overrides_snapshot() {
        let dir = tempdir().unwrap();
        let state = StateDir::open(dir.path()).unwrap();
        let mut sf = SnapshotsFile::default();
        sf.items.push(SnapshotMeta {
            id: "snap-abc".into(),
            created_at: Utc::now(),
            source_version: Some(DeployTag::parse("v0.9.0").unwrap()),
            size_bytes: 1,
            file_count: 1,
            keep: false,
            sample_sha256: None,
        });
        state.write_snapshots(&sf).unwrap();
        let got = resolve_previous_tag(&state, "snap-abc", Some("v0.8.0")).unwrap();
        assert_eq!(got.as_deref(), Some("v0.8.0"));
    }
}
