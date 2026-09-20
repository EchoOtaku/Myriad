//! Explicit, resumable media upgrade. Each admin request commits one bounded batch.
//! No schema-startup I/O and no filesystem crawl: only catalogued or cited files.
use super::{LegacyPaths, MediaError, MediaStore, cite, migration};
use crate::models::entities::{media_assets, media_migration_jobs};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection,
    EntityTrait, QueryFilter, Set, Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

const JOB: &str = "platform_media_v2";
const BATCH: u64 = 50;
const PHASES: &[(&str, &str, &str)] = &[
    ("media_assets", "id", "TRUE"),
    ("phantasi_note_docs", "id", "TRUE"),
    ("phantasi_items", "id", "content_md IS NOT NULL"),
    (
        "phantasi_note_history",
        "(doc_id::text || ':' || revision::text)",
        "TRUE",
    ),
    ("agent_persona", "id", "TRUE"),
    ("configurations", "key", "key = 'dashboard_layout'"),
    ("federation_activities", "id", "is_local = TRUE"),
    (
        "federation_delivery_queue",
        "id",
        "status IN ('pending', 'delivering', 'failed')",
    ),
    (
        "tapp_runtime_registry",
        "record_id",
        "namespace = 'ai_task' AND expires_at > EXTRACT(EPOCH FROM NOW())::BIGINT",
    ),
    ("federation_channel_messages", "id", "is_encrypted = FALSE"),
    ("agent_messages", "id", "TRUE"),
];

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct UpgradeProgress {
    /// 0: discover citations, 1: copy catalog, 2: bind consumers.
    #[serde(default)]
    pub pass: u8,
    pub phase: usize,
    pub after: String,
    pub scanned: u64,
    pub complete: bool,
    pub error: Option<String>,
    #[serde(default)]
    pub error_source: Option<String>,
}

pub async fn status(db: &impl ConnectionTrait) -> Result<UpgradeProgress, MediaError> {
    let job = media_migration_jobs::Entity::find()
        .filter(media_migration_jobs::Column::SourceKind.eq("upgrade"))
        .filter(media_migration_jobs::Column::SourceKey.eq(JOB))
        .one(db)
        .await?;
    match job.and_then(|row| row.cursor) {
        Some(cursor) => serde_json::from_str(&cursor)
            .map_err(|_| MediaError::invalid("Invalid media migration cursor")),
        None => Ok(UpgradeProgress::default()),
    }
}

async fn save(db: &impl ConnectionTrait, progress: &UpgradeProgress) -> Result<(), MediaError> {
    let cursor = serde_json::to_string(progress).map_err(|_| MediaError::StoreFailed)?;
    migration::record_job(
        db,
        "upgrade",
        JOB,
        None,
        if progress.complete {
            "copied"
        } else {
            "pending"
        },
        if progress.complete {
            "verified"
        } else {
            "pending"
        },
        if progress.complete {
            "switched"
        } else {
            "pending"
        },
        progress.error.as_deref(),
        Some(&cursor),
    )
    .await
}

pub async fn advance(
    db: &DatabaseConnection,
    store: &MediaStore,
    paths: &LegacyPaths,
    origins: &[String],
    restart: bool,
) -> Result<UpgradeProgress, MediaError> {
    let txn = db.begin().await?;
    // Serializes admin requests on all replicas, including the first request.
    txn.execute_raw(Statement::from_string(
        DatabaseBackend::Postgres,
        "SELECT pg_advisory_xact_lock(hashtextextended('media:upgrade:v2', 0))",
    ))
    .await?;
    let mut progress = if restart {
        UpgradeProgress::default()
    } else {
        status(&txn).await?
    };
    if progress.complete {
        return Ok(progress);
    }
    progress.error = None;
    progress.error_source = None;
    // Savepoint keeps the previous cursor on any failed consumer/copy while
    // retaining a durable, redacted error for the administrator.
    let batch = txn.begin().await?;
    let result = advance_on(&batch, store, paths, origins, &mut progress).await;
    match result {
        Ok(()) => batch.commit().await?,
        Err(error) => {
            batch.rollback().await?;
            let failed_source = progress.error_source.clone();
            progress = if restart {
                UpgradeProgress::default()
            } else {
                status(&txn).await?
            };
            progress.error_source = failed_source;
            progress.error = Some(error.code().to_string());
        }
    }
    save(&txn, &progress).await?;
    txn.commit().await?;
    Ok(progress)
}

