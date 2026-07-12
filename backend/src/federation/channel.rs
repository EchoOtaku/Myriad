//! 联邦 Channel 管理模块（Phase 3 — Layer 3）
//!
//! 1:1 双向通道：文本聊天、文件传输、RPC 调用等
//! 支持 HTTP 轮询和 WebSocket 两种传输方式

use axum::{http::StatusCode, Json};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::federation::types::*;

// ==================== 请求/响应类型 ====================

/// 创建 Channel 请求
#[derive(Debug, Deserialize)]
pub struct CreateChannelRequest {
    /// 远程 Actor URL 或 acct:user@domain / @user@domain / user@domain
    pub remote_actor: String,
    /// 通道类型: text, file-transfer, rpc, data-exchange, stream
    pub channel_type: Option<String>,
    /// 关联 Tapp ID
    pub tapp_id: Option<String>,
    /// 传输方式: http, websocket
    pub transport: Option<String>,
}

/// 发送消息请求
#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    /// 消息类型: text, file-meta, rpc-request, rpc-response, system
    pub message_type: Option<String>,
    /// 消息载荷
    pub payload: serde_json::Value,
    /// 回复的消息 ID
    pub reply_to: Option<String>,
}

/// Channel 概要
#[derive(Debug, Serialize)]
pub struct ChannelSummary {
    pub channel_id: String,
    pub remote_actor_url: String,
    pub remote_actor_name: Option<String>,
    pub remote_actor_avatar: Option<String>,
    pub channel_type: String,
    pub status: String,
    pub transport: String,
    pub initiated_by: String,
    pub last_activity_at: Option<String>,
    pub created_at: String,
    pub unread_count: i64,
}

/// Channel 详情
#[derive(Debug, Serialize)]
pub struct ChannelDetail {
    pub channel_id: String,
    pub remote_actor_url: String,
    pub remote_actor_name: Option<String>,
    pub remote_actor_avatar: Option<String>,
    pub channel_type: String,
    pub status: String,
    pub transport: String,
    pub tapp_id: Option<String>,
    pub properties: Option<serde_json::Value>,
    pub initiated_by: String,
    pub last_activity_at: Option<String>,
    pub created_at: String,
}

/// 消息条目
#[derive(Debug, Clone, Serialize)]
pub struct MessageItem {
    pub message_id: String,
    pub sender_actor: String,
    pub message_type: String,
    pub payload: serde_json::Value,
    pub reply_to: Option<String>,
    pub is_encrypted: bool,
    pub created_at: String,
}

/// 发送消息响应
#[derive(Debug, Serialize)]
pub struct SendMessageResponse {
    pub success: bool,
    pub message_id: String,
    pub channel_id: String,
}

// ==================== Channel CRUD 功能 ====================

