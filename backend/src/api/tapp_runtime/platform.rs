//! 平台数据 API

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::middleware::auth::Claims;
use crate::services::permission_service::TappPermission;

use super::common::{
    acquire_platform_lock, authorize_tapp_permission, get_cached_platform_data,
    update_cached_platform_data, validate_platform_name,
};
use super::runtime_grant::RuntimeGrantContext;

#[derive(Debug, Deserialize)]
pub struct PlatformDataQuery {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// GET /api/tapp/platform/{platform}/data
pub async fn get_platform_data(
    State(_db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
    Path(platform): Path<String>,
    Query(query): Query<PlatformDataQuery>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require(TappPermission::PlatformRead)?;
    tracing::debug!(
        "[TAPP] get_platform_data - User: {}, Platform: {}",
        claims.username,
        platform
    );

    let data = match get_cached_platform_data(&platform).await {
        Ok(d) => d,
        Err(_) => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Platform data not found", "platform": platform })),
            ));
        }
    };

    let items = data
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let total = items.len();
    let offset = query.offset.unwrap_or(0) as usize;
    let limit = (query.limit.unwrap_or(100) as usize).min(1000);
    let paged_items: Vec<_> = items.into_iter().skip(offset).take(limit).collect();

    Ok(Json(json!({
        "platform": platform,
        "items": paged_items,
        "total": total,
        "offset": offset,
        "limit": limit
    })))
}

