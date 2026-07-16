//! Persistent, server-authoritative AI quota ledger for Tapp runtimes.

use axum::{http::StatusCode, Json};
use chrono::{DateTime, Utc};
use sea_orm::{
    ConnectionTrait, DatabaseConnection, DbBackend, Statement, TransactionTrait, Value as SeaValue,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{services::permission_service::UserRole, GLOBAL_DYNAMIC_CONFIG};

type ApiError = (StatusCode, Json<Value>);

#[derive(Debug, Clone, Copy)]
struct AiQuotaLimits {
    calls: i32,
    tokens: i32,
    cooldown_seconds: i32,
    unlimited: bool,
}

#[derive(Debug, Clone)]
pub struct AiQuotaReservation {
    subject_id: i32,
    owner_id: i32,
    tapp_id: String,
    reserved_tokens: i32,
    unlimited: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageCounter {
    /// `None` means unlimited; JSON encodes this as null instead of Infinity.
    pub limit: Option<i32>,
    pub used: i32,
    pub remaining: Option<i32>,
    pub resets_at: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCooldownStatus {
    pub required_seconds: i32,
    pub remaining_seconds: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUsageSnapshot {
    pub calls: AiUsageCounter,
    pub tokens: AiUsageCounter,
    pub cooldown: AiCooldownStatus,
    pub restricted: bool,
    pub restriction_reason: Option<String>,
    pub unlimited: bool,
    pub role: UserRole,
}

fn api_error(status: StatusCode, code: &str, message: impl Into<String>) -> ApiError {
    (
        status,
        Json(json!({
            "error": message.into(),
            "code": code
        })),
    )
}

async fn limits_for_role(role: UserRole) -> AiQuotaLimits {
    if role == UserRole::Admin {
        return AiQuotaLimits {
            calls: i32::MAX,
            tokens: i32::MAX,
            cooldown_seconds: 0,
            unlimited: true,
        };
    }

    let config = GLOBAL_DYNAMIC_CONFIG.read().await;
    match role {
        UserRole::User => AiQuotaLimits {
            calls: config.user_ai_daily_calls.max(0),
            tokens: config.user_ai_daily_tokens.max(0),
            cooldown_seconds: config.user_ai_cooldown_seconds.max(0),
            unlimited: false,
        },
        UserRole::Guest => AiQuotaLimits {
            calls: config.guest_ai_daily_calls.max(0),
            tokens: config.guest_ai_daily_tokens.max(0),
            cooldown_seconds: config.guest_ai_cooldown_seconds.max(0),
            unlimited: false,
        },
        UserRole::Admin => unreachable!(),
    }
}

fn quota_type(kind: &str, owner_id: i32) -> String {
    format!("ai_{kind}:owner:{owner_id}")
}

fn period_end() -> String {
    let tomorrow = Utc::now().date_naive().succ_opt().unwrap_or_default();
    tomorrow
        .and_hms_opt(0, 0, 0)
        .map(|value| DateTime::<Utc>::from_naive_utc_and_offset(value, Utc).to_rfc3339())
        .unwrap_or_else(|| Utc::now().to_rfc3339())
}

fn insert_quota_sql() -> &'static str {
    r#"
        INSERT INTO tapp_quota_usage
            (tapp_id, user_id, quota_type, used, "limit", period_start, period_end, updated_at)
        VALUES
            ($1, $2, $3, 0, $4, date_trunc('day', NOW()),
             date_trunc('day', NOW()) + interval '1 day', NOW())
        ON CONFLICT (user_id, tapp_id, quota_type, period_start)
        DO UPDATE SET "limit" = EXCLUDED."limit"
    "#
}

async fn ensure_quota_row<C: ConnectionTrait>(
    db: &C,
    subject_id: i32,
    tapp_id: &str,
    quota_type: &str,
    limit: i32,
) -> Result<(), ApiError> {
    db.execute(Statement::from_sql_and_values(
        DbBackend::Postgres,
        insert_quota_sql(),
        vec![
            SeaValue::String(Some(Box::new(tapp_id.to_string()))),
            SeaValue::Int(Some(subject_id)),
            SeaValue::String(Some(Box::new(quota_type.to_string()))),
            SeaValue::Int(Some(limit)),
        ],
    ))
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "[TAPP] Failed to initialize AI quota row");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "AI_QUOTA_LEDGER_ERROR",
            "Failed to initialize AI quota ledger",
        )
    })?;
    Ok(())
}

