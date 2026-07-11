//! Agent 通知系统
//!
//! 提供实时通知推送（broadcast channel + SSE）和历史通知缓存。
//! 集成 heartbeat 任务结果、agent 执行结果等多种通知来源。
//!
//! 持久化：通知写入 `agent_notifications` 表，启动时恢复最近历史，
//! 已读状态落库，保留 30 天自动清理。内存中的环形缓冲作为热缓存。

use std::collections::VecDeque;
use std::sync::{Arc, OnceLock};

use chrono::{DateTime, Utc};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait,
    IntoActiveModel, PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, Statement,
};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};

use crate::models::entities::agent_notifications as notif_entity;

/// 全局通知管理器单例
static NOTIFICATION_MANAGER: OnceLock<Arc<NotificationManager>> = OnceLock::new();

/// 通知类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationType {
    /// Agent 任务正在执行（同一 run 的通知会原位更新）
    TaskProgress,
    /// Agent 任务完成
    TaskCompleted,
    /// Agent 任务失败
    TaskFailed,
    /// Agent 任务由用户明确取消
    TaskCancelled,
    /// Heartbeat 定时任务执行结果
    HeartbeatResult,
    /// MCP 服务器状态变化
    McpServerStatus,
    /// Brew 订阅源抓取到新内容
    BrewNewItems,
    /// Brew 订阅源连续抓取失败
    BrewSourceError,
    /// Tapp 定时任务排队的用户通知
    TappNotification,
    /// 系统更新/回滚任务状态
    UpdaterStatus,
    /// 系统提示（如能力更新、记忆归档）
    SystemInfo,
    /// 升级/澄清请求
    AgentClarification,
}

/// 通知优先级
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum NotificationPriority {
    Low = 0,
    Normal = 1,
    High = 2,
    Urgent = 3,
}

impl NotificationType {
    fn as_str(&self) -> &'static str {
        match self {
            NotificationType::TaskProgress => "task_progress",
            NotificationType::TaskCompleted => "task_completed",
            NotificationType::TaskFailed => "task_failed",
            NotificationType::TaskCancelled => "task_cancelled",
            NotificationType::HeartbeatResult => "heartbeat_result",
            NotificationType::McpServerStatus => "mcp_server_status",
            NotificationType::BrewNewItems => "brew_new_items",
            NotificationType::BrewSourceError => "brew_source_error",
            NotificationType::TappNotification => "tapp_notification",
            NotificationType::UpdaterStatus => "updater_status",
            NotificationType::SystemInfo => "system_info",
            NotificationType::AgentClarification => "agent_clarification",
        }
    }

    fn from_str(s: &str) -> Self {
        match s {
            "task_progress" => NotificationType::TaskProgress,
            "task_completed" => NotificationType::TaskCompleted,
            "task_failed" => NotificationType::TaskFailed,
            "task_cancelled" => NotificationType::TaskCancelled,
            "heartbeat_result" => NotificationType::HeartbeatResult,
            "mcp_server_status" => NotificationType::McpServerStatus,
            "brew_new_items" => NotificationType::BrewNewItems,
            "brew_source_error" => NotificationType::BrewSourceError,
            "tapp_notification" => NotificationType::TappNotification,
            "updater_status" => NotificationType::UpdaterStatus,
            "agent_clarification" => NotificationType::AgentClarification,
            _ => NotificationType::SystemInfo,
        }
    }
}

impl NotificationPriority {
    fn as_str(&self) -> &'static str {
        match self {
            NotificationPriority::Low => "low",
            NotificationPriority::Normal => "normal",
            NotificationPriority::High => "high",
            NotificationPriority::Urgent => "urgent",
        }
    }

    fn from_str(s: &str) -> Self {
        match s {
            "low" => NotificationPriority::Low,
            "high" => NotificationPriority::High,
            "urgent" => NotificationPriority::Urgent,
            _ => NotificationPriority::Normal,
        }
    }
}

/// 单条通知
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub notification_type: NotificationType,
    pub priority: NotificationPriority,
    pub title: String,
    pub body: String,
    /// 目标用户 ID。用户可见通知必须有明确 owner；None 仅兼容旧数据，不再下发。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<i32>,
    /// 可选的结构化数据（如任务 ID、链接等）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub read: bool,
}

