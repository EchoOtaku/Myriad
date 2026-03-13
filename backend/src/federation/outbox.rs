//! Outbox 端点（Layer 2）
//!
//! 用户的 Outbox — AP 兼容的活动历史

use axum::{
    extract::Path,
    http::StatusCode,
    Json,
};
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use serde_json::json;

use crate::federation::types::*;

/// GET /users/{username}/outbox
///
/// 返回用户已发布的 Activity 列表（OrderedCollection）
pub async fn get_outbox(
    Path(username): Path<String>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let db = get_db().await.map_err(|e| {
        (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e})))
    })?;
    let base_url = get_base_url();

    // 验证用户存在
    let (user_id, _) = get_local_user(&db, &username).await?;

    // 查询 outbox 活动数量
    let count = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT COUNT(*) as count FROM federation_activities WHERE user_id = $1 AND is_local = true",
            [user_id.into()],
        ))
        .await
        .map_err(db_err)?
        .map(|r| r.try_get::<i64>("", "count").unwrap_or(0) as u64)
        .unwrap_or(0);

    let collection = OrderedCollection {
        context: build_ap_context(),
        collection_type: "OrderedCollection".to_string(),
        id: outbox_url(&base_url, &username),
        total_items: count,
        first: if count > 0 {
            Some(format!("{}/users/{}/outbox?page=1", base_url, username))
        } else {
            None
        },
        last: None,
    };

    Ok((StatusCode::OK, Json(serde_json::to_value(collection).unwrap())))
}

// ==================== 辅助函数 ====================

fn get_base_url() -> String {
    let config = crate::GLOBAL_CONFIG.blocking_read();
    config
        .base_url
        .clone()
        .unwrap_or_else(|| format!("http://{}:{}", config.server_host, config.server_port))
}

async fn get_db() -> Result<sea_orm::DatabaseConnection, String> {
    let db_opt = crate::DB_CONNECTION.read().await;
    db_opt
        .clone()
        .ok_or_else(|| "Database not connected".to_string())
}

async fn get_local_user(
    db: &sea_orm::DatabaseConnection,
    username: &str,
) -> Result<(i32, String), (StatusCode, Json<serde_json::Value>)> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT id, username FROM users WHERE username = $1 LIMIT 1",
            [username.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (StatusCode::NOT_FOUND, Json(json!({"error": "User not found"})))
        })?;

    Ok((
        row.try_get("", "id").unwrap_or(0),
        row.try_get("", "username").unwrap_or_default(),
    ))
}