async fn read_row_for_update<C: ConnectionTrait>(
    db: &C,
    subject_id: i32,
    tapp_id: &str,
    quota_type: &str,
) -> Result<(i32, DateTime<Utc>), ApiError> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                SELECT used, updated_at
                FROM tapp_quota_usage
                WHERE user_id = $1 AND tapp_id = $2 AND quota_type = $3
                  AND period_start = date_trunc('day', NOW())
                FOR UPDATE
            "#,
            vec![
                SeaValue::Int(Some(subject_id)),
                SeaValue::String(Some(Box::new(tapp_id.to_string()))),
                SeaValue::String(Some(Box::new(quota_type.to_string()))),
            ],
        ))
        .await
        .map_err(|error| {
            tracing::error!(error = %error, "[TAPP] Failed to lock AI quota row");
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "AI_QUOTA_LEDGER_ERROR",
                "Failed to read AI quota ledger",
            )
        })?
        .ok_or_else(|| {
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "AI_QUOTA_LEDGER_ERROR",
                "AI quota row is missing",
            )
        })?;

    let used = row.try_get::<i32>("", "used").map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "AI_QUOTA_LEDGER_ERROR",
            "AI quota usage is invalid",
        )
    })?;
    let updated_at = row
        .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "updated_at")
        .map(|value| value.with_timezone(&Utc))
        .map_err(|_| {
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "AI_QUOTA_LEDGER_ERROR",
                "AI quota timestamp is invalid",
            )
        })?;
    Ok((used, updated_at))
}

async fn increment_row<C: ConnectionTrait>(
    db: &C,
    subject_id: i32,
    tapp_id: &str,
    quota_type: &str,
    amount: i32,
    touch: bool,
) -> Result<(), ApiError> {
    db.execute(Statement::from_sql_and_values(
        DbBackend::Postgres,
        if touch {
            r#"
                UPDATE tapp_quota_usage
                SET used = GREATEST(0, used + $4), updated_at = NOW()
                WHERE user_id = $1 AND tapp_id = $2 AND quota_type = $3
                  AND period_start = date_trunc('day', NOW())
            "#
        } else {
            r#"
                UPDATE tapp_quota_usage
                SET used = GREATEST(0, used + $4)
                WHERE user_id = $1 AND tapp_id = $2 AND quota_type = $3
                  AND period_start = date_trunc('day', NOW())
            "#
        },
        vec![
            SeaValue::Int(Some(subject_id)),
            SeaValue::String(Some(Box::new(tapp_id.to_string()))),
            SeaValue::String(Some(Box::new(quota_type.to_string()))),
            SeaValue::Int(Some(amount)),
        ],
    ))
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "[TAPP] Failed to update AI quota row");
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "AI_QUOTA_LEDGER_ERROR",
            "Failed to update AI quota ledger",
        )
    })?;
    Ok(())
}