/// 创建（或打开）一个新 Channel
///
/// 如果与该远程 Actor 已有 active/pending 的同类型 Channel，直接返回已有通道
pub async fn create_channel(
    user_id: i32,
    username: &str,
    db: &DatabaseConnection,
    req: &CreateChannelRequest,
) -> Result<ChannelDetail, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let channel_type = req.channel_type.as_deref().unwrap_or("text");
    let transport = req.transport.as_deref().unwrap_or("websocket");

    // 验证 channel_type 和 transport
    if !["text", "file-transfer", "rpc", "data-exchange", "stream"].contains(&channel_type) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid channel_type"})),
        ));
    }
    if !["http", "websocket"].contains(&transport) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid transport"})),
        ));
    }

    let remote_actor_url =
        crate::federation::follow::resolve_actor_reference(&req.remote_actor).await?;
    let local_actor = actor_url(&base_url, username);
    if same_actor_url(&remote_actor_url, &local_actor) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Cannot create a channel with your own federation actor"})),
        ));
    }

    // 确保远程 Actor 已缓存
    let remote = crate::federation::actor::fetch_remote_actor(db, &remote_actor_url)
        .await
        .map_err(|e| {
            tracing::error!("[Channel] Failed to fetch remote actor: {}", e);
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": format!("Cannot resolve remote actor: {}", e)})),
            )
        })?;

    let remote_actor_id: i32 = remote.id;

    // 检查是否已有同类型的 active/pending Channel
    let existing = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT channel_id, status, transport, tapp_id, properties, initiated_by,
                      last_activity_at, created_at
               FROM federation_channels
               WHERE user_id = $1 AND remote_actor_id = $2 AND channel_type = $3
                     AND status IN ('pending', 'accepted', 'active')
               LIMIT 1"#,
            [user_id.into(), remote_actor_id.into(), channel_type.into()],
        ))
        .await
        .map_err(db_err)?;

    if let Some(row) = existing {
        return Ok(ChannelDetail {
            channel_id: row.try_get("", "channel_id").unwrap_or_default(),
            remote_actor_url: remote_actor_url.clone(),
            remote_actor_name: remote
                .display_name
                .clone()
                .or_else(|| remote.username.clone()),
            remote_actor_avatar: remote.avatar_url.clone(),
            channel_type: channel_type.to_string(),
            status: row.try_get::<String>("", "status").unwrap_or_default(),
            transport: row.try_get::<String>("", "transport").unwrap_or_default(),
            tapp_id: row.try_get::<Option<String>>("", "tapp_id").unwrap_or(None),
            properties: row
                .try_get::<Option<serde_json::Value>>("", "properties")
                .unwrap_or(None),
            initiated_by: row
                .try_get::<String>("", "initiated_by")
                .unwrap_or_default(),
            last_activity_at: row
                .try_get::<Option<chrono::DateTime<chrono::FixedOffset>>>("", "last_activity_at")
                .ok()
                .flatten()
                .map(|t| t.to_rfc3339()),
            created_at: row
                .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "created_at")
                .map(|t| t.to_rfc3339())
                .unwrap_or_default(),
        });
    }

    // 创建新 Channel
    let channel_id = generate_channel_id();
    let properties = json!({
        "maxMessageSize": 65536,
        "supportedFormats": ["text/plain", "text/markdown", "application/json"]
    });

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_channels
           (channel_id, user_id, remote_actor_id, channel_type, tapp_id, status, transport, properties, initiated_by, created_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, 'local', NOW())"#,
        [
            channel_id.clone().into(),
            user_id.into(),
            remote_actor_id.into(),
            channel_type.into(),
            req.tapp_id.clone().into(),
            transport.into(),
            properties.clone().into(),
        ],
    ))
    .await
    .map_err(db_err)?;

    // 向远程 Actor 发送 ChannelOpen Activity
    let activity_id = generate_activity_id(&base_url);

    let channel_open = json!({
        "@context": build_context(),
        "type": "myriad:ChannelOpen",
        "id": &activity_id,
        "actor": &local_actor,
        "to": [&remote_actor_url],
        "object": {
            "type": "myriad:Channel",
            "id": &channel_id,
            "channelType": channel_type,
            "tappId": req.tapp_id,
            "protocol": "mfp/1.0",
            "transportPreference": [transport]
        }
    });

    // 记录 Activity 并投递
    let inbox = &remote.inbox_url;
    if !inbox.is_empty() {
        let domain = extract_domain(inbox).unwrap_or_default();
        let act_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"INSERT INTO federation_activities
                   (activity_id, user_id, activity_type, object_type, object_json, is_local, published_at)
                   VALUES ($1, $2, 'ChannelOpen', 'Channel', $3, true, NOW())
                   RETURNING id"#,
                [
                    activity_id.clone().into(),
                    user_id.into(),
                    channel_open.clone().into(),
                ],
            ))
            .await
            .map_err(db_err)?;

        if let Some(act_id) = act_row.and_then(|r| r.try_get::<i32>("", "id").ok()) {
            let _ = db
                .execute(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    r#"INSERT INTO federation_delivery_queue
                       (activity_id, target_inbox, target_domain, status, created_at)
                       VALUES ($1, $2, $3, 'pending', NOW())"#,
                    [act_id.into(), inbox.into(), domain.into()],
                ))
                .await;
        }
    }

    tracing::info!(
        "[Channel] Created channel {} with remote {}",
        channel_id,
        remote_actor_url
    );

    Ok(ChannelDetail {
        channel_id,
        remote_actor_url,
        remote_actor_name: remote
            .display_name
            .clone()
            .or_else(|| remote.username.clone()),
        remote_actor_avatar: remote.avatar_url.clone(),
        channel_type: channel_type.to_string(),
        status: "pending".to_string(),
        transport: transport.to_string(),
        tapp_id: req.tapp_id.clone(),
        properties: Some(properties),
        initiated_by: "local".to_string(),
        last_activity_at: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    })
}

