//! Route definitions.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    middleware,
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::api::{auth, ApiState};
use crate::error::UpdaterError;
use crate::release::Manifest;
use crate::state::Phase;
use crate::version::MyriadVersion;
use crate::worker::Command as WorkerCmd;

pub fn build(state: ApiState) -> Router {
    let public = Router::new()
        .route("/healthz", get(healthz))
        .route("/status", get(status))
        .route("/available", get(available))
        .route("/jobs", get(list_jobs))
        .route("/jobs/{id}", get(get_job))
        .route("/snapshots", get(list_snapshots));

    let token_only = Router::new()
        .route("/update", post(update))
        .route("/rollback", post(rollback))
        .route("/admin/self-update", post(self_update))
        .route("/diagnostics", get(diagnostics))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::token_required,
        ));

    let manual = Router::new()
        .route("/rescue/exit-maintenance", post(rescue_exit))
        .route("/rescue/continue", post(rescue_continue))
        .route("/rescue/forget-current", post(rescue_forget))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::token_and_manual_required,
        ));

    Router::new()
        .merge(public)
        .merge(token_only)
        .merge(manual)
        .with_state(state)
}

#[derive(Serialize)]
struct StatusResp {
    schema_version: u32,
    updater_version: String,
    current_version: Option<MyriadVersion>,
    channel: String,
    maintenance_active: bool,
    maintenance_phase: Phase,
    job_in_flight: Option<String>,
    /// Cached result of the last periodic `/available` check. UI uses this for a "new
    /// version" indicator without re-fetching from GitHub on every page render.
    latest_available: Option<crate::state::LatestAvailable>,
    /// True iff `latest_available.version > current_version` and not equal.
    update_available: bool,
    /// True iff the running updater is older than `latest_available.min_updater_version`.
    requires_self_update: bool,
    /// Last time the periodic check completed (success or failure).
    last_checked_at: Option<chrono::DateTime<chrono::Utc>>,
}

async fn healthz() -> Json<Value> {
    Json(json!({"ok": true}))
}

async fn status(State(st): State<ApiState>) -> Result<Json<StatusResp>, ApiError> {
    let u = st.state.read_updater()?;
    let m = st.state.read_maintenance()?;
    let job = st.state.read_current_job()?;

    let update_available = match (&u.current_version, &u.latest_available) {
        (Some(curr), Some(latest)) => curr.older_than(&latest.version),
        // No current version recorded (fresh install) — anything available counts as new.
        (None, Some(_)) => true,
        _ => false,
    };
    let requires_self_update = u
        .latest_available
        .as_ref()
        .is_some_and(|la| la.requires_self_update);

    Ok(Json(StatusResp {
        schema_version: 1,
        updater_version: crate::self_version().to_string(),
        current_version: u.current_version,
        channel: st.config.channel.to_string(),
        maintenance_active: m.active,
        maintenance_phase: m.phase,
        job_in_flight: job,
        latest_available: u.latest_available,
        update_available,
        requires_self_update,
        last_checked_at: u.last_checked_at,
    }))
}

#[derive(Deserialize)]
struct AvailableQuery {
    #[allow(dead_code)] // reserved for per-request channel override (M2)
    channel: Option<String>,
}

async fn available(
    State(st): State<ApiState>,
    Query(q): Query<AvailableQuery>,
) -> Result<Json<Option<Manifest>>, ApiError> {
    let _ = q; // future: per-request channel override
    let (tx, rx) = tokio::sync::oneshot::channel();
    st.worker
        .sender()
        .send(WorkerCmd::CheckUpdates { reply: tx })
        .await
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "worker unavailable".into()))?;
    let manifest = rx
        .await
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "worker dropped".into()))??;
    Ok(Json(manifest))
}

async fn list_jobs(State(st): State<ApiState>) -> Result<Json<Vec<String>>, ApiError> {
    let mut ids = st.state.list_jobs()?;
    ids.sort();
    Ok(Json(ids))
}

async fn get_job(
    State(st): State<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let job = st.state.read_job(&id)?;
    Ok(Json(serde_json::to_value(job)?))
}

async fn list_snapshots(State(st): State<ApiState>) -> Result<Json<Value>, ApiError> {
    let s = st.state.read_snapshots()?;
    Ok(Json(serde_json::to_value(s)?))
}

#[derive(Deserialize)]
struct UpdateBody {
    target_version: String,
    #[serde(default)]
    allow_skip_versions: bool,
}