pub async fn reserve_ai_quota(
    db: &DatabaseConnection,
    role: UserRole,
    subject_id: i32,
    owner_id: i32,
    tapp_id: &str,
    estimated_tokens: usize,
) -> Result<AiQuotaReservation, ApiError> {
    let limits = limits_for_role(role).await;
    if limits.unlimited {
        return Ok(AiQuotaReservation {
            subject_id,
            owner_id,
            tapp_id: tapp_id.to_string(),
            reserved_tokens: 0,
            unlimited: true,
        });
    }

    let estimated_tokens = i32::try_from(estimated_tokens).unwrap_or(i32::MAX).max(0);
    let calls_type = quota_type("calls", owner_id);
    let tokens_type = quota_type("tokens", owner_id);
    let txn = db.begin().await.map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "AI_QUOTA_LEDGER_ERROR",
            "Failed to start AI quota transaction",
        )
    })?;

    ensure_quota_row(&txn, subject_id, tapp_id, &calls_type, limits.calls).await?;
    ensure_quota_row(&txn, subject_id, tapp_id, &tokens_type, limits.tokens).await?;
    let (calls_used, last_call_at) =
        read_row_for_update(&txn, subject_id, tapp_id, &calls_type).await?;
    let (tokens_used, _) = read_row_for_update(&txn, subject_id, tapp_id, &tokens_type).await?;

    let cooldown_elapsed = Utc::now()
        .signed_duration_since(last_call_at)
        .num_seconds()
        .max(0);
    if calls_used > 0 && cooldown_elapsed < i64::from(limits.cooldown_seconds) {
        let remaining = i64::from(limits.cooldown_seconds) - cooldown_elapsed;
        return Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "AI_COOLDOWN_ACTIVE",
            format!("AI cooldown active; retry after {remaining} seconds"),
        ));
    }
    if calls_used >= limits.calls {
        return Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "AI_DAILY_CALL_LIMIT",
            "Daily AI call limit reached",
        ));
    }
    if estimated_tokens > limits.tokens.saturating_sub(tokens_used) {
        return Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "AI_DAILY_TOKEN_LIMIT",
            "Daily AI token budget is insufficient for this request",
        ));
    }

    increment_row(&txn, subject_id, tapp_id, &calls_type, 1, true).await?;
    increment_row(
        &txn,
        subject_id,
        tapp_id,
        &tokens_type,
        estimated_tokens,
        false,
    )
    .await?;
    txn.commit().await.map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "AI_QUOTA_LEDGER_ERROR",
            "Failed to commit AI quota reservation",
        )
    })?;

    Ok(AiQuotaReservation {
        subject_id,
        owner_id,
        tapp_id: tapp_id.to_string(),
        reserved_tokens: estimated_tokens,
        unlimited: false,
    })
}

pub async fn settle_ai_quota(
    db: &DatabaseConnection,
    reservation: &AiQuotaReservation,
    actual_tokens: usize,
) -> Result<(), ApiError> {
    if reservation.unlimited {
        return Ok(());
    }
    let actual = i32::try_from(actual_tokens).unwrap_or(i32::MAX).max(0);
    let delta = (i64::from(actual) - i64::from(reservation.reserved_tokens))
        .clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
    increment_row(
        db,
        reservation.subject_id,
        &reservation.tapp_id,
        &quota_type("tokens", reservation.owner_id),
        delta,
        false,
    )
    .await
}

pub async fn release_ai_token_reservation(
    db: &DatabaseConnection,
    reservation: &AiQuotaReservation,
) -> Result<(), ApiError> {
    if reservation.unlimited || reservation.reserved_tokens == 0 {
        return Ok(());
    }
    increment_row(
        db,
        reservation.subject_id,
        &reservation.tapp_id,
        &quota_type("tokens", reservation.owner_id),
        -reservation.reserved_tokens,
        false,
    )
    .await
}

/// Roll back a reservation when the task itself was never registered. Provider
/// failures still consume one call, but a cross-replica registration race or
/// registry outage must not charge for work that never started.
pub async fn rollback_ai_quota_reservation(
    db: &DatabaseConnection,
    reservation: &AiQuotaReservation,
) -> Result<(), ApiError> {
    if reservation.unlimited {
        return Ok(());
    }
    let transaction = db.begin().await.map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "AI_QUOTA_LEDGER_ERROR",
            "Failed to start AI quota rollback",
        )
    })?;
    increment_row(
        &transaction,
        reservation.subject_id,
        &reservation.tapp_id,
        &quota_type("calls", reservation.owner_id),
        -1,
        false,
    )
    .await?;
    if reservation.reserved_tokens > 0 {
        increment_row(
            &transaction,
            reservation.subject_id,
            &reservation.tapp_id,
            &quota_type("tokens", reservation.owner_id),
            -reservation.reserved_tokens,
            false,
        )
        .await?;
    }
    transaction.commit().await.map_err(|_| {
        api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "AI_QUOTA_LEDGER_ERROR",
            "Failed to commit AI quota rollback",
        )
    })?;
    Ok(())
}

