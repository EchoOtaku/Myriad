//! Normal update flow. State machine progression per spec §7.
//! Supports release (GitHub Release + release.json) and commit (CI image tags) modes.

use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use tracing::{error, info};

use crate::docker::ComposeRunner;
use crate::env_file::EnvFile;
use crate::error::{Result, UpdaterError};
use crate::probe::compose::ComposeBinary;
use crate::snapshot::SnapshotManager;
use crate::state::{JobStatus, Phase};
use crate::version::{DeployTag, MyriadVersion, UpdateMode};
use crate::worker::{machine::PhaseRecorder, preflight, rollback, Worker};

pub async fn run(
    worker: Arc<Worker>,
    job_id: String,
    target: DeployTag,
    mode: UpdateMode,
    risk: preflight::RiskFlags,
) -> Result<()> {
    info!(
        job = %job_id,
        target = %target,
        ?mode,
        allow_downgrade = risk.allow_downgrade,
        allow_diverged = risk.allow_diverged,
        allow_unknown = risk.allow_unknown,
        allow_irreversible = risk.allow_irreversible,
        "update flow starting"
    );

    let rec = PhaseRecorder {
        state: worker.state(),
        job_id: job_id.clone(),
        from_version: worker.state().read_updater()?.current_version.clone(),
        to_version: Some(target.clone()),
    };

    // ============================================================
    // Pre-swap phase: any failure cleans up without touching prod.
    // ============================================================
    // Structured audit line before any side effects (operator risk acknowledgements).
    worker.state().append_history(&format!(
        "audit: update_request job={} target={} mode={} \
         allow_downgrade={} allow_diverged={} allow_unknown={} allow_irreversible={}",
        job_id,
        target.as_str(),
        mode.as_str(),
        risk.allow_downgrade,
        risk.allow_diverged,
        risk.allow_unknown,
        risk.allow_irreversible
    ))?;

    rec.enter(Phase::Preflight, "updater.phase.preflight")?;
    let pre = match preflight::run(worker.clone(), &target, mode, risk).await {
        Ok(r) => {
            rec.finish_step_ok()?;
            r
        }
        Err(e) => {
            error!(job = %job_id, err = %e, "preflight failed");
            rec.finish_step_err(format!("preflight: {e}"))?;
            rec.finalize(JobStatus::Failed)?;
            crate::worker::machine::clear_maintenance(worker.state())?;
            return Err(e);
        }
    };

    // Commit mode normalizes branch tips → dev-<sha>; use pre.target for the rest of the flow.
    let target = pre.target.clone();
    // Keep job.to_version in sync with the effective tag (not the raw request).
    {
        let mut job = worker.state().read_job(&job_id)?;
        job.to_version = Some(target.clone());
        worker.state().write_job(&job)?;
    }
    // Refresh recorder to_version to the effective tag.
    let rec = PhaseRecorder {
        state: worker.state(),
        job_id: job_id.clone(),
        from_version: rec.from_version.clone(),
        to_version: Some(target.clone()),
    };

    // Maintenance ON.
    rec.enter(Phase::MaintenanceOn, "updater.phase.maintenance_on")?;
    rec.finish_step_ok()?;

    let compose = build_compose_runner(&worker)?;

    // Stop business containers.
    rec.enter(Phase::Stopping, "updater.phase.stopping")?;
    let out = compose
        .stop(&["frontend", "backend"], 30)
        .await
        .map_err(|e| {
            rec.finish_step_err(format!("stop frontend/backend: {e}"))
                .ok();
            e
        })?;
    if !out.ok() {
        let err = format!("compose stop failed: {}", out.error_summary());
        rec.finish_step_err(&err)?;
        rec.finalize(JobStatus::Failed)?;
        crate::worker::machine::clear_maintenance(worker.state())?;
        return Err(UpdaterError::Internal(anyhow::anyhow!(err)));
    }
    rec.finish_step_ok()?;

    // Snapshot pgdata.
    rec.enter(Phase::Snapshotting, "updater.phase.snapshotting")?;
    let stop_pg = compose.stop(&["postgres"], 60).await?;
    if !stop_pg.ok() {
        let err = format!("stop postgres failed: {}", stop_pg.error_summary());
        rec.finish_step_err(&err)?;
        rec.finalize(JobStatus::Failed)?;
        crate::worker::machine::clear_maintenance(worker.state())?;
        return Err(UpdaterError::Internal(anyhow::anyhow!(err)));
    }

    let snap = SnapshotManager {
        state: worker.state(),
        pgdata: worker.cli().pgdata.clone(),
    };
    let snapshot_id = format!("snap-{}", job_id);
    let source_version = pre.from_version.clone().or_else(|| {
        EnvFile::load(&worker.cli().env_file)
            .ok()
            .and_then(|e| e.get("MYRIAD_TAG").map(|s| s.to_string()))
            .and_then(|t| DeployTag::parse(&t).ok())
    });
    let _ = snap
        .create(&snapshot_id, source_version)
        .await
        .map_err(|e| {
            rec.finish_step_err(format!("snapshot: {e}")).ok();
            e
        })?;

    let start_pg = compose.start(&["postgres"]).await?;
    if !start_pg.ok() {
        let err = format!("restart postgres failed: {}", start_pg.error_summary());
        rec.finish_step_err(&err)?;
        rec.finalize(JobStatus::Failed)?;
        crate::worker::machine::clear_maintenance(worker.state())?;
        return Err(UpdaterError::Internal(anyhow::anyhow!(err)));
    }
    {
        let mut job = worker.state().read_job(&job_id)?;
        job.snapshot_id = Some(snapshot_id.clone());
        worker.state().write_job(&job)?;
    }
    rec.finish_step_ok()?;

    // ============================================================
    // Swap tag. Beyond here, any failure triggers automated rollback.
    // ============================================================
    rec.enter(Phase::SwapTag, "updater.phase.swap_tag")?;
    let from_tag_hint = rec
        .from_version
        .as_ref()
        .map(|v| v.to_string())
        .or_else(|| pre.from_version.as_ref().map(|v| v.to_string()));
    let from_tag_backup = match swap_tag(&worker, target.as_str()) {
        Ok(prev) => prev,
        Err(e) => {
            rec.finish_step_err(format!("swap_tag: {e}"))?;
            return finish_with_rollback(
                &worker,
                &rec,
                &compose,
                &snap,
                &snapshot_id,
                from_tag_hint.as_deref(),
                e,
            )
            .await;
        }
    };
    rec.finish_step_ok()?;

    if let Err(e) = pin_last_good_images(&worker, &from_tag_backup).await {
        tracing::warn!(err = %e, prev = %from_tag_backup, "pre-start pin of last-good images failed");
    } else if let Ok(v) = DeployTag::parse(&from_tag_backup) {
        let mut st = worker.state().read_updater()?;
        st.last_good_version = Some(v);
        let _ = worker.state().write_updater(&st);
    }

    rec.enter(Phase::StartingNew, "updater.phase.starting_new")?;
    let up = compose.up_detached(&["backend", "frontend"]).await?;
    if !up.ok() {
        let err = format!("compose up new failed: {}", up.error_summary());
        rec.finish_step_err(&err)?;
        return finish_with_rollback(
            &worker,
            &rec,
            &compose,
            &snap,
            &snapshot_id,
            Some(&from_tag_backup),
            UpdaterError::Internal(anyhow::anyhow!(err)),
        )
        .await;
    }
    rec.finish_step_ok()?;

    rec.enter(Phase::HealthProbing, "updater.phase.health_probing")?;
    let deadline = Duration::from_secs(300u64.max((pre.estimated_seconds as u64) * 3));
    let probe_result = health_probe(&worker, &target, deadline).await;
    if let Err(e) = probe_result {
        rec.finish_step_err(format!("health: {e}"))?;
        return finish_with_rollback(
            &worker,
            &rec,
            &compose,
            &snap,
            &snapshot_id,
            Some(&from_tag_backup),
            e,
        )
        .await;
    }
    rec.finish_step_ok()?;

    rec.enter(Phase::SwappingProxy, "updater.phase.swapping_proxy")?;
    let mut st = worker.state().read_updater()?;
    st.current_version = Some(target.clone());
    st.current_commit_sha = pre.target_commit_sha.clone();
    st.updater_version = MyriadVersion::parse(crate::self_version()).ok();
    worker.state().write_updater(&st)?;
    rec.finish_step_ok()?;

    rec.enter(Phase::Finalize, "updater.phase.finalize")?;
    if let Err(e) = pin_last_good_images(&worker, target.as_str()).await {
        tracing::warn!(err = %e, version = %target, "failed to pin last-good images");
    } else {
        let mut st = worker.state().read_updater()?;
        st.last_good_version = Some(target.clone());
        let _ = worker.state().write_updater(&st);
    }
    rec.finish_step_ok()?;

    let _ = snap.prune(3);

    rec.finalize(JobStatus::Succeeded)?;
    crate::worker::machine::clear_maintenance(worker.state())?;
    worker
        .state()
        .append_history(&format!("job {job_id}: SUCCESS {target} ({mode})"))?;
    info!(job = %job_id, %target, ?mode, "update succeeded");
    Ok(())
}

