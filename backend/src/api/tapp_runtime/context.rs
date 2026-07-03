//! 运行上下文 API

use axum::{extract::State, http::StatusCode, Extension, Json};
use sea_orm::DatabaseConnection;
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::middleware::auth::Claims;
use crate::services::tapp_api_service::{ApiExecutionContext, TappApiService};
use crate::GLOBAL_DYNAMIC_CONFIG;

use super::common::get_available_platforms;

/// GET /api/tapp/context/app
pub async fn get_context_app(
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::debug!("[TAPP] get_context_app - User: {}", claims.username);

    let config = GLOBAL_DYNAMIC_CONFIG.read().await;
    let platforms = get_available_platforms().await;

    Ok(Json(json!({
        "version": env!("CARGO_PKG_VERSION"),
        "locale": "zh-CN",
        "theme": "system",
        "features": {
            "aiEnabled": config.gemini_api_key.is_some() || config.openai_api_key.is_some(),
            "platforms": platforms
        }
    })))
}

/// GET /api/tapp/context/user
pub async fn get_context_user(
    State(_db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::debug!("[TAPP] get_context_user - User: {}", claims.username);

    let user_id: i32 = claims.sub.parse().map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid user" })),
        )
    })?;

    let connected_platforms = get_available_platforms().await;
    let role = if claims.is_admin { "admin" } else { "user" };

    Ok(Json(json!({
        "id": format!("user_{}", user_id),
        "username": claims.username,
        "avatar": null,
        "isAdmin": claims.is_admin,
        "role": role,
        "connectedPlatforms": connected_platforms,
        "preferences": {
            "language": "zh-CN",
            "timezone": "Asia/Shanghai"
        }
    })))
}

/// GET /api/tapp/context/player
pub async fn get_context_player(
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::debug!("[TAPP] get_context_player - User: {}", claims.username);

    Ok(Json(json!({
        "isPlaying": false,
        "isPaused": false,
        "currentTrack": null,
        "progress": { "current": 0, "duration": 0, "percentage": 0 },
        "playlist": null,
        "mode": "sequence",
        "volume": 80,
        "muted": false,
        "_note": "Real-time player state is provided via TappBridge events"
    })))
}

/// GET /api/tapp/context/navigation
pub async fn get_context_navigation(
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::debug!("[TAPP] get_context_navigation - User: {}", claims.username);

    Ok(Json(json!({
        "currentPath": "/",
        "previousPath": null,
        "history": [],
        "availableRoutes": [
            { "path": "/", "name": "home", "icon": "home" },
            { "path": "/library", "name": "library", "icon": "book" },
            { "path": "/reports", "name": "reports", "icon": "file-text" },
            { "path": "/settings", "name": "settings", "icon": "settings" }
        ],
        "tappPages": [],
        "_note": "Real-time navigation state is provided via TappBridge events"
    })))
}

/// GET /api/tapp/context/system
pub async fn get_context_system(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::debug!("[TAPP] get_context_system - User: {}", claims.username);

    let db_connected = db.ping().await.is_ok();
    let background_tasks: Vec<Value> = Vec::new();

    // 并行获取平台和文件元数据
    let platforms = get_available_platforms().await;
    let cache_dir = std::path::Path::new("cache/platforms");

    let mut last_fetch: HashMap<String, Option<String>> = HashMap::new();
    let futures: Vec<_> = platforms
        .iter()
        .map(|platform| {
            let file = cache_dir.join(format!("{}_filtered.json", platform));
            async move {
                if file.exists() {
                    if let Ok(metadata) = tokio::fs::metadata(&file).await {
                        if let Ok(modified) = metadata.modified() {
                            let datetime: chrono::DateTime<chrono::Utc> = modified.into();
                            return Some(datetime.to_rfc3339());
                        }
                    }
                }
                None
            }
        })
        .collect();

    let results = futures::future::join_all(futures).await;
    for (platform, result) in platforms.iter().zip(results) {
        last_fetch.insert(platform.to_string(), result);
    }

    Ok(Json(json!({
        "online": true,
        "serverConnected": db_connected,
        "version": env!("CARGO_PKG_VERSION"),
        "backgroundTasks": background_tasks,
        "lastFetch": last_fetch
    })))
}

/// GET /api/tapp/context/geo
pub async fn get_context_geo(
    headers: axum::http::HeaderMap,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    use crate::api::tapp_store::{TappApiAccess, TappApiDef};

    let client_ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| addr.ip().to_string());

    tracing::debug!("[TAPP] get_context_geo for IP: {}", client_ip);

    let context = ApiExecutionContext {
        user_id: -1,
        username: "guest".to_string(),
        is_admin: false,
        role: crate::services::permission_service::UserRole::Guest,
        client_ip: Some(client_ip),
        granted_permissions: vec![],
    };

    let geo_api = TappApiDef {
        access: TappApiAccess::Public,
        api_type: "builtin".to_string(),
        endpoint: None,
        url: None,
        params: None,
        method: "GET".to_string(),
        headers: None,
        body: None,
        builtin: Some("geo".to_string()),
        inject: None,
        cache_ttl: 300,
        spoof: None,
        description: Some("Get client geolocation".to_string()),
    };

    let result = TappApiService::execute("system", "geo", &geo_api, None, &context).await;

    if result.success {
        Ok(Json(
            json!({ "success": true, "data": result.data, "cached": result.cached }),
        ))
    } else {
        Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": result.error })),
        ))
    }
}
