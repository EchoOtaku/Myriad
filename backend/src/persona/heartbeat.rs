//! A heartbeat batch has two active executions, without spawning a waiter per task.
use super::drivers::run_batch;
use crate::services::agent;
use sea_orm::DatabaseConnection;
use std::sync::Arc;
use tokio::sync::watch;

pub(super) async fn tick(db: DatabaseConnection, stopped: watch::Receiver<bool>, cleanup: bool) {
    if cleanup {
        agent::heartbeat::HeartbeatManager::cleanup_old_claims(&db, 48).await;
    }
    let Some(hb) = agent::heartbeat::get_heartbeat() else {
        return;
    };
    let due = hb.check_due_tasks().await;
    // Keep the reservation's minute across the bounded batch. Claiming with the
    // execution-start minute would relabel queued work as a later cron occurrence.
    let minute_bucket = agent::heartbeat::HeartbeatManager::current_minute_bucket();
    run_batch(due, stopped, |task| {
        let db = db.clone();
        let hb = hb.clone();
        async move {
            let reserved_minute = task
                .last_reserved
                .map(|at| at.timestamp() / 60)
                .unwrap_or(minute_bucket);
            execute(db, hb, task, reserved_minute).await;
        }
    })
    .await;
}

// A timeout or supervisor abort must also drop the progress consumer.
struct AbortTask<T>(tokio::task::JoinHandle<T>);
impl<T> Drop for AbortTask<T> {
    fn drop(&mut self) {
        self.0.abort();
    }
}

async fn execute(
    task_db: DatabaseConnection,
    hb_ref: Arc<agent::heartbeat::HeartbeatManager>,
    task: agent::heartbeat::HeartbeatTask,
    minute_bucket: i64,
) {
    // 多副本 CAS：未抢到则跳过（另一实例已执行或已完成）
    if !agent::heartbeat::HeartbeatManager::try_claim_execution(&task_db, &task.id, minute_bucket)
        .await
    {
        return;
    }

    tracing::info!(
        task_id = %task.id,
        "[Heartbeat] Executing due task: {}",
        task.name
    );

    if task.id == agent::heartbeat::SEO_REVIEW_TASK_ID {
        execute_seo_review(task_db, hb_ref, &task, minute_bucket).await;
        return;
    }

    let request = agent::UserRequest {
        raw_input: task.action.clone(),
        timestamp: chrono::Utc::now(),
        user_id: agent::SYSTEM_USER_ID,
        context: None,
    };

    let agent = agent::Agent::new(task_db.clone()).await;
    let task_name = task.name.clone();
    let timeout = std::time::Duration::from_secs(agent::heartbeat::HEARTBEAT_TASK_TIMEOUT_SECS);

    // 捕获 TaskCreated 的 executor task_id，超时后协作取消
    let (progress_tx, mut progress_rx) =
        tokio::sync::mpsc::channel::<agent::types::AgentProgressEvent>(64);
    let captured_exec_task = std::sync::Arc::new(tokio::sync::Mutex::new(None::<String>));
    let captured_for_fwd = captured_exec_task.clone();
    let _forwarder = AbortTask(tokio::spawn(async move {
        while let Some(event) = progress_rx.recv().await {
            if let agent::types::AgentProgressEvent::TaskCreated { task_id, .. } = &event {
                *captured_for_fwd.lock().await = Some(task_id.clone());
            }
        }
    }));

    let outcome =
        tokio::time::timeout(timeout, agent.process_with_progress(request, progress_tx)).await;

    let mut claim_status = "done";
    match outcome {
        Ok(Ok(response)) => {
            let succeeded = response.is_successful_outcome();
            let response_summary = response.message.chars().take(200).collect::<String>();
            let result_summary = if succeeded {
                response_summary
            } else {
                claim_status = "failed";
                format!("ERROR: {}", response_summary)
            };
            hb_ref.record_result(&task.id, &result_summary).await;
            let full_body = response.message.chars().take(4000).collect::<String>();
            if let Some(nm) = agent::notifications::get_notification_manager() {
                nm.notify_heartbeat_result(&task_name, &full_body, succeeded)
                    .await;
            }
            if succeeded {
                tracing::info!(
                    task_id = %task.id,
                    "[Heartbeat] Task completed: {}",
                    result_summary
                );
            } else {
                tracing::warn!(
                    task_id = %task.id,
                    "[Heartbeat] Task returned a non-success outcome: {}",
                    result_summary
                );
            }
        }
        Ok(Err(e)) => {
            claim_status = "failed";
            let err_msg = format!("ERROR: {}", e);
            hb_ref.record_result(&task.id, &err_msg).await;
            if let Some(nm) = agent::notifications::get_notification_manager() {
                nm.notify_heartbeat_result(&task_name, &err_msg, false)
                    .await;
            }
            tracing::warn!(
                task_id = %task.id,
                error = %e,
                "[Heartbeat] Task failed"
            );
        }
        Err(_elapsed) => {
            claim_status = "failed";
            // 硬取消：协作式 is_cancelled，打断 executor 步骤环
            if let Some(exec_tid) = captured_exec_task.lock().await.clone() {
                agent::executor::request_cancel(
                    &exec_tid,
                    &format!(
                        "heartbeat timed out after {}s",
                        agent::heartbeat::HEARTBEAT_TASK_TIMEOUT_SECS
                    ),
                )
                .await;
            }
            let err_msg = format!(
                "ERROR: heartbeat task timed out after {}s",
                agent::heartbeat::HEARTBEAT_TASK_TIMEOUT_SECS
            );
            hb_ref.record_result(&task.id, &err_msg).await;
            if let Some(nm) = agent::notifications::get_notification_manager() {
                nm.notify_heartbeat_result(&task_name, &err_msg, false)
                    .await;
            }
            tracing::warn!(
                task_id = %task.id,
                timeout_secs = agent::heartbeat::HEARTBEAT_TASK_TIMEOUT_SECS,
                "[Heartbeat] Task timed out; cancel requested"
            );
        }
    }
    agent::heartbeat::HeartbeatManager::complete_claim(
        &task_db,
        &task.id,
        minute_bucket,
        claim_status,
    )
    .await;
}

