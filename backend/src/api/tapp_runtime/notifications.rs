//! Tapp 通知 API。
//!
//! 前台与后台 Tapp 通知统一进入 `NotificationManager`；客户端不再直接维护
//! 一套 TappToast，通知面板、Toast、智能岛和系统通知都消费同一个事件。

use axum::{extract::State, http::StatusCode, Extension, Json};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::middleware::auth::Claims;
use crate::services::agent::notifications::get_notification_manager;
use crate::services::permission_service::TappPermission;

use super::common::authorize_tapp_permission;
use super::runtime_grant::RuntimeGrantContext;

#[derive(Debug, Deserialize)]
pub struct TappNotificationRequest {
    pub tapp_id: String,
    pub title: Option<String>,
    #[serde(default)]
    pub message: String,
    #[serde(default = "default_notification_type")]
    pub notification_type: String,
}

fn default_notification_type() -> String {
    "info".to_string()
}

/// POST /api/tapp/notifications
pub async fn create_tapp_notification(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
    Json(request): Json<TappNotificationRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require_tapp_id(&request.tapp_id)?;
    runtime_grant.require(TappPermission::UiNotification)?;
    let user_id = authorize_tapp_permission(
        &db,
        &claims,
        &request.tapp_id,
        TappPermission::UiNotification,
    )
    .await?;

    let notification_type = match request.notification_type.as_str() {
        "success" | "warning" | "error" | "danger" | "info" => request.notification_type.as_str(),
        _ => "info",
    };
    let manager = get_notification_manager().ok_or((
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({ "error": "Notification system not initialized" })),
    ))?;
    let title = request
        .title
        .as_deref()
        .map(|value| value.chars().take(200).collect::<String>());
    let message = request.message.chars().take(4000).collect::<String>();
    let notification_id = manager
        .notify_tapp(
            user_id,
            &request.tapp_id,
            title.as_deref(),
            &message,
            notification_type,
        )
        .await;
    Ok(Json(json!({
        "success": true,
        "notification_id": notification_id
    })))
}
