//! 联邦 Room 管理模块（Phase 4 — Layer 3）
//!
//! N:N 多方房间：群聊、协作、共享阅读室、联合分析等
//! 支持星型路由（Home Server fan-out）和成员治理

use axum::{http::StatusCode, Json};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::federation::types::*;

// ==================== 请求/响应类型 ====================

/// 创建 Room 请求
#[derive(Debug, Deserialize)]
pub struct CreateRoomRequest {
    pub name: String,
    pub description: Option<String>,
    pub avatar_url: Option<String>,
    /// owner / democratic / open
    pub governance_type: Option<String>,
    /// admin-only / member-invite / open
    pub invite_policy: Option<String>,
    pub max_members: Option<i32>,
    pub is_public: Option<bool>,
}

/// 更新 Room 请求
#[derive(Debug, Deserialize)]
pub struct UpdateRoomRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub avatar_url: Option<String>,
    pub invite_policy: Option<String>,
    pub max_members: Option<i32>,
    pub is_public: Option<bool>,
}

/// 邀请成员请求
#[derive(Debug, Deserialize)]
pub struct InviteMemberRequest {
    /// 远程 Actor URL 或本地用户名
    pub actor: String,
    /// member / admin / observer
    pub role: Option<String>,
}

/// 发送 Room 消息请求
#[derive(Debug, Deserialize)]
pub struct SendRoomMessageRequest {
    pub message_type: Option<String>,
    pub payload: serde_json::Value,
    pub thread_id: Option<String>,
    pub reply_to: Option<String>,
}

/// Room 概要
#[derive(Debug, Serialize)]
pub struct RoomSummary {
    pub room_id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar_url: Option<String>,
    pub owner_actor: String,
    pub governance_type: String,
    pub invite_policy: String,
    pub member_count: i64,
    pub max_members: i32,
    pub is_public: bool,
    pub my_role: Option<String>,
    pub last_message_at: Option<String>,
    pub created_at: String,
    pub unread_count: i64,
}

/// Room 详情
#[derive(Debug, Serialize)]
pub struct RoomDetail {
    pub room_id: String,
    pub name: String,
    pub description: Option<String>,
    pub avatar_url: Option<String>,
    pub owner_actor: String,
    pub home_server: String,
    pub governance_type: String,
    pub governance_config: Option<serde_json::Value>,
    pub invite_policy: String,
    pub distribution_strategy: String,
    pub max_members: i32,
    pub is_public: bool,
    pub enabled_tapps: Option<serde_json::Value>,
    pub my_role: Option<String>,
    pub member_count: i64,
    pub created_at: String,
}

/// Room 成员
#[derive(Debug, Serialize)]
pub struct RoomMember {
    pub actor_url: String,
    pub is_local: bool,
    pub display_name: Option<String>,
    pub role: String,
    pub joined_at: String,
    pub invited_by: Option<String>,
}

/// Room 消息条目
#[derive(Debug, Clone, Serialize)]
pub struct RoomMessageItem {
    pub message_id: String,
    pub sender_actor: String,
    pub message_type: String,
    pub payload: serde_json::Value,
    pub thread_id: Option<String>,
    pub reply_to: Option<String>,
    pub reactions: serde_json::Value,
    pub is_pinned: bool,
    pub is_encrypted: bool,
    pub created_at: String,
}

/// 发送消息响应
#[derive(Debug, Serialize)]
pub struct SendRoomMessageResponse {
    pub success: bool,
    pub message_id: String,
    pub room_id: String,
}

// ==================== 辅助函数 ====================

/// 检查用户在 Room 中的角色
async fn get_member_role(
    db: &DatabaseConnection,
    room_id: &str,
    actor_url: &str,
) -> Result<Option<String>, sea_orm::DbErr> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT role FROM federation_room_members WHERE room_id = $1 AND actor_url = $2",
            [room_id.into(), actor_url.into()],
        ))
        .await?;

    Ok(row.and_then(|r| r.try_get::<String>("", "role").ok()))
}

/// 检查是否有管理权限（owner 或 admin）
fn is_admin_role(role: &str) -> bool {
    role == "owner" || role == "admin"
}

/// 向 Room 的所有远程成员 fan-out 一个 Activity
async fn fanout_to_remote_members(
    db: &DatabaseConnection,
    user_id: i32,
    room_id: &str,
    activity_id: &str,
    activity_json: &serde_json::Value,
    activity_type: &str,
    object_type: &str,
) -> Result<(), sea_orm::DbErr> {
    // 记录 Activity
    let act_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_activities
               (activity_id, user_id, activity_type, object_type, object_json, is_local, published_at)
               VALUES ($1, $2, $3, $4, $5, true, NOW())
               RETURNING id"#,
            [
                activity_id.into(),
                user_id.into(),
                activity_type.into(),
                object_type.into(),
                activity_json.clone().into(),
            ],
        ))
        .await?;

    let act_db_id = match act_row.and_then(|r| r.try_get::<i32>("", "id").ok()) {
        Some(id) => id,
        None => return Ok(()),
    };

    // 获取所有远程成员的 inbox
    let remote_members = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT DISTINCT ra.inbox_url, ra.domain
               FROM federation_room_members rm
               JOIN federation_remote_actors ra ON rm.actor_url = ra.actor_url
               WHERE rm.room_id = $1 AND rm.is_local = false"#,
            [room_id.into()],
        ))
        .await?;

    for member_row in remote_members {
        let inbox: String = member_row.try_get("", "inbox_url").unwrap_or_default();
        let domain: String = member_row.try_get("", "domain").unwrap_or_default();
        if !inbox.is_empty() {
            let _ = db
                .execute(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    r#"INSERT INTO federation_delivery_queue
                       (activity_id, target_inbox, target_domain, status, created_at)
                       VALUES ($1, $2, $3, 'pending', NOW())"#,
                    [act_db_id.into(), inbox.into(), domain.into()],
                ))
                .await;
        }
    }

    Ok(())
}

