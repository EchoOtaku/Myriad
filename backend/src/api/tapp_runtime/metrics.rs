//! Tapp 运行状态与速率限制 API

use axum::{extract::Path, http::StatusCode, Extension, Json};
use serde_json::{json, Value};

use crate::middleware::auth::{ensure_current_admin, Claims};

use super::common::{
    get_rate_limit_config, get_rate_limit_status_for, get_rate_limiter_active_count, PLATFORM_CACHE,
};

/// GET /api/tapp/metrics
pub async fn get_tapp_metrics(
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    ensure_current_admin(&claims).await?;

    let active_limits = get_rate_limiter_active_count().await;

    let platform_cache = PLATFORM_CACHE.read().await;
    let cached_platforms = platform_cache.len();

    Ok(Json(json!({
        "success": true,
        "rateLimiter": { "activeLimits": active_limits },
        "cache": { "platforms": cached_platforms }
    })))
}

/// GET /api/tapp/rate-limit/{tapp_id}
pub async fn get_rate_limit_status(
    Extension(claims): Extension<Claims>,
    Path(tapp_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user_id: i32 = claims.sub.parse().map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid user" })),
        )
    })?;

    let operations = ["ai.task", "platform.write", "storage.set"];
    let mut limits = Vec::new();

    for op in operations {
        let (limit, _window_secs) = get_rate_limit_config(op);
        let (used, remaining, reset_in) = get_rate_limit_status_for(user_id, &tapp_id, op).await;

        limits.push(json!({
            "operation": op,
            "limit": limit,
            "used": used,
            "remaining": remaining,
            "resetIn": reset_in
        }));
    }

    Ok(Json(json!({
        "success": true,
        "tappId": tapp_id,
        "limits": limits
    })))
}
