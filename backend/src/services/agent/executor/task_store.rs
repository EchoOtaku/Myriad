//! 任务存储模块
//!
//! 管理任务状态的内存存储和数据库持久化

use crate::models::entities::agent_tasks;
use crate::services::agent::types::*;
use chrono::Utc;
use once_cell::sync::Lazy;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder,
};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;

/// 全局任务状态存储
pub static TASK_STORE: Lazy<Arc<RwLock<TaskStore>>> =
    Lazy::new(|| Arc::new(RwLock::new(TaskStore::new())));

/// 全局数据库连接（用于任务持久化）
static DB_FOR_TASKS: Lazy<Arc<RwLock<Option<DatabaseConnection>>>> =
    Lazy::new(|| Arc::new(RwLock::new(None)));

/// 全局任务取消标记存储
pub static CANCELLATION_TOKENS: Lazy<Arc<RwLock<HashSet<String>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashSet::new())));

/// 检查任务是否被请求取消
pub async fn is_cancelled(task_id: &str) -> bool {
    let tokens = CANCELLATION_TOKENS.read().await;
    tokens.contains(task_id)
}

/// 清除取消标记（任务完成或已处理取消后）
pub async fn clear_cancellation(task_id: &str) {
    let mut tokens = CANCELLATION_TOKENS.write().await;
    tokens.remove(task_id);
}

/// 任务存储
pub struct TaskStore {
    /// 任务 ID -> 任务状态
    tasks: HashMap<String, TaskState>,
    /// 用户 ID -> 任务 ID 列表
    user_tasks: HashMap<i32, Vec<String>>,
}

impl TaskStore {
    pub fn new() -> Self {
        Self {
            tasks: HashMap::new(),
            user_tasks: HashMap::new(),
        }
    }

    /// 存储任务（同时异步保存到数据库）
    pub fn store(&mut self, user_id: i32, task: TaskState) {
        let task_id = task.task_id.clone();

        // 先 insert 到内存，再从内存里借出一份 clone 给异步任务
        // 避免 task 被 move 前的额外 clone
        self.tasks.insert(task_id.clone(), task);
        self.user_tasks
            .entry(user_id)
            .or_default()
            .push(task_id.clone());

        // 从内存中取出已存储的任务做一次 clone 用于持久化
        // 这样可在 TaskState 较大时只 clone 一次，而非两次
        if let Some(task_for_db) = self.tasks.get(&task_id).cloned() {
            tokio::spawn(async move {
                if let Err(e) = save_task_to_db(user_id, &task_for_db).await {
                    tracing::warn!("保存任务到数据库失败: {}", e);
                }
            });
        }
    }

    /// 获取任务
    pub fn get(&self, task_id: &str) -> Option<&TaskState> {
        self.tasks.get(task_id)
    }

    /// 获取任务（可变）
    pub fn get_mut(&mut self, task_id: &str) -> Option<&mut TaskState> {
        self.tasks.get_mut(task_id)
    }

    /// 获取用户的所有任务
    pub fn get_user_tasks(&self, user_id: i32) -> Vec<&TaskState> {
        self.user_tasks
            .get(&user_id)
            .map(|ids| ids.iter().filter_map(|id| self.tasks.get(id)).collect())
            .unwrap_or_default()
    }

