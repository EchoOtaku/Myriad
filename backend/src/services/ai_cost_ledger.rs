//! Append-only per-call AI cost ledger (write path).
//!
//! `tapp_quota_usage` answers "how much budget is left today"; this ledger
//! answers "which Tapp spent what, when, on which provider/model". Entries are
//! written for every governed AI call (completed, failed or cancelled) and are
//! never reset. Token counts are the same length/4 estimates the quota system
//! uses; `cost_micro_usd` stays NULL until a pricing source exists.
//!
//! HTTP list endpoint stays in the API layer; only the best-effort append lives
//! here so AI task execution does not import `crate::api`.

use sea_orm::{ConnectionTrait, DatabaseConnection, DbBackend, Statement, Value as SeaValue};

pub struct AiCostLedgerEntry<'a> {
    pub subject_id: i32,
    pub owner_id: i32,
    pub tapp_id: &'a str,
    pub task_id: &'a str,
    /// "runtime" for sandbox-created AI Tasks, "internal:<caller>" for
    /// governed host adapters (scheduler, declared builtins, ...).
    pub source: &'a str,
    pub operation: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub status: &'a str,
    pub error_code: Option<&'a str>,
}

/// Best-effort insert: the ledger must never fail the AI task itself.
pub async fn record_ai_cost(db: &DatabaseConnection, entry: AiCostLedgerEntry<'_>) {
    let result = db
        .execute(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                INSERT INTO tapp_ai_cost_ledger
                    (subject_id, owner_id, tapp_id, task_id, source, operation,
                     provider, model, input_tokens, output_tokens,
                     tokens_estimated, status, error_code)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11, $12)
            "#,
            vec![
                SeaValue::Int(Some(entry.subject_id)),
                SeaValue::Int(Some(entry.owner_id)),
                SeaValue::String(Some(Box::new(entry.tapp_id.to_string()))),
                SeaValue::String(Some(Box::new(entry.task_id.to_string()))),
                SeaValue::String(Some(Box::new(entry.source.to_string()))),
                SeaValue::String(Some(Box::new(entry.operation.to_string()))),
                SeaValue::String(Some(Box::new(entry.provider.to_string()))),
                SeaValue::String(Some(Box::new(entry.model.to_string()))),
                SeaValue::Int(Some(entry.input_tokens.max(0))),
                SeaValue::Int(Some(entry.output_tokens.max(0))),
                SeaValue::String(Some(Box::new(entry.status.to_string()))),
                SeaValue::String(entry.error_code.map(|code| Box::new(code.to_string()))),
            ],
        ))
        .await;
    if let Err(error) = result {
        tracing::error!(
            %error,
            tapp_id = entry.tapp_id,
            task_id = entry.task_id,
            "[TAPP] Failed to append AI cost ledger entry"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::AiCostLedgerEntry;

    #[test]
    fn entry_fields_are_borrowed_for_zero_copy_call_sites() {
        let entry = AiCostLedgerEntry {
            subject_id: 1,
            owner_id: 1,
            tapp_id: "com.example.app",
            task_id: "ait_1",
            source: "internal:scheduler",
            operation: "generate",
            provider: "openai",
            model: "gpt-test",
            input_tokens: 10,
            output_tokens: 20,
            status: "completed",
            error_code: None,
        };
        assert_eq!(entry.tapp_id, "com.example.app");
        assert_eq!(entry.input_tokens, 10);
        assert!(entry.error_code.is_none());
    }
}