impl Notification {
    pub fn new(
        user_id: i32,
        notification_type: NotificationType,
        priority: NotificationPriority,
        title: impl Into<String>,
        body: impl Into<String>,
    ) -> Self {
        Self {
            id: format!("notif_{}", uuid::Uuid::new_v4().simple()),
            notification_type,
            priority,
            title: title.into(),
            body: body.into(),
            user_id: Some(user_id),
            metadata: None,
            created_at: Utc::now(),
            read: false,
        }
    }

    pub fn with_metadata(mut self, metadata: serde_json::Value) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

/// SSE 推送事件（broadcast channel 传输类型）
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum NotificationEvent {
    /// 新通知
    NewNotification { notification: Notification },
    /// 通知已读
    NotificationRead { id: String, user_id: i32 },
    /// 该用户全部已读（SSE 端按 user_id 过滤转发）
    NotificationsReadAll { user_id: i32 },
    /// 通知被删除
    NotificationDeleted { id: String, user_id: i32 },
    /// 通知被批量清空（SSE 端按 user_id 过滤转发）
    NotificationsCleared { user_id: i32 },
}

pub fn event_is_for_user(event: &NotificationEvent, user_id: i32) -> bool {
    match event {
        NotificationEvent::NewNotification { notification } => {
            notification.user_id == Some(user_id)
        }
        NotificationEvent::NotificationRead { user_id: owner, .. }
        | NotificationEvent::NotificationDeleted { user_id: owner, .. }
        | NotificationEvent::NotificationsReadAll { user_id: owner }
        | NotificationEvent::NotificationsCleared { user_id: owner } => *owner == user_id,
    }
}

/// 通知管理器
pub struct NotificationManager {
    /// 广播通道（multi-subscriber SSE）
    tx: broadcast::Sender<NotificationEvent>,
    /// 历史通知环形缓冲区（热缓存，启动时从 DB 恢复）
    history: RwLock<VecDeque<Notification>>,
    /// 最大历史记录数
    max_history: usize,
    /// 数据库连接（持久化通知历史与已读状态）
    db: Option<DatabaseConnection>,
}

impl NotificationManager {
    /// 创建带持久化的管理器，并从 DB 恢复最近历史
    pub async fn new_with_db(max_history: usize, db: DatabaseConnection) -> Self {
        let (tx, _) = broadcast::channel(128);
        let mut history = VecDeque::with_capacity(max_history);

        // 旧版本把 user_id=NULL 当作共享广播；该记录允许任意用户删除，且可能包含
        // Heartbeat/Agent 私有结果。新模型不再支持共享可变通知，启动时安全清理。
        match notif_entity::Entity::delete_many()
            .filter(notif_entity::Column::UserId.is_null())
            .exec(&db)
            .await
        {
            Ok(result) if result.rows_affected > 0 => tracing::warn!(
                "[Notifications] Removed {} legacy ownerless notifications",
                result.rows_affected
            ),
            Ok(_) => {}
            Err(error) => tracing::warn!(
                "[Notifications] Failed to remove legacy ownerless notifications: {}",
                error
            ),
        }

        match notif_entity::Entity::find()
            .order_by_desc(notif_entity::Column::CreatedAt)
            .limit(max_history as u64)
            .all(&db)
            .await
        {
            Ok(models) => {
                // DB 按时间倒序取出，环形缓冲需要正序（旧→新）
                for model in models.into_iter().rev() {
                    history.push_back(Self::model_to_notification(model));
                }
                if !history.is_empty() {
                    tracing::info!(
                        "[Notifications] Restored {} notifications from DB",
                        history.len()
                    );
                }
            }
            Err(e) => {
                tracing::warn!("[Notifications] Failed to restore history: {}", e);
            }
        }

        Self {
            tx,
            history: RwLock::new(history),
            max_history,
            db: Some(db),
        }
    }

    fn model_to_notification(model: notif_entity::Model) -> Notification {
        Notification {
            id: model.id,
            notification_type: NotificationType::from_str(&model.notification_type),
            priority: NotificationPriority::from_str(&model.priority),
            title: model.title,
            body: model.body,
            user_id: model.user_id,
            metadata: model.metadata,
            created_at: model.created_at.with_timezone(&Utc),
            read: model.read,
        }
    }