async fn pin_last_good_images(worker: &Arc<Worker>, previous_tag: &str) -> Result<()> {
    const PIN_TAG: &str = "myriad-last-good";
    let env = EnvFile::load(&worker.cli().env_file)?;
    let backend = env
        .get("BACKEND_IMAGE")
        .map(|s| s.to_string())
        .ok_or_else(|| {
            UpdaterError::Precondition("BACKEND_IMAGE missing; cannot pin last-good".into())
        })?;
    let frontend = env
        .get("FRONTEND_IMAGE")
        .map(|s| s.to_string())
        .ok_or_else(|| {
            UpdaterError::Precondition("FRONTEND_IMAGE missing; cannot pin last-good".into())
        })?;
    let pairs = [("backend", backend), ("frontend", frontend)];

    for (comp, repo) in pairs {
        let source = format!("{repo}:{previous_tag}");
        if !worker.docker().image_exists_local(&source).await {
            tracing::warn!(%comp, %source, "last-good pin skipped: image not local");
            continue;
        }
        worker
            .docker()
            .tag_image(&source, &repo, PIN_TAG)
            .await
            .map_err(|e| UpdaterError::Docker(format!("pin last-good {comp} ({source}): {e}")))?;
        info!(%comp, %source, pin = %format!("{repo}:{PIN_TAG}"), "pinned last-good image");
    }
    Ok(())
}

