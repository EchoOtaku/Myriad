//! Stateful Agent Interaction between Myriad Agent tasks and Tapp runtimes.

use std::{convert::Infallible, time::Duration};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    Extension, Json,
};
use chrono::Utc;
use futures::Stream;
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, FromQueryResult, Statement};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    api::tapp_store::{
        installed_tapp_dir, resource_path, validate_inline_data_schema, TappAgentInteractionDef,
        TappAgentManifest,
    },
    middleware::auth::Claims,
};

use super::{
    common::{parse_user_id, resolve_accessible_tapp},
    data_exchange::validate_inline_json_value,
    shared_registry::{self, RegistryIdentity},
    RuntimeGrantContext,
};

type ApiError = (StatusCode, Json<Value>);

const INTERACTION_TTL_SECONDS: i64 = 5 * 60;
const TERMINAL_RETENTION_SECONDS: i64 = 15 * 60;
const MAX_INTERACTIONS_PER_SUBJECT: usize = 64;
const MAX_INTERACTION_VALUE_BYTES: usize = 128 * 1024;
const MAX_REASON_BYTES: usize = 500;
const INTERACTION_NAMESPACE: &str = "agent_interaction";
const INTERACTION_PRESENCE_NAMESPACE: &str = "agent_presence";
const INTERACTION_MAILBOX_CHANNEL: &str = "agent_interaction_v2";
const HOST_INTENT_ADAPTERS: [&str; 3] = ["ui.open", "report.create", "dataExchange.request"];

fn api_error(status: StatusCode, code: &str, message: impl Into<String>) -> ApiError {
    (
        status,
        Json(json!({ "error": message.into(), "code": code })),
    )
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InteractionState {
    Pending,
    Accepted,
    Completed,
    Rejected,
    Expired,
    Cancelled,
}

impl InteractionState {
    fn terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Rejected | Self::Expired | Self::Cancelled
        )
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionSource {
    agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    task_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInteractionSnapshot {
    version: u8,
    interaction_id: String,
    #[serde(rename = "type")]
    interaction_type: String,
    tapp_id: String,
    state: InteractionState,
    input: Value,
    input_schema: Option<String>,
    result_schema: Option<String>,
    deadline: String,
    source: InteractionSource,
    created_at: String,
    updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rejection_reason: Option<String>,
}

impl AgentInteractionSnapshot {
    pub fn interaction_id(&self) -> &str {
        &self.interaction_id
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct StoredInteraction {
    subject_id: i32,
    owner_id: i32,
    snapshot: AgentInteractionSnapshot,
    accepted_runtime_id: Option<String>,
    result_schema: Option<Value>,
    intents: Vec<String>,
    result_idempotency_key: Option<String>,
    deadline_at: i64,
    retain_until: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct InteractionStream {
    subject_id: i32,
    owner_id: i32,
    tapp_id: String,
}

struct StreamGuard {
    runtime_id: String,
}

impl Drop for StreamGuard {
    fn drop(&mut self) {
        let runtime_id = self.runtime_id.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                if let Ok(db) = shared_registry::database().await {
                    let _ =
                        shared_registry::delete(&db, INTERACTION_PRESENCE_NAMESPACE, &runtime_id)
                            .await;
                }
            });
        }
    }
}

fn parse_agent_manifest(manifest: &Value) -> Result<TappAgentManifest, ApiError> {
    manifest
        .get("agent")
        .cloned()
        .ok_or_else(|| {
            api_error(
                StatusCode::FORBIDDEN,
                "AGENT_V2_NOT_DECLARED",
                "Tapp manifest does not declare Agent Interaction",
            )
        })
        .and_then(|value| {
            serde_json::from_value(value).map_err(|_| {
                api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "INVALID_AGENT_V2_MANIFEST",
                    "Stored Tapp Agent declaration is invalid",
                )
            })
        })
}

async fn load_interaction_raw(
    db: &DatabaseConnection,
    interaction_id: &str,
) -> Result<StoredInteraction, ApiError> {
    shared_registry::get(db, INTERACTION_NAMESPACE, interaction_id)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "AGENT_REGISTRY_UNAVAILABLE",
                "Agent interaction registry is unavailable",
            )
        })?
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "AGENT_INTERACTION_NOT_FOUND",
                "Agent interaction was not found or expired",
            )
        })
}