/// 获取用户的所有 Channel 列表
pub async fn list_channels(
    user_id: i32,
    username: &str,
    db: &DatabaseConnection,
) -> Result<Vec<ChannelSummary>, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let local_actor = actor_url(&base_url, username);

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT c.channel_id, c.channel_type, c.status, c.transport, c.initiated_by,
                      c.last_activity_at, c.created_at,
                      ra.actor_url,
                      COALESCE(NULLIF(ra.display_name, ''), ra.username) AS remote_actor_name,
                      ra.avatar_url,
                      COALESCE((SELECT COUNT(*) FROM federation_channel_messages m
                                WHERE m.channel_id = c.channel_id
                                  AND m.sender_actor != $2
                                  AND m.created_at > COALESCE(c.last_activity_at, c.created_at)), 0) AS unread_count
               FROM federation_channels c
               JOIN federation_remote_actors ra ON c.remote_actor_id = ra.id
               WHERE c.user_id = $1
               ORDER BY COALESCE(c.last_activity_at, c.created_at) DESC"#,
            [user_id.into(), local_actor.into()],
        ))
        .await
        .map_err(db_err)?;

    let mut channels = Vec::new();
    for row in rows {
        channels.push(ChannelSummary {
            channel_id: row.try_get("", "channel_id").unwrap_or_default(),
            remote_actor_url: row.try_get("", "actor_url").unwrap_or_default(),
            remote_actor_name: row
                .try_get::<Option<String>>("", "remote_actor_name")
                .unwrap_or(None),
            remote_actor_avatar: row
                .try_get::<Option<String>>("", "avatar_url")
                .unwrap_or(None),
            channel_type: row.try_get("", "channel_type").unwrap_or_default(),
            status: row.try_get("", "status").unwrap_or_default(),
            transport: row.try_get("", "transport").unwrap_or_default(),
            initiated_by: row.try_get("", "initiated_by").unwrap_or_default(),
            last_activity_at: row
                .try_get::<Option<chrono::DateTime<chrono::FixedOffset>>>("", "last_activity_at")
                .ok()
                .flatten()
                .map(|t| t.to_rfc3339()),
            created_at: row
                .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "created_at")
                .map(|t| t.to_rfc3339())
                .unwrap_or_default(),
            unread_count: row.try_get::<i64>("", "unread_count").unwrap_or(0),
        });
    }

    Ok(channels)
}

/// 获取单个 Channel 详情
pub async fn get_channel(
    user_id: i32,
    channel_id: &str,
    db: &DatabaseConnection,
) -> Result<ChannelDetail, (StatusCode, Json<serde_json::Value>)> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT c.channel_id, c.channel_type, c.status, c.transport, c.tapp_id,
                      c.properties, c.initiated_by, c.last_activity_at, c.created_at,
                      ra.actor_url,
                      COALESCE(NULLIF(ra.display_name, ''), ra.username) AS remote_actor_name,
                      ra.avatar_url
               FROM federation_channels c
               JOIN federation_remote_actors ra ON c.remote_actor_id = ra.id
               WHERE c.user_id = $1 AND c.channel_id = $2"#,
            [user_id.into(), channel_id.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Channel not found"})),
            )
        })?;

    Ok(ChannelDetail {
        channel_id: row.try_get("", "channel_id").unwrap_or_default(),
        remote_actor_url: row.try_get("", "actor_url").unwrap_or_default(),
        remote_actor_name: row
            .try_get::<Option<String>>("", "remote_actor_name")
            .unwrap_or(None),
        remote_actor_avatar: row
            .try_get::<Option<String>>("", "avatar_url")
            .unwrap_or(None),
        channel_type: row.try_get("", "channel_type").unwrap_or_default(),
        status: row.try_get("", "status").unwrap_or_default(),
        transport: row.try_get("", "transport").unwrap_or_default(),
        tapp_id: row.try_get::<Option<String>>("", "tapp_id").unwrap_or(None),
        properties: row
            .try_get::<Option<serde_json::Value>>("", "properties")
            .unwrap_or(None),
        initiated_by: row.try_get("", "initiated_by").unwrap_or_default(),
        last_activity_at: row
            .try_get::<Option<chrono::DateTime<chrono::FixedOffset>>>("", "last_activity_at")
            .ok()
            .flatten()
            .map(|t| t.to_rfc3339()),
        created_at: row
            .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "created_at")
            .map(|t| t.to_rfc3339())
            .unwrap_or_default(),
    })
}