async fn execute_seo_review(
    task_db: DatabaseConnection,
    hb_ref: Arc<agent::heartbeat::HeartbeatManager>,
    task: &agent::heartbeat::HeartbeatTask,
    minute_bucket: i64,
) {
    let timeout = std::time::Duration::from_secs(agent::heartbeat::HEARTBEAT_TASK_TIMEOUT_SECS);
    let mut claim_status = "done";
    match tokio::time::timeout(
        timeout,
        crate::api::seo_review::run_scheduled_seo_review(&task_db),
    )
    .await
    {
        Ok(Ok(crate::api::seo_review::SeoReviewOutcome::Unchanged)) => {
            hb_ref.record_result(&task.id, "unchanged").await;
            tracing::info!(task_id = %task.id, "[Heartbeat] SEO review unchanged");
        }
        Ok(Ok(crate::api::seo_review::SeoReviewOutcome::Draft {
            why,
            site_description,
            site_keywords,
            site_ai_intro,
        })) => {
            let summary: String = why.chars().take(200).collect();
            hb_ref.record_result(&task.id, &summary).await;
            if let Some(nm) = agent::notifications::get_notification_manager() {
                nm.notify_seo_review_draft(
                    &why,
                    site_description.as_deref(),
                    site_keywords.as_deref(),
                    site_ai_intro.as_deref(),
                )
                .await;
            }
            tracing::info!(task_id = %task.id, "[Heartbeat] SEO review drafted");
        }
        Ok(Err(error)) => {
            claim_status = "failed";
            let err_msg = format!("ERROR: {error}");
            hb_ref.record_result(&task.id, &err_msg).await;
            if let Some(nm) = agent::notifications::get_notification_manager() {
                nm.notify_heartbeat_result(&task.name, &err_msg, false)
                    .await;
            }
            tracing::warn!(task_id = %task.id, %error, "[Heartbeat] SEO review failed");
        }
        Err(_elapsed) => {
            claim_status = "failed";
            let err_msg = format!(
                "ERROR: heartbeat task timed out after {}s",
                agent::heartbeat::HEARTBEAT_TASK_TIMEOUT_SECS
            );
            hb_ref.record_result(&task.id, &err_msg).await;
            if let Some(nm) = agent::notifications::get_notification_manager() {
                nm.notify_heartbeat_result(&task.name, &err_msg, false)
                    .await;
            }
            tracing::warn!(
                task_id = %task.id,
                timeout_secs = agent::heartbeat::HEARTBEAT_TASK_TIMEOUT_SECS,
                "[Heartbeat] SEO review timed out"
            );
        }
    }
    agent::heartbeat::HeartbeatManager::complete_claim(
        &task_db,
        &task.id,
        minute_bucket,
        claim_status,
    )
    .await;
}