async fn expire_interaction_if_due(
    db: &DatabaseConnection,
    interaction: &StoredInteraction,
) -> Result<Option<StoredInteraction>, ApiError> {
    if interaction.snapshot.state.terminal() || interaction.deadline_at > Utc::now().timestamp() {
        return Ok(None);
    }

    let mut expired = interaction.clone();
    expired.snapshot.state = InteractionState::Expired;
    expired.snapshot.rejection_reason = Some("Agent interaction expired".to_string());
    expired.snapshot.updated_at = Utc::now().to_rfc3339();
    expired.retain_until = Utc::now().timestamp() + TERMINAL_RETENTION_SECONDS;
    let payload = serde_json::to_value(&expired).map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "AGENT_INTERACTION_SERIALIZATION_FAILED",
            "Agent interaction could not be serialized",
        )
    })?;
    let result = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
UPDATE tapp_runtime_registry
SET payload = $1, expires_at = $2, updated_at = NOW()
WHERE namespace = $3 AND record_id = $4
  AND payload #>> '{snapshot,state}' IN ('pending', 'accepted')
  AND (payload ->> 'deadline_at')::BIGINT <= EXTRACT(EPOCH FROM NOW())::BIGINT
"#,
            vec![
                payload.into(),
                expired.retain_until.into(),
                INTERACTION_NAMESPACE.into(),
                expired.snapshot.interaction_id.clone().into(),
            ],
        ))
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "AGENT_REGISTRY_UNAVAILABLE",
                "Agent interaction registry is unavailable",
            )
        })?;
    if result.rows_affected() == 0 {
        return Ok(None);
    }
    resume_agent_task(db, &expired).await;
    Ok(Some(expired))
}

async fn load_interaction(
    db: &DatabaseConnection,
    interaction_id: &str,
) -> Result<StoredInteraction, ApiError> {
    let interaction = load_interaction_raw(db, interaction_id).await?;
    if let Some(expired) = expire_interaction_if_due(db, &interaction).await? {
        return Ok(expired);
    }
    // A different replica may have won the expiry CAS. Reload so this request
    // never acts on the stale pending/accepted snapshot.
    if !interaction.snapshot.state.terminal() && interaction.deadline_at <= Utc::now().timestamp() {
        return load_interaction_raw(db, interaction_id).await;
    }
    Ok(interaction)
}

async fn expire_due_interactions(db: &DatabaseConnection) -> Result<usize, ApiError> {
    let rows = shared_registry::RegistryRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
SELECT record_id, runtime_id, payload
FROM tapp_runtime_registry
WHERE namespace = $1
  AND expires_at > EXTRACT(EPOCH FROM NOW())::BIGINT
  AND payload #>> '{snapshot,state}' IN ('pending', 'accepted')
  AND (payload ->> 'deadline_at')::BIGINT <= EXTRACT(EPOCH FROM NOW())::BIGINT
ORDER BY updated_at ASC
LIMIT 128
"#,
        vec![INTERACTION_NAMESPACE.into()],
    ))
    .all(db)
    .await
    .map_err(|_| {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "AGENT_REGISTRY_UNAVAILABLE",
            "Agent interaction registry is unavailable",
        )
    })?;
    let mut expired = 0usize;
    for row in rows {
        let Ok(interaction) = serde_json::from_value::<StoredInteraction>(row.payload) else {
            tracing::warn!(
                interaction_id = %row.record_id,
                "[TAPP] Ignoring invalid Agent interaction registry payload"
            );
            continue;
        };
        if expire_interaction_if_due(db, &interaction).await?.is_some() {
            expired += 1;
        }
    }
    Ok(expired)
}

/// Start one local sweeper. PostgreSQL CAS makes it safe for every backend
/// replica to run the worker; only the winner resumes a given Agent task.
pub fn spawn_agent_interaction_expiry_worker(db: DatabaseConnection) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(5));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            match expire_due_interactions(&db).await {
                Ok(count) if count > 0 => {
                    tracing::info!(count, "[TAPP] Expired Agent interactions resumed")
                }
                Ok(_) => {}
                Err((_, body)) => tracing::warn!(
                    error = %body.0["error"].as_str().unwrap_or("registry unavailable"),
                    "[TAPP] Agent interaction expiry sweep failed"
                ),
            }
        }
    });
}

async fn conditional_save_interaction(
    db: &DatabaseConnection,
    interaction: &StoredInteraction,
    runtime: &RuntimeGrantContext,
    allow_pending: bool,
) -> Result<bool, ApiError> {
    let payload = serde_json::to_value(interaction).map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "AGENT_INTERACTION_SERIALIZATION_FAILED",
            "Agent interaction could not be serialized",
        )
    })?;
    let result = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
