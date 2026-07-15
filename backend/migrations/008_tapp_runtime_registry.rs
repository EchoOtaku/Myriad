use sea_orm_migration::prelude::*;

/// Shared, lease-based state for Tapp Runtime V2.
///
/// Runtime records intentionally use JSONB because the V2 protocol objects are
/// short-lived and evolve independently from the long-lived application model.
/// The indexed identity columns remain relational so authorization and cleanup
/// never depend on JSON path expressions.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                r#"
CREATE TABLE IF NOT EXISTS tapp_runtime_registry (
    namespace VARCHAR(64) NOT NULL,
    record_id VARCHAR(160) NOT NULL,
    subject_id INTEGER,
    owner_id INTEGER,
    tapp_id VARCHAR(255),
    runtime_id VARCHAR(160),
    payload JSONB NOT NULL,
    expires_at BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (namespace, record_id)
);

CREATE INDEX IF NOT EXISTS idx_tapp_runtime_registry_subject
    ON tapp_runtime_registry (namespace, subject_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_tapp_runtime_registry_tapp
    ON tapp_runtime_registry (namespace, tapp_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_tapp_runtime_registry_runtime
    ON tapp_runtime_registry (namespace, runtime_id, expires_at);

CREATE TABLE IF NOT EXISTS tapp_runtime_mailbox (
    message_id BIGSERIAL PRIMARY KEY,
    channel VARCHAR(64) NOT NULL,
    runtime_id VARCHAR(160) NOT NULL,
    payload JSONB NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tapp_runtime_mailbox_recipient
    ON tapp_runtime_mailbox (channel, runtime_id, message_id);
CREATE INDEX IF NOT EXISTS idx_tapp_runtime_mailbox_expiry
    ON tapp_runtime_mailbox (expires_at);

ALTER TABLE agent_tasks ADD COLUMN IF NOT EXISTS recipe JSONB;

CREATE OR REPLACE FUNCTION enforce_tapp_storage_quota()
RETURNS TRIGGER AS $$
DECLARE
    current_bytes BIGINT;
    projected_bytes BIGINT;
BEGIN
    PERFORM pg_advisory_xact_lock(
        hashtextextended('tapp-storage:' || NEW.user_id::text || ':' || NEW.tapp_id, 0)
    );

    IF TG_OP = 'UPDATE' THEN
        SELECT COALESCE(SUM(octet_length(key) + octet_length(value::text)), 0)::BIGINT
          INTO current_bytes
          FROM tapp_storage
         WHERE user_id = NEW.user_id
           AND tapp_id = NEW.tapp_id
           AND id <> OLD.id;
    ELSE
        SELECT COALESCE(SUM(octet_length(key) + octet_length(value::text)), 0)::BIGINT
          INTO current_bytes
          FROM tapp_storage
         WHERE user_id = NEW.user_id
           AND tapp_id = NEW.tapp_id;
    END IF;

    projected_bytes := current_bytes
        + octet_length(NEW.key)
        + octet_length(NEW.value::text);
    IF projected_bytes > 5242880 THEN
        RAISE EXCEPTION 'Tapp storage quota exceeded: % bytes', projected_bytes
            USING ERRCODE = '54000';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tapp_storage_quota ON tapp_storage;
CREATE TRIGGER trg_tapp_storage_quota
BEFORE INSERT OR UPDATE OF key, value, user_id, tapp_id ON tapp_storage
FOR EACH ROW EXECUTE FUNCTION enforce_tapp_storage_quota();
"#,
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "DROP TRIGGER IF EXISTS trg_tapp_storage_quota ON tapp_storage; DROP FUNCTION IF EXISTS enforce_tapp_storage_quota(); ALTER TABLE agent_tasks DROP COLUMN IF EXISTS recipe; DROP TABLE IF EXISTS tapp_runtime_mailbox; DROP TABLE IF EXISTS tapp_runtime_registry;",
            )
            .await?;
        Ok(())
    }
}