async fn read_usage_value(
    db: &DatabaseConnection,
    subject_id: i32,
    tapp_id: &str,
    quota_type: &str,
) -> Result<Option<(i32, DateTime<Utc>)>, ApiError> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DbBackend::Postgres,
            r#"
                SELECT used, updated_at
                FROM tapp_quota_usage
                WHERE user_id = $1 AND tapp_id = $2 AND quota_type = $3
                  AND period_start = date_trunc('day', NOW())
            "#,
            vec![
                SeaValue::Int(Some(subject_id)),
                SeaValue::String(Some(Box::new(tapp_id.to_string()))),
                SeaValue::String(Some(Box::new(quota_type.to_string()))),
            ],
        ))
        .await
        .map_err(|_| {
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "AI_QUOTA_LEDGER_ERROR",
                "Failed to read AI quota usage",
            )
        })?;
    row.map(|row| {
        let used = row.try_get::<i32>("", "used").map_err(|_| {
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "AI_QUOTA_LEDGER_ERROR",
                "AI quota usage is invalid",
            )
        })?;
        let updated = row
            .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "updated_at")
            .map(|value| value.with_timezone(&Utc))
            .map_err(|_| {
                api_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "AI_QUOTA_LEDGER_ERROR",
                    "AI quota timestamp is invalid",
                )
            })?;
        Ok((used, updated))
    })
    .transpose()
}

pub async fn get_ai_usage(
    db: &DatabaseConnection,
    role: UserRole,
    subject_id: i32,
    owner_id: i32,
    tapp_id: &str,
) -> Result<AiUsageSnapshot, ApiError> {
    let limits = limits_for_role(role).await;
    let resets_at = period_end();
    if limits.unlimited {
        return Ok(AiUsageSnapshot {
            calls: AiUsageCounter {
                limit: None,
                used: 0,
                remaining: None,
                resets_at: resets_at.clone(),
            },
            tokens: AiUsageCounter {
                limit: None,
                used: 0,
                remaining: None,
                resets_at,
            },
            cooldown: AiCooldownStatus {
                required_seconds: 0,
                remaining_seconds: 0,
            },
            restricted: false,
            restriction_reason: None,
            unlimited: true,
            role,
        });
    }

    let calls = read_usage_value(db, subject_id, tapp_id, &quota_type("calls", owner_id)).await?;
    let tokens = read_usage_value(db, subject_id, tapp_id, &quota_type("tokens", owner_id)).await?;
    let calls_used = calls.as_ref().map_or(0, |value| value.0);
    let tokens_used = tokens.as_ref().map_or(0, |value| value.0);
    let remaining_seconds = calls
        .map(|(_, updated_at)| {
            let elapsed = Utc::now()
                .signed_duration_since(updated_at)
                .num_seconds()
                .max(0);
            (i64::from(limits.cooldown_seconds) - elapsed).max(0) as i32
        })
        .unwrap_or(0);
    let restriction_reason = if calls_used >= limits.calls {
        Some("daily_calls".to_string())
    } else if tokens_used >= limits.tokens {
        Some("daily_tokens".to_string())
    } else if remaining_seconds > 0 {
        Some("cooldown".to_string())
    } else {
        None
    };

    Ok(AiUsageSnapshot {
        calls: AiUsageCounter {
            limit: Some(limits.calls),
            used: calls_used,
            remaining: Some(limits.calls.saturating_sub(calls_used)),
            resets_at: resets_at.clone(),
        },
        tokens: AiUsageCounter {
            limit: Some(limits.tokens),
            used: tokens_used,
            remaining: Some(limits.tokens.saturating_sub(tokens_used)),
            resets_at,
        },
        cooldown: AiCooldownStatus {
            required_seconds: limits.cooldown_seconds,
            remaining_seconds,
        },
        restricted: restriction_reason.is_some(),
        restriction_reason,
        unlimited: false,
        role,
    })
}

#[cfg(test)]
mod tests {
    use super::quota_type;

    #[test]
    fn quota_key_isolated_by_install_owner() {
        assert_ne!(quota_type("calls", 1), quota_type("calls", 2));
        assert_ne!(quota_type("calls", 1), quota_type("tokens", 1));
    }
}
