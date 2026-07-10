//! Heartbeat 主动式 Agent
//!
//! 基于 cron 调度的定时任务系统，让 Agent 可以主动执行任务。
//! 任务定义在 `data/agent/HEARTBEAT.md` 中，支持热加载。
//!
//! Cron 匹配按**服务器本地时间**，支持标准 5 字段语法：
//! `*`、数字、列表 `a,b,c`、区间 `a-b`、步进 `*/n` / `a-b/n` / `a/n`。
//! 星期字段 0 和 7 均表示周日；日/星期同时受限时按标准 cron 语义取"或"。

use std::path::PathBuf;
use std::sync::Arc;

use chrono::{DateTime, Datelike, Local, Timelike, Utc};
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
    /// 上次执行时间（运行时状态，不从文件加载；序列化为 lastRun 供前端展示）
    #[serde(skip_deserializing, rename = "lastRun")]
    pub last_run: Option<DateTime<Utc>>,
    /// 上次执行结果（运行时状态）
    #[serde(skip_deserializing, rename = "lastResult")]
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

/// 持久化视图：只写回配置字段，不把运行时状态写进 HEARTBEAT.md
#[derive(Serialize)]
struct PersistTask<'a> {
    id: &'a str,
    name: &'a str,
    schedule: &'a str,
    action: &'a str,
    enabled: bool,
}

#[derive(Serialize)]
struct PersistConfig<'a> {
    tasks: Vec<PersistTask<'a>>,
}

/// Heartbeat 管理器
pub struct HeartbeatManager {
    tasks: RwLock<Vec<HeartbeatTask>>,
    config_path: PathBuf,
    /// frontmatter 之后的 Markdown 正文（写回文件时原样保留）
    body: RwLock<String>,
}

impl HeartbeatManager {
    /// 从 HEARTBEAT.md 加载
    pub async fn new(config_path: PathBuf) -> Self {
        let (tasks, body) = Self::load_file(&config_path).await.unwrap_or_default();
        let count = tasks.len();

        let manager = Self {
            tasks: RwLock::new(tasks),
            config_path,
            body: RwLock::new(body),
        };

        tracing::info!("[Heartbeat] Loaded {} tasks", count);
        manager
    }