// ==================== Room CRUD ====================

/// 创建新 Room
pub async fn create_room(
    user_id: i32,
    username: &str,
    db: &DatabaseConnection,
    req: &CreateRoomRequest,
) -> Result<RoomDetail, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let local_actor = actor_url(&base_url, username);
    let home_server = extract_domain(&base_url).unwrap_or_default();
    let room_id = generate_room_id();

    let governance = req.governance_type.as_deref().unwrap_or("owner");
    let invite_policy = req.invite_policy.as_deref().unwrap_or("admin-only");
    let max_members = req.max_members.unwrap_or(50);
    let is_public = req.is_public.unwrap_or(false);

    // 验证名称和描述长度
    if req.name.is_empty() || req.name.len() > 500 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Room name must be 1-500 characters"})),
        ));
    }
    if req.description.as_ref().is_some_and(|d| d.len() > 5000) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Description must be at most 5000 characters"})),
        ));
    }

    // 验证 max_members 范围
    if !(2..=5000).contains(&max_members) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "max_members must be between 2 and 5000"})),
        ));
    }

    // 验证枚举值
    if !["owner", "democratic", "open"].contains(&governance) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid governance_type"})),
        ));
    }
    if !["admin-only", "member-invite", "open"].contains(&invite_policy) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid invite_policy"})),
        ));
    }

    // 创建 Room
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_rooms
           (room_id, name, description, avatar_url, owner_actor, home_server, governance_type, invite_policy,
            max_members, is_public, distribution_strategy, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'fan-out', NOW())"#,
        [
            room_id.clone().into(),
            req.name.clone().into(),
            req.description.clone().into(),
            req.avatar_url.clone().into(),
            local_actor.clone().into(),
            home_server.clone().into(),
            governance.into(),
            invite_policy.into(),
            max_members.into(),
            is_public.into(),
        ],
    ))
    .await
    .map_err(db_err)?;

    // 将创建者添加为 owner 成员
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_room_members
           (room_id, actor_url, is_local, local_user_id, role, joined_at)
           VALUES ($1, $2, true, $3, 'owner', NOW())"#,
        [
            room_id.clone().into(),
            local_actor.clone().into(),
            user_id.into(),
        ],
    ))
    .await
    .map_err(db_err)?;

    tracing::info!("[Room] Created room {} by {}", room_id, username);

    Ok(RoomDetail {
        room_id,
        name: req.name.clone(),
        description: req.description.clone(),
        avatar_url: req.avatar_url.clone(),
        owner_actor: local_actor,
        home_server,
        governance_type: governance.to_string(),
        governance_config: None,
        invite_policy: invite_policy.to_string(),
        distribution_strategy: "fan-out".to_string(),
        max_members,
        is_public,
        enabled_tapps: None,
        my_role: Some("owner".to_string()),
        member_count: 1,
        created_at: now_iso8601(),
    })
}

/// 更新 Room 信息（仅 owner/admin 可操作）
pub async fn update_room(
    user_id: i32,
    username: &str,
    room_id: &str,
    db: &DatabaseConnection,
    req: &UpdateRoomRequest,
) -> Result<RoomDetail, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let local_actor = actor_url(&base_url, username);

    // 验证权限：必须是 owner 或 admin
    let my_role = get_member_role(db, room_id, &local_actor)
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::FORBIDDEN,
                Json(json!({"error": "Not a member of this room"})),
            )
        })?;

    if !is_admin_role(&my_role) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Only owner or admin can update room"})),
        ));
    }

    // 验证字段
    if let Some(ref name) = req.name {
        if name.is_empty() || name.len() > 500 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Room name must be 1-500 characters"})),
            ));
        }
    }
    if let Some(ref desc) = req.description {
        if desc.len() > 5000 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Description must be at most 5000 characters"})),
            ));
        }
    }
    if let Some(ref avatar) = req.avatar_url {
        if avatar.len() > 2048 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Avatar URL too long"})),
            ));
        }
    }
    if let Some(ref policy) = req.invite_policy {
        if !["admin-only", "member-invite", "open"].contains(&policy.as_str()) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Invalid invite_policy"})),
            ));
        }
    }
    if let Some(max) = req.max_members {
        if !(2..=5000).contains(&max) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "max_members must be between 2 and 5000"})),
            ));
        }
    }

    // 构建动态 SET 子句
    let mut set_parts = Vec::new();
    let mut values: Vec<sea_orm::Value> = Vec::new();
    let mut idx = 1u32;

    if let Some(ref name) = req.name {
        set_parts.push(format!("name = ${}", idx));
        values.push(name.clone().into());
        idx += 1;
    }
    if let Some(ref desc) = req.description {
        set_parts.push(format!("description = ${}", idx));
        values.push(desc.clone().into());
        idx += 1;
    }
    if let Some(ref avatar) = req.avatar_url {
        set_parts.push(format!("avatar_url = ${}", idx));
        values.push(avatar.clone().into());
        idx += 1;
    }
    if let Some(ref policy) = req.invite_policy {
        set_parts.push(format!("invite_policy = ${}", idx));
        values.push(policy.clone().into());
        idx += 1;
    }
    if let Some(max) = req.max_members {
        set_parts.push(format!("max_members = ${}", idx));
        values.push(max.into());
        idx += 1;
    }
    if let Some(public) = req.is_public {
        set_parts.push(format!("is_public = ${}", idx));
        values.push(public.into());
        idx += 1;
    }

    if set_parts.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "No fields to update"})),
        ));
    }

    set_parts.push("updated_at = NOW()".to_string());
    let set_clause = set_parts.join(", ");
    let sql = format!(
        "UPDATE federation_rooms SET {} WHERE room_id = ${}",
        set_clause, idx
    );
    values.push(room_id.into());

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        &sql,
        values,
    ))
    .await
    .map_err(db_err)?;

    tracing::info!("[Room] Updated room {} by {}", room_id, username);

    // 返回更新后的详情
    get_room(user_id, username, room_id, db).await
}