UPDATE tapp_runtime_registry
SET payload = $1, runtime_id = $2, expires_at = $3, updated_at = NOW()
WHERE namespace = $4 AND record_id = $5
  AND subject_id = $6 AND owner_id = $7 AND tapp_id = $8
  AND (payload ->> 'deadline_at')::BIGINT > EXTRACT(EPOCH FROM NOW())::BIGINT
  AND (
    ($10::BOOLEAN AND payload #>> '{snapshot,state}' = 'pending')
    OR (
      payload #>> '{snapshot,state}' = 'accepted'
      AND payload ->> 'accepted_runtime_id' = $9
    )
  )
"#,
            vec![
                payload.into(),
                interaction.accepted_runtime_id.clone().into(),
                interaction.retain_until.into(),
                INTERACTION_NAMESPACE.into(),
                interaction.snapshot.interaction_id.clone().into(),
                runtime.subject_id().into(),
                runtime.owner_id().into(),
                runtime.tapp_id().into(),
                runtime.runtime_id().into(),
                allow_pending.into(),
            ],
        ))
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "AGENT_REGISTRY_UNAVAILABLE",
                "Agent interaction registry is unavailable",
            )
        })?;
    Ok(result.rows_affected() == 1)
}

async fn cancel_disconnected_interaction(
    db: &DatabaseConnection,
    interaction: &StoredInteraction,
    runtime_id: &str,
) -> Result<bool, ApiError> {
    let payload = serde_json::to_value(interaction).map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "AGENT_INTERACTION_SERIALIZATION_FAILED",
            "Agent interaction could not be serialized",
        )
    })?;
    let result = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
UPDATE tapp_runtime_registry
SET payload = $1, expires_at = $2, updated_at = NOW()
WHERE namespace = $3 AND record_id = $4
  AND payload #>> '{snapshot,state}' = 'accepted'
  AND payload ->> 'accepted_runtime_id' = $5
"#,
            vec![
                payload.into(),
                interaction.retain_until.into(),
                INTERACTION_NAMESPACE.into(),
                interaction.snapshot.interaction_id.clone().into(),
                runtime_id.into(),
            ],
        ))
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "AGENT_REGISTRY_UNAVAILABLE",
                "Agent interaction registry is unavailable",
            )
        })?;
    Ok(result.rows_affected() == 1)
}

fn value_size(value: &Value) -> Result<usize, ApiError> {
    serde_json::to_vec(value)
        .map(|value| value.len())
        .map_err(|_| {
            api_error(
                StatusCode::BAD_REQUEST,
                "INVALID_AGENT_INTERACTION_VALUE",
                "Agent interaction value cannot be serialized",
            )
        })
}

fn same_interaction_scope(
    stream_subject_id: i32,
    stream_owner_id: i32,
    stream_tapp_id: &str,
    interaction_subject_id: i32,
    interaction_owner_id: i32,
    interaction_tapp_id: &str,
) -> bool {
    stream_subject_id == interaction_subject_id
        && stream_owner_id == interaction_owner_id
        && stream_tapp_id == interaction_tapp_id
}

async fn read_schema(
    tapp: &crate::models::entities::tapps::Model,
    relative: Option<&str>,
) -> Result<Option<Value>, ApiError> {
    let Some(relative) = relative else {
        return Ok(None);
    };
    let root = installed_tapp_dir(tapp).map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "AGENT_SCHEMA_READ_FAILED",
            "Failed to resolve installed Tapp resources",
        )
    })?;
    let path = resource_path(&root, relative).ok_or_else(|| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_AGENT_SCHEMA",
            "Agent schema path is invalid",
        )
    })?;
    let bytes = tokio::fs::read(path).await.map_err(|_| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "AGENT_SCHEMA_READ_FAILED",
            "Declared Agent schema could not be read",
        )
    })?;
    if bytes.len() > 64 * 1024 {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_AGENT_SCHEMA",
            "Agent schema exceeds 64 KiB",
        ));
    }
    let schema: Value = serde_json::from_slice(&bytes).map_err(|_| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_AGENT_SCHEMA",
            "Agent schema is not valid JSON",
        )
    })?;
    validate_inline_data_schema(&schema).map_err(|error| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_AGENT_SCHEMA",
            error,
        )
    })?;
    Ok(Some(schema))
}

