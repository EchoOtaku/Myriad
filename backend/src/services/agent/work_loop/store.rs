//! Atomic checkpoint + public task projection. Revision fencing prevents an old
//! worker from committing after a recovery or another replica's resume.
use super::*;
use sea_orm::{ConnectionTrait, DatabaseBackend, FromQueryResult, Statement, TransactionTrait};

const NAMESPACE: &str = "agent_work_checkpoint";

#[derive(FromQueryResult)]
struct TaskOwner { user_id: i32, status: String, stale: bool }

pub(super) async fn load(db: &sea_orm::DatabaseConnection, task_id: &str, user_id: i32) -> Result<Checkpoint, String> {
    let task = crate::models::entities::agent_tasks::Entity::find_by_id(task_id);
    use sea_orm::EntityTrait;
    let owner = task.one(db).await.map_err(|_| "Unable to load task")?.ok_or("Task not found")?;
    if owner.user_id != user_id { return Err("Task not found".into()); }
    let mut state: Checkpoint = crate::services::tapp_registry::get(db,NAMESPACE,task_id).await.map_err(|_| "Unable to load Work checkpoint")?.ok_or("Work checkpoint has expired")?;
    if state.user_id != user_id || state.version != 1 { return Err("Unsupported Work checkpoint".into()); }
    if owner.status == "cancelled" { state.task.status = TaskStatus::Cancelled; }
    Ok(state)
}

pub(super) async fn save(db: &sea_orm::DatabaseConnection, state: &mut Checkpoint) -> Result<(), String> {
    save_inner(db,state,false).await
}

async fn save_inner(db: &sea_orm::DatabaseConnection, state: &mut Checkpoint, recovery: bool) -> Result<(), String> {
    let txn = db.begin().await.map_err(|_| "Unable to begin Work checkpoint")?;
    let owner = TaskOwner::find_by_statement(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "SELECT user_id, status, (updated_at < NOW() - INTERVAL '90 seconds') AS stale FROM agent_tasks WHERE id = $1 FOR UPDATE",[state.task.task_id.clone().into()]))
        .one(&txn).await.map_err(|_| "Unable to lock Work task")?;
    if let Some(owner) = owner {
        if recovery && (owner.status != "running" || !owner.stale) { return Err("Work lease is still active".into()); }
        if owner.user_id != state.user_id || (owner.status == "cancelled" && state.task.status != TaskStatus::Cancelled) { return Err("Task cancelled or unavailable".into()); }
        let current: Checkpoint = crate::services::tapp_registry::get(&txn,NAMESPACE,&state.task.task_id).await.map_err(|_| "Unable to read Work revision")?.ok_or("Work checkpoint has expired")?;
        if current.revision != state.revision { return Err("This Work continuation was already claimed".into()); }
    } else if state.revision != 0 { return Err("Work task no longer exists".into()); }
    let mut next = state.clone();
    next.revision += 1;
    executor::task_store::save_task_on(&txn,state.user_id,&state.task).await?;
    crate::services::tapp_registry::put(&txn,NAMESPACE,&state.task.task_id,
        crate::services::tapp_registry::RegistryIdentity { subject_id:Some(state.user_id),owner_id:Some(state.user_id),tapp_id:None,runtime_id:Some(&state.task.task_id) },
        &next,(chrono::Utc::now()+chrono::Duration::days(7)).timestamp()).await.map_err(|_| "Unable to save Work checkpoint")?;
    txn.commit().await.map_err(|_| "Unable to commit Work checkpoint")?;
    state.revision = next.revision;
    executor::TASK_STORE.write().await.cache_committed(state.user_id,state.task.clone());
    Ok(())
}

/// A heartbeat only extends the live lease. It never overwrites task state.
pub(super) struct Lease(tokio::task::JoinHandle<()>);
impl Drop for Lease { fn drop(&mut self) { self.0.abort(); } }
pub(super) fn lease(db: sea_orm::DatabaseConnection, task_id: String, lease_id: String) -> Lease {
    Lease(tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(20)).await;
            let _ = db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
                "UPDATE agent_tasks SET updated_at = NOW() WHERE id = $1 AND status = 'running' AND EXISTS (SELECT 1 FROM tapp_runtime_registry WHERE namespace = 'agent_work_checkpoint' AND record_id = $1 AND payload->>'lease_id' = $2)",[task_id.clone().into(),lease_id.clone().into()])).await;
        }
    }))
}

/// Expired leases become resumable questions. No side effect is replayed here.
pub(crate) async fn recover(db: &sea_orm::DatabaseConnection) -> Result<(), String> {
    let tasks = crate::models::entities::agent_tasks::Model::find_by_statement(Statement::from_string(DatabaseBackend::Postgres,
        "SELECT * FROM agent_tasks WHERE status = 'running' AND recipe->'metadata'->>'work_loop_version' = '1' AND updated_at < NOW() - INTERVAL '90 seconds' LIMIT 64"))
        .all(db).await.map_err(|_| "Unable to find interrupted Work tasks")?;
    for task in tasks {
        let Ok(mut state) = load(db,&task.id,task.user_id).await else { continue; };
        if state.task.status != TaskStatus::Running { continue; }
        let question = UserQuestion::free_text(
            if state.inflight.is_some() { "This task was interrupted during a tool call. Describe what happened, or continue so I can check its result before doing more." } else { "This task was interrupted. Reply to continue from its saved progress." },
            "Completed actions will not be repeated automatically.",true);
        state.task.set_pending_question(question);
        state.wait = Some(Wait::Recovery);
        state.lease_id = uuid::Uuid::new_v4().to_string();
        // A concurrent checkpoint wins through revision checking.
        let _ = save_inner(db,&mut state,true).await;
    }
    Ok(())
}