/// 获取用户参与的所有 Room
pub async fn list_rooms(
    user_id: i32,
    username: &str,
    db: &DatabaseConnection,
) -> Result<Vec<RoomSummary>, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let local_actor = actor_url(&base_url, username);

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT r.room_id, r.name, r.description, r.avatar_url, r.owner_actor,
                      r.governance_type, r.invite_policy, r.max_members, r.is_public,
                      r.created_at,
                      rm.role AS my_role,
                      (SELECT COUNT(*) FROM federation_room_members WHERE room_id = r.room_id) AS member_count,
                      (SELECT MAX(created_at) FROM federation_room_messages WHERE room_id = r.room_id) AS last_message_at,
                      COALESCE((SELECT COUNT(*) FROM federation_room_messages msg
                                WHERE msg.room_id = r.room_id
                                  AND msg.sender_actor != $2
                                  AND msg.created_at > COALESCE(
                                      (SELECT MAX(m2.created_at) FROM federation_room_messages m2
                                       WHERE m2.room_id = r.room_id AND m2.sender_actor = $2), r.created_at)
                      ), 0) AS unread_count
               FROM federation_rooms r
               JOIN federation_room_members rm ON rm.room_id = r.room_id AND rm.actor_url = $2
               WHERE rm.is_local = true AND rm.local_user_id = $1
               ORDER BY COALESCE(
                   (SELECT MAX(created_at) FROM federation_room_messages WHERE room_id = r.room_id),
                   r.created_at
               ) DESC"#,
            [user_id.into(), local_actor.into()],
        ))
        .await
        .map_err(db_err)?;

    let mut rooms = Vec::new();
    for row in rows {
        rooms.push(RoomSummary {
            room_id: row.try_get("", "room_id").unwrap_or_default(),
            name: row.try_get("", "name").unwrap_or_default(),
            description: row
                .try_get::<Option<String>>("", "description")
                .unwrap_or(None),
            avatar_url: row
                .try_get::<Option<String>>("", "avatar_url")
                .unwrap_or(None),
            owner_actor: row.try_get("", "owner_actor").unwrap_or_default(),
            governance_type: row.try_get("", "governance_type").unwrap_or_default(),
            invite_policy: row.try_get("", "invite_policy").unwrap_or_default(),
            member_count: row.try_get::<i64>("", "member_count").unwrap_or(0),
            max_members: row.try_get::<i32>("", "max_members").unwrap_or(50),
            is_public: row.try_get::<bool>("", "is_public").unwrap_or(false),
            my_role: row.try_get::<Option<String>>("", "my_role").unwrap_or(None),
            last_message_at: row
                .try_get::<Option<chrono::DateTime<chrono::FixedOffset>>>("", "last_message_at")
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

    Ok(rooms)
}

/// 获取 Room 详情
pub async fn get_room(
    user_id: i32,
    username: &str,
    room_id: &str,
    db: &DatabaseConnection,
) -> Result<RoomDetail, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let local_actor = actor_url(&base_url, username);

    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT r.room_id, r.name, r.description, r.avatar_url, r.owner_actor, r.home_server,
                      r.governance_type, r.governance_config, r.invite_policy,
                      r.distribution_strategy, r.max_members, r.is_public,
                      r.enabled_tapps, r.created_at,
                      rm.role AS my_role,
                      (SELECT COUNT(*) FROM federation_room_members WHERE room_id = r.room_id) AS member_count
               FROM federation_rooms r
               LEFT JOIN federation_room_members rm ON rm.room_id = r.room_id AND rm.actor_url = $3
               WHERE r.room_id = $1
                 AND (r.is_public = true
                      OR EXISTS (SELECT 1 FROM federation_room_members
                                 WHERE room_id = r.room_id AND is_local = true AND local_user_id = $2))"#,
            [room_id.into(), user_id.into(), local_actor.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (StatusCode::NOT_FOUND, Json(json!({"error": "Room not found or access denied"})))
        })?;

    Ok(RoomDetail {
        room_id: row.try_get("", "room_id").unwrap_or_default(),
        name: row.try_get("", "name").unwrap_or_default(),
        description: row
            .try_get::<Option<String>>("", "description")
            .unwrap_or(None),
        avatar_url: row
            .try_get::<Option<String>>("", "avatar_url")
            .unwrap_or(None),
        owner_actor: row.try_get("", "owner_actor").unwrap_or_default(),
        home_server: row.try_get("", "home_server").unwrap_or_default(),
        governance_type: row.try_get("", "governance_type").unwrap_or_default(),
        governance_config: row
            .try_get::<Option<serde_json::Value>>("", "governance_config")
            .unwrap_or(None),
        invite_policy: row.try_get("", "invite_policy").unwrap_or_default(),
        distribution_strategy: row.try_get("", "distribution_strategy").unwrap_or_default(),
        max_members: row.try_get::<i32>("", "max_members").unwrap_or(50),
        is_public: row.try_get::<bool>("", "is_public").unwrap_or(false),
        enabled_tapps: row
            .try_get::<Option<serde_json::Value>>("", "enabled_tapps")
            .unwrap_or(None),
        my_role: row.try_get::<Option<String>>("", "my_role").unwrap_or(None),
        member_count: row.try_get::<i64>("", "member_count").unwrap_or(0),
        created_at: row
            .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "created_at")
            .map(|t| t.to_rfc3339())
            .unwrap_or_default(),
    })
}