async fn notify_pending(
    db: &DatabaseConnection,
    snapshot: &AgentInteractionSnapshot,
    subject_id: i32,
    owner_id: i32,
) -> Result<(), ApiError> {
    let streams = shared_registry::list(
        db,
        INTERACTION_PRESENCE_NAMESPACE,
        Some(subject_id),
        Some(&snapshot.tapp_id),
    )
    .await
    .map_err(|_| {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "AGENT_REGISTRY_UNAVAILABLE",
            "Agent presence registry is unavailable",
        )
    })?;
    for row in streams {
        let Ok(stream) = serde_json::from_value::<InteractionStream>(row.payload) else {
            continue;
        };
        if !same_interaction_scope(
            stream.subject_id,
            stream.owner_id,
            &stream.tapp_id,
            subject_id,
            owner_id,
            &snapshot.tapp_id,
        ) {
            continue;
        }
        let runtime_id = row.runtime_id.as_deref().unwrap_or(&row.record_id);
        shared_registry::enqueue(
            db,
            INTERACTION_MAILBOX_CHANNEL,
            runtime_id,
            snapshot,
            Utc::now().timestamp() + INTERACTION_TTL_SECONDS,
        )
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "AGENT_REGISTRY_UNAVAILABLE",
                "Agent interaction mailbox is unavailable",
            )
        })?;
    }
    Ok(())
}

/// Create an interaction from trusted server-side Agent execution code.
pub async fn create_agent_interaction_internal(
    db: &DatabaseConnection,
    subject_id: i32,
    tapp_id: &str,
    interaction_type: &str,
    input: Value,
    task_id: Option<String>,
) -> Result<AgentInteractionSnapshot, String> {
    if value_size(&input).map_err(|(_, body)| {
        body.0["error"]
            .as_str()
            .unwrap_or("invalid input")
            .to_string()
    })? > MAX_INTERACTION_VALUE_BYTES
    {
        return Err("Agent interaction input exceeds 128 KiB".to_string());
    }
    let tapp = resolve_accessible_tapp(db, subject_id, tapp_id)
        .await
        .map_err(|(_, body)| {
            body.0["error"]
                .as_str()
                .unwrap_or("Tapp unavailable")
                .to_string()
        })?;
    let manifest = parse_agent_manifest(&tapp.manifest).map_err(|(_, body)| {
        body.0["error"]
            .as_str()
            .unwrap_or("Agent Interaction unavailable")
            .to_string()
    })?;
    let definition: TappAgentInteractionDef = manifest
        .interactions
        .into_iter()
        .find(|definition| definition.interaction_type == interaction_type)
        .ok_or_else(|| {
            format!("Tapp does not declare Agent interaction type {interaction_type}")
        })?;
    let input_schema = read_schema(&tapp, definition.input_schema.as_deref())
        .await
        .map_err(|(_, body)| {
            body.0["error"]
                .as_str()
                .unwrap_or("Invalid input schema")
                .to_string()
        })?;
    if let Some(schema) = &input_schema {
        validate_inline_json_value(schema, &input)
            .map_err(|error| format!("Agent interaction input schema mismatch: {error}"))?;
    }
    let result_schema = read_schema(&tapp, definition.result_schema.as_deref())
        .await
        .map_err(|(_, body)| {
            body.0["error"]
                .as_str()
                .unwrap_or("Invalid result schema")
                .to_string()
        })?;

    let now = Utc::now();
    let deadline_at = now.timestamp() + INTERACTION_TTL_SECONDS;
    let snapshot = AgentInteractionSnapshot {
        version: 2,
        interaction_id: format!("agi_{}", Uuid::new_v4().simple()),
        interaction_type: interaction_type.to_string(),
        tapp_id: tapp_id.to_string(),
        state: InteractionState::Pending,
        input,
        input_schema: definition.input_schema,
        result_schema: definition.result_schema,
        deadline: (now + chrono::Duration::seconds(INTERACTION_TTL_SECONDS)).to_rfc3339(),
        source: InteractionSource {
            agent_id: "myriad.agent".to_string(),
            task_id,
        },
        created_at: now.to_rfc3339(),
        updated_at: now.to_rfc3339(),
        result: None,
        rejection_reason: None,
    };
    let stored = StoredInteraction {
        subject_id,
        owner_id: tapp.user_id,
        snapshot: snapshot.clone(),
        accepted_runtime_id: None,
        result_schema,
        intents: manifest.intents,
        result_idempotency_key: None,
        deadline_at,
        // Keep non-terminal rows beyond their action deadline so the expiry
        // worker can transition them and resume the waiting Agent task.
        retain_until: deadline_at + TERMINAL_RETENTION_SECONDS,
    };
    let inserted = shared_registry::put_with_subject_limit(
        db,
        INTERACTION_NAMESPACE,
        &stored.snapshot.interaction_id,
        RegistryIdentity {
            subject_id: Some(stored.subject_id),
            owner_id: Some(stored.owner_id),
            tapp_id: Some(&stored.snapshot.tapp_id),
            runtime_id: None,
        },
        &stored,
        stored.retain_until,
        MAX_INTERACTIONS_PER_SUBJECT,
    )
    .await
    .map_err(|error| format!("Agent interaction registry unavailable: {error}"))?;
    if !inserted {
        return Err("Too many retained Agent interactions".to_string());
    }
    notify_pending(db, &snapshot, subject_id, tapp.user_id)
        .await
        .map_err(|(_, body)| {
            body.0["error"]
                .as_str()
                .unwrap_or("mailbox error")
                .to_string()
        })?;
    Ok(snapshot)
}

