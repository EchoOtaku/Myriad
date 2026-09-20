//! Bounded reference backfill. Not hooked from schema startup.

use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, Statement, TransactionTrait,
};
use std::collections::HashMap;

use crate::models::entities::{
    agent_persona, media_references, phantasi_items, phantasi_note_docs,
};

use super::cite::{bind_note_draft, bind_note_published, extract_registered_paths};
use super::error::MediaError;
use super::types::MediaState;

const SCAN_BATCH: u64 = 50;

pub struct ReferenceScanStats {
    pub notes: u32,
    pub published: u32,
    pub persona: u32,
    pub marked_complete: u32,
}

pub async fn backfill_known_consumers(
    db: &DatabaseConnection,
    origins: &[String],
) -> Result<ReferenceScanStats, MediaError> {
    let notes = scan_note_docs(db, origins).await?;
    let published = scan_published_items(db, origins).await?;
    let persona = scan_persona(db, origins).await?;
    let marked_complete = mark_ready_complete(db).await?;
    Ok(ReferenceScanStats {
        notes,
        published,
        persona,
        marked_complete,
    })
}

async fn scan_note_docs(db: &DatabaseConnection, origins: &[String]) -> Result<u32, MediaError> {
    let rows = phantasi_note_docs::Entity::find()
        .order_by_asc(phantasi_note_docs::Column::Id)
        .all(db)
        .await?;
    let mut count = 0;
    for doc in rows {
        let txn = db.begin().await?;
        bind_note_draft(&txn, doc.id, doc.image.as_deref(), &doc.content_md, origins).await?;
        txn.commit().await?;
        count += 1;
        if count >= SCAN_BATCH as u32 * 20 {
            break;
        }
    }
    Ok(count)
}

async fn scan_published_items(
    db: &DatabaseConnection,
    origins: &[String],
) -> Result<u32, MediaError> {
    let rows = phantasi_items::Entity::find()
        .filter(phantasi_items::Column::ContentMd.is_not_null())
        .order_by_asc(phantasi_items::Column::Id)
        .limit(SCAN_BATCH * 20)
        .all(db)
        .await?;
    let mut count = 0;
    for item in rows {
        let txn = db.begin().await?;
        bind_note_published(
            &txn,
            item.id,
            item.image.as_deref(),
            item.content_md.as_deref().unwrap_or(""),
            origins,
        )
        .await?;
        txn.commit().await?;
        count += 1;
    }
    Ok(count)
}

async fn scan_persona(db: &DatabaseConnection, origins: &[String]) -> Result<u32, MediaError> {
    let Some(persona) = agent_persona::Entity::find().one(db).await? else {
        return Ok(0);
    };
    let txn = db.begin().await?;
    super::cite::bind_persona(
        &txn,
        persona.portrait_asset_id.as_deref(),
        persona.avatar_asset_id.as_deref(),
        persona.visual_profile.as_ref(),
        origins,
    )
    .await?;
    txn.commit().await?;
    Ok(1)
}

async fn mark_ready_complete(db: &DatabaseConnection) -> Result<u32, MediaError> {
    let result = db
        .execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"UPDATE media_assets
               SET references_complete = true
               WHERE state = $1 AND references_complete = false"#,
            [MediaState::Ready.as_str().into()],
        ))
        .await?;
    Ok(result.rows_affected() as u32)
}

/// Map live consumer types onto the catalog UI's notes/articles/site labels.
pub fn catalog_reference_labels(consumer_types: &[String]) -> Vec<String> {
    let mut labels = Vec::new();
    let push = |labels: &mut Vec<String>, label: &str| {
        if !labels.iter().any(|existing| existing == label) {
            labels.push(label.to_string());
        }
    };
    for kind in consumer_types {
        match kind.as_str() {
            "note_draft" | "note_published" | "note_history" => push(&mut labels, "notes"),
            "federation_activity" | "federation_outbox" => push(&mut labels, "articles"),
            _ => push(&mut labels, "site"),
        }
    }
    labels
}

pub async fn catalog_labels_for_assets(
    db: &impl ConnectionTrait,
    asset_ids: &[i32],
) -> Result<HashMap<i32, Vec<String>>, MediaError> {
    if asset_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let now = chrono::Utc::now().fixed_offset();
    let rows = media_references::Entity::find()
        .filter(media_references::Column::AssetId.is_in(asset_ids.iter().copied()))
        .all(db)
        .await?;
    let mut grouped: HashMap<i32, Vec<String>> = HashMap::new();
    for row in rows {
        if row.expires_at.is_some_and(|expires| expires <= now) {
            continue;
        }
        grouped
            .entry(row.asset_id)
            .or_default()
            .push(row.consumer_type);
    }
    Ok(grouped
        .into_iter()
        .map(|(id, kinds)| (id, catalog_reference_labels(&kinds)))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_labels_group_consumer_types() {
        assert_eq!(
            catalog_reference_labels(&[
                "note_draft".into(),
                "note_history".into(),
                "sticker".into()
            ]),
            vec!["notes".to_string(), "site".to_string()]
        );
    }

    #[test]
    fn extract_helper_is_available_to_scan() {
        assert!(extract_registered_paths("no media", &[]).is_empty());
    }
}