    /// 从 YAML frontmatter 加载任务，返回 (tasks, markdown 正文)
    async fn load_file(path: &std::path::Path) -> Option<(Vec<HeartbeatTask>, String)> {
        let content = tokio::fs::read_to_string(path).await.ok()?;

        // 解析 YAML frontmatter
        let trimmed = content.trim_start();
        if !trimmed.starts_with("---") {
            return None;
        }

        let after_first = &trimmed[3..];
        let end_idx = after_first.find("\n---")?;
        let frontmatter = &after_first[..end_idx];
        // 正文：跳过闭合分隔符 "\n---" 及其后的换行
        let body = after_first[end_idx + 4..]
            .trim_start_matches('\r')
            .trim_start_matches('\n')
            .to_string();

        let config: HeartbeatConfig = match serde_yaml::from_str(frontmatter) {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!("[Heartbeat] Failed to parse HEARTBEAT.md frontmatter: {}", e);
                return None;
            }
        };
        Some((config.tasks, body))
    }

    /// 将当前任务配置写回 HEARTBEAT.md（原子写入，保留正文）
    async fn persist(&self) {
        let yaml = {
            let tasks = self.tasks.read().await;
            let view = PersistConfig {
                tasks: tasks
                    .iter()
                    .map(|t| PersistTask {
                        id: &t.id,
                        name: &t.name,
                        schedule: &t.schedule,
                        action: &t.action,
                        enabled: t.enabled,
                    })
                    .collect(),
            };
            match serde_yaml::to_string(&view) {
                Ok(y) => y,
                Err(e) => {
                    tracing::warn!("[Heartbeat] Failed to serialize tasks: {}", e);
                    return;
                }
            }
        };
        let body = self.body.read().await.clone();
        let content = format!("---\n{}---\n\n{}", yaml, body);

        let tmp_path = self.config_path.with_extension("md.tmp");
        if let Err(e) = tokio::fs::write(&tmp_path, &content).await {
            tracing::warn!("[Heartbeat] Failed to write config: {}", e);
            return;
        }
        if let Err(e) = tokio::fs::rename(&tmp_path, &self.config_path).await {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            tracing::warn!("[Heartbeat] Failed to persist config: {}", e);
        }
    }

    /// 获取所有任务状态
    pub async fn get_tasks(&self) -> Vec<HeartbeatTask> {
        self.tasks.read().await.clone()
    }

    /// 切换任务启用状态（持久化到 HEARTBEAT.md，重启后保留）
    pub async fn toggle_task(&self, task_id: &str) -> Option<bool> {
        let new_state = {
            let mut tasks = self.tasks.write().await;
            let task = tasks.iter_mut().find(|t| t.id == task_id)?;
            task.enabled = !task.enabled;
            task.enabled
        };
        tracing::info!(
            "[Heartbeat] Task '{}' toggled to {}",
            task_id,
            if new_state { "enabled" } else { "disabled" }
        );
        self.persist().await;
        Some(new_state)
    }

    /// 记录任务执行结果
    pub async fn record_result(&self, task_id: &str, result: &str) {
        let mut tasks = self.tasks.write().await;
        if let Some(task) = tasks.iter_mut().find(|t| t.id == task_id) {
            task.last_run = Some(Utc::now());
            task.last_result = Some(result.to_string());
        }
    }

    /// 检查哪些任务应该在当前分钟执行
    ///
    /// 返回到期任务的同时立即记录 last_run（调度即去重），
    /// 避免长任务执行期间同一分钟被重复触发。
    pub async fn check_due_tasks(&self) -> Vec<HeartbeatTask> {
        let now_local = Local::now();
        let now_utc = Utc::now();
        let mut tasks = self.tasks.write().await;

        let mut due = Vec::new();
        for task in tasks.iter_mut() {
            if !task.enabled {
                continue;
            }
            if !cron_matches(&task.schedule, &now_local) {
                continue;
            }
            // 同一日历分钟内不重复触发
            if let Some(last) = &task.last_run {
                if last.timestamp() / 60 == now_utc.timestamp() / 60 {
                    continue;
                }
            }
            task.last_run = Some(now_utc);
            due.push(task.clone());
        }
        due
    }

    /// 重新加载配置（保留运行时状态：last_run / last_result）
    pub async fn reload(&self) {
        if let Some((mut new_tasks, new_body)) = Self::load_file(&self.config_path).await {
            let mut current = self.tasks.write().await;
            for task in new_tasks.iter_mut() {
                if let Some(old) = current.iter().find(|t| t.id == task.id) {
                    task.last_run = old.last_run;
                    task.last_result = old.last_result.clone();
                }
            }
            *current = new_tasks;
            drop(current);
            *self.body.write().await = new_body;
            tracing::info!("[Heartbeat] Reloaded configuration");
        }
    }
}

// ==================== Cron 匹配 ====================

/// 完整 5 字段 cron 匹配（分 时 日 月 星期）
fn cron_matches(expr: &str, now: &DateTime<Local>) -> bool {
    let parts: Vec<&str> = expr.split_whitespace().collect();
    if parts.len() != 5 {
        return false;
    }

    let minute_ok = cron_field_matches(parts[0], now.minute());
    let hour_ok = cron_field_matches(parts[1], now.hour());
    let month_ok = cron_field_matches(parts[3], now.month());

    // 0 = 周日；星期字段额外接受 7 表示周日
    let dow = now.weekday().num_days_from_sunday();
    let dom_restricted = parts[2] != "*";
    let dow_restricted = parts[4] != "*";
    let dom_ok = cron_field_matches(parts[2], now.day());
    let dow_ok =
        cron_field_matches(parts[4], dow) || (dow == 0 && cron_field_matches(parts[4], 7));

    // 标准 cron 语义：日和星期同时受限时，任一命中即可
    let day_ok = if dom_restricted && dow_restricted {
        dom_ok || dow_ok
    } else {
        dom_ok && dow_ok
    };

    minute_ok && hour_ok && month_ok && day_ok
}