/// 关闭 Channel
pub async fn close_channel(
    user_id: i32,
    username: &str,
    channel_id: &str,
    db: &DatabaseConnection,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;

    // 验证通道归属 & 获取远程 actor 信息
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT c.status, ra.actor_url, ra.inbox_url
               FROM federation_channels c
               JOIN federation_remote_actors ra ON c.remote_actor_id = ra.id
               WHERE c.user_id = $1 AND c.channel_id = $2"#,
            [user_id.into(), channel_id.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Channel not found"})),
            )
        })?;

    let status: String = row.try_get("", "status").unwrap_or_default();
    if status == "closed" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Channel already closed"})),
        ));
    }

    let remote_actor_url: String = row.try_get("", "actor_url").unwrap_or_default();
    let remote_inbox: Option<String> = row
        .try_get::<Option<String>>("", "inbox_url")
        .unwrap_or(None);

    // 更新状态
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "UPDATE federation_channels SET status = 'closed', closed_at = NOW() WHERE channel_id = $1",
        [channel_id.into()],
    ))
    .await
    .map_err(db_err)?;

    // 通知远程方
    let local_actor = actor_url(&base_url, username);
    let activity_id = generate_activity_id(&base_url);
    let close_activity = json!({
        "@context": build_context(),
        "type": "myriad:ChannelClose",
        "id": &activity_id,
        "actor": &local_actor,
        "to": [&remote_actor_url],
        "object": {
            "type": "myriad:Channel",
            "id": channel_id
        }
    });

    if let Some(inbox) = remote_inbox {
        let domain = extract_domain(&inbox).unwrap_or_default();
        let act_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"INSERT INTO federation_activities
                   (activity_id, user_id, activity_type, object_type, object_json, is_local, published_at)
                   VALUES ($1, $2, 'ChannelClose', 'Channel', $3, true, NOW())
                   RETURNING id"#,
                [
                    activity_id.clone().into(),
                    user_id.into(),
                    close_activity.clone().into(),
                ],
            ))
            .await
            .map_err(db_err)?;

        if let Some(act_id) = act_row.and_then(|r| r.try_get::<i32>("", "id").ok()) {
            let _ = db
                .execute(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    r#"INSERT INTO federation_delivery_queue
                       (activity_id, target_inbox, target_domain, status, created_at)
                       VALUES ($1, $2, $3, 'pending', NOW())"#,
                    [act_id.into(), inbox.into(), domain.into()],
                ))
                .await;
        }
    }

    tracing::info!("[Channel] Closed channel {}", channel_id);

    Ok(json!({
        "success": true,
        "channel_id": channel_id,
        "status": "closed"
    }))
}

// ==================== 消息功能 ====================

/// 最大消息载荷大小: 1MB
const MAX_MESSAGE_PAYLOAD: usize = 1_048_576;

/// 发送消息到 Channel
pub async fn send_message(
    user_id: i32,
    username: &str,
    channel_id: &str,
    db: &DatabaseConnection,
    req: &SendMessageRequest,
) -> Result<SendMessageResponse, (StatusCode, Json<serde_json::Value>)> {
    // 验证载荷大小
    let payload_size = req.payload.to_string().len();
    if payload_size > MAX_MESSAGE_PAYLOAD {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(
                json!({"error": format!("Message payload too large: {} bytes (max {})", payload_size, MAX_MESSAGE_PAYLOAD)}),
            ),
        ));
    }

    let base_url = get_base_url().await;
    let message_type = req.message_type.as_deref().unwrap_or("text");

    // 验证通道存在且为 active 或 accepted
    let ch_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT c.status, ra.actor_url, ra.inbox_url
               FROM federation_channels c
               JOIN federation_remote_actors ra ON c.remote_actor_id = ra.id
               WHERE c.user_id = $1 AND c.channel_id = $2"#,
            [user_id.into(), channel_id.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Channel not found"})),
            )
        })?;

    let status: String = ch_row.try_get("", "status").unwrap_or_default();
    if !["active", "accepted"].contains(&status.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(
                json!({"error": format!("Channel is {}, cannot send messages (must be accepted first)", status)}),
            ),
        ));
    }

    let remote_inbox: Option<String> = ch_row
        .try_get::<Option<String>>("", "inbox_url")
        .unwrap_or(None);
    let remote_actor_url: String = ch_row.try_get("", "actor_url").unwrap_or_default();

    // 存入消息
    let message_id = generate_message_id();
    let local_actor = actor_url(&base_url, username);

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_channel_messages
           (channel_id, message_id, sender_actor, message_type, payload, reply_to, is_encrypted, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, false, NOW())"#,
        [
            channel_id.into(),
            message_id.clone().into(),
            local_actor.clone().into(),
            message_type.into(),
            req.payload.clone().into(),
            req.reply_to.clone().into(),
        ],
    ))
    .await
    .map_err(db_err)?;

    // 更新通道最后活动时间；如果 accepted → active
    let new_status = if status == "accepted" {
        "active"
    } else {
        &status
    };
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "UPDATE federation_channels SET last_activity_at = NOW(), status = $2 WHERE channel_id = $1",
        [channel_id.into(), new_status.into()],
    ))
    .await
    .map_err(db_err)?;

    // 通过 ActivityPub 投递消息给远程方
    let activity_id = generate_activity_id(&base_url);
    let msg_activity = json!({
        "@context": build_context(),
        "type": "myriad:ChannelMessage",
        "id": &activity_id,
        "actor": &local_actor,
        "to": [&remote_actor_url],
        "object": {
            "type": "myriad:ChannelMessage",
            "channel": channel_id,
            "messageId": &message_id,
            "messageType": message_type,
            "from": &local_actor,
            "payload": &req.payload,
            "replyTo": &req.reply_to,
            "timestamp": now_iso8601()
        }
    });

    if let Some(inbox) = remote_inbox {
        let domain = extract_domain(&inbox).unwrap_or_default();
        let act_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"INSERT INTO federation_activities
                   (activity_id, user_id, activity_type, object_type, object_json, is_local, published_at)
                   VALUES ($1, $2, 'ChannelMessage', 'ChannelMessage', $3, true, NOW())
                   RETURNING id"#,
                [
                    activity_id.clone().into(),
                    user_id.into(),
                    msg_activity.clone().into(),
                ],
            ))
            .await
            .map_err(db_err)?;

        if let Some(act_id) = act_row.and_then(|r| r.try_get::<i32>("", "id").ok()) {
            let _ = db
                .execute(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    r#"INSERT INTO federation_delivery_queue
                       (activity_id, target_inbox, target_domain, status, created_at)
                       VALUES ($1, $2, $3, 'pending', NOW())"#,
                    [act_id.into(), inbox.into(), domain.into()],
                ))
                .await;
        }
    }

    // 广播给该 Channel 的 WebSocket 连接
    crate::federation::ws_gateway::broadcast_to_channel(
        channel_id,
        &json!({
            "type": "message",
            "channel_id": channel_id,
            "message": {
                "message_id": &message_id,
                "sender_actor": &local_actor,
                "message_type": message_type,
                "payload": &req.payload,
                "reply_to": &req.reply_to,
                "created_at": now_iso8601()
            }
        }),
    )
    .await;

    Ok(SendMessageResponse {
        success: true,
        message_id,
        channel_id: channel_id.to_string(),
    })
}