async fn finish_with_rollback(
    worker: &Arc<Worker>,
    rec: &PhaseRecorder<'_>,
    compose: &ComposeRunner,
    snap: &SnapshotManager<'_>,
    snapshot_id: &str,
    from_tag: Option<&str>,
    original_err: UpdaterError,
) -> Result<()> {
    error!(err = %original_err, "rollback triggered");
    let rb_result =
        rollback::execute_inline(worker.clone(), rec, compose, snap, snapshot_id, from_tag).await;
    match rb_result {
        Ok(restored) => {
            rec.finalize(JobStatus::Failed)?;
            let mut st = worker.state().read_updater()?;
            if let Some(v) = restored.or_else(|| rec.from_version.clone()) {
                let version_changed = st.current_version.as_ref() != Some(&v);
                st.current_version = Some(v);
                if version_changed {
                    st.current_commit_sha = None;
                }
            }
            st.last_failed_update = Some(crate::state::FailedUpdate {
                from_version: rec.from_version.clone(),
                to_version: rec.to_version.clone(),
                at: Utc::now(),
                reason: original_err.to_string(),
                job_id: rec.job_id.clone(),
            });
            worker.state().write_updater(&st)?;
            crate::worker::machine::clear_maintenance(worker.state())?;
            worker
                .state()
                .append_history(&format!("job {}: ROLLBACK_OK ({original_err})", rec.job_id))?;
            Err(original_err)
        }
        Err(rb_err) => {
            rec.finish_step_err(format!("rollback failed: {rb_err}"))?;
            rec.finalize(JobStatus::NeedsManual)?;
            let mut m = worker.state().read_maintenance()?;
            m.phase = Phase::NeedsManual;
            m.message_key = "updater.phase.needs_manual".into();
            m.bump_heartbeat();
            worker.state().write_maintenance(&m)?;
            worker.state().append_history(&format!(
                "job {}: NEEDS_MANUAL — original={original_err}; rollback={rb_err}",
                rec.job_id
            ))?;
            Err(rb_err)
        }
    }
}

