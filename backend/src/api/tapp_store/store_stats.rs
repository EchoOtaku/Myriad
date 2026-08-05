//! Authenticated store stats report (browser fallback → backend → edge HMAC).

use super::{api_http_error, ApiResponse};
use axum::{http::StatusCode, response::IntoResponse, Json};
use serde::Deserialize;

use crate::error::HttpError;
use crate::services::store_stats_beacon;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreStatsReportRequest {
    pub app_id: String,
    pub version: String,
    /// `install` | `update`
    pub event: String,
}

/// POST /api/tapps/store/stats-report
///
/// Logged-in clients (typically after browser store-install fallback) report
/// through the backend so the edge only accepts HMAC-signed myriad-backend hits.
pub(super) async fn report_store_stats(
    Json(req): Json<StoreStatsReportRequest>,
) -> Result<impl IntoResponse, HttpError> {
    let app_id = req.app_id.trim();
    let version = req.version.trim();
    let event = req.event.trim();
    if app_id.is_empty() || version.is_empty() {
        return Err(api_http_error(
            StatusCode::BAD_REQUEST,
            "appId and version are required",
        ));
    }
    if event != "install" && event != "update" {
        return Err(api_http_error(
            StatusCode::BAD_REQUEST,
            "event must be install or update",
        ));
    }

    // Fire-and-forget: never block UI; still try once so 401 surfaces in logs.
    store_stats_beacon::spawn_store_stats_hit(app_id, version, event);

    Ok(Json(ApiResponse::success(serde_json::json!({
        "queued": true
    }))))
}