fn authorize_stored<'a>(
    interaction: &'a StoredInteraction,
    runtime: &RuntimeGrantContext,
) -> Result<&'a StoredInteraction, ApiError> {
    if interaction.subject_id != runtime.subject_id()
        || interaction.owner_id != runtime.owner_id()
        || interaction.snapshot.tapp_id != runtime.tapp_id()
    {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "AGENT_INTERACTION_NOT_FOUND",
            "Agent interaction was not found",
        ));
    }
    Ok(interaction)
}

pub async fn get_agent_interaction(
    State(db): State<DatabaseConnection>,
    runtime: RuntimeGrantContext,
    Path(interaction_id): Path<String>,
) -> Result<Json<AgentInteractionSnapshot>, ApiError> {
    let interaction = load_interaction(&db, &interaction_id).await?;
    authorize_stored(&interaction, &runtime)?;
    Ok(Json(interaction.snapshot.clone()))
}

pub async fn accept_agent_interaction(
    State(db): State<DatabaseConnection>,
    runtime: RuntimeGrantContext,
    Path(interaction_id): Path<String>,
) -> Result<Json<AgentInteractionSnapshot>, ApiError> {
    let mut interaction = load_interaction(&db, &interaction_id).await?;
    if interaction.subject_id != runtime.subject_id()
        || interaction.owner_id != runtime.owner_id()
        || interaction.snapshot.tapp_id != runtime.tapp_id()
    {
        return Err(api_error(
            StatusCode::NOT_FOUND,
            "AGENT_INTERACTION_NOT_FOUND",
            "Agent interaction was not found",
        ));
    }
    match interaction.snapshot.state {
        InteractionState::Pending => {
            interaction.snapshot.state = InteractionState::Accepted;
            interaction.accepted_runtime_id = Some(runtime.runtime_id().to_string());
            interaction.snapshot.updated_at = Utc::now().to_rfc3339();
        }
        InteractionState::Accepted
            if interaction.accepted_runtime_id.as_deref() == Some(runtime.runtime_id()) => {}
        _ => {
            return Err(api_error(
                StatusCode::CONFLICT,
                "AGENT_INTERACTION_STATE_CONFLICT",
                "Agent interaction cannot be accepted in its current state",
            ))
        }
    }
    if !conditional_save_interaction(&db, &interaction, &runtime, true).await? {
        return Err(api_error(
            StatusCode::CONFLICT,
            "AGENT_INTERACTION_STATE_CONFLICT",
            "Agent interaction was accepted by another runtime",
        ));
    }
    Ok(Json(interaction.snapshot.clone()))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmitResultRequest {
    data: Value,
    #[serde(default)]
    summary: Option<String>,
    idempotency_key: String,
}

pub async fn submit_agent_interaction_result(
    State(db): State<DatabaseConnection>,
    runtime: RuntimeGrantContext,
    Path(interaction_id): Path<String>,
    Json(request): Json<SubmitResultRequest>,
) -> Result<Json<AgentInteractionSnapshot>, ApiError> {
    if value_size(&request.data)? > MAX_INTERACTION_VALUE_BYTES
        || request
            .summary
            .as_ref()
            .is_some_and(|summary| summary.len() > 2_000)
        || request.idempotency_key.is_empty()
        || request.idempotency_key.len() > 128
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "INVALID_AGENT_INTERACTION_RESULT",
            "Agent interaction result is invalid or too large",
        ));
    }
    let mut interaction = load_interaction(&db, &interaction_id).await?;
    if interaction.subject_id != runtime.subject_id()
        || interaction.owner_id != runtime.owner_id()
        || interaction.snapshot.tapp_id != runtime.tapp_id()
        || interaction.accepted_runtime_id.as_deref() != Some(runtime.runtime_id())
    {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "AGENT_INTERACTION_RUNTIME_MISMATCH",
            "Only the runtime that accepted this interaction may submit a result",
        ));
    }
    if interaction.snapshot.state == InteractionState::Completed
        && interaction.result_idempotency_key.as_deref() == Some(&request.idempotency_key)
    {
        return Ok(Json(interaction.snapshot));
    }
    if interaction.snapshot.state != InteractionState::Accepted {
        return Err(api_error(
            StatusCode::CONFLICT,
            "AGENT_INTERACTION_STATE_CONFLICT",
            "Agent interaction is not accepting results",
        ));
    }
    if let Some(schema) = &interaction.result_schema {
        validate_inline_json_value(schema, &request.data).map_err(|error| {
            api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "AGENT_RESULT_SCHEMA_MISMATCH",
                error,
            )
        })?;
    }
    interaction.snapshot.state = InteractionState::Completed;
    interaction.snapshot.result = Some(json!({
        "data": request.data,
        "summary": request.summary,
    }));
    interaction.snapshot.updated_at = Utc::now().to_rfc3339();
    interaction.result_idempotency_key = Some(request.idempotency_key);
    interaction.retain_until = Utc::now().timestamp() + TERMINAL_RETENTION_SECONDS;
    if !conditional_save_interaction(&db, &interaction, &runtime, false).await? {
        let latest = load_interaction(&db, &interaction_id).await?;
        if latest.snapshot.state == InteractionState::Completed
            && latest.result_idempotency_key.as_deref()
                == interaction.result_idempotency_key.as_deref()
        {
            return Ok(Json(latest.snapshot));
        }
        return Err(api_error(
            StatusCode::CONFLICT,
            "AGENT_INTERACTION_STATE_CONFLICT",
            "Agent interaction result was already finalized",
        ));
    }
    resume_agent_task(&db, &interaction).await;
    Ok(Json(interaction.snapshot))
}

