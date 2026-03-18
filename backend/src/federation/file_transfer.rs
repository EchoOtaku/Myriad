//! 联邦文件传输模块（Phase 5 补全 — Layer 3 增强）
//!
//! 基于 federation_file_transfers 表实现：
//! 1. 文件元数据发送与接收
//! 2. 分块传输与进度追踪
//! 3. 基于 Channel 的文件传输 Activity

#![allow(dead_code)]

use axum::{http::StatusCode, Json};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::federation::types::*;

// ==================== 请求/响应类型 ====================

/// 发起文件传输请求
#[derive(Debug, Deserialize)]
pub struct InitTransferRequest {
    /// 文件名
    pub filename: String,
    /// 文件大小（字节）
    pub file_size: i64,
    /// MIME 类型
    pub mime_type: Option<String>,
    /// 校验和 (SHA-256)
    pub checksum: Option<String>,
}

/// 上传文件分块请求
#[derive(Debug, Deserialize)]
pub struct UploadChunkRequest {
    /// 分块序号 (0-based)
    pub chunk_index: i32,
    /// 分块数据 (Base64 编码)
    pub chunk_data: String,
    /// 分块大小
    pub chunk_size: i64,
}

/// 文件传输摘要
#[derive(Debug, Serialize)]
pub struct TransferSummary {
    pub transfer_id: String,
    pub channel_id: String,
    pub filename: String,
    pub file_size: i64,
    pub mime_type: Option<String>,
    pub status: String,
    pub direction: String,
    pub progress: f64,
    pub created_at: String,
}

/// 文件传输详情
#[derive(Debug, Serialize)]
pub struct TransferDetail {
    pub transfer_id: String,
    pub channel_id: String,
    pub filename: String,
    pub file_size: i64,
    pub mime_type: Option<String>,
    pub checksum: Option<String>,
    pub status: String,
    pub direction: String,
    pub chunks_total: i32,
    pub chunks_received: i32,
    pub bytes_transferred: i64,
    pub progress: f64,
    pub created_at: String,
    pub completed_at: Option<String>,
}

/// 默认块大小: 256KB
const DEFAULT_CHUNK_SIZE: i64 = 262144;

/// 最大文件大小: 5GB
const MAX_FILE_SIZE: i64 = 5_368_709_120;

// ==================== 文件传输功能 ====================

