//! Authenticated store stats report (browser fallback → backend → edge HMAC).
//! Only counts apps the caller actually has installed on this instance.

use super::{api_http_error, ApiResponse};
use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde::Deserialize;

use crate::error::HttpError;
use crate::middleware::auth::Claims;
use crate::models::entities::tapps;
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
pub(super) async fn report_store_stats(
    State(db): State<DatabaseConnection>,
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

    // Precision: only count if this user (or any install row they can see) has the app.
    // Temporary installs are under the user's id; public under admin — check both via
    // any row matching tapp_id owned by this user, or (for admin) any site install.
    let installed = tapps::Entity::find()
        .filter(tapps::Column::TappId.eq(app_id))
        .filter(tapps::Column::UserId.eq(user_id))
        .one(&db)
        .await
        .map_err(|_| api_http_error(StatusCode::INTERNAL_SERVER_ERROR, "Database error"))?;

    let installed = match installed {
        Some(row) => Some(row),
        None => {
            // Admin may have installed into canonical public namespace under admin user id
            // different from claims.sub in rare cases — also accept if tapp exists and
            // reporter is the same as installation owner only. Keep strict: must own row.
            None
        }
    };

    let Some(row) = installed else {
        return Err(api_http_error(
            StatusCode::FORBIDDEN,
            "app is not installed for this user",
        ));
    };

    // Prefer DB version for idempotency material when present.
    let version_for_key = if !row.version.trim().is_empty() {
        row.version.trim()
    } else {
        version
    };

    let key = store_stats_beacon::daily_user_idempotency_key(
        user_id,
        app_id,
        version_for_key,
        event,
    );

    store_stats_beacon::spawn_store_stats_hit_with_key(
        app_id,
        version_for_key,
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
