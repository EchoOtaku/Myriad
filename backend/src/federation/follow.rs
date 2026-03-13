//! 联邦关注管理（Layer 2）
//!
//! 本地用户发起关注远程 Actor、取消关注等操作

use axum::{
    http::StatusCode,
    Json,
};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::federation::actor::fetch_remote_actor;
use crate::federation::types::*;

/// 关注远程用户请求
#[derive(Debug, Deserialize)]
pub struct FollowRequest {
    /// 远程 Actor URL 或 acct:user@domain 格式
    pub target: String,
}

/// 关注响应
#[derive(Debug, Serialize)]
pub struct FollowResponse {
    pub status: String,
    pub target_actor: String,
    pub activity_id: String,
}

/// 发起关注远程用户
///
/// POST /api/federation/follow
pub async fn follow_remote(
    user_id: i32,
    username: &str,
    db: &DatabaseConnection,
    target: &str,
) -> Result<FollowResponse, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;

    // 解析目标：支持 acct:user@domain 和直接 URL
    let target_url = if target.starts_with("acct:") || target.contains('@') {
        resolve_acct_to_url(target).await?
    } else {
        target.to_string()
    };

    // 获取远程 Actor 信息
    let remote = fetch_remote_actor(db, &target_url).await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Cannot resolve remote actor: {}", e)})),
        )
    })?;

    // 检查是否已关注
    let existing = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT id, status FROM federation_follows
               WHERE user_id = $1 AND remote_actor_id = $2 AND direction = 'outgoing'"#,
            [user_id.into(), remote.id.into()],
        ))
        .await
        .map_err(db_err)?;

    if let Some(row) = existing {
        let status: String = row.try_get("", "status").unwrap_or_default();
        if status == "accepted" || status == "pending" {
            return Err((
                StatusCode::CONFLICT,
                Json(json!({"error": "Already following or pending", "status": status})),
            ));
        }
    }

    // 构造 Follow Activity
    let local_actor = actor_url(&base_url, username);
    let activity_id = generate_activity_id(&base_url);

    let follow_activity = serde_json::json!({
        "@context": build_ap_context(),
        "type": "Follow",
        "id": &activity_id,
        "actor": &local_actor,
        "to": [&target_url],
        "published": now_iso8601(),
        "object": &target_url
    });

    // 记录 outgoing follow
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_follows (user_id, remote_actor_id, direction, status, activity_id, created_at)
           VALUES ($1, $2, 'outgoing', 'pending', $3, NOW())
           ON CONFLICT (user_id, remote_actor_id, direction) DO UPDATE SET
               status = 'pending', activity_id = $3"#,
        [
            user_id.into(),
            remote.id.into(),
            activity_id.clone().into(),
        ],
    ))
    .await
    .map_err(db_err)?;

    // 存 Activity 记录（完整 Activity JSON，供 delivery 直接发送）
    let act_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_activities
                   (activity_id, user_id, activity_type, object_json, is_local, published_at)
               VALUES ($1, $2, 'Follow', $3, true, NOW())
               RETURNING id"#,
            [
                activity_id.clone().into(),
                user_id.into(),
                follow_activity.into(),
            ],
        ))
        .await
        .map_err(db_err)?;

    let act_db_id: i32 = act_row
        .map(|r| r.try_get("", "id").unwrap_or(0))
        .unwrap_or(0);

    // 入队投递
    let domain = extract_domain(&remote.inbox_url).unwrap_or_default();
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_delivery_queue
               (activity_id, target_inbox, target_domain, status, created_at)
           VALUES ($1, $2, $3, 'pending', NOW())"#,
        [
            act_db_id.into(),
            remote.inbox_url.clone().into(),
            domain.into(),
        ],
    ))
    .await
    .map_err(db_err)?;

    tracing::info!(
        "📤 Follow queued: {} → {}",
        username,
        target_url
    );

    Ok(FollowResponse {
        status: "pending".to_string(),
        target_actor: target_url,
        activity_id,
    })
}