async fn advance_on(
    db: &impl ConnectionTrait,
    store: &MediaStore,
    paths: &LegacyPaths,
    origins: &[String],
    progress: &mut UpgradeProgress,
) -> Result<(), MediaError> {
    if progress.pass == 1 && progress.phase > 0 {
        progress.pass = 2;
        progress.phase = 1;
    }
    if progress.pass == 0 && progress.phase >= PHASES.len() {
        progress.pass = 1;
        progress.phase = 0;
        progress.after.clear();
        return Ok(());
    }
    let Some(&(table, key, filter)) = PHASES.get(progress.phase) else {
        // Only migrated legacy rows are eligible. New writers already maintain
        // references transactionally; incomplete or missing imports stay protected.
        db.execute_unprepared("UPDATE media_assets SET references_complete = TRUE WHERE source = 'legacy' AND state = 'ready' AND references_complete = FALSE").await?;
        progress.complete = true;
        return Ok(());
    };
    // All identifiers and predicates come exclusively from the server whitelist.
    let sql = format!(
        "SELECT {key}::text AS cursor, to_jsonb(s) AS payload FROM {table} s WHERE ({filter}) AND {key}::text > $1 ORDER BY {key}::text LIMIT $2 FOR UPDATE"
    );
    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            sql,
            [progress.after.clone().into(), (BATCH as i64).into()],
        ))
        .await?;
    for row in &rows {
        let cursor: String = row.try_get("", "cursor")?;
        let payload: Value = row.try_get("", "payload")?;
        progress.error_source = Some(format!("{table}:{cursor}"));
        if progress.pass == 0 && progress.phase == 0 {
            db.execute_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
                "UPDATE media_assets SET public_id = gen_random_uuid() WHERE id = $1 AND public_id IS NULL",
                [cursor.parse::<i32>().map_err(|_| MediaError::StoreFailed)?.into()])).await?;
        } else if progress.pass == 0 {
            let layout = parse_layout(table, &payload);
            import_cited(
                db,
                store,
                paths,
                origins,
                layout.as_ref().unwrap_or(&payload),
                false,
            )
            .await?;
        } else if progress.phase == 0 {
            let asset: media_assets::Model =
                serde_json::from_value(payload).map_err(|_| MediaError::StoreFailed)?;
            if asset.state.is_none() || asset.state.as_deref() == Some("missing") {
                if let Ok(plan) = migration::plan_catalog_url(&asset.url, origins, paths) {
                    ensure_copied(store, db, &asset, &plan).await?;
                }
            }
        } else {
            bind_row(db, store, paths, origins, table, &cursor, &payload).await?;
        }
        progress.error_source = None;
        progress.after = cursor;
        progress.scanned += 1;
    }
    if rows.len() < BATCH as usize {
        progress.phase += 1;
        progress.after.clear();
    }
    Ok(())
}

async fn ensure_copied(
    store: &MediaStore,
    db: &impl ConnectionTrait,
    row: &media_assets::Model,
    plan: &migration::CatalogPlan,
) -> Result<(), MediaError> {
    match migration::migrate_one(store, db, row, plan).await? {
        migration::Outcome::Copied { .. } | migration::Outcome::Already { .. } => Ok(()),
        migration::Outcome::Missing => Err(MediaError::Missing),
        migration::Outcome::Failed => Err(MediaError::StoreFailed),
    }
}

async fn import_cited(
    db: &impl ConnectionTrait,
    store: &MediaStore,
    paths: &LegacyPaths,
    origins: &[String],
    payload: &Value,
    copy: bool,
) -> Result<Vec<String>, MediaError> {
    let _ = store;
    let mut strings = Vec::new();
    cite::collect_strings(payload, &mut strings);
    let mut urls = Vec::new();
    for text in strings {
        if let Some(path) = super::urls::cite_local_path(&text, origins) {
            urls.push(path);
        }
        urls.extend(cite::extract_registered_paths(&text, origins));
    }
    urls.sort();
    urls.dedup();
    for url in &urls {
        let Ok(_plan) = migration::plan_catalog_url(url, origins, paths) else {
            continue;
        };
        if let Some(id) = cite::resolve_asset_id(db, url).await? {
            let row = super::assets::find_by_id(db, id)
                .await?
                .ok_or(MediaError::Missing)?;
            if copy && row.state.as_deref() != Some("ready") {
                return Err(MediaError::NotReady);
            }
            continue;
        }
        if copy {
            return Err(MediaError::NotReady);
        }
        let ext = std::path::Path::new(url)
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("");
        let mime = match ext.to_ascii_lowercase().as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "mov" => "video/quicktime",
            _ => return Err(MediaError::invalid("Unsupported legacy media")),
        };
        media_assets::ActiveModel {
            kind: Set("upload".into()),
            url: Set(url.clone()),
            mime: Set(mime.into()),
            name: Set(url.rsplit('/').next().unwrap_or("media").into()),
            size: Set(0),
            created_at: Set(chrono::Utc::now().fixed_offset()),
            references_complete: Set(false),
            ..Default::default()
        }
        .insert(db)
        .await?;
        // Identity commits in the discovery pass before any file copy. Retrying
        // a failed or interrupted copy therefore reuses the same public_id/key.
    }
    Ok(urls)
}

fn parse_layout(table: &str, payload: &Value) -> Option<Value> {
    // Config values may contain a JSON string wrapping the layout document.
    if table == "configurations" {
        let value = payload.get("value").unwrap_or(&Value::Null);
        let parsed = value
            .as_str()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .unwrap_or(value.clone());
        Some(
            parsed
                .as_str()
                .and_then(|s| serde_json::from_str::<Value>(s).ok())
                .unwrap_or(parsed),
        )
    } else {
        None
    }
}

