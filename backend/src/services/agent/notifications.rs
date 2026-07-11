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
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
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
    /// Agent 任务完成
    TaskCompleted,
    /// Agent 任务失败
    TaskFailed,
    /// Heartbeat 定时任务执行结果
    HeartbeatResult,
    /// MCP 服务器状态变化
    McpServerStatus,
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
            NotificationType::TaskCompleted => "task_completed",
            NotificationType::TaskFailed => "task_failed",
            NotificationType::HeartbeatResult => "heartbeat_result",
            NotificationType::McpServerStatus => "mcp_server_status",
            NotificationType::SystemInfo => "system_info",
            NotificationType::AgentClarification => "agent_clarification",
        }
    }

    fn from_str(s: &str) -> Self {
        match s {
            "task_completed" => NotificationType::TaskCompleted,
            "task_failed" => NotificationType::TaskFailed,
            "heartbeat_result" => NotificationType::HeartbeatResult,
            "mcp_server_status" => NotificationType::McpServerStatus,
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
    /// 目标用户 ID（None = 广播给所有用户）
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
            user_id: None,
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
    NotificationRead { id: String },
    /// 该用户全部已读（SSE 端按 user_id 过滤转发）
    NotificationsReadAll { user_id: i32 },
    /// 通知被删除
    NotificationDeleted { id: String },
    /// 通知被批量清空（SSE 端按 user_id 过滤转发）
    NotificationsCleared { user_id: i32 },
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

    /// 发送通知（广播 + 存入历史 + 落库）
    pub async fn notify(&self, notification: Notification) {
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

    /// 清理过期通知（保留最近 keep_days 天）
    pub async fn cleanup_old(&self, keep_days: i64) {
        let Some(db) = &self.db else { return };
        let cutoff = Utc::now() - chrono::Duration::days(keep_days);
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

    /// 获取指定用户的历史通知（最新的 N 条，包含广播通知）
    pub async fn get_history_for_user(&self, user_id: i32, limit: usize) -> Vec<Notification> {
        let history = self.history.read().await;
        history
            .iter()
            .rev()
            .filter(|n| n.user_id.is_none() || n.user_id == Some(user_id))
            .take(limit)
            .cloned()
            .collect()
    }

    /// 获取指定用户的未读通知数
    pub async fn unread_count_for_user(&self, user_id: i32) -> usize {
        let history = self.history.read().await;
        history
            .iter()
            .filter(|n| !n.read && (n.user_id.is_none() || n.user_id == Some(user_id)))
            .count()
    }

    /// 标记通知已读（带用户归属校验）
    pub async fn mark_read(&self, notification_id: &str, user_id: i32) -> bool {
        let found = {
            let mut history = self.history.write().await;
            if let Some(n) = history.iter_mut().find(|n| {
                n.id == notification_id && (n.user_id.is_none() || n.user_id == Some(user_id))
            }) {
                n.read = true;
                true
            } else {
                false
            }
        };
        if !found {
            return false;
        }
        self.persist_read_state(&[notification_id.to_string()]).await;
        let _ = self.tx.send(NotificationEvent::NotificationRead {
            id: notification_id.to_string(),
        });
        true
    }

    /// 标记全部已读（仅影响该用户的通知）
    pub async fn mark_all_read(&self, user_id: i32) {
        let marked_ids: Vec<String> = {
            let mut history = self.history.write().await;
            let mut ids = Vec::new();
            for n in history
                .iter_mut()
                .filter(|n| !n.read && (n.user_id.is_none() || n.user_id == Some(user_id)))
            {
                n.read = true;
                ids.push(n.id.clone());
            }
            ids
        };
        self.persist_read_state(&marked_ids).await;
        // 单事件广播全量已读（此前逐条发 NotificationRead，N 条通知发 N 个事件）
        if !marked_ids.is_empty() {
            let _ = self
                .tx
                .send(NotificationEvent::NotificationsReadAll { user_id });
        }
    }

    /// 删除单条通知（带用户归属校验）
    pub async fn delete_notification(&self, notification_id: &str, user_id: i32) -> bool {
        // 从内存热缓存移除
        let removed_from_memory = {
            let mut history = self.history.write().await;
            let before = history.len();
            history.retain(|n| {
                !(n.id == notification_id
                    && (n.user_id.is_none() || n.user_id == Some(user_id)))
            });
            history.len() < before
        };

        // 从 DB 删除（热缓存之外的旧通知也能删）
        let removed_from_db = if let Some(db) = &self.db {
            match notif_entity::Entity::delete_many()
                .filter(notif_entity::Column::Id.eq(notification_id))
                .filter(
                    notif_entity::Column::UserId
                        .is_null()
                        .or(notif_entity::Column::UserId.eq(user_id)),
                )
                .exec(db)
                .await
            {
                Ok(res) => res.rows_affected > 0,
                Err(e) => {
                    tracing::warn!("[Notifications] Delete failed: {}", e);
                    false
                }
            }
        } else {
            false
        };

        let removed = removed_from_memory || removed_from_db;
        if removed {
            let _ = self.tx.send(NotificationEvent::NotificationDeleted {
                id: notification_id.to_string(),
            });
        }
        removed
    }

    /// 清空该用户可见的全部通知（广播 + 本人），返回删除条数
    pub async fn clear_all(&self, user_id: i32) -> u64 {
        {
            let mut history = self.history.write().await;
            history.retain(|n| !(n.user_id.is_none() || n.user_id == Some(user_id)));
        }

        let mut deleted = 0u64;
        if let Some(db) = &self.db {
            match notif_entity::Entity::delete_many()
                .filter(
                    notif_entity::Column::UserId
                        .is_null()
                        .or(notif_entity::Column::UserId.eq(user_id)),
                )
                .exec(db)
                .await
            {
                Ok(res) => deleted = res.rows_affected,
                Err(e) => tracing::warn!("[Notifications] Clear failed: {}", e),
            }
        }

        let _ = self.tx.send(NotificationEvent::NotificationsCleared { user_id });
        deleted
    }

    /// 已读状态落库
    async fn persist_read_state(&self, ids: &[String]) {
        let Some(db) = &self.db else { return };
        if ids.is_empty() {
            return;
        }
        if let Err(e) = notif_entity::Entity::update_many()
            .col_expr(notif_entity::Column::Read, sea_orm::sea_query::Expr::value(true))
            .filter(notif_entity::Column::Id.is_in(ids.to_vec()))
            .exec(db)
            .await
        {
            tracing::warn!("[Notifications] Failed to persist read state: {}", e);
        }
    }

    /// 便捷方法：发送任务完成通知
    /// user_id 指定归属用户（None 广播），避免任务结果泄露给其他用户；
    /// session_id 写入 metadata，前端点击通知可跳回对应会话
    pub async fn notify_task_completed(
        &self,
        task_id: &str,
        user_id: Option<i32>,
        session_id: Option<&str>,
        title: &str,
        summary: &str,
        success: bool,
    ) {
        let ntype = if success {
            NotificationType::TaskCompleted
        } else {
            NotificationType::TaskFailed
        };
        let priority = if success {
            NotificationPriority::Normal
        } else {
            NotificationPriority::High
        };
        let mut notification =
            Notification::new(ntype, priority, title, summary).with_metadata(serde_json::json!({
                "task_id": task_id,
                "success": success,
                "session_id": session_id,
            }));
        notification.user_id = user_id;
        self.notify(notification).await;
    }

    /// 便捷方法：发送 heartbeat 结果通知
    pub async fn notify_heartbeat_result(&self, task_name: &str, result: &str, success: bool) {
        let priority = if success {
            NotificationPriority::Low
        } else {
            NotificationPriority::Normal
        };
        let notification = Notification::new(
            NotificationType::HeartbeatResult,
            priority,
            format!("定时任务: {}", task_name),
            result,
        );
        self.notify(notification).await;
    }

    /// 便捷方法：发送系统信息
    pub async fn notify_system_info(&self, title: &str, body: &str) {
        let notification = Notification::new(
            NotificationType::SystemInfo,
            NotificationPriority::Low,
            title,
            body,
        );
        self.notify(notification).await;
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
