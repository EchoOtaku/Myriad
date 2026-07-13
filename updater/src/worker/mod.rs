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
use std::time::Duration;

use chrono::Utc;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tracing::{error, info, warn};

use crate::config::{Channel, Config};
use crate::docker::DockerClient;
use crate::error::{Result, UpdaterError};
use crate::release::{GithubClient, Manifest};
use crate::state::{Job, JobKind, JobStatus, LatestAvailable, MaintenanceFile, Phase, StateDir};
use crate::version::{
    commit_branch_for_channel, DeployTag, DeployTagKind, MyriadVersion, UpdateMode,
};

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
        target: DeployTag,
        mode: UpdateMode,
        /// Required when target is older than current; UI must confirm first.
        allow_downgrade: bool,
        /// Umbrella for diverged / unknown / irreversible (see also granular flags).
        allow_risk: bool,
        allow_diverged: Option<bool>,
        allow_unknown: Option<bool>,
        allow_irreversible: Option<bool>,
        idempotency_key: Option<String>,
        reply: tokio::sync::oneshot::Sender<Result<String>>,
    },
    ListCommits {
        branch: String,
        limit: u32,
        reply: tokio::sync::oneshot::Sender<Result<Vec<crate::release::CommitInfo>>>,
    },
    ListReleases {
        channel: Option<String>,
        limit: u32,
        reply: tokio::sync::oneshot::Sender<Result<Vec<crate::release::github::Release>>>,
    },
    Compare {
        from: Option<String>,
        to: String,
        reply: tokio::sync::oneshot::Sender<Result<crate::release::Freshness>>,
    },
    Rollback {
        snapshot_id: String,
        reply: tokio::sync::oneshot::Sender<Result<String>>,
    },
    CheckUpdates {
        /// Ephemeral overrides — do NOT persist prefs (use SetPrefs for that).
        channel: Option<String>,
        mode: Option<UpdateMode>,
        reply: tokio::sync::oneshot::Sender<Result<Option<AvailableInfo>>>,
    },
    SetPrefs {
        channel: Option<String>,
        mode: Option<UpdateMode>,
        reply: tokio::sync::oneshot::Sender<Result<Prefs>>,
    },
    SelfUpdate {
        reply: tokio::sync::oneshot::Sender<Result<self_update::SelfUpdateReport>>,
    },
    Shutdown,
}

