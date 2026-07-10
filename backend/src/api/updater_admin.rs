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
    /// Ephemeral override: `release` | `commit`. Must be forwarded to updater —
    /// UI channel checks rely on this when draft mode differs from saved prefs.
    #[serde(default)]
    pub mode: Option<String>,
}

pub async fn available(Query(q): Query<AvailableQuery>) -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    let mut parts = Vec::new();
    if let Some(ch) = q.channel.as_deref().filter(|s| !s.is_empty()) {
        parts.push(format!("channel={}", urlencoding_simple(ch)));
    }
    if let Some(m) = q.mode.as_deref().filter(|s| !s.is_empty()) {
        parts.push(format!("mode={}", urlencoding_simple(m)));
    }
    let path = if parts.is_empty() {
        "/available".to_string()
    } else {
        format!("/available?{}", parts.join("&"))
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
pub struct CommitsQuery {
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

pub async fn commits(Query(q): Query<CommitsQuery>) -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    let mut path = "/commits?".to_string();
    let mut parts = Vec::new();
    if let Some(b) = q.branch.as_deref().filter(|s| !s.is_empty()) {
        parts.push(format!("branch={b}"));
    }
    if let Some(n) = q.limit {
        parts.push(format!("limit={n}"));
    }
    path.push_str(&parts.join("&"));
    match c.get_json(&path).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

#[derive(Deserialize)]
pub struct ReleasesQuery {
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
}

pub async fn releases(Query(q): Query<ReleasesQuery>) -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    let mut parts = Vec::new();
    if let Some(ch) = q.channel.as_deref().filter(|s| !s.is_empty()) {
        parts.push(format!("channel={ch}"));
    }
    if let Some(n) = q.limit {
        parts.push(format!("limit={n}"));
    }
    let path = if parts.is_empty() {
        "/releases".to_string()
    } else {
        format!("/releases?{}", parts.join("&"))
    };
    match c.get_json(&path).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

#[derive(Deserialize)]
pub struct CompareQuery {
    #[serde(default)]
    pub from: Option<String>,
    pub to: String,
}

pub async fn compare(Query(q): Query<CompareQuery>) -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    let mut parts = vec![format!("to={}", urlencoding_simple(&q.to))];
    if let Some(f) = q.from.as_deref().filter(|s| !s.is_empty()) {
        parts.push(format!("from={}", urlencoding_simple(f)));
    }
    let path = format!("/compare?{}", parts.join("&"));
    match c.get_json(&path).await {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

fn urlencoding_simple(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[derive(Deserialize)]
pub struct UpdateBody {
    #[serde(default)]
    pub target_version: Option<String>,
    #[serde(default)]
    pub target_commit: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub allow_downgrade: bool,
    #[serde(default)]
    pub allow_risk: bool,
    #[serde(default)]
    pub allow_diverged: Option<bool>,
    #[serde(default)]
    pub allow_unknown: Option<bool>,
    #[serde(default)]
    pub allow_irreversible: Option<bool>,
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
    let mut payload = json!({
        "allow_skip_versions": body.allow_skip_versions,
        "allow_downgrade": body.allow_downgrade,
        "allow_risk": body.allow_risk,
    });
    if let Some(v) = body.target_version {
        payload["target_version"] = json!(v);
    }
    if let Some(v) = body.target_commit {
        payload["target_commit"] = json!(v);
    }
    if let Some(v) = body.mode {
        payload["mode"] = json!(v);
    }
    if let Some(v) = body.allow_diverged {
        payload["allow_diverged"] = json!(v);
    }
    if let Some(v) = body.allow_unknown {
        payload["allow_unknown"] = json!(v);
    }
    if let Some(v) = body.allow_irreversible {
        payload["allow_irreversible"] = json!(v);
    }
    match c
        .post_json("/update", Some(&payload), idem.as_deref())
        .await
    {
        Ok(v) => Json(v).into_response(),
        Err(e) => err_to_response(e),
    }
}

#[derive(Deserialize)]
pub struct PrefsBody {
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
}

pub async fn set_prefs(Json(body): Json<PrefsBody>) -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    if !c.has_token() {
        return token_missing();
    }
    let payload = json!({
        "channel": body.channel,
        "mode": body.mode,
    });
    match c.post_json("/prefs", Some(&payload), None).await {
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

/// One-click recovery: roll back to the snapshot on the stuck needs_manual job.
pub async fn rescue_continue() -> Response {
    let c = match require() {
        Ok(c) => c,
        Err(r) => return *r,
    };
    if !c.has_token() {
        return token_missing();
    }
    match c.post_json::<Value>("/rescue/continue", None, None).await {
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
