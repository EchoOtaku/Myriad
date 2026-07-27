//! Outbox 端点（Layer 2）
//!
//! 用户的 Outbox — AP 兼容的活动历史
//! `GET /users/{username}/outbox` 返回 OrderedCollection 摘要
//! `GET /users/{username}/outbox?page=N` 返回 OrderedCollectionPage

use axum::{
    extract::{Path, Query},
    http::StatusCode,
    Json,
};
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use serde::Deserialize;
use serde_json::json;

use crate::federation::types::*;

const OUTBOX_PAGE_SIZE: i64 = 20;

/// Outbox 的可见性投影。
///
/// `federation_activities` 是**通用**联邦活动表：Follow/Accept、房间邀请、
/// 频道消息、密钥交换、Ring 同步、文件分块都写在这里，且 `is_local = true`。
/// 过去 Outbox 直接按 `user_id + is_local` 全表返回 `object_json`，等于把整个
/// 内部控制面匿名公开。
///
/// 现在改成 fail-closed 投影：只有**同时**满足
///   1. activity 类型在下面的白名单里，且
///   2. 在 `federation_published_content` 里有一条 `visibility = 'public'` 记录
/// 的活动才会出现。任何新增的活动类型默认不可见，必须显式登记成公开内容。
const PUBLIC_OUTBOX_FILTER: &str = r#"
    FROM federation_activities a
    JOIN federation_published_content p ON p.activity_id = a.activity_id
    WHERE a.user_id = $1
      AND a.is_local = true
      AND a.activity_type IN ('Create', 'Announce')
      AND p.visibility = 'public'
"#;

#[derive(Debug, Deserialize)]
pub struct OutboxQuery {
    pub page: Option<u32>,
}

/// GET /users/{username}/outbox  (可选 ?page=N)
///
/// 无 page：返回 OrderedCollection 摘要（totalItems + first/last 指针）
/// 有 page：返回该页的 OrderedCollectionPage
pub async fn get_outbox(
    Path(username): Path<String>,
    Query(query): Query<OutboxQuery>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let db = get_db()
        .await
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e}))))?;
    let base_url = get_base_url().await;

    let (user_id, _) = get_local_user(&db, &username).await?;

    // 总数（与下面的分页查询共用同一个可见性投影）
    let total: i64 = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            &format!("SELECT COUNT(*) as count {}", PUBLIC_OUTBOX_FILTER),
            [user_id.into()],
        ))
        .await
        .map_err(db_err)?
        .map(|r| r.try_get::<i64>("", "count").unwrap_or(0))
        .unwrap_or(0);
    let total_u64 = total.max(0) as u64;

    let outbox_id = outbox_url(&base_url, &username);
    let last_page = if total == 0 {
        1
    } else {
        ((total - 1) / OUTBOX_PAGE_SIZE + 1) as u32
    };

    // 无 page 参数 → 返回 Collection 摘要
    let Some(page) = query.page else {
        let collection = OrderedCollection {
            context: build_ap_context(),
            collection_type: "OrderedCollection".to_string(),
            id: outbox_id.clone(),
            total_items: total_u64,
            first: if total > 0 {
                Some(format!("{}?page=1", outbox_id))
            } else {
                None
            },
            last: if total > 0 {
                Some(format!("{}?page={}", outbox_id, last_page))
            } else {
                None
            },
        };
        return Ok((
            StatusCode::OK,
            Json(serde_json::to_value(collection).unwrap()),
        ));
    };

    let page = page.max(1);
    let offset = (page as i64 - 1) * OUTBOX_PAGE_SIZE;

    // 取该页 Activity
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            &format!(
                "SELECT a.object_json {} ORDER BY a.published_at DESC NULLS LAST, a.id DESC \
                 LIMIT $2 OFFSET $3",
                PUBLIC_OUTBOX_FILTER
            ),
            [user_id.into(), OUTBOX_PAGE_SIZE.into(), offset.into()],
        ))
        .await
        .map_err(db_err)?;

    let items: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            r.try_get::<serde_json::Value>("", "object_json")
                .unwrap_or(json!({}))
        })
        .collect();

    let page_id = format!("{}?page={}", outbox_id, page);
    let next = if (page as i64) < last_page as i64 {
        Some(format!("{}?page={}", outbox_id, page + 1))
    } else {
        None
    };
    let prev = if page > 1 {
        Some(format!("{}?page={}", outbox_id, page - 1))
    } else {
        None
    };

    let page_doc = OrderedCollectionPage {
        context: build_ap_context(),
        collection_type: "OrderedCollectionPage".to_string(),
        id: page_id,
        part_of: outbox_id,
        total_items: total_u64,
        ordered_items: items,
        next,
        prev,
    };

    Ok((
        StatusCode::OK,
        Json(serde_json::to_value(page_doc).unwrap()),
    ))
}

// ==================== 辅助函数 ====================

async fn get_base_url() -> String {
    crate::federation::types::get_base_url().await
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
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "User not found"})),
            )
        })?;

    Ok((
        row.try_get("", "id").unwrap_or(0),
        row.try_get("", "username").unwrap_or_default(),
    ))
}
