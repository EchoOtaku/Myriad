//! Agent 运行状态中心。
//!
//! 后端 run 独立于 HTTP/SSE 连接存在：执行器写入服务端通道，任意前端连接只订阅
//! 可重放的事件快照。页面刷新、切路由和网络断线不会取消任务。

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use chrono::Utc;
use once_cell::sync::Lazy;
use serde_json::Value;
use tokio::sync::{broadcast, Mutex, RwLock};

use super::notifications::get_notification_manager;
use super::AgentProgressEvent;

const EVENT_HISTORY_LIMIT: usize = 256;

#[derive(Clone)]
pub struct AgentRunEnvelope {
    pub sequence: u64,
    pub event: AgentProgressEvent,
}

struct AgentRunState {
    next_sequence: u64,
    events: VecDeque<AgentRunEnvelope>,
    task_id: Option<String>,
    status: String,
    progress: u8,
    message: String,
    completed: bool,
}

pub struct AgentRun {
    run_id: String,
    user_id: i32,
    session_id: Option<String>,
    created_at: chrono::DateTime<Utc>,
    state: Mutex<AgentRunState>,
    events_tx: broadcast::Sender<AgentRunEnvelope>,
}

static AGENT_RUNS: Lazy<RwLock<HashMap<String, Arc<AgentRun>>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