/// 获取 Room 成员列表
pub async fn get_members(
    user_id: i32,
    username: &str,
    room_id: &str,
    db: &DatabaseConnection,
) -> Result<Vec<RoomMember>, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let local_actor = actor_url(&base_url, username);

    // 验证用户是成员
    let is_member = get_member_role(db, room_id, &local_actor)
        .await
        .map_err(db_err)?;
    if is_member.is_none() {
        // 检查是否是公开 Room
        let is_public = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "SELECT 1 FROM federation_rooms WHERE room_id = $1 AND is_public = true",
                [room_id.into()],
            ))
            .await
            .map_err(db_err)?;
        if is_public.is_none() {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": "Not a member of this room"})),
            ));
        }
    }

    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT rm.actor_url, rm.is_local, rm.role, rm.joined_at, rm.invited_by,
                      COALESCE(ra.display_name, ra.username) AS display_name
               FROM federation_room_members rm
               LEFT JOIN federation_remote_actors ra ON rm.actor_url = ra.actor_url
               WHERE rm.room_id = $1
               ORDER BY
                 CASE rm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END,
                 rm.joined_at"#,
            [room_id.into()],
        ))
        .await
        .map_err(db_err)?;

    let _ = user_id; // validated via actor_url
    let members = rows
        .iter()
        .map(|r| RoomMember {
            actor_url: r.try_get("", "actor_url").unwrap_or_default(),
            is_local: r.try_get::<bool>("", "is_local").unwrap_or(false),
            display_name: r
                .try_get::<Option<String>>("", "display_name")
                .unwrap_or(None),
            role: r.try_get("", "role").unwrap_or_default(),
            joined_at: r
                .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "joined_at")
                .map(|t| t.to_rfc3339())
                .unwrap_or_default(),
            invited_by: r
                .try_get::<Option<String>>("", "invited_by")
                .unwrap_or(None),
        })
        .collect();

    Ok(members)
}

// ==================== 成员管理 ====================

/// 邀请成员加入 Room
pub async fn invite_member(
    user_id: i32,
    username: &str,
    room_id: &str,
    db: &DatabaseConnection,
    req: &InviteMemberRequest,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let local_actor = actor_url(&base_url, username);

    // 验证邀请权限
    let my_role = get_member_role(db, room_id, &local_actor)
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::FORBIDDEN,
                Json(json!({"error": "Not a member"})),
            )
        })?;

    // 检查 invite_policy
    let room_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT invite_policy, max_members FROM federation_rooms WHERE room_id = $1",
            [room_id.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Room not found"})),
            )
        })?;

    let policy: String = room_row.try_get("", "invite_policy").unwrap_or_default();
    let max_members: i32 = room_row.try_get("", "max_members").unwrap_or(50);

    match policy.as_str() {
        "admin-only" if !is_admin_role(&my_role) => {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": "Only admins can invite"})),
            ));
        }
        "member-invite" => {} // 任何成员可邀请
        "open" => {}          // 无限制
        _ if !is_admin_role(&my_role) => {
            return Err((
                StatusCode::FORBIDDEN,
                Json(json!({"error": "Insufficient permissions"})),
            ));
        }
        _ => {}
    }

    // 检查成员上限
    let count_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT COUNT(*)::int AS cnt FROM federation_room_members WHERE room_id = $1",
            [room_id.into()],
        ))
        .await
        .map_err(db_err)?;

    let current_count: i32 = count_row
        .and_then(|r| r.try_get::<i32>("", "cnt").ok())
        .unwrap_or(0);

    if current_count >= max_members {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Room is full"})),
        ));
    }

    let role = req.role.as_deref().unwrap_or("member");
    if !["member", "admin", "observer"].contains(&role) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Invalid role"})),
        ));
    }

    // 解析目标 Actor
    let target_actor = &req.actor;
    let is_remote = target_actor.starts_with("http://") || target_actor.starts_with("https://");

    if is_remote {
        // 远程成员：fetch actor + 添加记录
        let remote = crate::federation::actor::fetch_remote_actor(db, target_actor)
            .await
            .map_err(|e| {
                tracing::error!("[Room] Failed to fetch remote actor: {}", e);
                (
                    StatusCode::BAD_REQUEST,
                    Json(json!({"error": format!("Cannot resolve actor: {}", e)})),
                )
            })?;

        // 添加远程成员
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_room_members
               (room_id, actor_url, is_local, role, invited_by, joined_at)
               VALUES ($1, $2, false, $3, $4, NOW())
               ON CONFLICT (room_id, actor_url) DO NOTHING"#,
            [
                room_id.into(),
                remote.actor_url.clone().into(),
                role.into(),
                local_actor.clone().into(),
            ],
        ))
        .await
        .map_err(db_err)?;

        // 发送 RoomInvite Activity 给远程方
        let activity_id = generate_activity_id(&base_url);
        let invite_activity = json!({
            "@context": build_context(),
            "type": "myriad:RoomInvite",
            "id": &activity_id,
            "actor": &local_actor,
            "to": [&remote.actor_url],
            "object": {
                "type": "myriad:Room",
                "id": room_id,
                "role": role
            }
        });

        let inbox = &remote.inbox_url;
        if !inbox.is_empty() {
            let domain = extract_domain(inbox).unwrap_or_default();
            let act_row = db
                .query_one(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    r#"INSERT INTO federation_activities
                       (activity_id, user_id, activity_type, object_type, object_json, is_local, published_at)
                       VALUES ($1, $2, 'RoomInvite', 'Room', $3, true, NOW())
                       RETURNING id"#,
                    [activity_id.into(), user_id.into(), invite_activity.into()],
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
            "[Room] Invited remote {} to room {} as {}",
            remote.actor_url,
            room_id,
            role
        );
    } else {
        // 本地成员 — 解析用户名 → actor_url
        let local_target_actor = actor_url(&base_url, target_actor);
        // 查找本地用户 ID
        let local_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "SELECT id FROM users WHERE username = $1",
                [target_actor.into()],
            ))
            .await
            .map_err(db_err)?;

        let target_user_id: Option<i32> = local_row.and_then(|r| r.try_get("", "id").ok());

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_room_members
               (room_id, actor_url, is_local, local_user_id, role, invited_by, joined_at)
               VALUES ($1, $2, true, $3, $4, $5, NOW())
               ON CONFLICT (room_id, actor_url) DO NOTHING"#,
            [
                room_id.into(),
                local_target_actor.into(),
                target_user_id.into(),
                role.into(),
                local_actor.clone().into(),
            ],
        ))
        .await
        .map_err(db_err)?;

        tracing::info!(
            "[Room] Invited local {} to room {} as {}",
            target_actor,
            room_id,
            role
        );
    }

    // 广播系统消息
    let system_msg = json!({
        "type": "system",
        "room_id": room_id,
        "event": "member_invited",
        "actor": &req.actor,
        "role": role,
        "invited_by": &local_actor
    });
    crate::federation::ws_gateway::broadcast_to_room(room_id, &system_msg).await;

    Ok(json!({
        "success": true,
        "room_id": room_id,
        "invited": &req.actor,
        "role": role
    }))
}