/// Unified "what's available" for both release and commit modes.
#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant)]
pub enum AvailableInfo {
    Release(Manifest),
    Commit {
        tag: DeployTag,
        full_sha: String,
        message: String,
        branch: String,
        notes_url: String,
        /// Ancestry of branch tip vs currently running deploy (if resolvable).
        freshness: Option<crate::release::Freshness>,
    },
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Prefs {
    pub channel: String,
    pub mode: UpdateMode,
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

    /// Reconcile persisted state with the version embedded in the running backend image.
    ///
    /// This runs once at daemon startup. The backend build stamp is the strongest source
    /// because mutable branch tags may have advanced since the currently running image was
    /// pulled. Older images do not expose `commit_sha`, so we fall back to resolving the
    /// deploy tag through GitHub. If the backend is not ready yet, MYRIAD_TAG from the managed
    /// `.env` still prevents a fresh/cleared state directory from reporting "unknown".
    pub async fn reconcile_current_deploy(&self) -> Result<()> {
        let mut st = self.state.read_updater()?;
        let previous_version = st.current_version.clone();

        let runtime = self.probe_runtime_identity().await;
        let env_version = crate::env_file::EnvFile::load(&self.cli.env_file)
            .ok()
            .and_then(|env| env.get("MYRIAD_TAG").map(str::to_owned))
            .and_then(|raw| match DeployTag::parse(&raw) {
                Ok(tag) => Some(tag),
                Err(e) => {
                    warn!(value = %raw, err = %e, "ignoring invalid MYRIAD_TAG during startup reconciliation");
                    None
                }
            });

        let (version, embedded_sha, source) = match runtime {
            Some((version, sha)) => (Some(version), sha, "backend-health"),
            None => match env_version {
                Some(version) => (Some(version), None, "env-file"),
                None => (previous_version.clone(), None, "persisted-state"),
            },
        };
        let Some(version) = version else {
            warn!("current deploy version remains unknown after startup reconciliation");
            return Ok(());
        };

        let version_changed = previous_version.as_ref() != Some(&version);
        let mut commit_sha = embedded_sha.or_else(|| {
            version
                .commit_sha()
                .filter(|sha| sha.len() == 40)
                .map(str::to_owned)
        });

        if commit_sha.is_none() && version.kind() != DeployTagKind::Branch {
            let git_ref = crate::release::deploy_tag_to_git_ref(&version);
            match self.github_client() {
                Ok(gh) => match gh.resolve_commit(&git_ref).await {
                    Ok(info) => commit_sha = Some(info.sha),
                    Err(e) => {
                        warn!(tag = %version, err = %e, "could not resolve current deploy commit during startup");
                    }
                },
                Err(e) => {
                    warn!(tag = %version, err = %e, "GitHub client unavailable during startup reconciliation")
                }
            }
            if commit_sha.is_none() && !version_changed {
                commit_sha = st.current_commit_sha.clone();
            }
        } else if commit_sha.is_none() && version.kind() == DeployTagKind::Branch {
            // A mutable branch name only identifies the image that would be pulled now, not the
            // image already running. Wait for backend /health rather than persisting a false SHA.
            commit_sha = None;
        }

        let state_changed =
            version_changed || st.current_commit_sha != commit_sha || st.current_version.is_none();
        st.current_version = Some(version.clone());
        st.current_commit_sha = commit_sha.clone();
        if state_changed {
            self.state.write_updater(&st)?;
        }
        info!(
            version = %version,
            commit_sha = ?commit_sha,
            %source,
            "current deploy identity reconciled"
        );
        Ok(())
    }

    async fn probe_runtime_identity(&self) -> Option<(DeployTag, Option<String>)> {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(3))
            .build()
            .ok()?;
        let response = client
            .get("http://backend:1103/health")
            .send()
            .await
            .ok()?
            .error_for_status()
            .ok()?;
        let body: serde_json::Value = response.json().await.ok()?;
        runtime_identity_from_json(&body)
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
                        .send(Command::CheckUpdates {
                            channel: None,
                            mode: None,
                            reply: tx,
                        })
                        .await
                        .is_err()
                    {
                        // Worker dropped — exit the ticker too.
                        break;
                    }
                    match rx.await {
                        Ok(Ok(Some(AvailableInfo::Release(m)))) => {
                            tracing::info!(
                                target_version = %m.version,
                                channel = %m.channel,
                                "periodic check: release available"
                            );
                        }
                        Ok(Ok(Some(AvailableInfo::Commit {
                            tag,
                            branch,
                            freshness,
                            ..
                        }))) => {
                            tracing::info!(
                                target = %tag,
                                %branch,
                                relation = freshness
                                    .as_ref()
                                    .map(|f| f.relation.as_str())
                                    .unwrap_or("?"),
                                "periodic check: commit tip available"
                            );
                        }
                        Ok(Ok(None)) => {
                            tracing::debug!("periodic check: nothing available for channel");
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
                    mode,
                    allow_downgrade,
                    allow_risk,
                    allow_diverged,
                    allow_unknown,
                    allow_irreversible,
                    idempotency_key,
                    reply,
                } => {
                    let res = self
                        .clone()
                        .handle_update(
                            target,
                            mode,
                            allow_downgrade,
                            allow_risk,
                            allow_diverged,
                            allow_unknown,
                            allow_irreversible,
                            idempotency_key,
                        )
                        .await;
                    let _ = reply.send(res);
                }
                Command::ListCommits {
                    branch,
                    limit,
                    reply,
                } => {
                    let res = self.clone().handle_list_commits(branch, limit).await;
                    let _ = reply.send(res);
                }
                Command::ListReleases {
                    channel,
                    limit,
                    reply,
                } => {
                    let res = self.clone().handle_list_releases(channel, limit).await;
                    let _ = reply.send(res);
                }
                Command::Compare { from, to, reply } => {
                    let res = self.clone().handle_compare(from, to).await;
                    let _ = reply.send(res);
                }
                Command::Rollback { snapshot_id, reply } => {
                    let res = self.clone().handle_rollback(snapshot_id).await;
                    let _ = reply.send(res);
                }
                Command::CheckUpdates {
                    channel,
                    mode,
                    reply,
                } => {
                    let res = self.clone().handle_check_updates(channel, mode).await;
                    let _ = reply.send(res);
                }
                Command::SetPrefs {
                    channel,
                    mode,
                    reply,
                } => {
                    let res = self.clone().handle_set_prefs(channel, mode).await;
                    let _ = reply.send(res);
                }
                Command::SelfUpdate { reply } => {
                    let res = self_update::run(self.clone()).await;
                    let _ = reply.send(res);
                }
            }
        }
    }

    /// Effective channel: state preference, else config default.
    pub fn effective_channel(&self) -> String {
        self.state
            .read_updater()
            .ok()
            .map(|s| s.channel)
            .filter(|c| !c.is_empty())
            .unwrap_or_else(|| self.config.channel.to_string())
    }

    pub fn effective_mode(&self) -> UpdateMode {
        self.state
            .read_updater()
            .ok()
            .map(|s| s.update_mode)
            .unwrap_or(UpdateMode::Release)
    }

    #[allow(clippy::too_many_arguments)]
    async fn handle_update(
        self: Arc<Self>,
        target: DeployTag,
        mode: UpdateMode,
        allow_downgrade: bool,
        allow_risk: bool,
        allow_diverged: Option<bool>,
        allow_unknown: Option<bool>,
        allow_irreversible: Option<bool>,
        idempotency_key: Option<String>,
    ) -> Result<String> {
        if let Some(k) = &idempotency_key {
            let cache = self.idempotency.lock().await;
            if let Some((_, jid)) = cache.iter().find(|(kk, _)| kk == k) {
                return Ok(jid.clone());
            }
        }

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

        let job_id_clone = job_id.clone();
        let me = self.clone();
        let risk = preflight::RiskFlags::from_api(
            allow_downgrade,
            allow_risk,
            allow_diverged,
            allow_unknown,
            allow_irreversible,
        );
        tokio::spawn(async move {
            if let Err(e) = update::run(me.clone(), job_id_clone.clone(), target, mode, risk).await
            {
                error!(job = %job_id_clone, err = %e, "update flow exited with error");
            }
            let _ = me.state.set_current_job(None);
        });

        Ok(job_id)
    }

    async fn handle_list_commits(
        self: Arc<Self>,
        branch: String,
        limit: u32,
    ) -> Result<Vec<crate::release::CommitInfo>> {
        let branch = if branch.trim().is_empty() {
            commit_branch_for_channel(&self.effective_channel()).to_string()
        } else {
            commit_branch_for_channel(branch.trim()).to_string()
        };
        let gh = self.github_client()?;
        gh.list_commits(&branch, limit).await
    }

    async fn handle_list_releases(
        self: Arc<Self>,
        channel: Option<String>,
        limit: u32,
    ) -> Result<Vec<crate::release::github::Release>> {
        let ch_name = channel.filter(|c| !c.trim().is_empty()).unwrap_or_else(|| {
            crate::version::release_channel_name_for_self_update(&self.effective_channel())
                .to_string()
        });
        let ch: Channel = ch_name.parse().unwrap_or(self.config.channel);
        let gh = self.github_client()?;
        gh.list_releases_for_channel(ch, limit).await
    }

    async fn handle_compare(
        self: Arc<Self>,
        from: Option<String>,
        to: String,
    ) -> Result<crate::release::Freshness> {
        let gh = self.github_client()?;
        let current = match from {
            Some(s) if !s.trim().is_empty() => Some(DeployTag::parse(s.trim())?),
            _ => self.state.read_updater()?.current_version,
        };
        gh.compare_deploy_to_ref(current.as_ref(), to.trim())
            .await?
            .ok_or_else(|| {
                UpdaterError::Precondition(
                    "could not resolve current deploy tag to a git commit for comparison".into(),
                )
            })
    }

    async fn handle_set_prefs(
        self: Arc<Self>,
        channel: Option<String>,
        mode: Option<UpdateMode>,
    ) -> Result<Prefs> {
        let mut st = self.state.read_updater()?;
        if let Some(ch) = channel {
            let ch = ch.trim().to_ascii_lowercase();
            let mode_now = mode.unwrap_or(st.update_mode);
            validate_channel_for_mode(&ch, mode_now)?;
            st.channel = ch.clone();
            // Persist to .env so restarts keep the preference.
            if let Ok(mut env) = crate::env_file::EnvFile::load(&self.cli.env_file) {
                let _ = env.set("CHANNEL", &ch);
                let _ = env.save();
            }
        }
        if let Some(m) = mode {
            // Re-validate channel under new mode.
            validate_channel_for_mode(&st.channel, m)?;
            st.update_mode = m;
            if let Ok(mut env) = crate::env_file::EnvFile::load(&self.cli.env_file) {
                let _ = env.set("UPDATE_MODE", m.as_str());
                let _ = env.save();
            }
        }
        // Clear stale availability cache when prefs change.
        st.latest_available = None;
        let prefs = Prefs {
            channel: st.channel.clone(),
            mode: st.update_mode,
        };
        self.state.write_updater(&st)?;
        self.state.append_history(&format!(
            "prefs: channel={} mode={}",
            prefs.channel, prefs.mode
        ))?;
        Ok(prefs)
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

    async fn handle_check_updates(
        self: Arc<Self>,
        channel_override: Option<String>,
        mode_override: Option<UpdateMode>,
    ) -> Result<Option<AvailableInfo>> {
        // Ephemeral overrides for this check only — never write prefs here.
        // Only persist latest_available when checking the *saved* prefs; UI ephemeral
        // checks must not pollute status().
        let persist_cache = channel_override.is_none() && mode_override.is_none();
        let mode = mode_override.unwrap_or_else(|| self.effective_mode());
        let channel = channel_override
            .filter(|c| !c.trim().is_empty())
            .unwrap_or_else(|| self.effective_channel());
        match mode {
            UpdateMode::Release => self.check_release_available(&channel, persist_cache).await,
            UpdateMode::Commit => self.check_commit_available(&channel, persist_cache).await,
        }
    }

    async fn check_release_available(
        self: Arc<Self>,
        channel: &str,
        persist_cache: bool,
    ) -> Result<Option<AvailableInfo>> {
        let gh = self.github_client()?;
        let ch: Channel = channel.parse().unwrap_or(self.config.channel);
        let Some(rel) = gh.latest_for_channel(ch).await? else {
            if persist_cache {
                let mut st = self.state.read_updater()?;
                st.last_checked_at = Some(Utc::now());
                st.latest_available = None;
                self.state.write_updater(&st)?;
            }
            return Ok(None);
        };
        let manifest = gh.fetch_manifest(&rel.tag_name).await?;

        let self_v = MyriadVersion::parse(crate::self_version()).ok();
        let requires_self_update = manifest.updater.self_update_required
            || self_v
                .as_ref()
                .is_some_and(|v| v.older_than(&manifest.updater.min_updater_version));
        let target_tag = DeployTag::from_release(manifest.version.clone());
        let current_state = self.state.read_updater().ok();
        let current = current_state
            .as_ref()
            .and_then(|s| s.current_version.clone());
        // Prefer semver when both are releases; otherwise git ancestry.
        let (is_upgrade, is_downgrade, relation) = match (
            current.as_ref().and_then(|c| c.as_release()),
            target_tag.as_release(),
        ) {
            (None, _) => (Some(true), Some(false), Some("ahead".into())),
            (Some(c), Some(tgt)) if c.as_str() == tgt.as_str() => {
                (Some(false), Some(false), Some("identical".into()))
            }
            (Some(c), Some(tgt)) if c.older_than(&tgt) => {
                (Some(true), Some(false), Some("ahead".into()))
            }
            (Some(c), Some(tgt)) if tgt.older_than(&c) => {
                (Some(false), Some(true), Some("behind".into()))
            }
            _ => {
                // Cross-mode or non-orderable: try git compare.
                match gh
                    .compare_deploy_to_ref(current.as_ref(), target_tag.as_str())
                    .await
                {
                    Ok(Some(f)) => (
                        Some(f.is_upgrade()),
                        Some(f.is_downgrade()),
                        Some(f.relation.as_str().to_string()),
                    ),
                    _ => (None, None, Some("unknown".into())),
                }
            }
        };
        let target_commit_sha = match manifest.commit_sha.clone() {
            some @ Some(_) => some,
            None => gh
                .resolve_commit(&rel.tag_name)
                .await
                .ok()
                .map(|info| info.sha),
        };
        let cached = LatestAvailable {
            version: target_tag,
            channel: manifest.channel.clone(),
            mode: UpdateMode::Release,
            seen_at: Utc::now(),
            commit_sha: target_commit_sha,
            current_commit_sha: current_state.and_then(|s| s.current_commit_sha),
            relation,
            ahead_by: None,
            behind_by: None,
            is_upgrade,
            is_downgrade,
            requires_self_update,
            min_updater_version: Some(manifest.updater.min_updater_version.clone()),
            notes_url: manifest.notes_url.clone(),
        };

        if persist_cache {
            let mut st = self.state.read_updater()?;
            st.last_checked_at = Some(Utc::now());
            st.latest_available = Some(cached);
            self.state.write_updater(&st)?;
        }
        Ok(Some(AvailableInfo::Release(manifest)))
    }

    async fn check_commit_available(
        self: Arc<Self>,
        channel: &str,
        persist_cache: bool,
    ) -> Result<Option<AvailableInfo>> {
        let branch = commit_branch_for_channel(channel);
        let gh = self.github_client()?;
        let info = match gh.latest_commit_on_branch(branch).await {
            Ok(i) => i,
            Err(e) => {
                warn!(err = %e, %branch, "commit lookup failed");
                if persist_cache {
                    let mut st = self.state.read_updater()?;
                    st.last_checked_at = Some(Utc::now());
                    st.latest_available = None;
                    self.state.write_updater(&st)?;
                }
                return Err(e);
            }
        };
        let tag = DeployTag::parse(&format!("dev-{}", info.short_sha))?;
        let notes_url = info.html_url.clone();

        // Ancestry compare: current deploy tag → branch tip (not wall-clock time).
        let st_now = self.state.read_updater()?;
        let freshness = match gh
            .compare_deploy_to_ref(st_now.current_version.as_ref(), branch)
            .await
        {
            Ok(f) => f,
            Err(e) => {
                warn!(err = %e, "commit freshness compare failed");
                None
            }
        };
        if let Some(ref f) = freshness {
            info!(
                relation = f.relation.as_str(),
                ahead = f.ahead_by,
                behind = f.behind_by,
                current = ?f.current_sha,
                target = ?f.target_sha,
                "commit freshness vs branch tip"
            );
        }

        let cached = LatestAvailable {
            version: tag.clone(),
            channel: branch.to_string(),
            mode: UpdateMode::Commit,
            seen_at: Utc::now(),
            commit_sha: Some(info.sha.clone()),
            current_commit_sha: freshness
                .as_ref()
                .and_then(|f| f.current_sha.clone())
                .or_else(|| st_now.current_commit_sha.clone()),
            relation: freshness.as_ref().map(|f| f.relation.as_str().to_string()),
            ahead_by: freshness.as_ref().map(|f| f.ahead_by),
            behind_by: freshness.as_ref().map(|f| f.behind_by),
            is_upgrade: freshness.as_ref().map(|f| f.is_upgrade()),
            is_downgrade: freshness.as_ref().map(|f| f.is_downgrade()),
            requires_self_update: false,
            min_updater_version: None,
            notes_url: notes_url.clone(),
        };
        if persist_cache {
            let mut st = self.state.read_updater()?;
            st.last_checked_at = Some(Utc::now());
            st.latest_available = Some(cached);
            self.state.write_updater(&st)?;
        }
        Ok(Some(AvailableInfo::Commit {
            tag,
            full_sha: info.sha,
            message: info.message,
            branch: branch.to_string(),
            notes_url,
            freshness,
        }))
    }
}