    /// 发布用户通知（实时事件 + 热缓存 + 持久化）
    pub async fn notify(&self, notification: Notification) {
        if notification.user_id.is_none() {
            tracing::error!(
                id = %notification.id,
                "[Notifications] Rejected ownerless user notification"
            );
            return;
        }
        tracing::debug!(
            id = %notification.id,
            r#type = ?notification.notification_type,
            title = %notification.title,
            "Sending notification"
        );

        // 存入历史
        {
            let mut history = self.history.write().await;
            if history.len() >= self.max_history {
                history.pop_front();
            }
            history.push_back(notification.clone());
        }

        // 落库（best-effort，失败不影响实时推送）
        if let Some(db) = &self.db {
            let record = notif_entity::ActiveModel {
                id: Set(notification.id.clone()),
                notification_type: Set(notification.notification_type.as_str().to_string()),
                priority: Set(notification.priority.as_str().to_string()),
                title: Set(notification.title.clone()),
                body: Set(notification.body.clone()),
                user_id: Set(notification.user_id),
                metadata: Set(notification.metadata.clone()),
                read: Set(notification.read),
                created_at: Set(notification.created_at.into()),
            };
            if let Err(e) = record.insert(db).await {
                tracing::warn!(id = %notification.id, "[Notifications] Persist failed: {}", e);
            }
        }

        // 广播到所有 SSE 订阅者
        let _ = self
            .tx
            .send(NotificationEvent::NewNotification { notification });
    }

    /// 创建或更新一条通知。
    ///
    /// Agent 的运行进度使用稳定 ID，避免每个步骤都堆积为一条新通知；
    /// SSE 仍复用 `new_notification` 事件，客户端按 ID 替换即可。
    pub async fn upsert(&self, notification: Notification) {
        if notification.user_id.is_none() {
            tracing::error!(
                id = %notification.id,
                "[Notifications] Rejected ownerless notification update"
            );
            return;
        }
        tracing::debug!(
            id = %notification.id,
            r#type = ?notification.notification_type,
            title = %notification.title,
            "Upserting notification"
        );

        {
            let mut history = self.history.write().await;
            if let Some(position) = history.iter().position(|n| n.id == notification.id) {
                history.remove(position);
            } else if history.len() >= self.max_history {
                history.pop_front();
            }
            history.push_back(notification.clone());
        }

        if let Some(db) = &self.db {
            match notif_entity::Entity::find_by_id(&notification.id)
                .one(db)
                .await
            {
                Ok(Some(model)) => {
                    let mut record = model.into_active_model();
                    record.notification_type =
                        Set(notification.notification_type.as_str().to_string());
                    record.priority = Set(notification.priority.as_str().to_string());
                    record.title = Set(notification.title.clone());
                    record.body = Set(notification.body.clone());
                    record.user_id = Set(notification.user_id);
                    record.metadata = Set(notification.metadata.clone());
                    record.read = Set(notification.read);
                    record.created_at = Set(notification.created_at.into());
                    if let Err(e) = record.update(db).await {
                        tracing::warn!(id = %notification.id, "[Notifications] Update failed: {}", e);
                    }
                }
                Ok(None) => {
                    let record = notif_entity::ActiveModel {
                        id: Set(notification.id.clone()),
                        notification_type: Set(notification.notification_type.as_str().to_string()),
                        priority: Set(notification.priority.as_str().to_string()),
                        title: Set(notification.title.clone()),
                        body: Set(notification.body.clone()),
                        user_id: Set(notification.user_id),
                        metadata: Set(notification.metadata.clone()),
                        read: Set(notification.read),
                        created_at: Set(notification.created_at.into()),
                    };
                    if let Err(e) = record.insert(db).await {
                        tracing::warn!(id = %notification.id, "[Notifications] Insert failed: {}", e);
                    }
                }
                Err(e) => {
                    tracing::warn!(id = %notification.id, "[Notifications] Lookup failed: {}", e);
                }
            }
        }

        let _ = self
            .tx
            .send(NotificationEvent::NewNotification { notification });
    }