async fn resume_agent_task(db: &DatabaseConnection, interaction: &StoredInteraction) {
    let Some(task_id) = interaction.snapshot.source.task_id.clone() else {
        return;
    };
    let question_id = format!("tapp_interaction:{}", interaction.snapshot.interaction_id);
    let (state, skipped, answer_value) = match interaction.snapshot.state {
        InteractionState::Completed => (
            "completed",
            false,
            json!({
                "state": "completed",
                "result": interaction.snapshot.result,
            }),
        ),
        InteractionState::Rejected => (
            "rejected",
            true,
            json!({
                "state": "rejected",
                "reason": interaction.snapshot.rejection_reason,
            }),
        ),
        InteractionState::Expired => (
            "expired",
            true,
            json!({
                "state": "expired",
                "reason": interaction.snapshot.rejection_reason,
            }),
        ),
        InteractionState::Cancelled => (
            "cancelled",
            true,
            json!({
                "state": "cancelled",
                "reason": interaction.snapshot.rejection_reason,
            }),
        ),
        _ => return,
    };
    let user_id = interaction.subject_id;
    let db = db.clone();
    tokio::spawn(async move {
        let agent = crate::services::agent::Agent::new(db).await;
        let answer = crate::services::agent::UserAnswer {
            question_id,
            task_id: task_id.clone(),
            answer: answer_value.to_string(),
            skipped,
        };
        if let Err(error) = agent.resume_task(&task_id, answer, user_id).await {
            tracing::error!(%task_id, interaction_state = state, %error, "[TAPP] Failed to resume Agent task from interaction");
        }
    });
}

#[derive(Debug, Deserialize)]
pub struct RejectInteractionRequest {
    reason: String,
}

