use sea_orm_migration::prelude::*;

/// Give the per-domain delivery failure streak a start timestamp, and make the
/// domain-scoped queue sweep indexable.
///
/// `failing_since` records when the *current* unbroken streak of unreachable
/// deliveries began. Revocation needs a duration, not just a count: without it a
/// single peer restart with a handful of queued rows looks identical to a peer
/// that has been gone for a week. Existing rows start NULL and get stamped on
/// their next failure, so a rolling deployment never inherits a fake streak.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                r#"
ALTER TABLE federation_instances
    ADD COLUMN IF NOT EXISTS failing_since TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_delivery_queue_target_domain
    ON federation_delivery_queue (LOWER(target_domain), status);
"#,
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                r#"
DROP INDEX IF EXISTS idx_delivery_queue_target_domain;
ALTER TABLE federation_instances
    DROP COLUMN IF EXISTS failing_since;
"#,
            )
            .await?;
        Ok(())
    }
}
