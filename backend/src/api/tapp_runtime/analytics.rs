//! Site analytics aggregates for Tapp runtimes (read-only).
//!
//! Exposes first-party visitor statistics already shown on the admin dashboard
//! / public visitor card — never visitor hashes or identity material.
//!
//! Permission: `analytics:read` (basic, guest-safe). Requires a Runtime Grant.

use axum::{
    extract::{Query, State},
    http::StatusCode,
    Extension, Json,
};
use sea_orm::DatabaseConnection;
use serde_json::{json, Value};

use crate::error::HttpError;
use crate::middleware::auth::Claims;
use crate::services::permission_service::TappPermission;

use super::runtime_grant::RuntimeGrantContext;

/// GET /api/tapp/analytics/summary?days=7 | ?from=&to=
///
/// Same aggregate payload shape as admin `GET /api/analytics/summary`
/// (today / range / daily / pages / events / referrers / countries).
pub async fn get_tapp_analytics_summary(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
    Query(q): Query<crate::api::analytics::SummaryQuery>,
) -> Result<Json<Value>, HttpError> {
    runtime_grant.require(TappPermission::AnalyticsRead)?;
    tracing::debug!(
        "[TAPP] analytics.summary user={} days={:?} from={:?} to={:?}",
        claims.username,
        q.days,
        q.from,
        q.to
    );

    let enabled = {
        let cfg = crate::GLOBAL_DYNAMIC_CONFIG.read().await;
        cfg.analytics_enabled
    };
    let (status, Json(mut body)) =
        crate::api::analytics::build_analytics_summary(&db, q).await;

    if status != StatusCode::OK {
        return Err(HttpError::from((status, Json(body))));
    }

    if let Some(obj) = body.as_object_mut() {
        obj.insert("enabled".into(), json!(enabled));
        obj.insert("source".into(), json!("site_analytics"));
    }

    Ok(Json(body))
}

/// GET /api/tapp/analytics/visitor
///
/// Public visitor-card aggregates (today / all-time / short trend).
/// Does not include per-visitor ordinals (those stay on the host visitor card).
pub async fn get_tapp_analytics_visitor(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
) -> Result<Json<Value>, HttpError> {
    runtime_grant.require(TappPermission::AnalyticsRead)?;
    tracing::debug!(
        "[TAPP] analytics.visitor user={}",
        claims.username
    );

    let enabled = {
        let cfg = crate::GLOBAL_DYNAMIC_CONFIG.read().await;
        cfg.analytics_enabled
    };
    if !enabled {
        return Ok(Json(json!({
            "success": true,
            "enabled": false,
            "source": "site_analytics",
        })));
    }

    let mut body = crate::api::analytics::visitor_card_aggregate(&db).await;
    if let Some(obj) = body.as_object_mut() {
        obj.insert("success".into(), json!(true));
        obj.insert("enabled".into(), json!(true));
        obj.insert("source".into(), json!("site_analytics"));
        // Host visitor card may add per-request ordinals; Tapp API never does.
        obj.remove("your_ordinal_today");
        obj.remove("counted");
    }

    Ok(Json(body))
}
