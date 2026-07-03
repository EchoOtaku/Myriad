//! Update worker: serializes update/rollback jobs through a single-slot state machine.
//!
//! Concurrency model:
//! - The HTTP API never executes long-running work directly.
//! - It enqueues commands into a bounded MPSC channel consumed by a single worker task.
//! - The state machine ensures at most one job is in flight; further `update` requests get 409.

pub mod bootstrap_self;
pub mod machine;
pub mod preflight;
pub mod rollback;
pub mod self_update;
pub mod update;

use std::sync::Arc;

use chrono::Utc;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

use crate::config::Config;
use crate::docker::DockerClient;
use crate::error::{Result, UpdaterError};
use crate::release::{GithubClient, Manifest};
use crate::state::{Job, JobKind, JobStatus, MaintenanceFile, Phase, StateDir};
use crate::version::MyriadVersion;

/// CLI parameters shared with the worker.
#[derive(Debug, Clone)]
pub struct WorkerCli {
    pub state_dir: std::path::PathBuf,
    pub compose_dir: std::path::PathBuf,
    pub env_file: std::path::PathBuf,
    pub pgdata: std::path::PathBuf,
    pub listen: String,
}

#[derive(Debug)]
pub enum Command {
    Update {
        target: MyriadVersion,
        idempotency_key: Option<String>,
        reply: tokio::sync::oneshot::Sender<Result<String>>,
    },
    Rollback {
        snapshot_id: String,
        reply: tokio::sync::oneshot::Sender<Result<String>>,
    },
    CheckUpdates {
        reply: tokio::sync::oneshot::Sender<Result<Option<Manifest>>>,
    },
    SelfUpdate {
        reply: tokio::sync::oneshot::Sender<Result<self_update::SelfUpdateReport>>,
    },
    Shutdown,
}

pub struct Worker {
    state: Arc<StateDir>,
    docker: Arc<DockerClient>,
    config: Config,
    cli: WorkerCli,
    tx: mpsc::Sender<Command>,
    rx: Mutex<Option<mpsc::Receiver<Command>>>,
    /// Recent idempotency keys → job id.
    idempotency: Mutex<std::collections::VecDeque<(String, String)>>,
}

#[derive(Debug, Clone)]
pub enum RecoveryReport {
    Idle,
    ResumedRollback(String),
    NeedsManual {
        job_id: String,
        phase: Phase,
        reason: String,
    },
    ClearedPreSwap,
    NoChange,
}

impl Worker {
    pub fn new(
        state: Arc<StateDir>,
        docker: Arc<DockerClient>,
        config: Config,
        cli: WorkerCli,
    ) -> Self {
        let (tx, rx) = mpsc::channel(16);
        Self {
            state,
            docker,
            config,
            cli,
            tx,
            rx: Mutex::new(Some(rx)),
            idempotency: Mutex::new(std::collections::VecDeque::with_capacity(100)),
        }
    }