/// 获取 Channel 消息历史
pub async fn get_messages(
    user_id: i32,
    channel_id: &str,
    db: &DatabaseConnection,
    before: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<MessageItem>, (StatusCode, Json<serde_json::Value>)> {
    // 验证通道归属
    let exists = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT 1 FROM federation_channels WHERE user_id = $1 AND channel_id = $2",
            [user_id.into(), channel_id.into()],
        ))
        .await
        .map_err(db_err)?;

    if exists.is_none() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Channel not found"})),
        ));
    }

    let limit = limit.unwrap_or(50).min(200);

    let rows = if let Some(before_id) = before {
        db.query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT message_id, sender_actor, message_type, payload, reply_to, is_encrypted, created_at
               FROM federation_channel_messages
               WHERE channel_id = $1
                 AND created_at < (SELECT created_at FROM federation_channel_messages WHERE message_id = $2)
               ORDER BY created_at DESC
               LIMIT $3"#,
            [channel_id.into(), before_id.into(), limit.into()],
        ))
        .await
        .map_err(db_err)?
    } else {
        db.query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT message_id, sender_actor, message_type, payload, reply_to, is_encrypted, created_at
               FROM federation_channel_messages
               WHERE channel_id = $1
               ORDER BY created_at DESC
               LIMIT $2"#,
            [channel_id.into(), limit.into()],
        ))
        .await
        .map_err(db_err)?
    };

    let mut messages = Vec::new();
    for row in rows {
        messages.push(MessageItem {
            message_id: row.try_get("", "message_id").unwrap_or_default(),
            sender_actor: row.try_get("", "sender_actor").unwrap_or_default(),
            message_type: row.try_get("", "message_type").unwrap_or_default(),
            payload: row.try_get("", "payload").unwrap_or(json!(null)),
            reply_to: row
                .try_get::<Option<String>>("", "reply_to")
                .unwrap_or(None),
            is_encrypted: row.try_get("", "is_encrypted").unwrap_or(false),
            created_at: row
                .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "created_at")
                .map(|t| t.to_rfc3339())
                .unwrap_or_default(),
        });
    }

    // 返回时按时间正序（最新在后）
    messages.reverse();

    Ok(messages)
}

// ==================== Inbox 处理（远程 Channel 事件）====================