/// 在 Channel 上发起文件传输
///
/// 创建传输记录 + 通过 ChannelMessage 通知远程方
pub async fn initiate_transfer(
    user_id: i32,
    username: &str,
    channel_id: &str,
    db: &DatabaseConnection,
    req: &InitTransferRequest,
) -> Result<TransferDetail, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;

    // 验证 Channel 存在且支持 file-transfer
    let ch_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT c.channel_type, c.status, ra.actor_url, ra.inbox_url
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
            Json(json!({"error": format!("Channel is {}, cannot transfer files", status)})),
        ));
    }

    // 验证文件大小
    if req.file_size <= 0 || req.file_size > MAX_FILE_SIZE {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("File size must be between 1 byte and {} bytes", MAX_FILE_SIZE)})),
        ));
    }

    let remote_actor_url: String = ch_row.try_get("", "actor_url").unwrap_or_default();
    let remote_inbox: Option<String> = ch_row.try_get::<Option<String>>("", "inbox_url").unwrap_or(None);

    // 计算分块数
    let chunks_total = ((req.file_size + DEFAULT_CHUNK_SIZE - 1) / DEFAULT_CHUNK_SIZE).max(1) as i32;

    // 创建传输记录
    let transfer_id = generate_transfer_id();

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_file_transfers
           (transfer_id, channel_id, filename, file_size, mime_type,
            checksum_sha256, status, direction, chunks_total, chunks_completed, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'outbound', $7, 0, NOW())"#,
        [
            transfer_id.clone().into(),
            channel_id.into(),
            req.filename.clone().into(),
            req.file_size.into(),
            req.mime_type.clone().into(),
            req.checksum.clone().into(),
            chunks_total.into(),
        ],
    ))
    .await
    .map_err(db_err)?;

    // 发送 FileTransfer Activity 通知远程方
    let local_actor = actor_url(&base_url, username);
    let activity_id = generate_activity_id(&base_url);

    let file_activity = json!({
        "@context": build_context(),
        "type": "myriad:FileTransfer",
        "id": &activity_id,
        "actor": &local_actor,
        "to": [&remote_actor_url],
        "object": {
            "type": "myriad:FileMeta",
            "transferId": &transfer_id,
            "channelId": channel_id,
            "filename": &req.filename,
            "fileSize": req.file_size,
            "mimeType": &req.mime_type,
            "checksum": &req.checksum,
            "chunksTotal": chunks_total,
            "chunkSize": DEFAULT_CHUNK_SIZE,
            "protocol": "mfp/1.0"
        }
    });

    // 投递到远程
    if let Some(inbox) = remote_inbox {
        let domain = extract_domain(&inbox).unwrap_or_default();
        let act_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"INSERT INTO federation_activities
                   (activity_id, user_id, activity_type, object_type, object_json, is_local, published_at)
                   VALUES ($1, $2, 'FileTransfer', 'FileMeta', $3, true, NOW())
                   RETURNING id"#,
                [
                    activity_id.clone().into(),
                    user_id.into(),
                    file_activity.into(),
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

    Ok(TransferDetail {
        transfer_id,
        channel_id: channel_id.to_string(),
        filename: req.filename.clone(),
        file_size: req.file_size,
        mime_type: req.mime_type.clone(),
        checksum: req.checksum.clone(),
        status: "pending".to_string(),
        direction: "outbound".to_string(),
        chunks_total,
        chunks_received: 0,
        bytes_transferred: 0,
        progress: 0.0,
        created_at: now_iso8601(),
        completed_at: None,
    })
}

/// 上传文件分块
pub async fn upload_chunk(
    user_id: i32,
    transfer_id: &str,
    db: &DatabaseConnection,
    req: &UploadChunkRequest,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    // 验证传输存在且状态正确
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT ft.status, ft.chunks_total, ft.chunks_completed,
                      ft.file_size, ft.channel_id, c.user_id
               FROM federation_file_transfers ft
               JOIN federation_channels c ON ft.channel_id = c.channel_id
               WHERE ft.transfer_id = $1"#,
            [transfer_id.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Transfer not found"})),
            )
        })?;

    let channel_user: i32 = row.try_get("", "user_id").map_err(|_| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to read channel ownership"})))
    })?;
    if channel_user != user_id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Not your transfer"})),
        ));
    }

    let status: String = row.try_get("", "status").unwrap_or_default();
    if !["pending", "in-progress"].contains(&status.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Transfer is {}", status)})),
        ));
    }

    let chunks_total: i32 = row.try_get("", "chunks_total").unwrap_or(1);
    let _chunks_completed: i32 = row.try_get("", "chunks_completed").unwrap_or(0);

    if req.chunk_index >= chunks_total {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Chunk index out of range"})),
        ));
    }

    // 原子更新进度——使用 SQL 内部递增避免并发竞态
    let updated = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"UPDATE federation_file_transfers
               SET chunks_completed = chunks_completed + 1,
                   status = CASE WHEN chunks_completed + 1 >= chunks_total THEN 'completed' ELSE 'in-progress' END,
                   completed_at = CASE WHEN chunks_completed + 1 >= chunks_total THEN NOW() ELSE NULL END
               WHERE transfer_id = $1 AND chunks_completed < chunks_total
               RETURNING chunks_completed, status"#,
            [transfer_id.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Transfer already completed or invalid"})),
            )
        })?;

    let new_chunks: i32 = updated.try_get("", "chunks_completed").unwrap_or(0);
    let new_status: String = updated.try_get("", "status").unwrap_or_default();

    let progress = (new_chunks as f64 / chunks_total as f64) * 100.0;

    Ok(json!({
        "success": true,
        "transfer_id": transfer_id,
        "chunk_index": req.chunk_index,
        "chunks_completed": new_chunks,
        "chunks_total": chunks_total,
        "status": new_status,
        "progress": progress
    }))
}