async fn bind_row(
    db: &impl ConnectionTrait,
    store: &MediaStore,
    paths: &LegacyPaths,
    origins: &[String],
    table: &str,
    cursor: &str,
    payload: &Value,
) -> Result<(), MediaError> {
    let text = |key: &str| payload.get(key).and_then(Value::as_str);
    let id = || cursor.parse::<i32>().map_err(|_| MediaError::StoreFailed);
    let layout = parse_layout(table, payload);
    let urls = import_cited(
        db,
        store,
        paths,
        origins,
        layout.as_ref().unwrap_or(payload),
        true,
    )
    .await?;
    match table {
        "phantasi_note_docs" => {
            // Import history citations before the existing atomic draft/history binder.
            let history = db
                .query_all_raw(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    "SELECT snapshot FROM phantasi_note_history WHERE doc_id = $1",
                    [id()?.into()],
                ))
                .await?;
            for row in history {
                let value: Value = row.try_get("", "snapshot")?;
                import_cited(db, store, paths, origins, &value, true).await?;
            }
            cite::bind_note_draft(
                db,
                id()?,
                text("image"),
                text("content_md").unwrap_or(""),
                origins,
            )
            .await
        }
        "phantasi_items" => {
            cite::bind_note_published(
                db,
                id()?,
                text("image"),
                text("content_md").unwrap_or(""),
                origins,
            )
            .await
        }
        "phantasi_note_history" => {
            let snapshot = payload.get("snapshot").unwrap_or(&Value::Null);
            let refs = cite::references_from_fields(
                db,
                origins,
                snapshot.get("image").and_then(Value::as_str),
                snapshot
                    .get("content_md")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                false,
            )
            .await?;
            cite::bind_consumer(
                db,
                "note_history",
                format!("{}:{}", payload["doc_id"], payload["revision"]),
                &refs,
            )
            .await
        }
        "agent_persona" => {
            let persona: crate::models::entities::agent_persona::Model =
                serde_json::from_value(payload.clone()).map_err(|_| MediaError::StoreFailed)?;
            let portrait = match persona.portrait_asset_id.as_deref() {
                Some(url) => Some(cite::publish_local_url(db, url, origins).await?),
                None => None,
            };
            let avatar = match persona.avatar_asset_id.as_deref() {
                Some(url) => Some(cite::publish_local_url(db, url, origins).await?),
                None => None,
            };
            let saved = crate::services::agent::merope::rewrite_persona_media_urls(
                db, persona, portrait, avatar,
            )
            .await
            .map_err(|error| {
                tracing::error!(%error, "media upgrade persona rewrite failed");
                MediaError::StoreFailed
            })?;
            cite::bind_persona(
                db,
                saved.portrait_asset_id.as_deref(),
                saved.avatar_asset_id.as_deref(),
                saved.visual_profile.as_ref(),
                origins,
            )
            .await
        }
        "configurations" => {
            cite::bind_stickers(db, &layout.unwrap_or(Value::Null).to_string(), origins).await
        }
        "tapp_runtime_registry" => {
            let task: crate::services::ai_task_registry::PersistedAiTask =
                serde_json::from_value(payload["payload"].clone())
                    .map_err(|_| MediaError::StoreFailed)?;
            cite::bind_ai_task(
                db,
                &task.snapshot.task_id,
                task.snapshot.result.as_ref().unwrap_or(&Value::Null),
                origins,
                chrono::DateTime::from_timestamp(task.retain_until, 0),
            )
            .await
        }
        "federation_delivery_queue" => {
            let activity = db
                .query_one_raw(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    "SELECT object_json FROM federation_activities WHERE id = $1",
                    [payload["activity_id"]
                        .as_i64()
                        .ok_or(MediaError::StoreFailed)?
                        .into()],
                ))
                .await?;
            let value = activity
                .map(|row| row.try_get::<Value>("", "object_json"))
                .transpose()?
                .unwrap_or(Value::Null);
            let urls = import_cited(db, store, paths, origins, &value, true).await?;
            let refs =
                cite::references_from_urls(db, origins, &urls, |i| format!("attachment:{i}"), true)
                    .await?;
            cite::bind_consumer(db, "federation_outbox", cursor, &refs).await
        }
        _ => {
            let public = table == "federation_activities";
            let refs = cite::references_from_urls(
                db,
                origins,
                &urls,
                |i| format!("attachment:{i}"),
                public,
            )
            .await?;
            let consumer = if public {
                "federation_activity"
            } else {
                "channel_message"
            };
            let identity = if public {
                text("activity_id").unwrap_or(cursor).to_owned()
            } else {
                format!("{table}:{cursor}")
            };
            cite::bind_consumer(db, consumer, identity, &refs).await
        }
    }
}