    /// 清理过期任务
    ///
    /// - 已完成/失败超过24小时的任务
    /// - WaitingForInput 超过2小时未响应的任务（标记为超时失败）
    pub async fn cleanup_expired(&mut self) {
        let now = Utc::now();
        let mut expired_ids: Vec<String> = Vec::new();

        for (id, task) in &mut self.tasks {
            // 已完成的任务：24小时后清理
            if let Some(completed_at) = &task.completed_at {
                if (now - *completed_at).num_hours() > 24 {
                    expired_ids.push(id.clone());
                }
            }
            // WaitingForInput 任务：2小时未响应则标记为超时
            else if task.status == TaskStatus::WaitingForInput {
                let age_hours = (now - task.started_at).num_hours();
                if age_hours > 2 {
                    tracing::info!(
                        task_id = %id,
                        age_hours = age_hours,
                        "[TaskStore] Expiring abandoned WaitingForInput task"
                    );
                    task.status = TaskStatus::Failed;
                    task.error = Some("任务等待用户输入超时（2小时），已自动取消".to_string());
                    task.completed_at = Some(now);
                    expired_ids.push(id.clone());
                }
            }
        }

        for id in &expired_ids {
            self.tasks.remove(id);
            for task_list in self.user_tasks.values_mut() {
                task_list.retain(|tid| tid != id);
            }
        }

        // 同步清理数据库中的过期任务
        if !expired_ids.is_empty() {
            if let Err(e) = cleanup_expired_tasks_from_db(&expired_ids).await {
                tracing::warn!("清理数据库过期任务失败: {}", e);
            }
        }
    }
}

impl Default for TaskStore {
    fn default() -> Self {
        Self::new()
    }
}

// ============ 数据库操作 ============

/// 初始化任务存储的数据库连接
pub async fn init_task_store_db(db: DatabaseConnection) {
    let mut db_guard = DB_FOR_TASKS.write().await;
    *db_guard = Some(db.clone());

    // 从数据库加载未完成的任务
    if let Err(e) = load_pending_tasks_from_db(&db).await {
        tracing::warn!("加载待处理任务失败: {}", e);
    }
}

/// 从数据库加载未完成的任务
async fn load_pending_tasks_from_db(db: &DatabaseConnection) -> Result<(), String> {
    let pending_tasks = agent_tasks::Entity::find()
        .filter(
            agent_tasks::Column::Status
                .eq("pending")
                .or(agent_tasks::Column::Status.eq("running")),
        )
        .order_by_desc(agent_tasks::Column::StartedAt)
        .all(db)
        .await
        .map_err(|e| format!("查询待处理任务失败: {}", e))?;

    let mut store = TASK_STORE.write().await;
    let mut recovered = 0u32;
    for task_model in pending_tasks {
        if let Ok(mut task_state) = task_model_to_state(&task_model) {
            // 服务重启时，Running/WaitingForInput 状态的任务无法恢复执行，标记为 Cancelled
            if matches!(
                task_state.status,
                TaskStatus::Running | TaskStatus::WaitingForInput
            ) {
                tracing::warn!(
                    task_id = %task_state.task_id,
                    old_status = ?task_state.status,
                    "[TaskStore] Task interrupted by server restart, marking as Cancelled"
                );
                task_state.status = TaskStatus::Cancelled;
                task_state.error = Some(crate::services::agent::response_agent::task_interrupted());
                recovered += 1;
            }
            let user_id = task_model.user_id;
            let task_id = task_state.task_id.clone();
            store.tasks.insert(task_id.clone(), task_state);
            store.user_tasks.entry(user_id).or_default().push(task_id);
        }
    }

    if recovered > 0 {
        tracing::info!("标记了 {} 个中断任务为 Cancelled", recovered);
    }
    tracing::info!("从数据库加载了 {} 个待处理任务", store.tasks.len());
    Ok(())
}

