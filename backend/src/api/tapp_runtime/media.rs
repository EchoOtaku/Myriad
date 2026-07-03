//! 媒体控制 API

use axum::{http::StatusCode, Extension, Json};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::middleware::auth::Claims;
use crate::services::permission_service::TappPermission;

use super::common::check_tapp_permission;

#[derive(Debug, Deserialize)]
pub struct MediaControlRequest {
    pub tapp_id: String,
    pub action: String,
    pub value: Option<Value>,
}

/// POST /api/tapp/media/control
pub async fn media_control(
    Extension(claims): Extension<Claims>,
    Json(req): Json<MediaControlRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    check_tapp_permission(&claims, TappPermission::MediaControl).await?;

    tracing::info!(
        "[TAPP] media_control - User: {}, Tapp: {}, Action: {}",
        claims.username,
        req.tapp_id,
        req.action
    );

    let valid_actions = [
        "play", "pause", "next", "prev", "seek", "volume", "mode", "mute", "unmute",
    ];
    if !valid_actions.contains(&req.action.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": format!("Invalid action: {}", req.action) })),
        ));
    }

    match req.action.as_str() {
        "seek" => {
            if req.value.is_none() {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Seek action requires a position value" })),
                ));
            }
        }
        "volume" => {
            if let Some(val) = &req.value {
                if let Some(v) = val.as_f64() {
                    if !(0.0..=100.0).contains(&v) {
                        return Err((
                            StatusCode::BAD_REQUEST,
                            Json(json!({ "error": "Volume must be between 0 and 100" })),
                        ));
                    }
                }
            }
        }
        "mode" => {
            if let Some(val) = &req.value {
                let valid_modes = ["sequence", "loop", "shuffle", "single"];
                if let Some(mode) = val.as_str() {
                    if !valid_modes.contains(&mode) {
                        return Err((
                            StatusCode::BAD_REQUEST,
                            Json(json!({ "error": format!("Invalid mode: {}", mode) })),
                        ));
                    }
                }
            }
        }
        _ => {}
    }

    Ok(Json(json!({
        "success": true,
        "action": req.action,
        "value": req.value,
        "_note": "Media control is handled by TappBridge on the frontend"
    })))
}

/// GET /api/tapp/media/status
pub async fn media_status(
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::debug!("[TAPP] media_status - User: {}", claims.username);

    Ok(Json(json!({
        "success": true,
        "status": {
            "isPlaying": false,
            "isPaused": false,
            "currentTrack": null,
            "progress": { "current": 0, "duration": 0, "percentage": 0 },
            "playlist": null,
            "mode": "sequence",
            "volume": 80,
            "muted": false
        },
        "_note": "Real-time status is provided via TappBridge"
    })))
}