    /// 将一个后端 run 映射为通知中心中的单条、可持续更新的任务通知。
    #[allow(clippy::too_many_arguments)]
    pub async fn notify_task_status(
        &self,
        run_id: &str,
        task_id: Option<&str>,
        user_id: i32,
        session_id: Option<&str>,
        title: &str,
        body: &str,
        progress: u8,
        status: &str,
        success: Option<bool>,
    ) {
        let notification_type = match status {
            "completed" => NotificationType::TaskCompleted,
            "failed" => NotificationType::TaskFailed,
            "cancelled" => NotificationType::TaskCancelled,
            "waiting_for_input" => NotificationType::AgentClarification,
            _ => NotificationType::TaskProgress,
        };
        let priority = match status {
            "failed" => NotificationPriority::High,
            "waiting_for_input" => NotificationPriority::High,
            _ => NotificationPriority::Normal,
        };
        let mut notification = Notification::new(user_id, notification_type, priority, title, body)
            .with_metadata(serde_json::json!({
                "run_id": run_id,
                "task_id": task_id,
                "session_id": session_id,
                "status": status,
                "progress": progress,
                "success": success,
            }));
        notification.id = format!("agent_run_{}", run_id);
        self.upsert(notification).await;
    }

    /// 清理过期通知（保留最近 keep_days 天）
    pub async fn cleanup_old(&self, keep_days: i64) {
        let cutoff = Utc::now() - chrono::Duration::days(keep_days);
        self.history
            .write()
            .await
            .retain(|notification| notification.created_at >= cutoff);
        let Some(db) = &self.db else { return };
        match notif_entity::Entity::delete_many()
            .filter(notif_entity::Column::CreatedAt.lt(cutoff))
            .exec(db)
            .await
        {
            Ok(res) if res.rows_affected > 0 => {
                tracing::info!(
                    "[Notifications] Cleaned {} notifications older than {} days",
                    res.rows_affected,
                    keep_days
                );
            }
            Ok(_) => {}
            Err(e) => tracing::warn!("[Notifications] Cleanup failed: {}", e),
        }
    }

    /// 订阅通知流（用于 SSE endpoint）
    pub fn subscribe(&self) -> broadcast::Receiver<NotificationEvent> {
        self.tx.subscribe()
    }

    /// 获取指定用户的历史通知（最新的 N 条）。旧的无 owner 通知不会下发。
    pub async fn get_history_for_user(&self, user_id: i32, limit: usize) -> Vec<Notification> {
        if let Some(db) = &self.db {
            match notif_entity::Entity::find()
                .filter(notif_entity::Column::UserId.eq(user_id))
                .order_by_desc(notif_entity::Column::CreatedAt)
                .limit(limit as u64)
                .all(db)
                .await
            {
                Ok(models) => {
                    return models
                        .into_iter()
                        .map(Self::model_to_notification)
                        .collect();
                }
                Err(error) => {
                    tracing::warn!(
                        user_id,
                        "[Notifications] History query failed, using hot cache: {}",
                        error
                    );
                }
            }
        }
        let history = self.history.read().await;
        history
            .iter()
            .rev()
            .filter(|n| n.user_id == Some(user_id))
            .take(limit)
            .cloned()
            .collect()
    }

    /// 获取指定用户的未读通知数
    pub async fn unread_count_for_user(&self, user_id: i32) -> usize {
        if let Some(db) = &self.db {
            match notif_entity::Entity::find()
                .filter(notif_entity::Column::UserId.eq(user_id))
                .filter(notif_entity::Column::Read.eq(false))
                .count(db)
                .await
            {
                Ok(count) => return count as usize,
                Err(error) => tracing::warn!(
                    user_id,
                    "[Notifications] Unread count query failed, using hot cache: {}",
                    error
                ),
            }
        }
        let history = self.history.read().await;
        history
            .iter()
            .filter(|n| !n.read && n.user_id == Some(user_id))
            .count()
    }

    pub async fn total_count_for_user(&self, user_id: i32) -> usize {
        if let Some(db) = &self.db {
            match notif_entity::Entity::find()
                .filter(notif_entity::Column::UserId.eq(user_id))
                .count(db)
                .await
            {
                Ok(count) => return count as usize,
                Err(error) => tracing::warn!(
                    user_id,
                    "[Notifications] Total count query failed, using hot cache: {}",
                    error
                ),
            }
        }
        self.history
            .read()
            .await
            .iter()
            .filter(|notification| notification.user_id == Some(user_id))
            .count()
    }