/// 将数据库模型转换为任务状态
fn task_model_to_state(model: &agent_tasks::Model) -> Result<TaskState, String> {
    let status = match model.status.as_str() {
        "pending" => TaskStatus::Pending,
        "running" => TaskStatus::Running,
        "waiting_for_input" => TaskStatus::WaitingForInput,
        "paused" => TaskStatus::Paused,
        "completed" => TaskStatus::Completed,
        "failed" => TaskStatus::Failed,
        "cancelled" => TaskStatus::Cancelled,
        _ => TaskStatus::Pending,
    };

    let step_results: HashMap<String, StepResult> =
        serde_json::from_value(model.step_results.clone()).unwrap_or_default();

    let pending_question: Option<UserQuestion> = model
        .pending_question
        .as_ref()
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    let execution_context: Option<ExecutionContext> = model
        .execution_context
        .as_ref()
        .and_then(|v| serde_json::from_value(v.clone()).ok());

    Ok(TaskState {
        task_id: model.id.clone(),
        recipe_id: model.recipe_id.clone(),
        status,
        current_step: model.current_step as usize,
        step_results,
        started_at: model.started_at.into(),
        completed_at: model.completed_at.map(|t| t.into()),
        error: model.error.clone(),
        progress: model.progress as u8,
        pending_question,
        execution_context,
        lane_id: None,
        execution_trace: None,
        recipe: None, // Recipe 不持久化到 DB，仅在内存中保持
    })
}

/// 保存任务到数据库
pub async fn save_task_to_db(user_id: i32, task: &TaskState) -> Result<(), String> {
    let db_guard = DB_FOR_TASKS.read().await;
    let db = db_guard.as_ref().ok_or("数据库连接未初始化")?;

    let status_str = match task.status {
        TaskStatus::Pending => "pending",
        TaskStatus::Running => "running",
        TaskStatus::WaitingForInput => "waiting_for_input",
        TaskStatus::Paused => "paused",
        TaskStatus::Completed => "completed",
        TaskStatus::Failed => "failed",
        TaskStatus::Cancelled => "cancelled",
    };

    // 检查任务是否已存在（使用 id 字段，它存储的是 task_id）
    let existing = agent_tasks::Entity::find_by_id(&task.task_id)
        .one(db)
        .await
        .map_err(|e| format!("查询任务失败: {}", e))?;

    if let Some(existing_task) = existing {
        // 更新现有任务
        let mut active_model: agent_tasks::ActiveModel = existing_task.into();
        active_model.status = Set(status_str.to_string());
        active_model.current_step = Set(task.current_step as i32);
        active_model.step_results = Set(json!(task.step_results));
        active_model.completed_at = Set(task.completed_at.map(|t| t.into()));
        active_model.error = Set(task.error.clone());
        active_model.progress = Set(task.progress as i16);
        active_model.pending_question = Set(task.pending_question.as_ref().map(|q| json!(q)));
        active_model.execution_context = Set(task.execution_context.as_ref().map(|c| json!(c)));

        active_model
            .update(db)
            .await
            .map_err(|e| format!("更新任务失败: {}", e))?;
    } else {
        // 创建新任务
        let new_task = agent_tasks::ActiveModel {
            id: Set(task.task_id.clone()),
            user_id: Set(user_id),
            recipe_id: Set(task.recipe_id.clone()),
            status: Set(status_str.to_string()),
            current_step: Set(task.current_step as i32),
            step_results: Set(json!(task.step_results)),
            started_at: Set(task.started_at.into()),
            completed_at: Set(task.completed_at.map(|t| t.into())),
            error: Set(task.error.clone()),
            progress: Set(task.progress as i16),
            pending_question: Set(task.pending_question.as_ref().map(|q| json!(q))),
            execution_context: Set(task.execution_context.as_ref().map(|c| json!(c))),
            original_request: Set(None),
            updated_at: Set(chrono::Utc::now().into()),
            session_id: Set(None),
            lane_id: Set(task.lane_id.clone()),
            name: Set(None),
            total_steps: Set(Some(
                task.recipe
                    .as_ref()
                    .map(|r| r.steps.len())
                    .unwrap_or(task.step_results.len())
                    .max(1) as i32,
            )),
        };

        new_task
            .insert(db)
            .await
            .map_err(|e| format!("创建任务失败: {}", e))?;
    }

    Ok(())
}