fn runtime_identity_from_json(body: &serde_json::Value) -> Option<(DeployTag, Option<String>)> {
    let version = DeployTag::parse(body.get("version")?.as_str()?).ok()?;
    let commit_sha = body
        .get("commit_sha")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|sha| sha.len() == 40 && sha.bytes().all(|b| b.is_ascii_hexdigit()))
        .map(|sha| sha.to_ascii_lowercase());
    Some((version, commit_sha))
}

fn validate_channel_for_mode(channel: &str, mode: UpdateMode) -> Result<()> {
    if !matches!(channel, "stable" | "preview") {
        return Err(UpdaterError::InvalidInput(format!(
            "channel must be stable|preview, got {channel}"
        )));
    }
    match mode {
        UpdateMode::Release => Ok(()),
        // Commit tracking is only offered on the preview track.
        UpdateMode::Commit if channel == "preview" => Ok(()),
        UpdateMode::Commit => Err(UpdaterError::InvalidInput(format!(
            "commit mode is only allowed when channel=preview, got channel={channel}"
        ))),
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
#[allow(dead_code)]
pub(crate) fn set_phase(
    state: &StateDir,
    job_id: &str,
    from: Option<&DeployTag>,
    to: Option<&DeployTag>,
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

#[cfg(test)]
mod runtime_identity_tests {
    use super::*;

    #[test]
    fn parses_release_with_embedded_commit() {
        let body = serde_json::json!({
            "version": "v0.1.0",
            "commit_sha": "ABCDEF0123456789ABCDEF0123456789ABCDEF01"
        });
        let (version, sha) = runtime_identity_from_json(&body).expect("runtime identity");
        assert_eq!(version.as_str(), "v0.1.0");
        assert_eq!(
            sha.as_deref(),
            Some("abcdef0123456789abcdef0123456789abcdef01")
        );
    }

    #[test]
    fn keeps_version_when_old_health_has_no_commit() {
        let body = serde_json::json!({ "version": "dev-103a5ec" });
        let (version, sha) = runtime_identity_from_json(&body).expect("runtime identity");
        assert_eq!(version.as_str(), "dev-103a5ec");
        assert_eq!(sha, None);
    }

    #[test]
    fn ignores_invalid_commit_sha() {
        let body = serde_json::json!({
            "version": "v0.1.0",
            "commit_sha": "not-a-commit"
        });
        let (_, sha) = runtime_identity_from_json(&body).expect("runtime identity");
        assert_eq!(sha, None);
    }
}