    /// 标记通知已读（带用户归属校验）
    pub async fn mark_read(&self, notification_id: &str, user_id: i32) -> Result<bool, String> {
        let updated_db = if let Some(db) = &self.db {
            match notif_entity::Entity::update_many()
                .col_expr(
                    notif_entity::Column::Read,
                    sea_orm::sea_query::Expr::value(true),
                )
                .filter(notif_entity::Column::Id.eq(notification_id))
                .filter(notif_entity::Column::UserId.eq(user_id))
                .exec(db)
                .await
            {
                Ok(result) => result.rows_affected > 0,
                Err(error) => {
                    tracing::warn!("[Notifications] Mark read failed: {}", error);
                    return Err(error.to_string());
                }
            }
        } else {
            false
        };
        let found = {
            let mut history = self.history.write().await;
            if let Some(n) = history
                .iter_mut()
                .find(|n| n.id == notification_id && n.user_id == Some(user_id))
            {
                n.read = true;
                true
            } else {
                false
            }
        };
        if found || updated_db {
            let _ = self.tx.send(NotificationEvent::NotificationRead {
                id: notification_id.to_string(),
                user_id,
            });
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// 标记全部已读（仅影响该用户的通知）
    pub async fn mark_all_read(&self, user_id: i32) -> Result<u64, String> {
        let marked_in_db = if let Some(db) = &self.db {
            match notif_entity::Entity::update_many()
                .col_expr(
                    notif_entity::Column::Read,
                    sea_orm::sea_query::Expr::value(true),
                )
                .filter(notif_entity::Column::UserId.eq(user_id))
                .filter(notif_entity::Column::Read.eq(false))
                .exec(db)
                .await
            {
                Ok(result) => result.rows_affected,
                Err(error) => {
                    tracing::warn!("[Notifications] Mark all read failed: {}", error);
                    return Err(error.to_string());
                }
            }
        } else {
            0
        };
        let marked_in_memory = {
            let mut history = self.history.write().await;
            let mut count = 0u64;
            for n in history
                .iter_mut()
                .filter(|n| !n.read && n.user_id == Some(user_id))
            {
                n.read = true;
                count += 1;
            }
            count
        };
        if marked_in_memory > 0 || marked_in_db > 0 {
            let _ = self
                .tx
                .send(NotificationEvent::NotificationsReadAll { user_id });
        }
        Ok(if self.db.is_some() {
            marked_in_db
        } else {
            marked_in_memory
        })
    }

    /// 删除单条通知（带用户归属校验）
    pub async fn delete_notification(
        &self,
        notification_id: &str,
        user_id: i32,
    ) -> Result<bool, String> {
        // 持久化模式先写 DB；失败时保留热缓存，避免返回成功后重启又“复活”。
        let removed_from_db = if let Some(db) = &self.db {
            match notif_entity::Entity::delete_many()
                .filter(notif_entity::Column::Id.eq(notification_id))
                .filter(notif_entity::Column::UserId.eq(user_id))
                .exec(db)
                .await
            {
                Ok(res) => res.rows_affected > 0,
                Err(e) => {
                    tracing::warn!("[Notifications] Delete failed: {}", e);
                    return Err(e.to_string());
                }
            }
        } else {
            false
        };
        let removed_from_memory = {
            let mut history = self.history.write().await;
            let before = history.len();
            history.retain(|n| !(n.id == notification_id && n.user_id == Some(user_id)));
            history.len() < before
        };

        let removed = removed_from_memory || removed_from_db;
        if removed {
            let _ = self.tx.send(NotificationEvent::NotificationDeleted {
                id: notification_id.to_string(),
                user_id,
            });
        }
        Ok(removed)
    }

    /// 清空该用户自己的全部通知，返回删除条数
    pub async fn clear_all(&self, user_id: i32) -> Result<u64, String> {
        let deleted_from_db = if let Some(db) = &self.db {
            match notif_entity::Entity::delete_many()
                .filter(notif_entity::Column::UserId.eq(user_id))
                .exec(db)
                .await
            {
                Ok(res) => res.rows_affected,
                Err(e) => {
                    tracing::warn!("[Notifications] Clear failed: {}", e);
                    return Err(e.to_string());
                }
            }
        } else {
            0
        };

        let deleted_from_memory = {
            let mut history = self.history.write().await;
            let before = history.len();
            history.retain(|n| n.user_id != Some(user_id));
            (before - history.len()) as u64
        };

        let _ = self
            .tx
            .send(NotificationEvent::NotificationsCleared { user_id });
        Ok(if self.db.is_some() {
            deleted_from_db
        } else {
            deleted_from_memory
        })
    }

    pub(crate) async fn admin_user_ids(&self) -> Vec<i32> {
        let Some(db) = &self.db else {
            return Vec::new();
        };
        let statement = Statement::from_string(
            db.get_database_backend(),
            "SELECT id FROM users WHERE is_admin = true ORDER BY id".to_string(),
        );
        match db.query_all(statement).await {
            Ok(rows) => rows
                .iter()
                .filter_map(|row| row.try_get::<i32>("", "id").ok())
                .collect(),
            Err(error) => {
                tracing::warn!(
                    "[Notifications] Failed to resolve admin recipients: {}",
                    error
                );
                Vec::new()
            }
        }
    }

    /// 返回尚未到达终态的 updater 通知，用于 backend 重启后恢复状态跟踪。
    pub(crate) async fn pending_updater_jobs(&self) -> Vec<(i32, String, String)> {
        let Some(db) = &self.db else {
            return Vec::new();
        };
        match notif_entity::Entity::find()
            .filter(
                notif_entity::Column::NotificationType.eq(NotificationType::UpdaterStatus.as_str()),
            )
            .all(db)
            .await
        {
            Ok(models) => models
                .into_iter()
                .filter_map(|model| {
                    let user_id = model.user_id?;
                    let metadata = model.metadata?;
                    let status = metadata.get("status").and_then(|value| value.as_str())?;
                    if matches!(status, "succeeded" | "failed" | "needs_manual" | "unknown") {
                        return None;
                    }
                    let job_id = metadata
                        .get("job_id")
                        .and_then(|value| value.as_str())?
                        .to_string();
                    let kind = metadata
                        .get("kind")
                        .and_then(|value| value.as_str())
                        .unwrap_or("update")
                        .to_string();
                    Some((user_id, job_id, kind))
                })
                .collect(),
            Err(error) => {
                tracing::warn!(
                    "[Notifications] Failed to restore updater trackers: {}",
                    error
                );
                Vec::new()
            }
        }
    }
}

/// 初始化全局通知管理器（带持久化 + 每日过期清理）
pub async fn init_notifications(db: DatabaseConnection) {
    let manager = Arc::new(NotificationManager::new_with_db(200, db).await);
    let _ = NOTIFICATION_MANAGER.set(manager.clone());

    // 每日清理 30 天前的通知
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(86400));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            manager.cleanup_old(30).await;
        }
    });

    tracing::info!("[Notifications] Manager initialized (persistent)");
}

