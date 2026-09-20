//! Platform media asset service.
//!
//! Business modules depend on this crate path. This module must not depend on
//! `crate::federation`.
//!
//! P1 adds the store and row lifecycle; HTTP and producers switch in later
//! stages, so the public entry is unused until those land.
#![allow(dead_code)]

mod access;
mod assets;
mod error;
pub(crate) mod legacy;
mod migration;
mod recovery;
mod references;
pub(crate) mod serve;
mod store;
mod types;
mod urls;
mod validate;

pub use access::{can_manage, can_read};
pub use error::MediaError;
pub use legacy::{LegacyClass, LegacyPaths};
pub use migration::{
    MigrationBatch, MigrationJobInput, MigrationStats, migrate_catalog_batch, upsert_job,
};
pub use recovery::{RecoverPlan, plan_recovery};
pub use references::{NewReference, active_count, parse_consumer_type, replace_for_consumer};
pub use serve::{FileServe, NO_STORE, ServeOutcome, resolve_alias_or_legacy, resolve_public_asset};
pub use store::MediaStore;
pub use types::{
    DeleteOutcome, MediaActor, MediaAsset, MediaContext, MediaExposure, MediaScope, MediaSource,
    MediaState, NewMediaBytes, RecoveryReport,
};
pub use urls::{content_path, public_path, registered_local_path, storage_key};
pub use validate::{ValidatedPayload, allowed_media_mimes, validate_bytes};

use sea_orm::{DatabaseConnection, TransactionTrait};
use uuid::Uuid;

use crate::models::entities::media_assets;
use crate::services::data_paths::DataPaths;

use self::urls::filename_for_mime;

pub const WRITE_LEASE_SECS: i64 = 600;

pub struct MediaService {
    store: MediaStore,
}

impl MediaService {
    pub fn new(root: std::path::PathBuf) -> Self {
        Self {
            store: MediaStore::new(root),
        }
    }

    pub fn from_data_paths(paths: &DataPaths) -> Self {
        Self::new(paths.media.clone())
    }

    pub fn store(&self) -> &MediaStore {
        &self.store
    }

    pub async fn create_from_bytes(
        &self,
        db: &DatabaseConnection,
        ctx: MediaContext,
        input: NewMediaBytes,
    ) -> Result<MediaAsset, MediaError> {
        ctx.validate()?;
        let payload = validate_bytes(&input.bytes, &input.claimed_mime, input.max_bytes)?;
        if let Some(existing) = assets::find_by_producer(db, &ctx).await? {
            return existing_producer_result(existing);
        }
        let write_token = Uuid::new_v4();
        let row = match assets::insert_staging(
            db,
            &ctx,
            &payload,
            &input.filename,
            input.derived_from_id,
            input.exposure,
            write_token,
            WRITE_LEASE_SECS,
        )
        .await
        {
            Ok(row) => row,
            Err(MediaError::StoreFailed) => {
                if let Some(existing) = assets::find_by_producer(db, &ctx).await? {
                    return existing_producer_result(existing);
                }
                return Err(MediaError::StoreFailed);
            }
            Err(error) => return Err(error),
        };
        let public_id = row.public_id.ok_or(MediaError::StoreFailed)?;
        let key = row.storage_key.clone().ok_or(MediaError::StoreFailed)?;
        if let Err(error) = self
            .store
            .publish_bytes(&key, write_token, &input.bytes)
            .await
        {
            let _ = self.store.remove_owned_temp(write_token).await;
            return Err(error);
        }
        let filename = filename_for_mime(&row.name, &payload.mime, public_id)?;
        if !assets::commit_ready(db, row.id, write_token, public_id, &filename).await? {
            let _ = self.store.remove_owned_temp(write_token).await;
            return Err(MediaError::NotReady);
        }
        let saved = assets::find_by_id(db, row.id)
            .await?
            .ok_or(MediaError::Missing)?;
        assets::to_domain(saved, 0)
    }

    pub async fn renew_write_lease(
        &self,
        db: &DatabaseConnection,
        id: i32,
        write_token: Uuid,
    ) -> Result<(), MediaError> {
        if assets::renew_write_lease(db, id, write_token, WRITE_LEASE_SECS).await? {
            Ok(())
        } else {
            Err(MediaError::NotReady)
        }
    }

    pub async fn recover_expired(
        &self,
        db: &DatabaseConnection,
        limit: u32,
    ) -> Result<RecoveryReport, MediaError> {
        recovery::recover_expired(&self.store, db, limit, WRITE_LEASE_SECS).await
    }

    pub async fn migrate_legacy_catalog_batch(
        &self,
        db: &DatabaseConnection,
        paths: &LegacyPaths,
        allowed_origins: &[String],
        after_id: i32,
        limit: u32,
    ) -> Result<MigrationBatch, MediaError> {
        migrate_catalog_batch(&self.store, db, paths, allowed_origins, after_id, limit).await
    }

