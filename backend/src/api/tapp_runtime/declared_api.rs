//! Tapp API 声明系统

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use once_cell::sync::Lazy;
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::api::tapp_store::{TappApiAccess, TappApiDef};
use crate::middleware::auth::Claims;
use crate::models::entities::tapps;
use crate::services::tapp_api_service::{ApiExecutionContext, TappApiService};

// ============ Manifest API 解析缓存 ============

/// 缓存条目：已解析的 API 定义 + 缓存时间
struct ApisCacheEntry {
    apis: HashMap<String, TappApiDef>,
    cached_at: Instant,
}

/// 全局缓存（tapp_id → 解析结果，5 分钟 TTL）
static TAPP_APIS_CACHE: Lazy<Arc<RwLock<HashMap<String, ApisCacheEntry>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

const APIS_CACHE_TTL: Duration = Duration::from_secs(300);

/// 从 manifest JSON 解析 API 定义，优先命中内存缓存
async fn get_tapp_apis(tapp_id: &str, manifest: &Value) -> HashMap<String, TappApiDef> {
    // 读缓存
    {
        let cache = TAPP_APIS_CACHE.read().await;
        if let Some(entry) = cache.get(tapp_id) {
            if entry.cached_at.elapsed() < APIS_CACHE_TTL {
                return entry.apis.clone();
            }
        }
    }

    // 缓存未命中，解析 manifest
    let apis: HashMap<String, TappApiDef> = manifest
        .get("apis")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();

    // 写缓存
    {
        let mut cache = TAPP_APIS_CACHE.write().await;
        cache.insert(
            tapp_id.to_string(),
            ApisCacheEntry {
                apis: apis.clone(),
                cached_at: Instant::now(),
            },
        );
    }

    apis
}

/// Tapp 更新/卸载时使缓存失效
pub async fn invalidate_tapp_apis_cache(tapp_id: &str) {
    let mut cache = TAPP_APIS_CACHE.write().await;
    cache.remove(tapp_id);
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TappApiCallRequest {
    pub params: Option<Value>,
}

/// POST /api/tapp/{tapp_id}/api/{api_name}
pub async fn execute_tapp_api(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    headers: axum::http::HeaderMap,
    Path((tapp_id, api_name)): Path<(String, String)>,
    Json(body): Json<TappApiCallRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::debug!(
        "[TAPP API] Execute {} for tapp {} by user {}",
        api_name,
        tapp_id,
        claims.username
    );

    let user_id: i32 = claims.sub.parse().map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid user" })),
        )
    })?;

    // 1. 查找 Tapp
    let tapp = tapps::Entity::find()
        .filter(tapps::Column::TappId.eq(&tapp_id))
        .one(&db)
        .await
        .map_err(|e| {
            tracing::error!("[TAPP API] Database error: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Tapp not found" })),
            )
        })?;

    // 2. 解析 manifest 中的 APIs（带缓存）
    let apis = get_tapp_apis(&tapp_id, &tapp.manifest).await;

    let api_def = apis.get(&api_name).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("API '{}' not defined in manifest", api_name) })),
        )
    })?;

    // 3. 获取用户已授权的权限
    let granted_permissions: Vec<String> = tapp
        .granted_permissions
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    // 4. 获取客户端 IP
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
        });

    // 5. 确定用户角色
    let role = if claims.is_admin {
        crate::services::permission_service::UserRole::Admin
    } else if user_id < 0 {
        crate::services::permission_service::UserRole::Guest
    } else {
        crate::services::permission_service::UserRole::User
    };

    // 6. 构建执行上下文
    let context = ApiExecutionContext {
        user_id,
        username: claims.username.clone(),
        is_admin: claims.is_admin,
        role,
        client_ip,
        granted_permissions,
    };

    // 7. 执行 API
    let result = TappApiService::execute(&tapp_id, &api_name, api_def, body.params, &context).await;

    if result.success {
        Ok(Json(
            json!({ "success": true, "data": result.data, "cached": result.cached }),
        ))
    } else {
        Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "error": result.error })),
        ))
    }
}

/// GET /api/tapp/{tapp_id}/apis
pub async fn list_tapp_apis(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(tapp_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::debug!(
        "[TAPP API] List APIs for tapp {} by user {}",
        tapp_id,
        claims.username
    );

    let tapp = tapps::Entity::find()
        .filter(tapps::Column::TappId.eq(&tapp_id))
        .one(&db)
        .await
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("Database error: {}", e) })),
            )
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Tapp not found" })),
            )
        })?;

    let apis = get_tapp_apis(&tapp_id, &tapp.manifest).await;

    let api_list: Vec<Value> = apis
        .iter()
        .map(|(name, def)| {
            json!({
                "name": name,
                "access": match def.access {
                    TappApiAccess::Public => "public",
                    TappApiAccess::Protected => "protected",
                },
                "type": def.api_type,
                "description": def.description,
                "cacheTtl": def.cache_ttl,
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "apis": api_list })))
}