/// GET /api/tapp/platform/{platform}/stats
pub async fn get_platform_stats(
    State(_db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
    Path(platform): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require(TappPermission::PlatformRead)?;
    tracing::debug!(
        "[TAPP] get_platform_stats - User: {}, Platform: {}",
        claims.username,
        platform
    );

    let data = get_cached_platform_data(&platform)
        .await
        .unwrap_or(json!({ "items": [] }));
    let items = data
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let total = items.len();

    let mut type_distribution: HashMap<String, usize> = HashMap::new();
    for item in &items {
        if let Some(item_type) = item.get("type").and_then(|v| v.as_str()) {
            *type_distribution.entry(item_type.to_string()).or_default() += 1;
        }
    }

    Ok(Json(json!({
        "platform": platform,
        "total": total,
        "distribution": type_distribution,
        "recentActivity": []
    })))
}

/// GET /api/tapp/platform/{platform}/distribution/{dimension}
pub async fn get_platform_distribution(
    State(_db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
    Path((platform, dimension)): Path<(String, String)>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require(TappPermission::PlatformRead)?;
    tracing::debug!(
        "[TAPP] get_platform_distribution - User: {}, Platform: {}, Dimension: {}",
        claims.username,
        platform,
        dimension
    );

    let data = get_cached_platform_data(&platform)
        .await
        .unwrap_or(json!({ "items": [] }));
    let items = data
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut distribution: HashMap<String, usize> = HashMap::new();
    for item in &items {
        if let Some(value) = item.get(&dimension).and_then(|v| v.as_str()) {
            *distribution.entry(value.to_string()).or_default() += 1;
        }
    }

    let distribution_data: Vec<Value> = distribution
        .into_iter()
        .map(|(label, value)| json!({ "label": label, "value": value }))
        .collect();

    Ok(Json(json!({
        "dimension": dimension,
        "data": distribution_data
    })))
}

// ============ Platform Write API ============

#[derive(Debug, Deserialize)]
pub struct AddPlatformItemRequest {
    pub tapp_id: String,
    pub item: NewPlatformItem,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct NewPlatformItem {
    pub platform: String,
    #[serde(rename = "type")]
    pub item_type: String,
    pub title: String,
    pub cover: Option<String>,
    pub description: Option<String>,
    pub url: Option<String>,
    pub metadata: Option<Value>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PlatformItemResult {
    pub success: bool,
    #[serde(rename = "itemId")]
    pub item_id: String,
    pub source: String,
}

/// POST /api/tapp/platform/items
pub async fn add_platform_item(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
    Json(req): Json<AddPlatformItemRequest>,
) -> Result<Json<PlatformItemResult>, (StatusCode, Json<Value>)> {
    runtime_grant.require_tapp_id(&req.tapp_id)?;
    runtime_grant.require(TappPermission::PlatformWrite)?;
    authorize_tapp_permission(&db, &claims, &req.tapp_id, TappPermission::PlatformWrite).await?;

    validate_platform_name(&req.item.platform)
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))))?;

    tracing::info!(
        "[TAPP] add_platform_item - User: {}, Tapp: {}, Platform: {}",
        claims.username,
        req.tapp_id,
        req.item.platform
    );

    let item_id = format!("tapp_{}", uuid::Uuid::new_v4());

    let cache_dir = std::path::Path::new("cache/platforms");
    let cache_file = cache_dir.join(format!(
        "{}_filtered.json",
        req.item.platform.to_lowercase()
    ));

    let _platform_guard = acquire_platform_lock(&req.item.platform)
        .await
        .map_err(|error| (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))))?;
    tokio::fs::create_dir_all(cache_dir)
        .await
        .map_err(|error| {
            tracing::error!(
                "[TAPP] Failed to create platform cache directory: {}",
                error
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to save platform data" })),
            )
        })?;
    let mut data = match tokio::fs::read_to_string(&cache_file).await {
        Ok(content) => serde_json::from_str::<Value>(&content).map_err(|error| {
            tracing::error!("[TAPP] Invalid platform cache file: {}", error);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Invalid platform cache data" })),
            )
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({ "items": [] }),
        Err(error) => {
            tracing::error!("[TAPP] Failed to read platform cache: {}", error);
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to read platform data" })),
            ));
        }
    };

    let new_item = json!({
        "id": item_id,
        "type": req.item.item_type,
        "title": req.item.title,
        "cover": req.item.cover,
        "description": req.item.description,
        "url": req.item.url,
        "metadata": req.item.metadata,
        "createdAt": req.item.created_at.unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
        "source": format!("tapp:{}", req.tapp_id)
    });

    if let Some(items) = data.get_mut("items").and_then(|v| v.as_array_mut()) {
        items.push(new_item);
    }

    // 原子写入：先写临时文件再重命名，避免并发写入导致数据损坏
    let tmp_file = cache_file.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4()));
    let content = serde_json::to_string_pretty(&data).unwrap();
    if let Err(e) = tokio::fs::write(&tmp_file, &content).await {
        tracing::error!("[TAPP] Failed to write temp cache file: {}", e);
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to save platform data" })),
        ));
    }
    if let Err(e) = tokio::fs::rename(&tmp_file, &cache_file).await {
        tracing::error!("[TAPP] Failed to rename cache file: {}", e);
        let _ = tokio::fs::remove_file(&tmp_file).await;
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to save platform data" })),
        ));
    }
    update_cached_platform_data(&req.item.platform, data)
        .await
        .map_err(|error| {
            tracing::error!("[TAPP] Failed to refresh platform cache: {}", error);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to refresh platform data" })),
            )
        })?;

    Ok(Json(PlatformItemResult {
        success: true,
        item_id,
        source: format!("tapp:{}", req.tapp_id),
    }))
}

#[derive(Debug, Deserialize)]
pub struct AddPlatformItemsBatchRequest {
    pub tapp_id: String,
    pub items: Vec<NewPlatformItem>,
}