/// 获取传输进度
pub async fn get_transfer(
    transfer_id: &str,
    user_id: i32,
    db: &DatabaseConnection,
) -> Result<TransferDetail, (StatusCode, Json<serde_json::Value>)> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT ft.transfer_id, ft.channel_id, ft.filename, ft.file_size,
                      ft.mime_type, ft.checksum_sha256, ft.status, ft.direction,
                      ft.chunks_total, ft.chunks_completed,
                      ft.created_at, ft.completed_at, c.user_id
               FROM federation_file_transfers ft
               JOIN federation_channels c ON ft.channel_id = c.channel_id
               WHERE ft.transfer_id = $1"#,
            [transfer_id.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Transfer not found"})),
            )
        })?;

    let channel_user: i32 = row.try_get("", "user_id").unwrap_or(0);
    if channel_user != user_id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Not your transfer"})),
        ));
    }

    let chunks_total: i32 = row.try_get("", "chunks_total").unwrap_or(1);
    let chunks_completed: i32 = row.try_get("", "chunks_completed").unwrap_or(0);
    let progress = if chunks_total > 0 {
        (chunks_completed as f64 / chunks_total as f64) * 100.0
    } else {
        0.0
    };

    Ok(TransferDetail {
        transfer_id: row.try_get("", "transfer_id").unwrap_or_default(),
        channel_id: row.try_get("", "channel_id").unwrap_or_default(),
        filename: row.try_get("", "filename").unwrap_or_default(),
        file_size: row.try_get("", "file_size").unwrap_or(0),
        mime_type: row.try_get::<Option<String>>("", "mime_type").unwrap_or(None),
        checksum: row.try_get::<Option<String>>("", "checksum_sha256").unwrap_or(None),
        status: row.try_get("", "status").unwrap_or_default(),
        direction: row.try_get("", "direction").unwrap_or_default(),
        chunks_total,
        chunks_received: chunks_completed,
        bytes_transferred: 0,
        progress,
        created_at: row
            .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "created_at")
            .map(|t| t.to_rfc3339())
            .unwrap_or_default(),
        completed_at: row
            .try_get::<Option<chrono::DateTime<chrono::FixedOffset>>>("", "completed_at")
            .ok()
            .flatten()
            .map(|t| t.to_rfc3339()),
    })
}

/// 列出 Channel 上的所有文件传输
pub async fn list_transfers(
    channel_id: &str,
    user_id: i32,
    db: &DatabaseConnection,
) -> Result<Vec<TransferSummary>, (StatusCode, Json<serde_json::Value>)> {
    // 验证用户对该 Channel 的所有权
    let ch_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT user_id FROM federation_channels WHERE channel_id = $1",
            [channel_id.into()],
        ))
        .await
        .map_err(db_err)?;

    match ch_row {
        Some(r) => {
            let channel_user: i32 = r.try_get("", "user_id").unwrap_or(0);
            if channel_user != user_id {
                return Err((
                    StatusCode::FORBIDDEN,
                    Json(json!({"error": "Not your channel"})),
                ));
            }
        }
        None => {
            return Err((
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Channel not found"})),
            ));
        }
    }

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT transfer_id, channel_id, filename, file_size, mime_type,
                      status, direction, chunks_total, chunks_completed, created_at
               FROM federation_file_transfers
               WHERE channel_id = $1
               ORDER BY created_at DESC"#,
            [channel_id.into()],
        ))
        .await
        .map_err(db_err)?;

    let transfers = rows
        .iter()
        .map(|r| {
            let ct: i32 = r.try_get("", "chunks_total").unwrap_or(1);
            let cr: i32 = r.try_get("", "chunks_completed").unwrap_or(0);
            let progress = if ct > 0 { (cr as f64 / ct as f64) * 100.0 } else { 0.0 };
            TransferSummary {
                transfer_id: r.try_get("", "transfer_id").unwrap_or_default(),
                channel_id: r.try_get("", "channel_id").unwrap_or_default(),
                filename: r.try_get("", "filename").unwrap_or_default(),
                file_size: r.try_get("", "file_size").unwrap_or(0),
                mime_type: r.try_get::<Option<String>>("", "mime_type").unwrap_or(None),
                status: r.try_get("", "status").unwrap_or_default(),
                direction: r.try_get("", "direction").unwrap_or_default(),
                progress,
                created_at: r
                    .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "created_at")
                    .map(|t| t.to_rfc3339())
                    .unwrap_or_default(),
            }
        })
        .collect();

    Ok(transfers)
}