/// 处理收到的 ChannelOpen Activity
pub async fn handle_channel_open(
    db: &DatabaseConnection,
    actor_url_str: &str,
    activity: &serde_json::Value,
) -> Result<(), String> {
    let object = activity.get("object").ok_or("Missing object")?;
    let channel_id = object
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing channel id")?;
    let channel_type = object
        .get("channelType")
        .and_then(|v| v.as_str())
        .unwrap_or("text");
    let tapp_id = object.get("tappId").and_then(|v| v.as_str());
    let transport = object
        .get("transportPreference")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .unwrap_or("websocket");

    // 查找本地对应的远程 actor 记录
    let actor_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT id FROM federation_remote_actors WHERE actor_url = $1",
            [actor_url_str.into()],
        ))
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Remote actor not found")?;

    let remote_actor_id: i32 = actor_row.try_get("", "id").unwrap_or(0);

    // 找到所有关注了这个远程 actor 的本地用户（取第一个作为通道目标）
    let follower_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT user_id FROM federation_follows
               WHERE remote_actor_id = $1 AND status = 'accepted'
               LIMIT 1"#,
            [remote_actor_id.into()],
        ))
        .await
        .map_err(|e| e.to_string())?;

    let target_user_id: i32 = match follower_row
        .as_ref()
        .and_then(|r| r.try_get("", "user_id").ok())
    {
        Some(uid) => uid,
        None => {
            // 个人实例回退：没有关注关系时路由到第一个本地用户
            let fallback = db
                .query_one(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    "SELECT id FROM users ORDER BY id LIMIT 1",
                    [],
                ))
                .await
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "No local users found".to_string())?;
            fallback.try_get("", "id").map_err(|e| e.to_string())?
        }
    };

    // 创建本地 Channel 记录
    let inserted = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_channels
           (channel_id, user_id, remote_actor_id, channel_type, tapp_id, status, transport, initiated_by, created_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, 'remote', NOW())
           ON CONFLICT (channel_id) DO NOTHING"#,
            [
                channel_id.into(),
                target_user_id.into(),
                remote_actor_id.into(),
                channel_type.into(),
                tapp_id.into(),
                transport.into(),
            ],
        ))
        .await
        .map_err(|e| e.to_string())?;

    if inserted.rows_affected() > 0 {
        let label = crate::federation::notify::actor_label(db, actor_url_str).await;
        crate::federation::notify::notify_channel_invite(
            target_user_id,
            channel_id,
            actor_url_str,
            &label,
        )
        .await;
    }

    tracing::info!(
        "[Channel] Received ChannelOpen {} from {}",
        channel_id,
        actor_url_str
    );

    Ok(())
}

/// 处理收到的 ChannelMessage Activity
pub async fn handle_channel_message(
    db: &DatabaseConnection,
    actor_url_str: &str,
    activity: &serde_json::Value,
) -> Result<(), String> {
    let object = activity.get("object").ok_or("Missing object")?;
    let channel_id = object
        .get("channel")
        .and_then(|v| v.as_str())
        .ok_or("Missing channel")?;

    // 验证通道存在且发送方是该通道的远程方
    let ch_check = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT c.status, c.user_id FROM federation_channels c
               JOIN federation_remote_actors ra ON c.remote_actor_id = ra.id
               WHERE c.channel_id = $1 AND ra.actor_url = $2"#,
            [channel_id.into(), actor_url_str.into()],
        ))
        .await
        .map_err(|e| e.to_string())?;

    if ch_check.is_none() {
        return Err(format!(
            "Channel {} not found or actor {} is not the remote party",
            channel_id, actor_url_str
        ));
    }

    let ch_status: String = ch_check
        .as_ref()
        .and_then(|r| r.try_get::<String>("", "status").ok())
        .unwrap_or_default();
    if ch_status == "closed" {
        return Err(format!("Channel {} is closed", channel_id));
    }
    let owner_user_id: Option<i32> = ch_check
        .as_ref()
        .and_then(|r| r.try_get::<i32>("", "user_id").ok());

    let fallback_msg_id = generate_message_id();
    let message_id = object
        .get("messageId")
        .and_then(|v| v.as_str())
        .unwrap_or(&fallback_msg_id);
    let sender = object
        .get("from")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let message_type = object
        .get("messageType")
        .and_then(|v| v.as_str())
        .unwrap_or("text");
    let payload = object.get("payload").cloned().unwrap_or(json!(null));
    let reply_to = object.get("replyTo").and_then(|v| v.as_str());

    // 存入消息
    let inserted = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_channel_messages
           (channel_id, message_id, sender_actor, message_type, payload, reply_to, is_encrypted, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, false, NOW())
           ON CONFLICT (message_id) DO NOTHING"#,
            [
                channel_id.into(),
                message_id.into(),
                sender.into(),
                message_type.into(),
                payload.clone().into(),
                reply_to.into(),
            ],
        ))
        .await
        .map_err(|e| e.to_string())?;

    // 更新通道活动时间
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "UPDATE federation_channels SET last_activity_at = NOW(), status = 'active' WHERE channel_id = $1",
        [channel_id.into()],
    ))
    .await
    .map_err(|e| e.to_string())?;

    // 广播到 WebSocket
    crate::federation::ws_gateway::broadcast_to_channel(
        channel_id,
        &json!({
            "type": "message",
            "channel_id": channel_id,
            "message": {
                "message_id": message_id,
                "sender_actor": sender,
                "message_type": message_type,
                "payload": payload,
                "reply_to": reply_to,
                "created_at": now_iso8601()
            }
        }),
    )
    .await;

    // 新消息才推通知中心（重放/去重不通知）
    if inserted.rows_affected() > 0 {
        if let Some(user_id) = owner_user_id {
            let label = crate::federation::notify::actor_label(db, sender).await;
            crate::federation::notify::notify_channel_message(
                user_id,
                channel_id,
                sender,
                &label,
                message_type,
                &payload,
            )
            .await;
        }
    }

    tracing::info!(
        "[Channel] Received message {} in channel {}",
        message_id,
        channel_id
    );

    Ok(())
}