    pub fn cli(&self) -> &WorkerCli {
        &self.cli
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    pub fn state(&self) -> &Arc<StateDir> {
        &self.state
    }

    pub fn github_client(&self) -> Result<GithubClient> {
        use crate::release::CosignPolicy;
        let policy = CosignPolicy::from_env(Some(&self.config.cosign_verify));
        GithubClient::new(
            self.config.github_repo.clone(),
            self.config.github_token.clone(),
            self.state.cache_dir(),
            policy,
        )
    }

    pub fn docker(&self) -> &Arc<DockerClient> {
        &self.docker
    }

    /// Pull an image, applying REGISTRY_MIRROR rewriting if configured. Returns the digest
    /// of the pulled image (`sha256:...`).
    pub async fn docker_pull_with_mirror(&self, image_ref: &str) -> Result<String> {
        let actual_ref = match &self.config.registry_mirror {
            Some(mirror) => rewrite_with_mirror(image_ref, mirror),
            None => image_ref.to_string(),
        };
        let digest = self.docker.pull(&actual_ref, None).await?;
        // Strip "<image>@" prefix, keep only "sha256:..."
        Ok(digest.split('@').next_back().unwrap_or(&digest).to_string())
    }

    pub fn sender(&self) -> mpsc::Sender<Command> {
        self.tx.clone()
    }

    /// Try to recover from prior crash. Per spec §7.1 we are conservative: anything
    /// post-`swap_tag` becomes `needs_manual` unless we were specifically in a rollback flow.
    pub async fn recover_or_idle(
        state: Arc<StateDir>,
        _docker: Arc<DockerClient>,
    ) -> Result<RecoveryReport> {
        let maint = state.read_maintenance()?;
        if !maint.active {
            return Ok(RecoveryReport::Idle);
        }
        let job_id = match maint.job_id.clone() {
            Some(id) => id,
            None => {
                warn!("maintenance active but no job_id; clearing");
                state.clear_maintenance()?;
                return Ok(RecoveryReport::ClearedPreSwap);
            }
        };
        let mut job = match state.read_job(&job_id) {
            Ok(j) => j,
            Err(_) => {
                warn!(%job_id, "maintenance references missing job; clearing");
                state.clear_maintenance()?;
                return Ok(RecoveryReport::ClearedPreSwap);
            }
        };

        if maint.phase.is_post_swap() || maint.phase.is_rollback() {
            // We must not re-attempt destructive operations from a half-known state.
            job.status = JobStatus::NeedsManual;
            let last_phase = maint.phase;
            let reason = format!(
                "recovered into post-swap phase {:?}; manual intervention required",
                last_phase
            );
            job.steps
                .push(crate::state::JobStep::start(Phase::NeedsManual));
            if let Some(step) = job.steps.last_mut() {
                step.finish_err(reason.clone());
            }
            state.write_job(&job)?;
            state.append_history(&format!(
                "recovery: job {} stuck at {:?}; needs_manual",
                job_id, last_phase
            ))?;

            let mut maint = maint;
            maint.phase = Phase::NeedsManual;
            maint.message_key = "updater.phase.needs_manual".into();
            maint.bump_heartbeat();
            state.write_maintenance(&maint)?;

            return Ok(RecoveryReport::NeedsManual {
                job_id,
                phase: last_phase,
                reason,
            });
        }

        // Pre-swap: safe to clear and return to idle.
        info!(%job_id, phase = ?maint.phase, "recovery: clearing pre-swap maintenance state");
        state.clear_maintenance()?;
        state.set_current_job(None)?;
        if matches!(job.status, JobStatus::Running | JobStatus::Pending) {
            job.status = JobStatus::Failed;
            job.finished_at = Some(Utc::now());
        }
        state.write_job(&job)?;
        state.append_history(&format!("recovery: pre-swap cleanup for job {job_id}"))?;
        Ok(RecoveryReport::ClearedPreSwap)
    }

    /// Spawn the worker loop AND, if configured, the periodic update checker.
    /// The returned handle resolves when the main loop exits.
    pub fn spawn(self: Arc<Self>) -> JoinHandle<()> {
        let rx = self
            .rx
            .try_lock()
            .expect("spawn() called twice")
            .take()
            .expect("worker rx already taken");
        let me = self.clone();

        // Periodic GitHub release poller. Each tick enqueues a CheckUpdates command into the
        // same single-slot worker channel, so it serialises with manual `/available` calls
        // and never overlaps with an in-flight update.
        if me.config.check_interval_secs > 0 {
            let ticker_worker = me.clone();
            let interval_secs = me.config.check_interval_secs;
            tokio::spawn(async move {
                // Initial delay so we don't hammer GitHub on a crash-loop restart.
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                let mut interval =
                    tokio::time::interval(std::time::Duration::from_secs(interval_secs));
                interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                loop {
                    interval.tick().await;
                    let (tx, rx) = tokio::sync::oneshot::channel();
                    if ticker_worker
                        .tx
                        .send(Command::CheckUpdates { reply: tx })
                        .await
                        .is_err()
                    {
                        // Worker dropped — exit the ticker too.
                        break;
                    }
                    match rx.await {
                        Ok(Ok(Some(m))) => {
                            tracing::info!(
                                target_version = %m.version,
                                channel = %m.channel,
                                "periodic check: release available"
                            );
                        }
                        Ok(Ok(None)) => {
                            tracing::debug!("periodic check: no release for channel");
                        }
                        Ok(Err(e)) => {
                            tracing::warn!(err = %e, "periodic check: github lookup failed");
                        }
                        Err(_) => break, // worker shutdown
                    }
                }
            });
        }

        tokio::spawn(async move {
            me.run(rx).await;
        })
    }

    pub async fn shutdown(&self) {
        let _ = self.tx.send(Command::Shutdown).await;
    }

    async fn run(self: Arc<Self>, mut rx: mpsc::Receiver<Command>) {
        info!("worker loop started");
        while let Some(cmd) = rx.recv().await {
            match cmd {
                Command::Shutdown => {
                    info!("worker shutting down");
                    break;
                }
                Command::Update {
                    target,
                    idempotency_key,
                    reply,
                } => {
                    let res = self.clone().handle_update(target, idempotency_key).await;
                    let _ = reply.send(res);
                }
                Command::Rollback { snapshot_id, reply } => {
                    let res = self.clone().handle_rollback(snapshot_id).await;
                    let _ = reply.send(res);
                }
                Command::CheckUpdates { reply } => {
                    let res = self.clone().handle_check_updates().await;
                    let _ = reply.send(res);
                }
                Command::SelfUpdate { reply } => {
                    let res = self_update::run(self.clone()).await;
                    let _ = reply.send(res);
                }
            }
        }
    }

    async fn handle_update(
        self: Arc<Self>,
        target: MyriadVersion,
        idempotency_key: Option<String>,
    ) -> Result<String> {
        // Idempotency: short-circuit on duplicate key.
        if let Some(k) = &idempotency_key {
            let cache = self.idempotency.lock().await;
            if let Some((_, jid)) = cache.iter().find(|(kk, _)| kk == k) {
                return Ok(jid.clone());
            }
        }

        // Conflict if there's already an in-flight job.
        if let Some(_existing) = self.state.read_current_job()? {
            return Err(UpdaterError::Conflict);
        }

        let job_id = uuid::Uuid::new_v4().simple().to_string();
        let from_version = self.state.read_updater()?.current_version;
        let job = Job {
            id: job_id.clone(),
            kind: JobKind::Update,
            created_at: Utc::now(),
            finished_at: None,
            from_version,
            to_version: Some(target.clone()),
            snapshot_id: None,
            status: JobStatus::Pending,
            steps: Vec::new(),
            idempotency_key: idempotency_key.clone(),
        };
        self.state.write_job(&job)?;
        self.state.set_current_job(Some(&job_id))?;

        if let Some(k) = idempotency_key {
            let mut cache = self.idempotency.lock().await;
            cache.push_back((k, job_id.clone()));
            if cache.len() > 100 {
                cache.pop_front();
            }
        }

        // Run the update synchronously within the worker task. The HTTP API has already
        // returned the job id by the time this method finishes — see api/routes.rs.
        let job_id_clone = job_id.clone();
        let me = self.clone();
        tokio::spawn(async move {
            if let Err(e) = update::run(me.clone(), job_id_clone.clone(), target).await {
                error!(job = %job_id_clone, err = %e, "update flow exited with error");
            }
            let _ = me.state.set_current_job(None);
        });

        Ok(job_id)
    }

    async fn handle_rollback(self: Arc<Self>, snapshot_id: String) -> Result<String> {
        if let Some(_existing) = self.state.read_current_job()? {
            return Err(UpdaterError::Conflict);
        }
        let job_id = uuid::Uuid::new_v4().simple().to_string();
        let job = Job {
            id: job_id.clone(),
            kind: JobKind::Rollback,
            created_at: Utc::now(),
            finished_at: None,
            from_version: self.state.read_updater()?.current_version,
            to_version: None,
            snapshot_id: Some(snapshot_id.clone()),
            status: JobStatus::Pending,
            steps: Vec::new(),
            idempotency_key: None,
        };
        self.state.write_job(&job)?;
        self.state.set_current_job(Some(&job_id))?;

        let me = self.clone();
        let id = job_id.clone();
        tokio::spawn(async move {
            if let Err(e) = rollback::run(me.clone(), id.clone(), snapshot_id).await {
                error!(job = %id, err = %e, "rollback flow exited with error");
            }
            let _ = me.state.set_current_job(None);
        });
        Ok(job_id)
    }

    async fn handle_check_updates(self: Arc<Self>) -> Result<Option<Manifest>> {
        let gh = self.github_client()?;
        let Some(rel) = gh.latest_for_channel(self.config.channel).await? else {
            // Clear cached latest_available when the channel has no releases anymore.
            let mut st = self.state.read_updater()?;
            st.last_checked_at = Some(Utc::now());
            st.latest_available = None;
            self.state.write_updater(&st)?;
            return Ok(None);
        };
        let manifest = gh.fetch_manifest(&rel.tag_name).await?;

        // Cache the cheap-to-render bits for UI consumption. The full manifest is
        // re-fetched on demand by `/available`.
        let self_v = MyriadVersion::parse(crate::self_version()).ok();
        let requires_self_update = manifest.updater.self_update_required
            || self_v
                .as_ref()
                .is_some_and(|v| v.older_than(&manifest.updater.min_updater_version));
        let cached = crate::state::LatestAvailable {
            version: manifest.version.clone(),
            channel: manifest.channel.clone(),
            seen_at: Utc::now(),
            requires_self_update,
            min_updater_version: Some(manifest.updater.min_updater_version.clone()),
            notes_url: manifest.notes_url.clone(),
        };

        let mut st = self.state.read_updater()?;
        st.last_checked_at = Some(Utc::now());
        st.latest_available = Some(cached);
        self.state.write_updater(&st)?;
        Ok(Some(manifest))
    }
}

fn rewrite_with_mirror(image_ref: &str, mirror: &str) -> String {
    // image_ref looks like "docker.io/foo/bar:v1". Replace the registry host with `mirror`.
    let mirror = mirror.trim_end_matches('/');
    match image_ref.split_once('/') {
        Some((_host, rest)) => format!("{mirror}/{rest}"),
        None => format!("{mirror}/{image_ref}"),
    }
}

/// Helper used by the maintenance/state-machine layer to update maintenance.json.
#[allow(dead_code)] // kept for ad-hoc tests and future rescue-API growth
pub(crate) fn set_phase(
    state: &StateDir,
    job_id: &str,
    from: Option<&MyriadVersion>,
    to: Option<&MyriadVersion>,
    phase: Phase,
    message_key: &str,
) -> Result<()> {
    let m = MaintenanceFile {
        schema_version: 1,
        active: !matches!(phase, Phase::Idle),
        phase,
        from_version: from.cloned(),
        to_version: to.cloned(),
        started_at: Some(Utc::now()),
        updated_at: Utc::now(),
        job_id: Some(job_id.to_string()),
        message_key: message_key.to_string(),
    };
    state.write_maintenance(&m)
}