/// 取消文件传输
pub async fn cancel_transfer(
    user_id: i32,
    transfer_id: &str,
    db: &DatabaseConnection,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    // 验证所有权
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT ft.status, c.user_id
               FROM federation_file_transfers ft
               JOIN federation_channels c ON ft.channel_id = c.channel_id
               WHERE ft.transfer_id = $1"#,
            [transfer_id.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Transfer not found"})),
            )
        })?;

    let channel_user: i32 = row.try_get("", "user_id").map_err(|_| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error": "Failed to read channel ownership"})))
    })?;
    if channel_user != user_id {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Not your transfer"})),
        ));
    }

    let status: String = row.try_get("", "status").unwrap_or_default();
    if status == "completed" || status == "cancelled" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Transfer is already {}", status)})),
        ));
    }

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "UPDATE federation_file_transfers SET status = 'cancelled' WHERE transfer_id = $1",
        [transfer_id.into()],
    ))
    .await
    .map_err(db_err)?;

    Ok(json!({
        "success": true,
        "transfer_id": transfer_id,
        "status": "cancelled"
    }))
}

// ==================== Inbox 处理 ====================

/// 处理收到的文件传输 Activity（从远程实例）
pub async fn handle_file_transfer(
    db: &DatabaseConnection,
    actor_url_str: &str,
    activity: &serde_json::Value,
) -> Result<(), String> {
    let object = activity.get("object").ok_or("Missing object")?;

    let transfer_id = object
        .get("transferId")
        .and_then(|v| v.as_str())
        .ok_or("Missing transferId")?;
    let channel_id = object
        .get("channelId")
        .and_then(|v| v.as_str())
        .ok_or("Missing channelId")?;
    let filename = object
        .get("filename")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let file_size: i64 = object
        .get("fileSize")
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let mime_type = object.get("mimeType").and_then(|v| v.as_str());
    let checksum = object.get("checksum").and_then(|v| v.as_str());
    let chunks_total: i32 = object
        .get("chunksTotal")
        .and_then(|v| v.as_i64())
        .unwrap_or(1) as i32;

    // 创建入站传输记录
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_file_transfers
           (transfer_id, channel_id, filename, file_size, mime_type,
            checksum_sha256, status, direction, chunks_total, chunks_completed, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', 'inbound', $7, 0, NOW())
           ON CONFLICT (transfer_id) DO NOTHING"#,
        [
            transfer_id.into(),
            channel_id.into(),
            filename.into(),
            file_size.into(),
            mime_type.into(),
            checksum.into(),
            chunks_total.into(),
        ],
    ))
    .await
    .map_err(|e| e.to_string())?;

    tracing::info!(
        "[FileTransfer] Inbound transfer {} from {} — {} ({} bytes, {} chunks)",
        transfer_id, actor_url_str, filename, file_size, chunks_total
    );

    Ok(())
}
