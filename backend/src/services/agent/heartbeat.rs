//! Heartbeat 主动式 Agent
//!
//! 基于 cron 调度的定时任务系统，让 Agent 可以主动执行任务。
//! 任务定义在 `data/agent/HEARTBEAT.md` 中，支持热加载。

use std::path::PathBuf;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

/// Heartbeat 任务定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatTask {
    /// 任务 ID
    pub id: String,
    /// 显示名称
    pub name: String,
    /// Cron 表达式
    pub schedule: String,
    /// 要执行的自然语言指令
    pub action: String,
    /// 是否启用
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// 上次执行时间
    #[serde(skip)]
    pub last_run: Option<DateTime<Utc>>,
    /// 上次执行结果
    #[serde(skip)]
    pub last_result: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Heartbeat 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatConfig {
    pub tasks: Vec<HeartbeatTask>,
}

/// Heartbeat 管理器
pub struct HeartbeatManager {
    tasks: RwLock<Vec<HeartbeatTask>>,
    config_path: PathBuf,
}

impl HeartbeatManager {
    /// 从 HEARTBEAT.md 加载
    pub async fn new(config_path: PathBuf) -> Self {
        let tasks = Self::load_tasks(&config_path).await.unwrap_or_default();
        let count = tasks.len();

        let manager = Self {
            tasks: RwLock::new(tasks),
            config_path,
        };

        tracing::info!("[Heartbeat] Loaded {} tasks", count);
        manager
    }

    /// 从 YAML frontmatter 加载任务
    async fn load_tasks(path: &std::path::Path) -> Option<Vec<HeartbeatTask>> {
        let content = tokio::fs::read_to_string(path).await.ok()?;

        // 解析 YAML frontmatter
        let trimmed = content.trim_start();
        if !trimmed.starts_with("---") {
            return None;
        }

        let after_first = &trimmed[3..];
        let end_idx = after_first.find("\n---")?;
        let frontmatter = &after_first[..end_idx];

        let config: HeartbeatConfig = serde_yaml::from_str(frontmatter).ok()?;
        Some(config.tasks)
    }

    /// 获取所有任务状态
    pub async fn get_tasks(&self) -> Vec<HeartbeatTask> {
        self.tasks.read().await.clone()
    }

    /// 获取已启用的任务
    #[allow(dead_code)]
    pub async fn get_enabled_tasks(&self) -> Vec<HeartbeatTask> {
        self.tasks
            .read()
            .await
            .iter()
            .filter(|t| t.enabled)
            .cloned()
            .collect()
    }

    /// 切换任务启用状态
    pub async fn toggle_task(&self, task_id: &str) -> Option<bool> {
        let mut tasks = self.tasks.write().await;
        if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
            task.enabled = !task.enabled;
            let new_state = task.enabled;
            tracing::info!(
                "[Heartbeat] Task '{}' toggled to {}",
                task_id,
                if new_state { "enabled" } else { "disabled" }
            );
            Some(new_state)
        } else {
            None
        }
    }

    /// 记录任务执行结果
    #[allow(dead_code)]
    pub async fn record_result(&self, task_id: &str, result: &str) {
        let mut tasks = self.tasks.write().await;
        if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
            task.last_run = Some(Utc::now());
            task.last_result = Some(result.to_string());
        }
    }

    /// 检查哪些任务应该在当前分钟执行
    ///
    /// 简化实现：使用分钟粒度匹配。
    /// 未来可引入完整 cron 解析库。
    #[allow(dead_code)]
    pub async fn check_due_tasks(&self) -> Vec<HeartbeatTask> {
        let tasks = self.tasks.read().await;
        let now = Utc::now();

        tasks
            .iter()
            .filter(|t| {
                if !t.enabled {
                    return false;
                }
                // 简化 cron 匹配：解析 "分 时 * * *" 格式
                if let Some(should_run) = Self::matches_simple_cron(&t.schedule, &now) {
                    // 避免同一分钟重复执行
                    if let Some(last_run) = &t.last_run {
                        let elapsed = now.signed_duration_since(*last_run);
                        if elapsed.num_minutes() < 1 {
                            return false;
                        }
                    }
                    should_run
                } else {
                    false
                }
            })
            .cloned()
            .collect()
    }

    /// 简化的 cron 匹配（支持 "分 时 * * *" 格式）
    fn matches_simple_cron(cron_expr: &str, now: &DateTime<Utc>) -> Option<bool> {
        let parts: Vec<&str> = cron_expr.split_whitespace().collect();
        if parts.len() != 5 {
            return None;
        }

        let minute = now.format("%M").to_string();
        let hour = now.format("%H").to_string();

        let minute_match = parts[0] == "*" || parts[0] == &minute
            || parts[0].starts_with("*/") && {
                let interval: u32 = parts[0][2..].parse().ok()?;
                let current: u32 = minute.parse().ok()?;
                interval > 0 && current % interval == 0
            };

        let hour_match = parts[1] == "*" || parts[1] == &hour;

        Some(minute_match && hour_match)
    }

    /// 重新加载配置
    #[allow(dead_code)]
    pub async fn reload(&self) {
        if let Some(tasks) = Self::load_tasks(&self.config_path).await {
            let mut current = self.tasks.write().await;
            *current = tasks;
            tracing::info!("[Heartbeat] Reloaded configuration");
        }
    }
}

/// 全局 Heartbeat 管理器
static HEARTBEAT_MANAGER: once_cell::sync::OnceCell<Arc<HeartbeatManager>> =
    once_cell::sync::OnceCell::new();

/// 初始化全局 Heartbeat 管理器
pub async fn init_heartbeat(config_path: PathBuf) {
    let manager = Arc::new(HeartbeatManager::new(config_path).await);
    let _ = HEARTBEAT_MANAGER.set(manager);
}

/// 获取全局 Heartbeat 管理器
pub fn get_heartbeat() -> Option<&'static Arc<HeartbeatManager>> {
    HEARTBEAT_MANAGER.get()
}
