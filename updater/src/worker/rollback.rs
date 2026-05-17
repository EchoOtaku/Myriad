//! Rollback flow: restore pgdata snapshot, swap tag back, restart old containers.
//!
//! Two entry points:
//!  - [`run`]: a standalone rollback job triggered from the API.
//!  - [`execute_inline`]: called from inside the update flow when something fails post-swap.

use std::sync::Arc;
use std::time::Duration;

use tracing::{error, info};

use crate::docker::ComposeRunner;
use crate::env_file::EnvFile;
use crate::error::{Result, UpdaterError};
use crate::snapshot::SnapshotManager;
use crate::state::{JobStatus, Phase};
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

    match execute_inline(worker.clone(), &rec, &compose, &snap, &snapshot_id, None).await {
        Ok(_) => {
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

pub async fn execute_inline(
    worker: Arc<Worker>,
    rec: &PhaseRecorder<'_>,
    compose: &ComposeRunner,
    snap: &SnapshotManager<'_>,
    snapshot_id: &str,
    swap_back_tag: Option<&str>,
) -> Result<()> {
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

    if let Some(prev_tag) = swap_back_tag {
        rec.enter(Phase::SwapTagBack, "updater.phase.swap_tag_back")?;
        let mut env = EnvFile::load(&worker.cli().env_file)?;
        env.set("MYRIAD_TAG", prev_tag)?;
        env.save()?;
        rec.finish_step_ok()?;
    }

    rec.enter(Phase::StartOld, "updater.phase.start_old")?;
    let up = compose.up_detached(&["backend", "frontend"]).await?;
    if !up.ok() {
        let err = format!("start old failed: {}", up.error_summary());
        rec.finish_step_err(&err)?;
        return Err(UpdaterError::Internal(anyhow::anyhow!(err)));
    }
    rec.finish_step_ok()?;

    // Quick liveness probe (do NOT enforce version match here — we may not know the prior digest).
    let start = std::time::Instant::now();
    let deadline = Duration::from_secs(300);
    while start.elapsed() < deadline {
        tokio::time::sleep(Duration::from_secs(2)).await;
        if let Ok((200, body)) = worker
            .docker()
            .http_probe("http://backend:3000/health", Duration::from_secs(5))
            .await
        {
            let json: serde_json::Value =
                serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
            if json.get("db_connected").and_then(|v| v.as_bool()) == Some(true) {
                return Ok(());
            }
        }
        let _ = crate::worker::machine::heartbeat(worker.state());
    }
    Err(UpdaterError::Precondition(
        "rollback health probe exceeded 300s".into(),
    ))
}
