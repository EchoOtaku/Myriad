//! 当前用户的通知策略 API。

use axum::{http::StatusCode, Extension, Json};
use serde_json::{json, Value};

use crate::middleware::auth::Claims;
use crate::services::agent::notification_preferences::{
    NotificationPreferences, EVENT_DEFINITIONS, SOURCE_KEYS,
};
use crate::services::agent::notifications::get_notification_manager;

fn user_id(claims: &Claims) -> Result<i32, (StatusCode, Json<Value>)> {
    claims.sub.parse::<i32>().map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Invalid authenticated user"})),
        )
    })
}

pub async fn get_notification_preferences(
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user_id = user_id(&claims)?;
    let manager = get_notification_manager().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"error": "Notification system not initialized"})),
    ))?;
    let preferences = manager.notification_preferences(user_id).await;
    Ok(Json(json!({
        "success": true,
        "preferences": preferences,
        "catalog": {
            "sources": SOURCE_KEYS,
            "events": EVENT_DEFINITIONS,
        }
    })))
}

pub async fn update_notification_preferences(
    Extension(claims): Extension<Claims>,
    Json(payload): Json<NotificationPreferences>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let user_id = user_id(&claims)?;
    let manager = get_notification_manager().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"error": "Notification system not initialized"})),
    ))?;
    let preferences = manager
        .update_notification_preferences(user_id, payload)
        .await
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": error})),
            )
        })?;
    Ok(Json(json!({"success": true, "preferences": preferences})))
}
