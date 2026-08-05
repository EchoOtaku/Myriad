//! Authenticated store stats report (browser fallback → backend → edge HMAC).

use super::{api_http_error, ApiResponse};
use axum::{
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use serde::Deserialize;

use crate::error::HttpError;
use crate::middleware::auth::Claims;
use crate::services::store_stats_beacon;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreStatsReportRequest {
    pub app_id: String,
    pub version: String,
    /// `install` | `update`
    pub event: String,
    /// Optional client session key; backend still binds to user+day for anti-spam.
    pub idempotency_key: Option<String>,
}

/// POST /api/tapps/store/stats-report
///
/// Cookie/JWT auth + CSRF (via global middleware). Never accepts anonymous edge hits.
pub(super) async fn report_store_stats(
    Extension(claims): Extension<Claims>,
    Json(req): Json<StoreStatsReportRequest>,
) -> Result<impl IntoResponse, HttpError> {
    let user_id: i32 = claims
        .sub
        .parse()
        .map_err(|_| api_http_error(StatusCode::UNAUTHORIZED, "Invalid user"))?;

    let app_id = req.app_id.trim();
    let version = req.version.trim();
    let event = req.event.trim();
    if app_id.is_empty() || version.is_empty() {
        return Err(api_http_error(
            StatusCode::BAD_REQUEST,
            "appId and version are required",
        ));
    }
    if !is_plausible_app_id(app_id) {
        return Err(api_http_error(StatusCode::BAD_REQUEST, "invalid appId"));
    }
    if version.len() > 64 {
        return Err(api_http_error(StatusCode::BAD_REQUEST, "invalid version"));
    }
    if event != "install" && event != "update" {
        return Err(api_http_error(
            StatusCode::BAD_REQUEST,
            "event must be install or update",
        ));
    }

    // One count per user / app / version / event / UTC day — retries safe.
    let key = store_stats_beacon::daily_user_idempotency_key(user_id, app_id, version, event);

    store_stats_beacon::spawn_store_stats_hit_with_key(
        app_id,
        version,
        event,
        Some(key),
    );

    Ok(Json(ApiResponse::success(serde_json::json!({
        "queued": true
    }))))
}

fn is_plausible_app_id(id: &str) -> bool {
    if id.len() < 3 || id.len() > 128 {
        return false;
    }
    // reverse-domain-ish: a.b...
    let mut parts = 0;
    for part in id.split('.') {
        if part.is_empty() || part.len() > 63 {
            return false;
        }
        if !part
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return false;
        }
        parts += 1;
    }
    parts >= 2
}