/// 单字段匹配：支持逗号分隔的多个 item
fn cron_field_matches(field: &str, value: u32) -> bool {
    field.split(',').any(|item| cron_item_matches(item.trim(), value))
}

/// 单 item 匹配：`*`、`N`、`A-B`、`*/N`、`A-B/N`、`A/N`
fn cron_item_matches(item: &str, value: u32) -> bool {
    if item.is_empty() {
        return false;
    }

    let (base, step) = match item.split_once('/') {
        Some((b, s)) => match s.parse::<u32>() {
            Ok(n) if n > 0 => (b, Some(n)),
            _ => return false,
        },
        None => (item, None),
    };

    let (start, end) = if base == "*" {
        (0u32, u32::MAX)
    } else if let Some((a, b)) = base.split_once('-') {
        match (a.parse::<u32>(), b.parse::<u32>()) {
            (Ok(a), Ok(b)) if a <= b => (a, b),
            _ => return false,
        }
    } else {
        match base.parse::<u32>() {
            Ok(n) => match step {
                // 裸数字带步进（如 "5/15"）按 vixie cron 语义视为 "5-max/15"
                Some(_) => (n, u32::MAX),
                None => return value == n,
            },
            Err(_) => return false,
        }
    };

    if value < start || value > end {
        return false;
    }
    match step {
        Some(s) => (value - start).is_multiple_of(s),
        None => true,
    }
}