/// 移除成员
pub async fn remove_member(
    user_id: i32,
    username: &str,
    room_id: &str,
    target_actor: &str,
    db: &DatabaseConnection,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let local_actor = actor_url(&base_url, username);

    // 验证权限
    let my_role = get_member_role(db, room_id, &local_actor)
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::FORBIDDEN,
                Json(json!({"error": "Not a member"})),
            )
        })?;

    if !is_admin_role(&my_role) {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Only admins can remove members"})),
        ));
    }

    // 不能移除 owner
    let target_role = get_member_role(db, room_id, target_actor)
        .await
        .map_err(db_err)?;

    if target_role.as_deref() == Some("owner") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Cannot remove the room owner"})),
        ));
    }

    let _ = user_id; // validated via my_role check

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "DELETE FROM federation_room_members WHERE room_id = $1 AND actor_url = $2",
        [room_id.into(), target_actor.into()],
    ))
    .await
    .map_err(db_err)?;

    // 广播系统消息
    let system_msg = json!({
        "type": "system",
        "room_id": room_id,
        "event": "member_removed",
        "actor": target_actor,
        "removed_by": &local_actor
    });
    crate::federation::ws_gateway::broadcast_to_room(room_id, &system_msg).await;

    tracing::info!("[Room] Removed {} from room {}", target_actor, room_id);

    Ok(json!({ "success": true, "room_id": room_id, "removed": target_actor }))
}

/// 离开 Room
pub async fn leave_room(
    user_id: i32,
    username: &str,
    room_id: &str,
    db: &DatabaseConnection,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let local_actor = actor_url(&base_url, username);

    let my_role = get_member_role(db, room_id, &local_actor)
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({"error": "Not a member"})),
            )
        })?;

    if my_role == "owner" {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Owner cannot leave. Transfer ownership or delete the room."})),
        ));
    }

    let _ = user_id;

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "DELETE FROM federation_room_members WHERE room_id = $1 AND actor_url = $2",
        [room_id.into(), local_actor.clone().into()],
    ))
    .await
    .map_err(db_err)?;

    // 广播
    let system_msg = json!({
        "type": "system",
        "room_id": room_id,
        "event": "member_left",
        "actor": &local_actor
    });
    crate::federation::ws_gateway::broadcast_to_room(room_id, &system_msg).await;

    tracing::info!("[Room] {} left room {}", username, room_id);

    Ok(json!({ "success": true, "room_id": room_id }))
}

// ==================== 消息功能 ====================

/// 最大消息载荷大小: 1MB
const MAX_ROOM_MESSAGE_PAYLOAD: usize = 1_048_576;

