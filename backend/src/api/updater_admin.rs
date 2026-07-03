//! Admin-only proxy to the Myriad updater. All routes require `admin_middleware`.
//!
//! The backend holds `UPDATE_TOKEN` server-side; the browser never sees it.
//! See docs/updater-spec.md §13 for the upstream contract.
//!
//! The `UpdaterClient` is stashed in a process-global `OnceLock` so handlers don't need to
//! thread axum `State` through — this matches the style of the rest of `backend/src/main.rs`,
//! which constructs the `Router` without a generic state parameter.

use std::sync::OnceLock;

use axum::{
    extract::{Path, Query},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::services::updater_client::{UpdaterClient, UpdaterClientError};

/// Holds the optional client. `None` means "no updater configured" — we still want the routes
/// to exist (so admins get a predictable 503 instead of a 404) but mutating calls will refuse.
static UPDATER: OnceLock<Option<UpdaterClient>> = OnceLock::new();

/// Initialise the client. Call once during backend startup.
pub fn init(client: Option<UpdaterClient>) {
    if UPDATER.set(client).is_err() {
        tracing::warn!("updater_admin::init called twice; ignoring later call");
    }
}

fn client() -> Option<&'static UpdaterClient> {
    UPDATER.get().and_then(|c| c.as_ref())
}

fn err_to_response(e: UpdaterClientError) -> Response {
    let status = e.status();
    let body = Json(json!({ "error": e.to_string() }));
    (status, body).into_response()
}

fn require() -> Result<&'static UpdaterClient, Box<Response>> {
    client().ok_or_else(|| {
        Box::new(
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "error": "updater service is not configured on this backend",
                    "hint": "set MYRIAD_UPDATER_URL and UPDATE_TOKEN in backend environment"
                })),
            )
                .into_response(),
        )
    })
}

pub async fn status() -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    match c.get_json("/status").await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

#[derive(Deserialize)]
pub struct AvailableQuery {
    #[serde(default)]
    pub channel: Option<String>,
}

pub async fn available(Query(q): Query<AvailableQuery>) -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    let path = match q.channel.as_deref() {
        Some(ch) if !ch.is_empty() => format!("/available?channel={ch}"),
        _ => "/available".to_string(),
    };
    match c.get_json(&path).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

pub async fn jobs() -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    match c.get_json("/jobs").await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

pub async fn job(Path(id): Path<String>) -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "invalid job id" })),
        )
            .into_response();
    }
    match c.get_json(&format!("/jobs/{id}")).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

pub async fn snapshots() -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    match c.get_json("/snapshots").await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

#[derive(Deserialize)]
pub struct UpdateBody {
    pub target_version: String,
    #[serde(default)]
    pub allow_skip_versions: bool,
}

pub async fn trigger_update(headers: HeaderMap, Json(body): Json<UpdateBody>) -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    if !c.has_token() {
        return token_missing();
    }
    let idem = headers
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let payload = json!({
        "target_version": body.target_version,
        "allow_skip_versions": body.allow_skip_versions,
    });
    match c
        .post_json("/update", Some(&payload), idem.as_deref())
        .await
    {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

#[derive(Deserialize)]
pub struct RollbackBody {
    pub snapshot_id: String,
}

pub async fn rollback(Json(body): Json<RollbackBody>) -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    if !c.has_token() {
        return token_missing();
    }
    let payload = json!({ "snapshot_id": body.snapshot_id });
    match c.post_json("/rollback", Some(&payload), None).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

pub async fn diagnostics() -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    if !c.has_token() {
        return token_missing();
    }
    match c.get_json("/diagnostics").await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

pub async fn exit_maintenance() -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    if !c.has_token() {
        return token_missing();
    }
    match c
        .post_json::<Value>("/rescue/exit-maintenance", None, None)
        .await
    {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

pub async fn forget_current() -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    if !c.has_token() {
        return token_missing();
    }
    match c
        .post_json::<Value>("/rescue/forget-current", None, None)
        .await
    {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

/// Trigger the updater's self-update flow. Spawns a helper container that replaces
/// the running updater after a short delay. See docs/updater-spec.md §14.
pub async fn self_update() -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    if !c.has_token() {
        return token_missing();
    }
    match c.post_json::<Value>("/admin/self-update", None, None).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

fn token_missing() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({
            "error": "backend is missing UPDATE_TOKEN; mutating updater requests are disabled",
            "hint": "set UPDATE_TOKEN env var on the backend container"
        })),
    )
        .into_response()
}