async fn update(
    State(st): State<ApiState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<UpdateBody>,
) -> Result<Json<Value>, ApiError> {
    let _ = body.allow_skip_versions; // reserved
    let target = MyriadVersion::parse(&body.target_version).map_err(ApiError::from)?;
    let idem = headers
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let (tx, rx) = tokio::sync::oneshot::channel();
    st.worker
        .sender()
        .send(WorkerCmd::Update {
            target,
            idempotency_key: idem,
            reply: tx,
        })
        .await
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "worker unavailable".into()))?;
    let job_id = rx
        .await
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "worker dropped".into()))??;
    Ok(Json(json!({"job_id": job_id})))
}

#[derive(Deserialize)]
struct RollbackBody {
    snapshot_id: String,
}

async fn self_update(State(st): State<ApiState>) -> Result<Json<Value>, ApiError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    st.worker
        .sender()
        .send(WorkerCmd::SelfUpdate { reply: tx })
        .await
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "worker unavailable".into()))?;
    let report = rx
        .await
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "worker dropped".into()))??;
    Ok(Json(json!({
        "ok": true,
        "helper_container_id": report.helper_container_id,
        "new_updater_tag": report.new_updater_tag,
    })))
}

async fn rollback(
    State(st): State<ApiState>,
    Json(body): Json<RollbackBody>,
) -> Result<Json<Value>, ApiError> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    st.worker
        .sender()
        .send(WorkerCmd::Rollback {
            snapshot_id: body.snapshot_id,
            reply: tx,
        })
        .await
        .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "worker unavailable".into()))?;
    let job_id = rx
        .await
        .map_err(|_| ApiError(StatusCode::INTERNAL_SERVER_ERROR, "worker dropped".into()))??;
    Ok(Json(json!({"job_id": job_id})))
}

async fn diagnostics(State(st): State<ApiState>) -> Result<Json<Value>, ApiError> {
    let updater = st.state.read_updater()?;
    let maintenance = st.state.read_maintenance()?;
    let snapshots = st.state.read_snapshots()?;
    let env_probe_path = st.state.root().join("env-probe.json");
    let env_probe = std::fs::read_to_string(&env_probe_path)
        .ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok());
    let history =
        crate::state::history::tail(&st.state.root().join("history.log"), 100).unwrap_or_default();
    Ok(Json(json!({
        "updater_version": crate::self_version(),
        "config": {
            "channel": st.config.channel.to_string(),
            "registry_mirror": st.config.registry_mirror,
            "check_interval_secs": st.config.check_interval_secs,
        },
        "state": {
            "updater": updater,
            "maintenance": maintenance,
            "snapshots": snapshots,
            "env_probe": env_probe,
            "history_tail": history,
        }
    })))
}

async fn rescue_exit(State(st): State<ApiState>) -> Result<Json<Value>, ApiError> {
    st.state.clear_maintenance()?;
    st.state.set_current_job(None)?;
    st.state
        .append_history("rescue: exit_maintenance via API")?;
    Ok(Json(json!({"ok": true})))
}

async fn rescue_continue(State(_st): State<ApiState>) -> Result<Json<Value>, ApiError> {
    // M1: no automatic continuation; require explicit rollback or exit.
    Err(ApiError(
        StatusCode::NOT_IMPLEMENTED,
        "rescue/continue is reserved for M2; use /rescue/forget-current + /rollback".into(),
    ))
}

async fn rescue_forget(State(st): State<ApiState>) -> Result<Json<Value>, ApiError> {
    st.state.set_current_job(None)?;
    st.state.append_history("rescue: forget-current via API")?;
    Ok(Json(json!({"ok": true})))
}

// ----- error mapping -----

pub struct ApiError(pub StatusCode, pub String);

impl<E: Into<UpdaterError>> From<E> for ApiError {
    fn from(e: E) -> Self {
        let e = e.into();
        let status = match &e {
            UpdaterError::Unauthorized => StatusCode::UNAUTHORIZED,
            UpdaterError::Conflict => StatusCode::CONFLICT,
            UpdaterError::NotFound(_) => StatusCode::NOT_FOUND,
            UpdaterError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            UpdaterError::Precondition(_) => StatusCode::PRECONDITION_FAILED,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        ApiError(status, e.to_string())
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let body = Json(json!({"error": self.1}));
        (self.0, body).into_response()
    }
}
