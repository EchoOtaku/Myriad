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
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::api::tapp_store::{TappApiAccess, TappApiDef};
use crate::middleware::auth::{ensure_current_admin, Claims};
use crate::models::entities::tapps;
use crate::services::permission_service::{TappPermission, TappPermissionService, UserRole};
use crate::services::tapp_api_service::{ApiExecutionContext, TappApiService};
use crate::GLOBAL_DYNAMIC_CONFIG;

use super::common::{get_admin_user_id, verify_tapp_ownership};
use super::runtime_grant::RuntimeGrantContext;

// ============ Manifest API 解析缓存 ============

/// 缓存条目：已解析的 API 定义 + 缓存时间
struct ApisCacheEntry {
    tapp_id: String,
    cache_scope: String,
    apis: HashMap<String, TappApiDef>,
    cached_at: Instant,
}

/// 进程内解析缓存。key 包含 Manifest APIs 内容指纹，因此其他副本更新数据库后，
/// 本副本下一次请求也不会继续命中旧定义。
static TAPP_APIS_CACHE: Lazy<RwLock<HashMap<String, ApisCacheEntry>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

const APIS_CACHE_TTL: Duration = Duration::from_secs(300);
const MAX_APIS_CACHE_ENTRIES: usize = 1024;

fn manifest_apis_fingerprint(manifest: &Value) -> String {
    let encoded = serde_json::to_vec(manifest.get("apis").unwrap_or(&Value::Null))
        .unwrap_or_else(|_| b"null".to_vec());
    format!("{:x}", Sha256::digest(encoded))
}

/// 从 manifest JSON 解析 API 定义，优先命中内存缓存
async fn get_tapp_apis(
    cache_scope: &str,
    tapp_id: &str,
    manifest: &Value,
) -> HashMap<String, TappApiDef> {
    let cache_key = format!("{cache_scope}:{}", manifest_apis_fingerprint(manifest));
    // 读缓存
    {
        let cache = TAPP_APIS_CACHE.read().await;
        if let Some(entry) = cache.get(&cache_key) {
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
        cache.retain(|_, entry| {
            entry.cached_at.elapsed() < APIS_CACHE_TTL && entry.cache_scope != cache_scope
        });
        while cache.len() >= MAX_APIS_CACHE_ENTRIES {
            let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, entry)| entry.cached_at)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            cache.remove(&oldest);
        }
        cache.insert(
            cache_key,
            ApisCacheEntry {
                tapp_id: tapp_id.to_string(),
                cache_scope: cache_scope.to_string(),
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
    cache.retain(|_, entry| entry.tapp_id != tapp_id);
}

async fn find_accessible_tapp(
    db: &DatabaseConnection,
    user_id: i32,
    tapp_id: &str,
) -> Result<tapps::Model, (StatusCode, Json<Value>)> {
    verify_tapp_ownership(db, user_id, tapp_id).await?;

    let admin_id = get_admin_user_id(db).await?;
    if let Some(tapp) = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(admin_id))
        .filter(tapps::Column::TappId.eq(tapp_id))
        .one(db)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[TAPP API] Failed to resolve shared Tapp");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            )
        })?
    {
        return Ok(tapp);
    }

    if let Some(tapp) = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(user_id))
        .filter(tapps::Column::TappId.eq(tapp_id))
        .one(db)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[TAPP API] Failed to resolve user Tapp");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            )
        })?
    {
        return Ok(tapp);
    }

    // 管理员可访问其他 owner 的 Tapp；普通用户到这里说明既没有共享版本也没有自己的版本。
    let mut query = tapps::Entity::find().filter(tapps::Column::TappId.eq(tapp_id));
    if !crate::services::agent::user_is_current_admin(db, user_id).await {
        query = query.filter(tapps::Column::UserId.eq(admin_id));
    }
    query
        .one(db)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[TAPP API] Failed to resolve shared Tapp");
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
        })
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
    runtime_grant: RuntimeGrantContext,
    headers: axum::http::HeaderMap,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
    Path((tapp_id, api_name)): Path<(String, String)>,
    Json(body): Json<TappApiCallRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require_tapp_id(&tapp_id)?;
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

    // 1. Resolve the same administrator-first installation bound into the Runtime Grant.
    let tapp = find_accessible_tapp(&db, user_id, &tapp_id).await?;

    // 2. 解析 manifest 中的 APIs（带缓存）
    let manifest_cache_key = format!("{}:{}", tapp.user_id, tapp_id);
    let apis = get_tapp_apis(&manifest_cache_key, &tapp_id, &tapp.manifest).await;

    let api_def = apis.get(&api_name).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "error": format!("API '{}' not defined in manifest", api_name) })),
        )
    })?;

    // 3. 读取安装时授权；下面还会按调用者当前角色动态过滤。
    let installed_permissions: Vec<String> = tapp
        .granted_permissions
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    // 4. 获取客户端 IP
    let client_ip = crate::middleware::client_ip::client_ip_from_parts(
        &headers,
        Some(addr.ip()),
        crate::middleware::client_ip::trusted_proxy_headers_enabled(),
    )
    .map(|ip| ip.to_string());

    // 5. 确定用户角色
    let is_current_admin = claims.is_admin && ensure_current_admin(&claims).await.is_ok();
    let role = if is_current_admin {
        UserRole::Admin
    } else if user_id < 0 {
        UserRole::Guest
    } else {
        UserRole::User
    };
    let granted_permissions = {
        let config = GLOBAL_DYNAMIC_CONFIG.read().await;
        installed_permissions
            .into_iter()
            .filter(|permission| {
                TappPermission::from_str(permission).is_some_and(|permission| {
                    TappPermissionService::check(&config, role, permission)
                })
            })
            .collect()
    };

    // 6. 构建执行上下文
    let context = ApiExecutionContext {
        user_id,
        owner_id: tapp.user_id,
        username: claims.username.clone(),
        is_admin: is_current_admin,
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
    runtime_grant: RuntimeGrantContext,
    Path(tapp_id): Path<String>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require_tapp_id(&tapp_id)?;
    tracing::debug!(
        "[TAPP API] List APIs for tapp {} by user {}",
        tapp_id,
        claims.username
    );

    let user_id = claims.sub.parse::<i32>().map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid user" })),
        )
    })?;
    let tapp = find_accessible_tapp(&db, user_id, &tapp_id).await?;

    let manifest_cache_key = format!("{}:{}", tapp.user_id, tapp_id);
    let apis = get_tapp_apis(&manifest_cache_key, &tapp_id, &tapp.manifest).await;

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

#[cfg(test)]
mod tests {
    use super::manifest_apis_fingerprint;
    use serde_json::json;

    #[test]
    fn declared_api_cache_fingerprint_tracks_only_api_contract() {
        let first = json!({
            "name": "Example",
            "apis": { "weather": { "endpoint": "https://one.example" } }
        });
        let metadata_only = json!({
            "name": "Renamed",
            "apis": { "weather": { "endpoint": "https://one.example" } }
        });
        let changed_api = json!({
            "name": "Example",
            "apis": { "weather": { "endpoint": "https://two.example" } }
        });

        assert_eq!(
            manifest_apis_fingerprint(&first),
            manifest_apis_fingerprint(&metadata_only)
        );
        assert_ne!(
            manifest_apis_fingerprint(&first),
            manifest_apis_fingerprint(&changed_api)
        );
    }
}