/// 发送 Room 消息
pub async fn send_room_message(
    user_id: i32,
    username: &str,
    room_id: &str,
    db: &DatabaseConnection,
    req: &SendRoomMessageRequest,
) -> Result<SendRoomMessageResponse, (StatusCode, Json<serde_json::Value>)> {
    // 验证载荷大小
    let payload_size = req.payload.to_string().len();
    if payload_size > MAX_ROOM_MESSAGE_PAYLOAD {
        return Err((
            StatusCode::PAYLOAD_TOO_LARGE,
            Json(
                json!({"error": format!("Message payload too large: {} bytes (max {})", payload_size, MAX_ROOM_MESSAGE_PAYLOAD)}),
            ),
        ));
    }

    let base_url = get_base_url().await;
    let local_actor = actor_url(&base_url, username);
    let message_type = req.message_type.as_deref().unwrap_or("text");

    // 验证成员身份
    let my_role = get_member_role(db, room_id, &local_actor)
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::FORBIDDEN,
                Json(json!({"error": "Not a member"})),
            )
        })?;

    // observer 不能发消息
    if my_role == "observer" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Observers cannot send messages"})),
        ));
    }

    let message_id = generate_message_id();

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_room_messages
           (room_id, message_id, sender_actor, message_type, payload, thread_id, reply_to,
            reactions, is_pinned, is_encrypted, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', false, false, NOW())"#,
        [
            room_id.into(),
            message_id.clone().into(),
            local_actor.clone().into(),
            message_type.into(),
            req.payload.clone().into(),
            req.thread_id.clone().into(),
            req.reply_to.clone().into(),
        ],
    ))
    .await
    .map_err(db_err)?;

    // 广播给 WebSocket 连接
    let ws_msg = json!({
        "type": "message",
        "room_id": room_id,
        "message": {
            "message_id": &message_id,
            "sender_actor": &local_actor,
            "message_type": message_type,
            "payload": &req.payload,
            "thread_id": &req.thread_id,
            "reply_to": &req.reply_to,
            "created_at": now_iso8601()
        }
    });
    crate::federation::ws_gateway::broadcast_to_room(room_id, &ws_msg).await;

    // Fan-out 到远程成员
    let activity_id = generate_activity_id(&base_url);
    let msg_activity = json!({
        "@context": build_context(),
        "type": "myriad:RoomMessage",
        "id": &activity_id,
        "actor": &local_actor,
        "object": {
            "type": "myriad:RoomMessage",
            "room": room_id,
            "messageId": &message_id,
            "messageType": message_type,
            "from": &local_actor,
            "payload": &req.payload,
            "threadId": &req.thread_id,
            "replyTo": &req.reply_to,
            "timestamp": now_iso8601()
        }
    });

    let _ = fanout_to_remote_members(
        db,
        user_id,
        room_id,
        &activity_id,
        &msg_activity,
        "RoomMessage",
        "RoomMessage",
    )
    .await;

    Ok(SendRoomMessageResponse {
        success: true,
        message_id,
        room_id: room_id.to_string(),
    })
}

/// 获取 Room 消息历史
pub async fn get_room_messages(
    user_id: i32,
    username: &str,
    room_id: &str,
    db: &DatabaseConnection,
    before: Option<&str>,
    limit: Option<i64>,
) -> Result<Vec<RoomMessageItem>, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let local_actor = actor_url(&base_url, username);

    // 验证成员身份
    let is_member = get_member_role(db, room_id, &local_actor)
        .await
        .map_err(db_err)?;
    if is_member.is_none() {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Not a member"})),
        ));
    }

    let _ = user_id;
    let limit = limit.unwrap_or(50).min(200);

    let rows = if let Some(before_id) = before {
        db.query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT message_id, sender_actor, message_type, payload, thread_id, reply_to,
                      reactions, is_pinned, is_encrypted, created_at
               FROM federation_room_messages
               WHERE room_id = $1
                 AND created_at < (SELECT created_at FROM federation_room_messages WHERE message_id = $2)
               ORDER BY created_at DESC
               LIMIT $3"#,
            [room_id.into(), before_id.into(), limit.into()],
        ))
        .await
        .map_err(db_err)?
    } else {
        db.query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT message_id, sender_actor, message_type, payload, thread_id, reply_to,
                      reactions, is_pinned, is_encrypted, created_at
               FROM federation_room_messages
               WHERE room_id = $1
               ORDER BY created_at DESC
               LIMIT $2"#,
            [room_id.into(), limit.into()],
        ))
        .await
        .map_err(db_err)?
    };

    let mut messages: Vec<RoomMessageItem> = rows
        .iter()
        .map(|r| RoomMessageItem {
            message_id: r.try_get("", "message_id").unwrap_or_default(),
            sender_actor: r.try_get("", "sender_actor").unwrap_or_default(),
            message_type: r.try_get("", "message_type").unwrap_or_default(),
            payload: r.try_get("", "payload").unwrap_or(json!(null)),
            thread_id: r.try_get::<Option<String>>("", "thread_id").unwrap_or(None),
            reply_to: r.try_get::<Option<String>>("", "reply_to").unwrap_or(None),
            reactions: r.try_get("", "reactions").unwrap_or(json!({})),
            is_pinned: r.try_get::<bool>("", "is_pinned").unwrap_or(false),
            is_encrypted: r.try_get::<bool>("", "is_encrypted").unwrap_or(false),
            created_at: r
                .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "created_at")
                .map(|t| t.to_rfc3339())
                .unwrap_or_default(),
        })
        .collect();

    messages.reverse();
    Ok(messages)
}

// ==================== Inbox 处理（远程 Room 事件）====================