/// 处理收到的 ChannelClose Activity
pub async fn handle_channel_close(
    db: &DatabaseConnection,
    actor_url_str: &str,
    activity: &serde_json::Value,
) -> Result<(), String> {
    let object = activity.get("object").ok_or("Missing object")?;
    let channel_id = object
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing channel id")?;

    // 验证发送方是该通道的远程方
    let ch_check = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT 1 FROM federation_channels c
               JOIN federation_remote_actors ra ON c.remote_actor_id = ra.id
               WHERE c.channel_id = $1 AND ra.actor_url = $2"#,
            [channel_id.into(), actor_url_str.into()],
        ))
        .await
        .map_err(|e| e.to_string())?;

    if ch_check.is_none() {
        return Err(format!(
            "Channel {} not found or actor {} is not the remote party",
            channel_id, actor_url_str
        ));
    }

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "UPDATE federation_channels SET status = 'closed', closed_at = NOW() WHERE channel_id = $1",
        [channel_id.into()],
    ))
    .await
    .map_err(|e| e.to_string())?;

    // 通知 WebSocket 连接
    crate::federation::ws_gateway::broadcast_to_channel(
        channel_id,
        &json!({
            "type": "channel_closed",
            "channel_id": channel_id
        }),
    )
    .await;

    tracing::info!("[Channel] Channel {} closed by remote", channel_id);

    Ok(())
}

/// 接受 Channel（本地用户确认）
pub async fn accept_channel(
    user_id: i32,
    username: &str,
    channel_id: &str,
    db: &DatabaseConnection,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;

    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT c.status, c.initiated_by, ra.actor_url, ra.inbox_url
               FROM federation_channels c
               JOIN federation_remote_actors ra ON c.remote_actor_id = ra.id
               WHERE c.user_id = $1 AND c.channel_id = $2"#,
            [user_id.into(), channel_id.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Channel not found"})),
            )
        })?;

    let status: String = row.try_get("", "status").unwrap_or_default();
    if status != "pending" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Channel is {}, cannot accept", status)})),
        ));
    }

    let remote_actor_url: String = row.try_get("", "actor_url").unwrap_or_default();
    let remote_inbox: Option<String> = row
        .try_get::<Option<String>>("", "inbox_url")
        .unwrap_or(None);

    // 更新状态
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "UPDATE federation_channels SET status = 'accepted' WHERE channel_id = $1",
        [channel_id.into()],
    ))
    .await
    .map_err(db_err)?;

    // 发送 Accept Activity
    let local_actor = actor_url(&base_url, username);
    let activity_id = generate_activity_id(&base_url);
    let accept = json!({
        "@context": build_context(),
        "type": "Accept",
        "id": &activity_id,
        "actor": &local_actor,
        "to": [&remote_actor_url],
        "object": {
            "type": "myriad:ChannelOpen",
            "id": channel_id
        }
    });

    if let Some(inbox) = remote_inbox {
        let domain = extract_domain(&inbox).unwrap_or_default();
        let act_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"INSERT INTO federation_activities
                   (activity_id, user_id, activity_type, object_type, object_json, is_local, published_at)
                   VALUES ($1, $2, 'Accept', 'ChannelOpen', $3, true, NOW())
                   RETURNING id"#,
                [
                    activity_id.clone().into(),
                    user_id.into(),
                    accept.clone().into(),
                ],
            ))
            .await
            .map_err(db_err)?;

        if let Some(act_id) = act_row.and_then(|r| r.try_get::<i32>("", "id").ok()) {
            let _ = db
                .execute(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    r#"INSERT INTO federation_delivery_queue
                       (activity_id, target_inbox, target_domain, status, created_at)
                       VALUES ($1, $2, $3, 'pending', NOW())"#,
                    [act_id.into(), inbox.into(), domain.into()],
                ))
                .await;
        }
    }

    Ok(json!({
        "success": true,
        "channel_id": channel_id,
        "status": "accepted"
    }))
}