/// 获取全局通知管理器
pub fn get_notification_manager() -> Option<&'static Arc<NotificationManager>> {
    NOTIFICATION_MANAGER.get()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_manager() -> NotificationManager {
        let (tx, _) = broadcast::channel(8);
        NotificationManager {
            tx,
            history: RwLock::new(VecDeque::new()),
            max_history: 10,
            db: None,
        }
    }

    #[tokio::test]
    async fn upsert_replaces_task_progress_instead_of_duplicating_it() {
        let manager = test_manager();

        let mut first = Notification::new(
            9,
            NotificationType::TaskProgress,
            NotificationPriority::Normal,
            "running",
            "10%",
        );
        first.id = "agent_run_test".to_string();
        manager.upsert(first).await;

        let mut second = Notification::new(
            9,
            NotificationType::TaskCompleted,
            NotificationPriority::Normal,
            "done",
            "100%",
        );
        second.id = "agent_run_test".to_string();
        manager.upsert(second).await;

        let history = manager.get_history_for_user(9, 10).await;
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "agent_run_test");
        assert_eq!(history[0].body, "100%");
        assert!(matches!(
            history[0].notification_type,
            NotificationType::TaskCompleted
        ));
    }

    #[tokio::test]
    async fn users_cannot_read_delete_or_clear_each_others_notifications() {
        let manager = test_manager();
        for user_id in [1, 2] {
            let mut notification = Notification::new(
                user_id,
                NotificationType::SystemInfo,
                NotificationPriority::Normal,
                format!("user {}", user_id),
                "private",
            );
            notification.id = format!("private_{}", user_id);
            manager.notify(notification).await;
        }

        assert_eq!(manager.get_history_for_user(1, 10).await.len(), 1);
        assert_eq!(manager.get_history_for_user(2, 10).await.len(), 1);
        assert!(!manager.delete_notification("private_2", 1).await.unwrap());
        manager.clear_all(1).await.unwrap();
        assert!(manager.get_history_for_user(1, 10).await.is_empty());
        assert_eq!(manager.get_history_for_user(2, 10).await.len(), 1);
    }

    #[tokio::test]
    async fn ownerless_notifications_are_not_user_visible() {
        let manager = test_manager();
        manager
            .notify({
                let mut notification = Notification::new(
                    1,
                    NotificationType::SystemInfo,
                    NotificationPriority::Normal,
                    "legacy broadcast",
                    "must not leak",
                );
                notification.user_id = None;
                notification
            })
            .await;

        assert!(manager.get_history_for_user(1, 10).await.is_empty());
        assert_eq!(manager.total_count_for_user(1).await, 0);
    }

    #[test]
    fn realtime_events_are_filtered_by_owner() {
        let notification = Notification::new(
            2,
            NotificationType::SystemInfo,
            NotificationPriority::Normal,
            "private",
            "body",
        );
        let event = NotificationEvent::NewNotification { notification };
        assert!(event_is_for_user(&event, 2));
        assert!(!event_is_for_user(&event, 1));

        let deleted = NotificationEvent::NotificationDeleted {
            id: "n".to_string(),
            user_id: 2,
        };
        assert!(event_is_for_user(&deleted, 2));
        assert!(!event_is_for_user(&deleted, 1));
    }

    #[tokio::test]
    async fn brew_and_tapp_producers_target_only_their_owner() {
        let manager = test_manager();
        manager
            .notify_brew_new_items(
                42,
                7,
                "Example Feed",
                2,
                &["First".to_string(), "Second".to_string()],
            )
            .await;
        manager
            .notify_tapp(42, "demo.tapp", Some("Scheduled"), "done", "info")
            .await;

        let owner_history = manager.get_history_for_user(42, 10).await;
        assert_eq!(owner_history.len(), 2);
        assert!(owner_history.iter().any(|notification| matches!(
            notification.notification_type,
            NotificationType::BrewNewItems
        )));
        assert!(owner_history.iter().any(|notification| matches!(
            notification.notification_type,
            NotificationType::TappNotification
        )));
        assert!(manager.get_history_for_user(41, 10).await.is_empty());
    }

    #[tokio::test]
    async fn updater_producer_targets_only_the_initiating_admin() {
        let manager = test_manager();
        manager
            .notify_updater_job(42, "job-1", "update", "running", "正在更新")
            .await;
        manager
            .notify_updater_job(42, "job-1", "update", "succeeded", "更新完成")
            .await;

        let owner_history = manager.get_history_for_user(42, 10).await;
        assert_eq!(owner_history.len(), 1);
        assert!(matches!(
            owner_history[0].notification_type,
            NotificationType::UpdaterStatus
        ));
        assert_eq!(
            owner_history[0]
                .metadata
                .as_ref()
                .and_then(|metadata| metadata.get("status"))
                .and_then(|value| value.as_str()),
            Some("succeeded")
        );
        assert!(manager.get_history_for_user(41, 10).await.is_empty());
    }

    #[test]
    fn notification_type_storage_names_round_trip() {
        for notification_type in [
            NotificationType::TaskProgress,
            NotificationType::TaskCompleted,
            NotificationType::TaskFailed,
            NotificationType::TaskCancelled,
            NotificationType::HeartbeatResult,
            NotificationType::McpServerStatus,
            NotificationType::BrewNewItems,
            NotificationType::BrewSourceError,
            NotificationType::TappNotification,
            NotificationType::UpdaterStatus,
            NotificationType::SystemInfo,
            NotificationType::AgentClarification,
        ] {
            let stored = notification_type.as_str();
            assert_eq!(NotificationType::from_str(stored).as_str(), stored);
        }
    }
}