pub async fn reject_agent_interaction(
    State(db): State<DatabaseConnection>,
    runtime: RuntimeGrantContext,
    Path(interaction_id): Path<String>,
    Json(request): Json<RejectInteractionRequest>,
) -> Result<Json<AgentInteractionSnapshot>, ApiError> {
    if request.reason.is_empty() || request.reason.len() > MAX_REASON_BYTES {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "INVALID_AGENT_REJECTION",
            "Rejection reason must contain 1-500 characters",
        ));
    }
    let mut interaction = load_interaction(&db, &interaction_id).await?;
    if interaction.subject_id != runtime.subject_id()
        || interaction.owner_id != runtime.owner_id()
        || interaction.snapshot.tapp_id != runtime.tapp_id()
        || interaction.snapshot.state.terminal()
        || (interaction.snapshot.state == InteractionState::Accepted
            && interaction.accepted_runtime_id.as_deref() != Some(runtime.runtime_id()))
    {
        return Err(api_error(
            StatusCode::CONFLICT,
            "AGENT_INTERACTION_STATE_CONFLICT",
            "Agent interaction cannot be rejected",
        ));
    }
    interaction.snapshot.state = InteractionState::Rejected;
    interaction.snapshot.rejection_reason = Some(request.reason);
    interaction.snapshot.updated_at = Utc::now().to_rfc3339();
    interaction.retain_until = Utc::now().timestamp() + TERMINAL_RETENTION_SECONDS;
    if !conditional_save_interaction(&db, &interaction, &runtime, true).await? {
        return Err(api_error(
            StatusCode::CONFLICT,
            "AGENT_INTERACTION_STATE_CONFLICT",
            "Agent interaction was already finalized",
        ));
    }
    resume_agent_task(&db, &interaction).await;
    Ok(Json(interaction.snapshot))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestIntentRequest {
    #[serde(rename = "type")]
    intent_type: String,
    #[serde(default)]
    params: Value,
    reason: String,
    host_confirmed: bool,
}

pub async fn request_agent_intent(
    State(db): State<DatabaseConnection>,
    runtime: RuntimeGrantContext,
    Path(interaction_id): Path<String>,
    Json(request): Json<RequestIntentRequest>,
) -> Result<Json<Value>, ApiError> {
    if !request.host_confirmed
        || request.reason.is_empty()
        || request.reason.len() > MAX_REASON_BYTES
        || value_size(&request.params)? > 16 * 1024
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "AGENT_INTENT_CONFIRMATION_REQUIRED",
            "Agent intent requires bounded params, reason, and host confirmation",
        ));
    }
    if !HOST_INTENT_ADAPTERS.contains(&request.intent_type.as_str()) {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "AGENT_INTENT_ADAPTER_UNAVAILABLE",
            "No trusted host adapter is registered for this intent type",
        ));
    }
    let interaction = load_interaction(&db, &interaction_id).await?;
    if interaction.subject_id != runtime.subject_id()
        || interaction.owner_id != runtime.owner_id()
        || interaction.snapshot.tapp_id != runtime.tapp_id()
        || interaction.snapshot.state != InteractionState::Accepted
        || interaction.accepted_runtime_id.as_deref() != Some(runtime.runtime_id())
        || !interaction.intents.contains(&request.intent_type)
    {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "AGENT_INTENT_NOT_ALLOWED",
            "Agent intent is not declared or interaction state does not allow it",
        ));
    }
    Ok(Json(json!({
        "intentId": format!("agi_int_{}", Uuid::new_v4().simple()),
        "interactionId": interaction_id,
        "type": request.intent_type,
        "status": "authorized",
        "hostConfirmed": true,
        "executed": false,
        "adapter": request.intent_type,
        "note": "The trusted host adapter may execute this one authorized operation"
    })))
}