/// 处理远程 RoomInvite
pub async fn handle_room_invite(
    db: &DatabaseConnection,
    actor_url_str: &str,
    activity: &serde_json::Value,
) -> Result<(), String> {
    let object = activity.get("object").ok_or("Missing object")?;
    let room_id = object
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing room id")?;
    let role = object
        .get("role")
        .and_then(|v| v.as_str())
        .unwrap_or("member");

    // 查找本地接收者（从 "to" 字段推断）
    let to = activity.get("to").and_then(|v| v.as_array());
    let local_user_id: Option<i32> = if let Some(targets) = to {
        let mut found_id = None;
        for target in targets {
            if let Some(url) = target.as_str() {
                // 尝试从 /users/xxx 提取用户名并查找
                if let Some(uname) = url.rsplit('/').next() {
                    if let Ok(Some(row)) = db
                        .query_one(Statement::from_sql_and_values(
                            DatabaseBackend::Postgres,
                            "SELECT id FROM users WHERE username = $1",
                            [uname.into()],
                        ))
                        .await
                    {
                        found_id = row.try_get::<i32>("", "id").ok();
                        break;
                    }
                }
            }
        }
        found_id
    } else {
        None
    };

    let target_user_id: i32 = match local_user_id {
        Some(uid) => uid,
        None => {
            // 个人实例回退：无法从 "to" 解析出收件人时路由到第一个本地用户
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
    let base_url_val = {
        let config = crate::GLOBAL_CONFIG.read().await;
        config
            .base_url
            .clone()
            .unwrap_or_else(|| format!("http://{}:{}", config.server_host, config.server_port))
    };

    // 先确保 Room 有记录（如果是首次看到这个 room）
    let room_exists = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT 1 FROM federation_rooms WHERE room_id = $1",
            [room_id.into()],
        ))
        .await
        .map_err(|e| e.to_string())?;

    if room_exists.is_none() {
        let home_server = extract_domain(actor_url_str).unwrap_or_default();
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_rooms
               (room_id, name, description, owner_actor, home_server, governance_type, invite_policy,
                max_members, is_public, distribution_strategy, created_at)
               VALUES ($1, $2, NULL, $3, $4, 'owner', 'admin-only', 50, false, 'fan-out', NOW())
               ON CONFLICT (room_id) DO NOTHING"#,
            [
                room_id.into(),
                format!("Room {}", &room_id[..8.min(room_id.len())]).into(),
                actor_url_str.into(),
                home_server.into(),
            ],
        ))
        .await
        .map_err(|e| e.to_string())?;
    }

    // 查找或创建本地用户对应的 actor_url
    let local_actor = if let Ok(Some(row)) = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT username FROM users WHERE id = $1",
            [target_user_id.into()],
        ))
        .await
    {
        let uname: String = row.try_get("", "username").unwrap_or_default();
        actor_url(&base_url_val, &uname)
    } else {
        actor_url(&base_url_val, "unknown")
    };

    // 添加本地用户作为成员
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_room_members
           (room_id, actor_url, is_local, local_user_id, role, invited_by, joined_at)
           VALUES ($1, $2, true, $3, $4, $5, NOW())
           ON CONFLICT (room_id, actor_url) DO NOTHING"#,
        [
            room_id.into(),
            local_actor.into(),
            target_user_id.into(),
            role.into(),
            actor_url_str.into(),
        ],
    ))
    .await
    .map_err(|e| e.to_string())?;

    tracing::info!(
        "[Room] Received invite to room {} from {}",
        room_id,
        actor_url_str
    );
    Ok(())
}

/// 处理远程 RoomMessage
pub async fn handle_room_message(
    db: &DatabaseConnection,
    actor_url_str: &str,
    activity: &serde_json::Value,
) -> Result<(), String> {
    let object = activity.get("object").ok_or("Missing object")?;
    let room_id = object
        .get("room")
        .and_then(|v| v.as_str())
        .ok_or("Missing room")?;

    // 验证发送方是该 Room 的成员
    let sender_actor = object
        .get("from")
        .and_then(|v| v.as_str())
        .unwrap_or(actor_url_str);
    let is_member = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT 1 FROM federation_room_members WHERE room_id = $1 AND actor_url = $2",
            [room_id.into(), sender_actor.into()],
        ))
        .await
        .map_err(|e| e.to_string())?;

    if is_member.is_none() {
        return Err(format!(
            "Actor {} is not a member of room {}",
            sender_actor, room_id
        ));
    }

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
    let thread_id = object.get("threadId").and_then(|v| v.as_str());
    let reply_to = object.get("replyTo").and_then(|v| v.as_str());

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_room_messages
           (room_id, message_id, sender_actor, message_type, payload, thread_id, reply_to,
            reactions, is_pinned, is_encrypted, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', false, false, NOW())
           ON CONFLICT (message_id) DO NOTHING"#,
        [
            room_id.into(),
            message_id.into(),
            sender.into(),
            message_type.into(),
            payload.clone().into(),
            thread_id.into(),
            reply_to.into(),
        ],
    ))
    .await
    .map_err(|e| e.to_string())?;

    // 广播到本地 WebSocket
    crate::federation::ws_gateway::broadcast_to_room(
        room_id,
        &json!({
            "type": "message",
            "room_id": room_id,
            "message": {
                "message_id": message_id,
                "sender_actor": sender,
                "message_type": message_type,
                "payload": payload,
                "thread_id": thread_id,
                "reply_to": reply_to,
                "created_at": now_iso8601()
            }
        }),
    )
    .await;

    tracing::info!("[Room] Received message {} in room {}", message_id, room_id);
    Ok(())
}

/// 处理远程 RoomLeave
pub async fn handle_room_leave(
    db: &DatabaseConnection,
    actor_url_str: &str,
    activity: &serde_json::Value,
) -> Result<(), String> {
    let object = activity.get("object").ok_or("Missing object")?;
    let room_id = object
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Missing room id")?;

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "DELETE FROM federation_room_members WHERE room_id = $1 AND actor_url = $2",
        [room_id.into(), actor_url_str.into()],
    ))
    .await
    .map_err(|e| e.to_string())?;

    crate::federation::ws_gateway::broadcast_to_room(
        room_id,
        &json!({
            "type": "system",
            "room_id": room_id,
            "event": "member_left",
            "actor": actor_url_str
        }),
    )
    .await;

    tracing::info!("[Room] {} left room {}", actor_url_str, room_id);
    Ok(())
}