/// 取消关注远程用户
///
/// POST /api/federation/unfollow
pub async fn unfollow_remote(
    user_id: i32,
    username: &str,
    db: &DatabaseConnection,
    target: &str,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;

    let target_url = if target.starts_with("acct:") || target.contains('@') {
        resolve_acct_to_url(target).await?
    } else {
        target.to_string()
    };

    // 查找关注关系
    let follow_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT f.id, f.activity_id, ra.inbox_url, ra.actor_url
               FROM federation_follows f
               JOIN federation_remote_actors ra ON ra.id = f.remote_actor_id
               WHERE f.user_id = $1 AND f.direction = 'outgoing' AND ra.actor_url = $2"#,
            [user_id.into(), target_url.clone().into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Follow relationship not found"})),
            )
        })?;

    let follow_activity_id: String = follow_row.try_get("", "activity_id").unwrap_or_default();
    let inbox: String = follow_row.try_get("", "inbox_url").unwrap_or_default();

    // 构造 Undo(Follow) Activity
    let local_actor = actor_url(&base_url, username);
    let undo_id = generate_activity_id(&base_url);

    let undo_activity = serde_json::json!({
        "@context": build_ap_context(),
        "type": "Undo",
        "id": undo_id,
        "actor": local_actor,
        "object": {
            "type": "Follow",
            "id": follow_activity_id,
            "actor": local_actor,
            "object": target_url
        }
    });

    // 删除本地关注记录
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"DELETE FROM federation_follows
           WHERE user_id = $1 AND direction = 'outgoing'
           AND remote_actor_id = (SELECT id FROM federation_remote_actors WHERE actor_url = $2)"#,
        [user_id.into(), target_url.clone().into()],
    ))
    .await
    .map_err(db_err)?;

    // 存 Undo Activity 并入队投递（完整 Activity JSON，供 delivery 直接发送）
    let act_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_activities
                   (activity_id, user_id, activity_type, object_json, is_local, published_at)
               VALUES ($1, $2, 'Undo', $3, true, NOW())
               RETURNING id"#,
            [
                undo_id.clone().into(),
                user_id.into(),
                undo_activity.clone().into(),
            ],
        ))
        .await
        .map_err(db_err)?;

    let act_db_id: i32 = act_row
        .map(|r| r.try_get("", "id").unwrap_or(0))
        .unwrap_or(0);

    let domain = extract_domain(&inbox).unwrap_or_default();
    let _ = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_delivery_queue
                   (activity_id, target_inbox, target_domain, status, created_at)
               VALUES ($1, $2, $3, 'pending', NOW())"#,
            [act_db_id.into(), inbox.into(), domain.into()],
        ))
        .await;

    Ok(json!({"status": "unfollowed", "target": target_url}))
}

/// WebFinger 查询：acct:user@domain → Actor URL
async fn resolve_acct_to_url(acct: &str) -> Result<String, (StatusCode, Json<serde_json::Value>)> {
    let stripped = acct.strip_prefix("acct:").unwrap_or(acct);
    let parts: Vec<&str> = stripped.splitn(2, '@').collect();
    if parts.len() != 2 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid acct format"})),
        ));
    }

    let domain = parts[1];
    let webfinger_url = format!(
        "https://{}/.well-known/webfinger?resource=acct:{}",
        domain, stripped
    );

    // 防止 SSRF：验证 WebFinger URL 不指向内网
    if is_internal_url(&webfinger_url) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Cannot resolve internal domains"})),
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "HTTP client error"})),
            )
        })?;

    let resp = client
        .get(&webfinger_url)
        .header("Accept", "application/jrd+json")
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({"error": format!("WebFinger lookup failed: {}", e)})),
            )
        })?;

    let wf: serde_json::Value = resp.json().await.map_err(|_| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "Invalid WebFinger response"})),
        )
    })?;

    // 找到 rel=self, type=application/activity+json 的链接
    let links = wf["links"].as_array().ok_or_else(|| {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"error": "No links in WebFinger response"})),
        )
    })?;

    for link in links {
        let rel = link["rel"].as_str().unwrap_or("");
        let ltype = link["type"].as_str().unwrap_or("");
        if rel == "self" && (ltype == AP_CONTENT_TYPE || ltype.contains("activity+json")) {
            if let Some(href) = link["href"].as_str() {
                return Ok(href.to_string());
            }
        }
    }

    Err((
        StatusCode::BAD_GATEWAY,
        Json(json!({"error": "No ActivityPub self link found in WebFinger response"})),
    ))
}

// ==================== 辅助函数 ====================

async fn get_base_url() -> String {
    let config = crate::GLOBAL_CONFIG.read().await;
    config
        .base_url
        .clone()
        .unwrap_or_else(|| format!("http://{}:{}", config.server_host, config.server_port))
}
