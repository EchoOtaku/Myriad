//! Agent 通知系统
//!
//! 提供实时通知推送（broadcast channel + SSE）和历史通知缓存。
//! 集成 heartbeat 任务结果、agent 执行结果等多种通知来源。

use std::collections::VecDeque;
use std::sync::{Arc, OnceLock};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, RwLock};

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
}

/// 通知管理器
pub struct NotificationManager {
    /// 广播通道（multi-subscriber SSE）
    tx: broadcast::Sender<NotificationEvent>,
    /// 历史通知环形缓冲区
    history: RwLock<VecDeque<Notification>>,
    /// 最大历史记录数
    max_history: usize,
}

impl NotificationManager {
    pub fn new(max_history: usize) -> Self {
        let (tx, _) = broadcast::channel(128);
        Self {
            tx,
            history: RwLock::new(VecDeque::with_capacity(max_history)),
            max_history,
        }
    }

    /// 发送通知（广播 + 存入历史）
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

        // 广播到所有 SSE 订阅者
        let _ = self
            .tx
            .send(NotificationEvent::NewNotification { notification });
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

    /// 获取未读通知数
    #[allow(dead_code)]
    pub async fn unread_count(&self) -> usize {
        let history = self.history.read().await;
        history.iter().filter(|n| !n.read).count()
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
        let mut history = self.history.write().await;
        if let Some(n) = history.iter_mut().find(|n| {
            n.id == notification_id && (n.user_id.is_none() || n.user_id == Some(user_id))
        }) {
            n.read = true;
            let _ = self.tx.send(NotificationEvent::NotificationRead {
                id: notification_id.to_string(),
            });
            true
        } else {
            false
        }
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
        // 广播已读事件，让 SSE 客户端同步状态
        for id in marked_ids {
            let _ = self.tx.send(NotificationEvent::NotificationRead { id });
        }
    }

    /// 便捷方法：发送任务完成通知
    pub async fn notify_task_completed(
        &self,
        task_id: &str,
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
        let notification =
            Notification::new(ntype, priority, title, summary).with_metadata(serde_json::json!({
                "task_id": task_id,
                "success": success,
            }));
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

/// 初始化全局通知管理器
pub fn init_notifications() {
    let manager = Arc::new(NotificationManager::new(200));
    let _ = NOTIFICATION_MANAGER.set(manager);
    tracing::info!("[Notifications] Manager initialized");
}

/// 获取全局通知管理器
pub fn get_notification_manager() -> Option<&'static Arc<NotificationManager>> {
    NOTIFICATION_MANAGER.get()
}