impl AgentRun {
    fn new(run_id: String, user_id: i32, session_id: Option<String>) -> Arc<Self> {
        let (events_tx, _) = broadcast::channel(EVENT_HISTORY_LIMIT);
        Arc::new(Self {
            run_id,
            user_id,
            session_id,
            created_at: Utc::now(),
            state: Mutex::new(AgentRunState {
                next_sequence: 1,
                events: VecDeque::with_capacity(EVENT_HISTORY_LIMIT),
                task_id: None,
                status: "running".to_string(),
                progress: 0,
                message: "任务已提交，等待执行".to_string(),
                completed: false,
            }),
            events_tx,
        })
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentRunEnvelope> {
        self.events_tx.subscribe()
    }

    pub async fn snapshot(&self) -> (Vec<AgentRunEnvelope>, u64, bool) {
        let state = self.state.lock().await;
        (
            state.events.iter().cloned().collect(),
            state.events.back().map(|event| event.sequence).unwrap_or(0),
            state.completed,
        )
    }

    async fn is_completed(&self) -> bool {
        self.state.lock().await.completed
    }

    pub async fn publish(&self, event: AgentProgressEvent) {
        let mut notify = false;
        let (envelope, task_id, status, progress, message, success) = {
            let mut state = self.state.lock().await;
            let success = match &event {
                AgentProgressEvent::RunStarted { .. } => {
                    notify = true;
                    state.status = "running".to_string();
                    state.message = "任务已提交，等待执行".to_string();
                    None
                }
                AgentProgressEvent::TaskCreated {
                    task_id, message, ..
                } => {
                    notify = true;
                    state.task_id = Some(task_id.clone());
                    state.status = "running".to_string();
                    state.progress = state.progress.max(5);
                    state.message = message.clone();
                    None
                }
                AgentProgressEvent::TaskAssigned {
                    task_id,
                    assignment,
                } => {
                    notify = true;
                    state.task_id = Some(task_id.clone());
                    state.status = "running".to_string();
                    state.message = format!(
                        "已分配给 {} 个 Agent: {}",
                        assignment.total_agents,
                        assignment
                            .agents
                            .iter()
                            .map(|agent| agent.display_name.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    );
                    None
                }
                AgentProgressEvent::Progress {
                    progress, message, ..
                } => {
                    notify = true;
                    state.status = "running".to_string();
                    state.progress = *progress;
                    state.message = message.clone();
                    None
                }
                AgentProgressEvent::WaitingForInput {
                    task_id, question, ..
                } => {
                    notify = true;
                    state.task_id = Some(task_id.clone());
                    state.status = "waiting_for_input".to_string();
                    state.message = question.clone();
                    None
                }
                AgentProgressEvent::TaskCompleted {
                    task_id,
                    success,
                    response,
                } => {
                    notify = true;
                    if !task_id.is_empty() {
                        state.task_id = Some(task_id.clone());
                    }
                    let response_status = response.pointer("/task/status").and_then(Value::as_str);
                    state.status = match response_status {
                        Some("cancelled") => "cancelled",
                        Some("waiting_for_input") => "waiting_for_input",
                        _ if *success => "completed",
                        _ => "failed",
                    }
                    .to_string();
                    if state.status != "waiting_for_input" {
                        state.progress = 100;
                    }
                    state.message = response
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or(if *success {
                            "任务已完成"
                        } else {
                            "任务执行失败"
                        })
                        .to_string();
                    state.completed = state.status != "waiting_for_input";
                    Some(*success)
                }
                AgentProgressEvent::Error {
                    task_id, message, ..
                } => {
                    notify = true;
                    if task_id.is_some() {
                        state.task_id = task_id.clone();
                    }
                    state.status = "failed".to_string();
                    state.message = message.clone();
                    state.completed = true;
                    Some(false)
                }
                _ => None,
            };

            let envelope = AgentRunEnvelope {
                sequence: state.next_sequence,
                event,
            };
            state.next_sequence += 1;
            if state.events.len() >= EVENT_HISTORY_LIMIT {
                state.events.pop_front();
            }
            state.events.push_back(envelope.clone());
            (
                envelope,
                state.task_id.clone(),
                state.status.clone(),
                state.progress,
                state.message.clone(),
                success,
            )
        };

        let _ = self.events_tx.send(envelope);

        if notify {
            if let Some(manager) = get_notification_manager() {
                let title = match status.as_str() {
                    "completed" => "任务完成",
                    "failed" => "任务失败",
                    "cancelled" => "任务已取消",
                    "waiting_for_input" => "任务等待你的回答",
                    _ => "Arael 正在执行任务",
                };
                manager
                    .notify_task_status(
                        &self.run_id,
                        task_id.as_deref(),
                        self.user_id,
                        self.session_id.as_deref(),
                        title,
                        &message.chars().take(160).collect::<String>(),
                        progress,
                        &status,
                        success,
                    )
                    .await;
            }
        }
    }
}

pub async fn create_run(user_id: i32, session_id: Option<String>) -> Arc<AgentRun> {
    let cutoff = Utc::now() - chrono::Duration::hours(24);
    let candidates = {
        let runs = AGENT_RUNS.read().await;
        runs.iter()
            .filter(|(_, run)| run.created_at < cutoff)
            .map(|(id, run)| (id.clone(), run.clone()))
            .collect::<Vec<_>>()
    };
    let mut stale_ids = Vec::new();
    for (id, run) in candidates {
        if run.is_completed().await {
            stale_ids.push(id);
        }
    }
    if !stale_ids.is_empty() {
        let mut runs = AGENT_RUNS.write().await;
        for id in stale_ids {
            runs.remove(&id);
        }
    }

    let run_id = format!("run_{}", uuid::Uuid::new_v4().simple());
    let run = AgentRun::new(run_id.clone(), user_id, session_id.clone());
    AGENT_RUNS.write().await.insert(run_id.clone(), run.clone());
    run.publish(AgentProgressEvent::RunStarted { run_id, session_id })
        .await;
    run
}

pub async fn get_run_for_user(run_id: &str, user_id: i32) -> Option<Arc<AgentRun>> {
    AGENT_RUNS
        .read()
        .await
        .get(run_id)
        .filter(|run| run.user_id == user_id)
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn events_survive_subscriber_disconnect_and_replay() {
        let run = AgentRun::new("run_test".to_string(), 7, Some("session_test".to_string()));
        let mut first_subscriber = run.subscribe();
        run.publish(AgentProgressEvent::RunStarted {
            run_id: "run_test".to_string(),
            session_id: Some("session_test".to_string()),
        })
        .await;

        assert_eq!(run.snapshot().await.0.len(), 1);
        assert!(first_subscriber.recv().await.is_ok());
        drop(first_subscriber);

        run.publish(AgentProgressEvent::Progress {
            progress: 45,
            completed_steps: 1,
            total_steps: 2,
            message: "still running".to_string(),
        })
        .await;
        run.publish(AgentProgressEvent::TaskCompleted {
            task_id: "task_test".to_string(),
            success: true,
            response: Box::new(serde_json::json!({
                "success": true,
                "message": "done"
            })),
        })
        .await;

        let (history, _, completed) = run.snapshot().await;
        assert_eq!(history.len(), 3);
        assert!(completed);
        assert!(matches!(
            history.last().map(|event| &event.event),
            Some(AgentProgressEvent::TaskCompleted { .. })
        ));
    }
}
