//! Bounded migration job records. Startup must not scan the whole disk.

use chrono::Utc;
use sea_orm::{ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Set};

use crate::models::entities::media_migration_jobs;

use super::error::MediaError;

#[derive(Clone, Debug)]
pub struct MigrationJobInput {
    pub source_kind: String,
    pub source_key: String,
    pub batch_version: i32,
}

pub async fn upsert_job(
    db: &impl ConnectionTrait,
    input: MigrationJobInput,
) -> Result<media_migration_jobs::Model, MediaError> {
    if input.source_kind.trim().is_empty() || input.source_key.trim().is_empty() {
        return Err(MediaError::invalid("Invalid migration source"));
    }
    if let Some(existing) = media_migration_jobs::Entity::find()
        .filter(media_migration_jobs::Column::SourceKind.eq(&input.source_kind))
        .filter(media_migration_jobs::Column::SourceKey.eq(&input.source_key))
        .one(db)
        .await?
    {
        return Ok(existing);
    }
    let now = Utc::now().fixed_offset();
    let row = media_migration_jobs::ActiveModel {
        source_kind: Set(input.source_kind),
        source_key: Set(input.source_key),
        copy_state: Set("pending".into()),
        verify_state: Set("pending".into()),
        switch_state: Set("pending".into()),
        batch_version: Set(input.batch_version),
        created_at: Set(now),
        updated_at: Set(now),
        ..Default::default()
    };
    Ok(row.insert(db).await?)
}

#[cfg(test)]
mod tests {
    #[test]
    fn migration_module_does_not_walk_the_tree_on_load() {
        let src = include_str!("migration.rs");
        assert!(!src.contains(concat!("read_dir", "(")));
        assert!(!src.contains(concat!("Walk", "Dir")));
        assert!(!src.contains(concat!("backfill", "_federation")));
    }
}