    pub async fn delete(
        &self,
        db: &DatabaseConnection,
        id: i32,
    ) -> Result<DeleteOutcome, MediaError> {
        let plan = db
            .transaction(|txn| {
                Box::pin(async move {
                    let Some(row) = assets::lock_by_id(txn, id).await? else {
                        return Err(MediaError::Missing);
                    };
                    let state = row
                        .state
                        .as_deref()
                        .ok_or_else(|| MediaError::invalid("Asset is not migrated"))?;
                    match MediaState::parse(state)? {
                        MediaState::Deleted => Ok(DeletePlan::AlreadyGone),
                        MediaState::Deleting => Ok(DeletePlan::Unlink(row.storage_key)),
                        MediaState::Ready => {
                            if !row.references_complete {
                                return Err(MediaError::InUse);
                            }
                            if references::active_count(txn, id).await? > 0 {
                                return Err(MediaError::InUse);
                            }
                            if !assets::mark_deleting(txn, id).await? {
                                return Err(MediaError::NotReady);
                            }
                            Ok(DeletePlan::Unlink(row.storage_key))
                        }
                        MediaState::Staging | MediaState::Missing => Err(MediaError::NotReady),
                    }
                })
            })
            .await
            .map_err(txn_error)?;
        match plan {
            DeletePlan::AlreadyGone => Ok(DeleteOutcome::Deleted),
            DeletePlan::Unlink(key) => {
                if let Some(key) = key {
                    if let Err(error) = self.store.remove_final(&key).await {
                        tracing::error!(error = ?error, "media delete unlink failed");
                        return Ok(DeleteOutcome::PendingRetry);
                    }
                }
                if assets::mark_deleted(db, id).await? {
                    Ok(DeleteOutcome::Deleted)
                } else {
                    Ok(DeleteOutcome::PendingRetry)
                }
            }
        }
    }
}

enum DeletePlan {
    AlreadyGone,
    Unlink(Option<String>),
}

fn existing_producer_result(row: media_assets::Model) -> Result<MediaAsset, MediaError> {
    let state = row.state.as_deref().unwrap_or("");
    match MediaState::parse(state) {
        Ok(MediaState::Ready) => assets::to_domain(row, 0),
        Ok(MediaState::Staging) => Err(MediaError::NotReady),
        _ => Err(MediaError::conflict("Producer key already used")),
    }
}

fn txn_error(err: sea_orm::TransactionError<MediaError>) -> MediaError {
    match err {
        sea_orm::TransactionError::Connection(err) => MediaError::from(err),
        sea_orm::TransactionError::Transaction(err) => err,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_sources_do_not_import_federation() {
        for src in [
            include_str!("mod.rs"),
            include_str!("access.rs"),
            include_str!("assets.rs"),
            include_str!("error.rs"),
            include_str!("legacy.rs"),
            include_str!("migration.rs"),
            include_str!("recovery.rs"),
            include_str!("references.rs"),
            include_str!("serve.rs"),
            include_str!("store.rs"),
            include_str!("types.rs"),
            include_str!("urls.rs"),
            include_str!("validate.rs"),
        ] {
            for line in src.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("//") || trimmed.starts_with("//!") {
                    continue;
                }
                assert!(
                    !trimmed.contains(concat!("use crate", "::", "federation")),
                    "media service must not import federation: {trimmed}"
                );
            }
        }
    }

    #[test]
    fn error_codes_are_stable_and_redact_paths() {
        let err = MediaError::StoreFailed.into_app_error();
        assert_eq!(err.code(), Some("MEDIA_STORE_FAILED"));
        let json = err.to_json().to_string();
        assert!(!json.contains("/data"));
        assert!(!json.contains("storage_key"));
    }

    #[test]
    fn allowed_mimes_keep_current_upload_surface() {
        let mimes: Vec<_> = allowed_media_mimes().collect();
        assert_eq!(
            mimes,
            vec![
                "image/jpeg",
                "image/png",
                "image/gif",
                "image/webp",
                "video/mp4",
                "video/webm",
                "video/quicktime",
            ]
        );
    }

    #[test]
    fn user_context_rejects_owner_zero() {
        assert!(MediaActor::user(0).is_err());
        let actor = MediaActor {
            user_id: Some(0),
            is_admin: false,
        };
        assert!(MediaContext::user(actor, MediaSource::Upload).is_err());
    }

    #[tokio::test]
    async fn postgres_create_recover_delete_when_configured() {
        let Ok(url) = std::env::var("MYRIAD_MEDIA_TEST_DATABASE_URL") else {
            eprintln!(
                "skipping: set MYRIAD_MEDIA_TEST_DATABASE_URL to run media lifecycle DB tests"
            );
            return;
        };
        let db = sea_orm::Database::connect(&url)
            .await
            .expect("connect media test database");
        sea_orm::ConnectionTrait::execute_unprepared(
            &db,
            include_str!("../../../migrations/media_asset_model.sql"),
        )
        .await
        .expect("apply media asset model");

        let root = std::env::temp_dir().join(format!("myriad-media-pg-{}", Uuid::new_v4()));
        let service = MediaService::new(root.clone());
        let png = {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD
                .decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWNw6fj/H4QBFnsFlbfmtiMAAAAASUVORK5CYII=")
                .unwrap()
        };
        let ctx = MediaContext::site(MediaActor::admin(1).unwrap(), MediaSource::Upload);
        let created = service
            .create_from_bytes(
                &db,
                ctx,
                NewMediaBytes {
                    bytes: png,
                    claimed_mime: "image/png".into(),
                    filename: "shot.png".into(),
                    max_bytes: 1024 * 1024,
                    derived_from_id: None,
                    exposure: MediaExposure::Private,
                },
            )
            .await
            .expect("create asset");
        assert_eq!(created.state, MediaState::Ready);
        assert_eq!(created.exposure, MediaExposure::Private);
        assert!(created.references_complete);
        assert!(created.checksum_sha256.is_some());

        let outcome = service.delete(&db, created.id).await.expect("delete");
        assert_eq!(outcome, DeleteOutcome::Deleted);
        let _ = tokio::fs::remove_dir_all(root).await;
    }
}