/// 从数据库清理过期任务
async fn cleanup_expired_tasks_from_db(task_ids: &[String]) -> Result<(), String> {
    let db_guard = DB_FOR_TASKS.read().await;
    let db = db_guard.as_ref().ok_or("数据库连接未初始化")?;

    for task_id in task_ids {
        agent_tasks::Entity::delete_by_id(task_id)
            .exec(db)
            .await
            .map_err(|e| format!("删除任务失败: {}", e))?;
    }

    Ok(())
}

/// 异步持久化任务（fire-and-forget）
pub fn persist_task_async(user_id: i32, task: TaskState) {
    tokio::spawn(async move {
        if let Err(e) = save_task_to_db(user_id, &task).await {
            tracing::warn!("异步保存任务失败: {}", e);
        }
    });
}

// ============ 公共 API ============

/// 获取任务状态（带所有权校验）
///
/// 仅当任务属于指定用户时才返回，防止 IDOR
pub async fn get_task_for_user(task_id: &str, user_id: i32) -> Option<TaskState> {
    let store = TASK_STORE.read().await;
    // 先确认 task_id 在该用户的任务列表中
    let user_owns_task = store
        .user_tasks
        .get(&user_id)
        .map(|ids| ids.iter().any(|id| id == task_id))
        .unwrap_or(false);

    if user_owns_task {
        store.get(task_id).cloned()
    } else {
        None
    }
}

/// 取消任务（带所有权校验）
///
/// 仅当任务属于指定用户时才取消，返回 true 表示已请求取消
pub async fn cancel_task_for_user(task_id: &str, user_id: i32) -> bool {
    let owned = {
        let store = TASK_STORE.read().await;
        store
            .user_tasks
            .get(&user_id)
            .map(|ids| ids.iter().any(|id| id == task_id))
            .unwrap_or(false)
    };

    if !owned {
        return false;
    }

    // 设置取消标记
    {
        let mut tokens = CANCELLATION_TOKENS.write().await;
        tokens.insert(task_id.to_string());
    }

    // 更新内存中的任务状态
    {
        let mut store = TASK_STORE.write().await;
        if let Some(task) = store.get_mut(task_id) {
            task.status = TaskStatus::Cancelled;
            task.error = Some(crate::services::agent::response_agent::task_cancelled_by_user());
        }
    }

    tracing::info!(task_id = %task_id, user_id = user_id, "[TaskStore] Task cancelled by user");
    true
}

/// 获取用户的所有任务
pub async fn get_user_tasks(user_id: i32) -> Vec<TaskState> {
    let store = TASK_STORE.read().await;
    store.get_user_tasks(user_id).into_iter().cloned().collect()
}

/// 以约 5% 的概率触发一次过期任务清理（请求驱动，避免独立定时任务）
pub async fn maybe_cleanup_tasks() {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    // 每 20 次请求清理一次过期任务
    if n.is_multiple_of(20) {
        let mut store = TASK_STORE.write().await;
        store.cleanup_expired().await;
    }
    // 每 100 次请求清理一次空闲 Lane（防止 HashMap 无限增长）
    if n.is_multiple_of(100) {
        crate::services::agent::LANE_QUEUE
            .cleanup_idle_lanes()
            .await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_task_store() {
        let mut store = TaskStore::new();
        let task = TaskState {
            task_id: "test_task".to_string(),
            recipe_id: "test_recipe".to_string(),
            status: TaskStatus::Pending,
            current_step: 0,
            step_results: HashMap::new(),
            started_at: Utc::now(),
            completed_at: None,
            error: None,
            progress: 0,
            pending_question: None,
            execution_context: None,
            lane_id: None,
            execution_trace: None,
            recipe: None,
        };

        // 直接插入，不触发异步数据库保存
        store.tasks.insert(task.task_id.clone(), task.clone());
        store
            .user_tasks
            .entry(1)
            .or_default()
            .push(task.task_id.clone());

        assert!(store.get("test_task").is_some());
        assert_eq!(store.get_user_tasks(1).len(), 1);
    }
}
