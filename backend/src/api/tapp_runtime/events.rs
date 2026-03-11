//! 事件总线 API

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::middleware::auth::Claims;
use crate::services::permission_service::TappPermission;

use super::common::check_tapp_permission;

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct PublishEventRequest {
    pub tapp_id: String,
    pub event_type: String,
    pub payload: Value,
    pub target: Option<String>,
}

/// POST /api/tapp/events/publish
pub async fn publish_event(
    Extension(claims): Extension<Claims>,
    Json(req): Json<PublishEventRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    check_tapp_permission(&claims, TappPermission::EventPublish).await?;

    tracing::info!(
        "[TAPP] publish_event - User: {}, Tapp: {}, Event: {}",
        claims.username, req.tapp_id, req.event_type
    );

    let event_id = format!("evt_{}_{}", req.event_type, uuid::Uuid::new_v4());
    let now = chrono::Utc::now().fixed_offset();

    Ok(Json(json!({
        "success": true,
        "event": {
            "id": event_id,
            "type": req.event_type,
            "tappId": req.tapp_id,
            "target": req.target.unwrap_or_else(|| "all".to_string()),
            "timestamp": now.to_rfc3339()
        },
        "_note": "Event routing is handled by TappBridge on the frontend"
    })))
}

/// GET /api/tapp/events/subscriptions/{tapp_id}
pub async fn get_event_subscriptions(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(tapp_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::debug!(
        "[TAPP] get_event_subscriptions - User: {}, Tapp: {}",
        claims.username, tapp_id
    );

    use crate::models::entities::tapp_storage;

    let user_id: i32 = claims.sub.parse().map_err(|_| {
        (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid user" })))
    })?;

    let item = tapp_storage::Entity::find()
        .filter(tapp_storage::Column::UserId.eq(user_id))
        .filter(tapp_storage::Column::TappId.eq(&tapp_id))
        .filter(tapp_storage::Column::Key.eq("_event_subscriptions"))
        .one(&db)
        .await
        .map_err(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Database error" })))
        })?;

    let subscriptions = item.map(|i| i.value).unwrap_or_else(|| json!([]));

    Ok(Json(json!({ "success": true, "tappId": tapp_id, "subscriptions": subscriptions })))
}

#[derive(Debug, Deserialize)]
pub struct UpdateSubscriptionsRequest {
    pub subscriptions: Vec<String>,
}

/// PUT /api/tapp/events/subscriptions/{tapp_id}
pub async fn update_event_subscriptions(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(tapp_id): Path<String>,
    Json(req): Json<UpdateSubscriptionsRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::info!(
        "[TAPP] update_event_subscriptions - User: {}, Tapp: {}, Count: {}",
        claims.username, tapp_id, req.subscriptions.len()
    );

    use crate::models::entities::tapp_storage;
    use sea_orm::{ActiveModelTrait, ActiveValue::NotSet, Set};

    let user_id: i32 = claims.sub.parse().map_err(|_| {
        (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid user" })))
    })?;

    let now = chrono::Utc::now().fixed_offset();
    let storage_key = "_event_subscriptions".to_string();

    let existing = tapp_storage::Entity::find()
        .filter(tapp_storage::Column::UserId.eq(user_id))
        .filter(tapp_storage::Column::TappId.eq(&tapp_id))
        .filter(tapp_storage::Column::Key.eq(&storage_key))
        .one(&db)
        .await
        .map_err(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Database error" })))
        })?;

    let subscriptions_value = json!(req.subscriptions);

    if let Some(existing) = existing {
        let mut active: tapp_storage::ActiveModel = existing.into();
        active.value = Set(subscriptions_value);
        active.updated_at = Set(now);
        active.update(&db).await.map_err(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Failed to update subscriptions" })))
        })?;
    } else {
        let storage = tapp_storage::ActiveModel {
            id: NotSet,
            tapp_id: Set(tapp_id.clone()),
            user_id: Set(user_id),
            key: Set(storage_key),
            value: Set(subscriptions_value),
            created_at: Set(now),
            updated_at: Set(now),
        };
        storage.insert(&db).await.map_err(|_| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "Failed to save subscriptions" })))
        })?;
    }

    Ok(Json(json!({ "success": true, "tappId": tapp_id, "subscriptions": req.subscriptions })))
}
