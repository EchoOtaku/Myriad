use sea_orm_migration::prelude::*;

/// Preserve install-time consent separately from the permissions that happen
/// to be effective under the current role/delegation policy.
#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let db = manager.get_connection();
        db.execute_unprepared(
            r#"
ALTER TABLE tapps
    ADD COLUMN IF NOT EXISTS approved_permissions JSONB;
UPDATE tapps
   SET approved_permissions = granted_permissions
 WHERE approved_permissions IS NULL;
ALTER TABLE tapps
    ALTER COLUMN approved_permissions SET DEFAULT '[]'::jsonb,
    ALTER COLUMN approved_permissions SET NOT NULL;
"#,
        )
        .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE tapps DROP COLUMN IF EXISTS approved_permissions")
            .await?;
        Ok(())
    }
}