/// POST /api/tapp/platform/items/batch
pub async fn add_platform_items_batch(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
    Json(req): Json<AddPlatformItemsBatchRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require_tapp_id(&req.tapp_id)?;
    runtime_grant.require(TappPermission::PlatformWrite)?;
    authorize_tapp_permission(&db, &claims, &req.tapp_id, TappPermission::PlatformWrite).await?;

    tracing::info!(
        "[TAPP] add_platform_items_batch - User: {}, Tapp: {}, Count: {}",
        claims.username,
        req.tapp_id,
        req.items.len()
    );

    if req.items.len() > 500 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Too many items in batch (max 500)" })),
        ));
    }

    for item in &req.items {
        validate_platform_name(&item.platform)
            .map_err(|e| (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))))?;
    }

    let mut grouped_items: HashMap<String, Vec<&NewPlatformItem>> = HashMap::new();
    for item in &req.items {
        grouped_items
            .entry(item.platform.to_lowercase())
            .or_default()
            .push(item);
    }

    let mut results = Vec::new();
    let cache_dir = std::path::Path::new("cache/platforms");
    tokio::fs::create_dir_all(cache_dir)
        .await
        .map_err(|error| {
            tracing::error!(
                "[TAPP] Failed to create platform cache directory: {}",
                error
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Failed to save platform data" })),
            )
        })?;

    for (platform, items) in grouped_items {
        let cache_file = cache_dir.join(format!("{}_filtered.json", platform));
        let _platform_guard = acquire_platform_lock(&platform)
            .await
            .map_err(|error| (StatusCode::BAD_REQUEST, Json(json!({ "error": error }))))?;
        let result_start = results.len();

        let mut data = match tokio::fs::read_to_string(&cache_file).await {
            Ok(content) => serde_json::from_str::<Value>(&content).map_err(|error| {
                tracing::error!(
                    "[TAPP] Invalid platform cache file for {}: {}",
                    platform,
                    error
                );
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Invalid platform cache data" })),
                )
            })?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({ "items": [] }),
            Err(error) => {
                tracing::error!(
                    "[TAPP] Failed to read platform cache for {}: {}",
                    platform,
                    error
                );
                return Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Failed to read platform data" })),
                ));
            }
        };

        let data_items = data
            .as_object_mut()
            .and_then(|obj| obj.get_mut("items"))
            .and_then(|v| v.as_array_mut());

        if let Some(data_items) = data_items {
            for item in items {
                let item_id = format!("tapp_{}", uuid::Uuid::new_v4());

                let new_item = json!({
                    "id": item_id.clone(),
                    "type": item.item_type,
                    "title": item.title,
                    "cover": item.cover,
                    "description": item.description,
                    "url": item.url,
                    "metadata": item.metadata,
                    "createdAt": item.created_at.clone().unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                    "source": format!("tapp:{}", req.tapp_id)
                });

                data_items.push(new_item);
                results.push(json!({
                    "success": true,
                    "itemId": item_id,
                    "source": format!("tapp:{}", req.tapp_id)
                }));
            }
        } else {
            for _ in items {
                results.push(json!({ "success": false, "error": "Invalid cache file structure" }));
            }
            continue;
        }

        // 原子写入：先写临时文件再重命名
        let tmp_file = cache_file.with_extension(format!("json.{}.tmp", uuid::Uuid::new_v4()));
        let content = serde_json::to_string_pretty(&data).unwrap();
        let write_ok = match tokio::fs::write(&tmp_file, &content).await {
            Ok(_) => match tokio::fs::rename(&tmp_file, &cache_file).await {
                Ok(_) => true,
                Err(e) => {
                    tracing::error!("[TAPP] Failed to rename cache file for {}: {}", platform, e);
                    let _ = tokio::fs::remove_file(&tmp_file).await;
                    false
                }
            },
            Err(e) => {
                tracing::error!(
                    "[TAPP] Failed to write temp cache file for {}: {}",
                    platform,
                    e
                );
                false
            }
        };
        if !write_ok {
            for result in &mut results[result_start..] {
                *result = json!({ "success": false, "error": "Failed to save platform data" });
            }
        } else if let Err(error) = update_cached_platform_data(&platform, data).await {
            tracing::error!(
                "[TAPP] Failed to refresh platform cache for {}: {}",
                platform,
                error
            );
            for result in &mut results[result_start..] {
                *result = json!({ "success": false, "error": "Failed to refresh platform data" });
            }
        }
    }

    let success_count = results
        .iter()
        .filter(|r| r.get("success").and_then(|v| v.as_bool()).unwrap_or(false))
        .count();

    Ok(Json(json!({
        "success": success_count == results.len(),
        "results": results,
        "totalProcessed": results.len(),
        "successCount": success_count
    })))
}
