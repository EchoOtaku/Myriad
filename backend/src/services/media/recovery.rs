//! Recover expired staging rows. Claim with SKIP LOCKED, inspect files off-lock.

use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use uuid::Uuid;

use crate::models::entities::media_assets;

use super::assets;
use super::error::MediaError;
use super::store::MediaStore;
use super::types::RecoveryReport;
use super::urls::filename_for_mime;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecoverPlan {
    CompleteReady,
    CleanupMissing,
}

pub fn plan_recovery(final_exists: bool, checksum_matches: bool) -> RecoverPlan {
    if final_exists && checksum_matches {
        RecoverPlan::CompleteReady
    } else {
        RecoverPlan::CleanupMissing
    }
}

struct ClaimedStaging {
    row: media_assets::Model,
    prev_token: Option<Uuid>,
}

async fn claim_one(
    db: &impl ConnectionTrait,
    new_token: Uuid,
    lease_secs: i64,
) -> Result<Option<ClaimedStaging>, MediaError> {
    let Some(result) = db
        .query_one_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
WITH selected AS MATERIALIZED (
    SELECT id, write_token AS prev_token
    FROM media_assets
    WHERE state = 'staging'
      AND write_lease_until IS NOT NULL
      AND write_lease_until < NOW()
    ORDER BY id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
)
UPDATE media_assets AS asset
SET write_token = $1,
    write_lease_until = NOW() + make_interval(secs => $2::double precision),
    updated_at = NOW()
FROM selected
WHERE asset.id = selected.id
RETURNING asset.id, selected.prev_token
"#,
            [new_token.into(), lease_secs.into()],
        ))
        .await?
    else {
        return Ok(None);
    };
    let id = result
        .try_get::<i32>("", "id")
        .map_err(|_| MediaError::StoreFailed)?;
    let prev_token = result
        .try_get::<Option<Uuid>>("", "prev_token")
        .ok()
        .flatten();
    let Some(row) = assets::find_by_id(db, id).await? else {
        return Ok(None);
    };
    Ok(Some(ClaimedStaging { row, prev_token }))
}

pub async fn recover_expired(
    store: &MediaStore,
    db: &impl ConnectionTrait,
    limit: u32,
    lease_secs: i64,
) -> Result<RecoveryReport, MediaError> {
    let mut report = RecoveryReport {
        claimed: 0,
        completed: 0,
        cleaned: 0,
    };
    for _ in 0..limit.max(1).min(32) {
        let new_token = Uuid::new_v4();
        let Some(claimed) = claim_one(db, new_token, lease_secs).await? else {
            break;
        };
        report.claimed += 1;
        if let Some(prev) = claimed.prev_token {
            store.remove_owned_temp(prev).await?;
        }
        let Some(key) = claimed.row.storage_key.clone() else {
            assets::mark_missing(db, claimed.row.id, new_token).await?;
            report.cleaned += 1;
            continue;
        };
        let actual = store.final_checksum(&key).await?;
        let checksum_matches = match (&claimed.row.checksum_sha256, &actual) {
            (Some(expected), Some(actual_sum)) => expected == actual_sum,
            _ => false,
        };
        match plan_recovery(actual.is_some(), checksum_matches) {
            RecoverPlan::CompleteReady => {
                let public_id = claimed.row.public_id.ok_or(MediaError::StoreFailed)?;
                let filename = filename_for_mime(&claimed.row.name, &claimed.row.mime, public_id)?;
                if assets::commit_ready(db, claimed.row.id, new_token, public_id, &filename).await?
                {
                    report.completed += 1;
                } else {
                    report.cleaned += 1;
                }
            }
            RecoverPlan::CleanupMissing => {
                if actual.is_some() && !checksum_matches {
                    store.remove_final(&key).await?;
                }
                store.remove_owned_temp(new_token).await?;
                assets::mark_missing(db, claimed.row.id, new_token).await?;
                report.cleaned += 1;
            }
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_only_when_checksum_matches() {
        assert_eq!(plan_recovery(true, true), RecoverPlan::CompleteReady);
        assert_eq!(plan_recovery(true, false), RecoverPlan::CleanupMissing);
        assert_eq!(plan_recovery(false, false), RecoverPlan::CleanupMissing);
        assert_eq!(plan_recovery(false, true), RecoverPlan::CleanupMissing);
    }

    #[test]
    fn recovery_sql_uses_skip_locked_and_does_not_copy() {
        let src = include_str!("recovery.rs");
        assert!(src.contains("FOR UPDATE SKIP LOCKED"));
        assert!(!src.contains(concat!("fs::copy", "(")));
    }
}