// ==================== 全局实例 ====================

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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn local(y: i32, mo: u32, d: u32, h: u32, mi: u32) -> DateTime<Local> {
        Local.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap()
    }

    #[test]
    fn test_cron_every_minute() {
        assert!(cron_matches("* * * * *", &local(2026, 7, 11, 12, 34)));
    }

    #[test]
    fn test_cron_fixed_time() {
        // 2026-07-11 是周六
        assert!(cron_matches("0 9 * * *", &local(2026, 7, 11, 9, 0)));
        assert!(!cron_matches("0 9 * * *", &local(2026, 7, 11, 9, 1)));
        assert!(!cron_matches("0 9 * * *", &local(2026, 7, 11, 10, 0)));
    }

    #[test]
    fn test_cron_minute_step() {
        assert!(cron_matches("*/15 * * * *", &local(2026, 7, 11, 8, 0)));
        assert!(cron_matches("*/15 * * * *", &local(2026, 7, 11, 8, 45)));
        assert!(!cron_matches("*/15 * * * *", &local(2026, 7, 11, 8, 20)));
    }

    #[test]
    fn test_cron_hour_step() {
        // 默认 HEARTBEAT.md 中的 "0 */6 * * *" 必须可用
        assert!(cron_matches("0 */6 * * *", &local(2026, 7, 11, 0, 0)));
        assert!(cron_matches("0 */6 * * *", &local(2026, 7, 11, 6, 0)));
        assert!(cron_matches("0 */6 * * *", &local(2026, 7, 11, 18, 0)));
        assert!(!cron_matches("0 */6 * * *", &local(2026, 7, 11, 7, 0)));
        assert!(!cron_matches("0 */6 * * *", &local(2026, 7, 11, 6, 1)));
    }

    #[test]
    fn test_cron_weekday() {
        // 2026-07-11 = 周六(6)，2026-07-12 = 周日(0)，2026-07-13 = 周一(1)
        assert!(cron_matches("0 9 * * 6", &local(2026, 7, 11, 9, 0)));
        assert!(!cron_matches("0 9 * * 1", &local(2026, 7, 11, 9, 0)));
        assert!(cron_matches("0 9 * * 1", &local(2026, 7, 13, 9, 0)));
        // 0 和 7 都是周日
        assert!(cron_matches("0 9 * * 0", &local(2026, 7, 12, 9, 0)));
        assert!(cron_matches("0 9 * * 7", &local(2026, 7, 12, 9, 0)));
    }

    #[test]
    fn test_cron_day_of_month() {
        assert!(cron_matches("0 0 1 * *", &local(2026, 7, 1, 0, 0)));
        assert!(!cron_matches("0 0 1 * *", &local(2026, 7, 11, 0, 0)));
    }

    #[test]
    fn test_cron_month() {
        assert!(cron_matches("0 0 * 7 *", &local(2026, 7, 11, 0, 0)));
        assert!(!cron_matches("0 0 * 8 *", &local(2026, 7, 11, 0, 0)));
    }

    #[test]
    fn test_cron_list_and_range() {
        assert!(cron_matches("0,30 * * * *", &local(2026, 7, 11, 5, 30)));
        assert!(!cron_matches("0,30 * * * *", &local(2026, 7, 11, 5, 15)));
        assert!(cron_matches("0 9-17 * * *", &local(2026, 7, 11, 13, 0)));
        assert!(!cron_matches("0 9-17 * * *", &local(2026, 7, 11, 18, 0)));
        assert!(cron_matches("0 9-17/4 * * *", &local(2026, 7, 11, 13, 0)));
        assert!(!cron_matches("0 9-17/4 * * *", &local(2026, 7, 11, 14, 0)));
    }

    #[test]
    fn test_cron_dom_dow_or_semantics() {
        // 日和星期同时受限：任一命中即可（标准 cron 语义）
        // 2026-07-13 是周一、13 号
        assert!(cron_matches("0 0 13 * *", &local(2026, 7, 13, 0, 0)));
        assert!(cron_matches("0 0 1 * 1", &local(2026, 7, 13, 0, 0))); // 星期命中
        assert!(cron_matches("0 0 13 * 5", &local(2026, 7, 13, 0, 0))); // 日命中
        assert!(!cron_matches("0 0 1 * 5", &local(2026, 7, 13, 0, 0))); // 都不命中
    }

    #[test]
    fn test_cron_invalid() {
        assert!(!cron_matches("bad expr", &local(2026, 7, 11, 0, 0)));
        assert!(!cron_matches("0 0 * *", &local(2026, 7, 11, 0, 0))); // 4 字段
        assert!(!cron_matches("*/0 * * * *", &local(2026, 7, 11, 0, 0))); // 步进为 0
    }

    #[tokio::test]
    async fn test_toggle_persists_and_reload_keeps_runtime_state() {
        let dir = std::env::temp_dir().join(format!("hb_test_{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let path = dir.join("HEARTBEAT.md");
        tokio::fs::write(
            &path,
            "---\ntasks:\n  - id: t1\n    name: \"Task One\"\n    schedule: \"0 9 * * *\"\n    action: \"do stuff\"\n    enabled: false\n---\n\n# Body text\n",
        )
        .await
        .unwrap();

        let mgr = HeartbeatManager::new(path.clone()).await;

        // toggle 写回文件
        assert_eq!(mgr.toggle_task("t1").await, Some(true));
        let content = tokio::fs::read_to_string(&path).await.unwrap();
        assert!(content.contains("enabled: true"), "toggle 应持久化: {content}");
        assert!(content.contains("# Body text"), "正文应保留: {content}");
        // 运行时状态不应写入文件
        assert!(!content.contains("lastRun"), "运行时状态不应落盘: {content}");

        // reload 保留运行时状态
        mgr.record_result("t1", "ok").await;
        mgr.reload().await;
        let tasks = mgr.get_tasks().await;
        assert!(tasks[0].enabled, "reload 后 toggle 状态应保留");
        assert_eq!(tasks[0].last_result.as_deref(), Some("ok"));
        assert!(tasks[0].last_run.is_some());

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }

    #[tokio::test]
    async fn test_check_due_tasks_dedup_within_minute() {
        let dir = std::env::temp_dir().join(format!("hb_test_dedup_{}", std::process::id()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let path = dir.join("HEARTBEAT.md");
        tokio::fs::write(
            &path,
            "---\ntasks:\n  - id: every\n    name: \"Every Minute\"\n    schedule: \"* * * * *\"\n    action: \"tick\"\n    enabled: true\n---\n",
        )
        .await
        .unwrap();

        let mgr = HeartbeatManager::new(path).await;
        let first = mgr.check_due_tasks().await;
        assert_eq!(first.len(), 1, "首次检查应返回到期任务");
        // 同一分钟内第二次检查不应重复触发（即使任务尚未完成）
        let second = mgr.check_due_tasks().await;
        assert!(second.is_empty(), "同一分钟内不应重复触发");

        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
}