pub async fn stream_agent_interactions(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime: RuntimeGrantContext,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    let subject_id = parse_user_id(&claims)?;
    let tapp = resolve_accessible_tapp(&db, subject_id, runtime.tapp_id()).await?;
    let manifest = parse_agent_manifest(&tapp.manifest)?;
    if manifest.protocol_version != 2 {
        return Err(api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_AGENT_V2_MANIFEST",
            "Agent protocolVersion must be 2",
        ));
    }
    let presence = InteractionStream {
        subject_id,
        owner_id: runtime.owner_id(),
        tapp_id: runtime.tapp_id().to_string(),
    };
    shared_registry::put(
        &db,
        INTERACTION_PRESENCE_NAMESPACE,
        runtime.runtime_id(),
        RegistryIdentity {
            subject_id: Some(subject_id),
            owner_id: Some(runtime.owner_id()),
            tapp_id: Some(runtime.tapp_id()),
            runtime_id: Some(runtime.runtime_id()),
        },
        &presence,
        runtime.expires_at(),
    )
    .await
    .map_err(|_| {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "AGENT_REGISTRY_UNAVAILABLE",
            "Agent presence registry is unavailable",
        )
    })?;
    let interactions = shared_registry::list(
        &db,
        INTERACTION_NAMESPACE,
        Some(subject_id),
        Some(runtime.tapp_id()),
    )
    .await
    .map_err(|_| {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "AGENT_REGISTRY_UNAVAILABLE",
            "Agent interaction registry is unavailable",
        )
    })?;
    for row in interactions {
        let Ok(interaction) = serde_json::from_value::<StoredInteraction>(row.payload) else {
            continue;
        };
        if same_interaction_scope(
            subject_id,
            runtime.owner_id(),
            runtime.tapp_id(),
            interaction.subject_id,
            interaction.owner_id,
            &interaction.snapshot.tapp_id,
        ) && interaction.snapshot.state == InteractionState::Pending
        {
            shared_registry::enqueue(
                &db,
                INTERACTION_MAILBOX_CHANNEL,
                runtime.runtime_id(),
                &interaction.snapshot,
                interaction.retain_until,
            )
            .await
            .map_err(|_| {
                api_error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "AGENT_REGISTRY_UNAVAILABLE",
                    "Agent interaction mailbox is unavailable",
                )
            })?;
        }
    }
    let guard = StreamGuard {
        runtime_id: runtime.runtime_id().to_string(),
    };
    let expires_in = (runtime.expires_at() - Utc::now().timestamp()).max(1) as u64;
    let stream = async_stream::stream! {
        let _guard = guard;
        yield Ok(Event::default().event("ready").json_data(json!({
            "runtimeId": runtime.runtime_id(),
            "interactions": manifest.interactions.iter().map(|value| &value.interaction_type).collect::<Vec<_>>(),
        })).unwrap_or_default());
        let deadline = tokio::time::sleep(Duration::from_secs(expires_in));
        tokio::pin!(deadline);
        let mut poll = tokio::time::interval(Duration::from_millis(250));
        poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = &mut deadline => break,
                _ = poll.tick() => {
                    let interactions = shared_registry::drain::<AgentInteractionSnapshot>(
                        &db,
                        INTERACTION_MAILBOX_CHANNEL,
                        runtime.runtime_id(),
                        32,
                    ).await.unwrap_or_default();
                    for interaction in interactions {
                        yield Ok(Event::default().event("interaction").json_data(interaction).unwrap_or_default());
                    }
                }
            }
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

pub(super) async fn disconnect_runtime_interactions(runtime_id: &str) -> bool {
    let Ok(db) = shared_registry::database().await else {
        return false;
    };
    let disconnected = shared_registry::delete(&db, INTERACTION_PRESENCE_NAMESPACE, runtime_id)
        .await
        .unwrap_or(false);
    let interactions = shared_registry::list(&db, INTERACTION_NAMESPACE, None, None)
        .await
        .unwrap_or_default();
    for row in interactions {
        let Ok(mut interaction) = serde_json::from_value::<StoredInteraction>(row.payload) else {
            continue;
        };
        if interaction.accepted_runtime_id.as_deref() != Some(runtime_id)
            || interaction.snapshot.state != InteractionState::Accepted
        {
            continue;
        }
        interaction.snapshot.state = InteractionState::Cancelled;
        interaction.snapshot.rejection_reason = Some("Tapp runtime disconnected".to_string());
        interaction.snapshot.updated_at = Utc::now().to_rfc3339();
        interaction.retain_until = Utc::now().timestamp() + TERMINAL_RETENTION_SECONDS;
        if cancel_disconnected_interaction(&db, &interaction, runtime_id)
            .await
            .unwrap_or(false)
        {
            resume_agent_task(&db, &interaction).await;
        }
    }
    disconnected
}

#[cfg(test)]
mod tests {
    use super::{same_interaction_scope, InteractionState};

    #[test]
    fn interaction_states_have_terminal_boundary() {
        assert!(!InteractionState::Pending.terminal());
        assert!(!InteractionState::Accepted.terminal());
        assert!(InteractionState::Completed.terminal());
    }

    #[test]
    fn interaction_stream_scope_includes_install_owner() {
        assert!(same_interaction_scope(
            10,
            1,
            "com.example.app",
            10,
            1,
            "com.example.app",
        ));
        assert!(!same_interaction_scope(
            10,
            1,
            "com.example.app",
            10,
            10,
            "com.example.app",
        ));
    }
}