/// 处理收到的 ChannelAccept Activity（myriad:ChannelAccept）
///
/// 远程方接受了我方发起的 Channel：把 status 置为 'accepted'。
/// 与外部 `Accept`（object=myriad:ChannelOpen）等价的快捷形式，
/// 来自仅实现 MFP 扩展的对端实例。
pub async fn handle_channel_accept(
    db: &DatabaseConnection,
    actor_url_str: &str,
    activity: &serde_json::Value,
) -> Result<(), String> {
    let object = activity.get("object").ok_or("Missing object")?;
    let channel_id = object
        .get("id")
        .and_then(|v| v.as_str())
        .or_else(|| object.as_str())
        .ok_or("Missing channel id")?;

    // 验证发送方确为该 Channel 的远程方
    let ch_check = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT c.status FROM federation_channels c
               JOIN federation_remote_actors ra ON c.remote_actor_id = ra.id
               WHERE c.channel_id = $1 AND ra.actor_url = $2"#,
            [channel_id.into(), actor_url_str.into()],
        ))
        .await
        .map_err(|e| e.to_string())?;

    if ch_check.is_none() {
        return Err(format!(
            "Channel {} not found or actor {} is not the remote party",
            channel_id, actor_url_str
        ));
    }

    let result = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"UPDATE federation_channels
               SET status = 'accepted', last_activity_at = NOW()
               WHERE channel_id = $1 AND status = 'pending'"#,
            [channel_id.into()],
        ))
        .await
        .map_err(|e| e.to_string())?;

    if result.rows_affected() > 0 {
        crate::federation::ws_gateway::broadcast_to_channel(
            channel_id,
            &json!({
                "type": "channel_accepted",
                "channel_id": channel_id
            }),
        )
        .await;
        tracing::info!(
            "[Channel] {} accepted by remote {}",
            channel_id,
            actor_url_str
        );
    }

    Ok(())
}

/// 处理 myriad:KeyExchange Activity
///
/// 把对端 X25519 公钥作为一条特殊 message 存入 channel 历史，
/// 同时通过 WebSocket 广播给本地客户端用于建立 E2E 会话。
pub async fn handle_key_exchange(
    db: &DatabaseConnection,
    actor_url_str: &str,
    activity: &serde_json::Value,
) -> Result<(), String> {
    let object = activity.get("object").ok_or("Missing object")?;
    let channel_id = object
        .get("channel")
        .and_then(|v| v.as_str())
        .ok_or("Missing channel")?;
    let public_key = object
        .get("publicKey")
        .and_then(|v| v.as_str())
        .ok_or("Missing publicKey")?;
    let algorithm = object
        .get("algorithm")
        .and_then(|v| v.as_str())
        .unwrap_or("x25519-chacha20-poly1305");

    // 验证发送方是该 Channel 的远程方
    let ch_check = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT 1 FROM federation_channels c
               JOIN federation_remote_actors ra ON c.remote_actor_id = ra.id
               WHERE c.channel_id = $1 AND ra.actor_url = $2"#,
            [channel_id.into(), actor_url_str.into()],
        ))
        .await
        .map_err(|e| e.to_string())?;

    if ch_check.is_none() {
        return Err(format!(
            "Channel {} not found or actor {} is not the remote party",
            channel_id, actor_url_str
        ));
    }

    let message_id = activity
        .get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(generate_message_id);

    let payload = json!({
        "publicKey": public_key,
        "algorithm": algorithm,
    });

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_channel_messages
           (channel_id, message_id, sender_actor, message_type, payload, is_encrypted, created_at)
           VALUES ($1, $2, $3, 'myriad:KeyExchange', $4, false, NOW())
           ON CONFLICT (message_id) DO NOTHING"#,
        [
            channel_id.into(),
            message_id.clone().into(),
            actor_url_str.into(),
            payload.clone().into(),
        ],
    ))
    .await
    .map_err(|e| e.to_string())?;

    crate::federation::ws_gateway::broadcast_to_channel(
        channel_id,
        &json!({
            "type": "key_exchange",
            "channel_id": channel_id,
            "from": actor_url_str,
            "publicKey": public_key,
            "algorithm": algorithm
        }),
    )
    .await;

    tracing::info!(
        "[Channel] KeyExchange received in channel {} from {}",
        channel_id,
        actor_url_str
    );
    Ok(())
}