/// 处理远程 RoomJoin (myriad:RoomJoin)
///
/// 远程方接受 Invite，加入 Room。本地 home server 把成员激活，并向其他成员广播。
pub async fn handle_room_join(
    db: &DatabaseConnection,
    actor_url_str: &str,
    activity: &serde_json::Value,
) -> Result<(), String> {
    let object = activity.get("object").ok_or("Missing object")?;
    let room_id = object
        .get("id")
        .and_then(|v| v.as_str())
        .or_else(|| object.get("room").and_then(|v| v.as_str()))
        .ok_or("Missing room id")?;
    let role = object
        .get("role")
        .and_then(|v| v.as_str())
        .unwrap_or("member");

    // 验证 Room 存在
    let room_exists = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT 1 FROM federation_rooms WHERE room_id = $1",
            [room_id.into()],
        ))
        .await
        .map_err(|e| e.to_string())?;

    if room_exists.is_none() {
        return Err(format!("Room {} not found", room_id));
    }

    // 加入/激活成员
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_room_members
           (room_id, actor_url, is_local, role, joined_at)
           VALUES ($1, $2, false, $3, NOW())
           ON CONFLICT (room_id, actor_url) DO UPDATE SET
               role = EXCLUDED.role,
               joined_at = COALESCE(federation_room_members.joined_at, NOW())"#,
        [room_id.into(), actor_url_str.into(), role.into()],
    ))
    .await
    .map_err(|e| e.to_string())?;

    crate::federation::ws_gateway::broadcast_to_room(
        room_id,
        &json!({
            "type": "system",
            "room_id": room_id,
            "event": "member_joined",
            "actor": actor_url_str,
            "role": role
        }),
    )
    .await;

    tracing::info!(
        "[Room] {} joined room {} as {}",
        actor_url_str,
        room_id,
        role
    );
    Ok(())
}

/// 处理 RoomGovernance Activity (myriad:RoomGovernance)
///
/// 治理变更：name / description / avatar_url / invite_policy / max_members / is_public /
/// transfer_owner。仅 owner 或 admin 角色可执行；transfer_owner 仅 owner 可执行。
pub async fn handle_room_governance(
    db: &DatabaseConnection,
    actor_url_str: &str,
    activity: &serde_json::Value,
) -> Result<(), String> {
    let object = activity.get("object").ok_or("Missing object")?;
    let room_id = object
        .get("room")
        .and_then(|v| v.as_str())
        .or_else(|| object.get("id").and_then(|v| v.as_str()))
        .ok_or("Missing room id")?;
    let changes = object
        .get("changes")
        .and_then(|v| v.as_object())
        .ok_or("Missing changes object")?;

    // 验证发送方是 owner / admin
    let sender_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT m.role, r.owner_actor
               FROM federation_room_members m
               JOIN federation_rooms r ON r.room_id = m.room_id
               WHERE m.room_id = $1 AND m.actor_url = $2"#,
            [room_id.into(), actor_url_str.into()],
        ))
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            format!(
                "Actor {} is not a member of room {}",
                actor_url_str, room_id
            )
        })?;

    let role: String = sender_row.try_get("", "role").unwrap_or_default();
    let owner: String = sender_row.try_get("", "owner_actor").unwrap_or_default();
    let is_owner = owner == actor_url_str;
    let is_admin = role == "admin" || is_owner;
    if !is_admin {
        return Err(format!(
            "Actor {} has no governance rights in room {}",
            actor_url_str, room_id
        ));
    }

    // 转移 owner — 仅 owner 可发
    if let Some(new_owner) = changes.get("transfer_owner").and_then(|v| v.as_str()) {
        if !is_owner {
            return Err("Only owner can transfer ownership".to_string());
        }
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "UPDATE federation_rooms SET owner_actor = $2 WHERE room_id = $1",
            [room_id.into(), new_owner.into()],
        ))
        .await
        .map_err(|e| e.to_string())?;
    }

    // 字段更新（白名单）
    let mut updates: Vec<(&str, sea_orm::Value)> = Vec::new();
    if let Some(v) = changes.get("name").and_then(|v| v.as_str()) {
        updates.push(("name", v.to_string().into()));
    }
    if let Some(v) = changes.get("description").and_then(|v| v.as_str()) {
        updates.push(("description", v.to_string().into()));
    }
    if let Some(v) = changes.get("avatar_url").and_then(|v| v.as_str()) {
        updates.push(("avatar_url", v.to_string().into()));
    }
    if let Some(v) = changes.get("invite_policy").and_then(|v| v.as_str()) {
        updates.push(("invite_policy", v.to_string().into()));
    }
    if let Some(v) = changes.get("max_members").and_then(|v| v.as_i64()) {
        updates.push(("max_members", (v as i32).into()));
    }
    if let Some(v) = changes.get("is_public").and_then(|v| v.as_bool()) {
        updates.push(("is_public", v.into()));
    }

    for (col, val) in updates {
        let sql = format!(
            "UPDATE federation_rooms SET {} = $2, updated_at = NOW() WHERE room_id = $1",
            col
        );
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            &sql,
            [room_id.into(), val],
        ))
        .await
        .map_err(|e| e.to_string())?;
    }

    crate::federation::ws_gateway::broadcast_to_room(
        room_id,
        &json!({
            "type": "system",
            "room_id": room_id,
            "event": "governance_changed",
            "actor": actor_url_str,
            "changes": changes
        }),
    )
    .await;

    tracing::info!(
        "[Room] Governance change in {} by {}: {:?}",
        room_id,
        actor_url_str,
        changes
    );
    Ok(())
}