pub(crate) fn build_compose_runner_pub(worker: &Arc<Worker>) -> Result<ComposeRunner> {
    build_compose_runner(worker)
}

fn build_compose_runner(worker: &Arc<Worker>) -> Result<ComposeRunner> {
    let probe_path = worker.state().root().join("env-probe.json");
    let probe: crate::probe::EnvProbe = serde_json::from_slice(&std::fs::read(&probe_path)?)?;
    let binary: ComposeBinary = probe
        .compose
        .binary
        .ok_or_else(|| UpdaterError::Internal(anyhow::anyhow!("compose binary unavailable")))?;
    let project = std::env::var("COMPOSE_PROJECT_NAME").unwrap_or_else(|_| "myriad".into());
    Ok(ComposeRunner::new(
        binary,
        project,
        probe.compose.compose_files,
        worker.cli().env_file.clone(),
        worker.cli().compose_dir.clone(),
    ))
}

fn swap_tag(worker: &Arc<Worker>, new_tag: &str) -> Result<String> {
    let mut env = EnvFile::load(&worker.cli().env_file)?;
    let prev = env
        .get("MYRIAD_TAG")
        .map(|s| s.to_string())
        .ok_or_else(|| UpdaterError::Precondition("MYRIAD_TAG missing in .env".into()))?;
    env.set("MYRIAD_TAG", new_tag)?;
    env.save()?;
    Ok(prev)
}

async fn health_probe(worker: &Arc<Worker>, target: &DeployTag, deadline: Duration) -> Result<()> {
    let start = std::time::Instant::now();
    let mut ok_streak = 0;
    while start.elapsed() < deadline {
        tokio::time::sleep(Duration::from_secs(2)).await;
        let backend_url = "http://backend:1103/health";
        let frontend_url = "http://frontend:1102/";
        if let Ok((200, body)) = worker
            .docker()
            .http_probe(backend_url, Duration::from_secs(10))
            .await
        {
            let json: serde_json::Value =
                serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
            let v = json.get("version").and_then(|v| v.as_str()).unwrap_or("");
            let db = json
                .get("db_connected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let mig = json
                .get("migrations_applied")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if target.matches_runtime_version(v) && db && mig {
                if let Ok((200, html)) = worker
                    .docker()
                    .http_probe(frontend_url, Duration::from_secs(10))
                    .await
                {
                    // Frontend embeds full MYRIAD_VERSION; accept exact or commit-prefix match.
                    let meta_ok = html.contains(&format!(
                        r#"name="myriad-version" content="{}""#,
                        target.as_str()
                    )) || frontend_meta_matches(&html, target);
                    if meta_ok {
                        ok_streak += 1;
                        if ok_streak >= 3 {
                            return Ok(());
                        }
                        continue;
                    }
                }
            }
        }
        ok_streak = 0;
        let _ = crate::worker::machine::heartbeat(worker.state());
    }
    Err(UpdaterError::Precondition(format!(
        "health probe deadline ({}s) exceeded",
        deadline.as_secs()
    )))
}

fn frontend_meta_matches(html: &str, target: &DeployTag) -> bool {
    // Parse content="..." of myriad-version meta loosely.
    let marker = r#"name="myriad-version" content=""#;
    let Some(idx) = html.find(marker) else {
        return false;
    };
    let rest = &html[idx + marker.len()..];
    let Some(end) = rest.find('"') else {
        return false;
    };
    let reported = &rest[..end];
    target.matches_runtime_version(reported)
}
