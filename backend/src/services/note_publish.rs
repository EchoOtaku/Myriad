//! 把云端笔记文档落成公开 `phantasi_items`。草稿不走这里。
//!
//! 写 `phantasi_items` 和把文档标成已发布是一个事务：要么公开文章和文档状态一起落地，
//! 要么什么都不变。调度器发定时稿之前先用 revision 「认领」一次，多实例同时到点
//! 也只有一个能拿到。

use chrono::{TimeZone, Utc};
use myriad_phantasi_notes::{
    NoteDocStatus, is_due, note_guid, note_link, render_note, validate_note,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection,
    EntityTrait, PaginatorTrait, QueryFilter, Set, Statement, TransactionTrait, Value as SeaValue,
};
use serde::Serialize;

use crate::api::seo::PHANTASI_MINE_CATEGORY as NOTE_SOURCE_CATEGORY;
use crate::error::HttpError;
use crate::models::entities::{phantasi_items, phantasi_note_docs, phantasi_sources};
use axum::{Json, http::StatusCode};
use myriad_error::AppError;

fn phantasi_http_err(status: StatusCode, error: impl Into<String>) -> HttpError {
    HttpError::from((status, Json(AppError::fail_json(error))))
}

fn phantasi_store_http(context: &'static str, error: impl std::fmt::Display) -> HttpError {
    tracing::error!(%error, context, "phantasi store failed");
    phantasi_http_err(
        StatusCode::INTERNAL_SERVER_ERROR,
        format!("Failed to {context}"),
    )
}

pub(crate) const NOTE_SOURCE_NAME: &str = "笔记";
pub(crate) const NOTE_SOURCE_URL: &str = "myriad:notes";

#[derive(Debug, Clone, Serialize)]
pub struct PublishedNote {
    pub id: i32,
    pub link: String,
}

pub fn millis_to_datetime(ms: i64) -> Option<chrono::DateTime<Utc>> {
    Utc.timestamp_millis_opt(ms).single()
}

pub fn datetime_to_millis(value: sea_orm::prelude::DateTimeWithTimeZone) -> i64 {
    value.timestamp_millis()
}

fn validation_err(err: myriad_phantasi_notes::NoteError) -> HttpError {
    phantasi_http_err(StatusCode::BAD_REQUEST, err.message())
}

async fn ensure_note_source<C: ConnectionTrait>(
    db: &C,
    user_id: i32,
) -> Result<phantasi_sources::Model, HttpError> {
    let existing = phantasi_sources::Entity::find()
        .filter(phantasi_sources::Column::SourceType.eq(phantasi_sources::SourceType::Note))
        .one(db)
        .await
        .map_err(|e| phantasi_store_http("find note source", e))?;

    if let Some(source) = existing {
        return Ok(source);
    }

    let now = Utc::now();
    let source = phantasi_sources::ActiveModel {
        user_id: Set(user_id),
        name: Set(NOTE_SOURCE_NAME.to_string()),
        url: Set(NOTE_SOURCE_URL.to_string()),
        feed_type: Set(phantasi_sources::FeedType::Rss),
        source_type: Set(phantasi_sources::SourceType::Note),
        category: Set(Some(NOTE_SOURCE_CATEGORY.to_string())),
        update_interval: Set(0),
        enabled: Set(true),
        error_count: Set(0),
        item_count: Set(0),
        unread_count: Set(0),
        admin_only: Set(false),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
        ..Default::default()
    };

    source
        .insert(db)
        .await
        .map_err(|e| phantasi_store_http("create note source", e))
}

async fn sync_item_count<C: ConnectionTrait>(db: &C, source: &phantasi_sources::Model) {
    let count = phantasi_items::Entity::find()
        .filter(phantasi_items::Column::SourceId.eq(source.id))
        .count(db)
        .await
        .unwrap_or(0);
    let mut active: phantasi_sources::ActiveModel = source.clone().into();
    active.item_count = Set(i32::try_from(count).unwrap_or(i32::MAX));
    active.updated_at = Set(Utc::now().into());
    if let Err(error) = active.update(db).await {
        tracing::warn!(%error, source_id = source.id, "failed to sync note item count");
    }
}

/// 把一篇已经校验过的笔记写进 `phantasi_items`。有 `item_id` 就改，没有就新建。
async fn write_published_item<C: ConnectionTrait>(
    db: &C,
    user_id: i32,
    item_id: Option<i32>,
    title: &str,
    content_md: &str,
    topic: Option<String>,
    image: Option<String>,
    published_at_ms: Option<i64>,
    author: Option<String>,
) -> Result<PublishedNote, HttpError> {
    validate_note(title, content_md).map_err(validation_err)?;
    let source = ensure_note_source(db, user_id).await?;
    let rendered = render_note(title, content_md);
    let now = Utc::now();
    let topic = topic.filter(|value| !value.trim().is_empty());
    let cover = image
        .filter(|value| !value.trim().is_empty())
        .or(rendered.image);

    if let Some(id) = item_id {
        let item = phantasi_items::Entity::find_by_id(id)
            .one(db)
            .await
            .map_err(|e| phantasi_store_http("find note", e))?
            .ok_or_else(|| phantasi_http_err(StatusCode::NOT_FOUND, "Note not found"))?;
        if item.source_id != source.id {
            return Err(phantasi_http_err(StatusCode::NOT_FOUND, "Note not found"));
        }
        let mut active: phantasi_items::ActiveModel = item.into();
        active.title = Set(rendered.title);
        active.summary = Set(rendered.summary);
        active.content = Set(Some(rendered.html));
        active.content_md = Set(Some(content_md.to_string()));
        active.image = Set(cover);
        active.word_count = Set(Some(rendered.word_count));
        active.reading_time = Set(Some(rendered.reading_time));
        active.topic = Set(topic);
        active.author = Set(author);
        if let Some(published_at) = published_at_ms.and_then(millis_to_datetime) {
            active.published_at = Set(published_at.into());
        }
        let item = active
            .update(db)
            .await
            .map_err(|e| phantasi_store_http("save note", e))?;
        return Ok(PublishedNote {
            id: item.id,
            link: item.link,
        });
    }

    let published_at = published_at_ms.and_then(millis_to_datetime).unwrap_or(now);
    let new_item = phantasi_items::ActiveModel {
        source_id: Set(source.id),
        guid: Set(note_guid(&uuid::Uuid::new_v4().to_string())),
        title: Set(rendered.title),
        link: Set(String::new()),
        summary: Set(rendered.summary),
        content: Set(Some(rendered.html)),
        content_md: Set(Some(content_md.to_string())),
        image: Set(cover),
        published_at: Set(published_at.into()),
        fetched_at: Set(now.into()),
        word_count: Set(Some(rendered.word_count)),
        reading_time: Set(Some(rendered.reading_time)),
        fulltext_fetched: Set(true),
        topic: Set(topic),
        author: Set(author),
        ..Default::default()
    };
    let item = new_item
        .insert(db)
        .await
        .map_err(|e| phantasi_store_http("save note", e))?;
    let item_id = item.id;
    let mut active: phantasi_items::ActiveModel = item.into();
    active.link = Set(note_link(item_id));
    let item = active
        .update(db)
        .await
        .map_err(|e| phantasi_store_http("save note", e))?;
    sync_item_count(db, &source).await;
    Ok(PublishedNote {
        id: item.id,
        link: item.link,
    })
}

async fn mark_doc_published<C: ConnectionTrait>(
    db: &C,
    mut doc: phantasi_note_docs::Model,
    item: &PublishedNote,
    published_at_ms: Option<i64>,
) -> Result<phantasi_note_docs::Model, HttpError> {
    let now = Utc::now();
    let published_at = published_at_ms
        .and_then(millis_to_datetime)
        .or_else(|| doc.published_at.map(|dt| dt.with_timezone(&Utc)))
        .unwrap_or(now);
    let expected = doc.revision;
    let mut active = <phantasi_note_docs::ActiveModel as std::default::Default>::default();
    active.item_id = Set(Some(item.id));
    active.status = Set(NoteDocStatus::Published.as_str().to_string());
    active.scheduled_at = Set(None);
    active.published_at = Set(Some(published_at.into()));
    active.last_error = Set(None);
    active.updated_at = Set(now.into());
    active.revision = Set(expected + 1);
    let result = phantasi_note_docs::Entity::update_many()
        .set(active)
        .filter(phantasi_note_docs::Column::Id.eq(doc.id))
        .filter(phantasi_note_docs::Column::Revision.eq(expected))
        .exec(db)
        .await
        .map_err(|e| phantasi_store_http("save note doc", e))?;
    if result.rows_affected == 0 {
        return Err(phantasi_http_err(
            StatusCode::CONFLICT,
            "Note draft was updated elsewhere",
        ));
    }
    doc.item_id = Some(item.id);
    doc.status = NoteDocStatus::Published.as_str().to_string();
    doc.scheduled_at = None;
    doc.published_at = Some(published_at.into());
    doc.last_error = None;
    doc.updated_at = now.into();
    doc.revision = expected + 1;
    Ok(doc)
}

/// 发布一篇云端文档：写 `phantasi_items` + 标文档已发布，一个事务。
///
/// `doc` 里的字段就是要发布的内容（调用方已把请求里的改动合进去）。
pub async fn publish_doc(
    db: &DatabaseConnection,
    doc: phantasi_note_docs::Model,
    published_at_ms: Option<i64>,
) -> Result<(PublishedNote, phantasi_note_docs::Model), HttpError> {
    let txn = db
        .begin()
        .await
        .map_err(|e| phantasi_store_http("begin note publish", e))?;
    let outcome = async {
        let author = crate::services::note_authors::note_author_line(&txn, doc.id).await?;
        let item = write_published_item(
            &txn,
            doc.user_id,
            doc.item_id,
            &doc.title,
            &doc.content_md,
            doc.topic.clone(),
            doc.image.clone(),
            published_at_ms,
            author,
        )
        .await?;
        let saved = mark_doc_published(&txn, doc, &item, published_at_ms).await?;
        Ok::<_, HttpError>((item, saved))
    }
    .await;
    match outcome {
        Ok(result) => {
            txn.commit()
                .await
                .map_err(|e| phantasi_store_http("commit note publish", e))?;
            Ok(result)
        }
        Err(error) => {
            if let Err(rollback) = txn.rollback().await {
                tracing::warn!(error = %rollback, "note publish rollback failed");
            }
            Err(error)
        }
    }
}

/// 认领一篇到点的定时稿：只在 status/revision 都没变时把 revision 推一格。
/// 推不动说明别的实例（或用户）先动了它，这一轮跳过。
async fn claim_due_doc(
    db: &DatabaseConnection,
    doc: &phantasi_note_docs::Model,
) -> Result<Option<phantasi_note_docs::Model>, HttpError> {
    let claimed_revision = doc.revision + 1;
    let result = phantasi_note_docs::Entity::update_many()
        .col_expr(
            phantasi_note_docs::Column::Revision,
            sea_orm::sea_query::Expr::value(claimed_revision),
        )
        .col_expr(
            phantasi_note_docs::Column::UpdatedAt,
            sea_orm::sea_query::Expr::value(Utc::now()),
        )
        .filter(phantasi_note_docs::Column::Id.eq(doc.id))
        .filter(phantasi_note_docs::Column::Status.eq(NoteDocStatus::Scheduled.as_str()))
        .filter(phantasi_note_docs::Column::Revision.eq(doc.revision))
        .exec(db)
        .await
        .map_err(|e| phantasi_store_http("claim scheduled note", e))?;
    if result.rows_affected == 0 {
        return Ok(None);
    }
    let mut claimed = doc.clone();
    claimed.revision = claimed_revision;
    Ok(Some(claimed))
}

/// 调度器：把到点的定时稿写成公开文章。
pub async fn publish_due_note_docs(db: &DatabaseConnection) -> Result<usize, String> {
    let now = Utc::now();
    let rows = phantasi_note_docs::Entity::find()
        .filter(phantasi_note_docs::Column::Status.eq(NoteDocStatus::Scheduled.as_str()))
        .filter(phantasi_note_docs::Column::ScheduledAt.lte(now))
        .all(db)
        .await
        .map_err(|e| format!("list due note docs: {e}"))?;

    let mut published = 0;
    for doc in rows {
        let scheduled_ms = doc.scheduled_at.map(datetime_to_millis);
        if !is_due(
            NoteDocStatus::parse(&doc.status).unwrap_or(NoteDocStatus::Draft),
            scheduled_ms,
            now.timestamp_millis(),
        ) {
            continue;
        }
        let doc = match claim_due_doc(db, &doc).await {
            Ok(Some(claimed)) => claimed,
            Ok(None) => continue,
            Err(error) => {
                tracing::error!(error = ?error, doc_id = doc.id, "failed to claim scheduled note");
                continue;
            }
        };
        let published_at = scheduled_ms.or(doc.published_at.map(datetime_to_millis));
        let doc_id = doc.id;
        match publish_doc(db, doc.clone(), published_at).await {
            Ok(_) => published += 1,
            Err(error) => {
                tracing::error!(error = ?error, doc_id, "failed to publish scheduled note");
                // 4xx 是这篇稿子自己的问题，打回草稿并把原因写下来；5xx 保持 scheduled 下一轮再试。
                if error.0.status().is_client_error() {
                    if let Err(revert) = revert_due_doc(db, doc, error.0.error_label()).await {
                        tracing::error!(error = ?revert, "failed to revert scheduled note");
                    }
                }
            }
        }
    }
    Ok(published)
}

async fn revert_due_doc(
    db: &DatabaseConnection,
    doc: phantasi_note_docs::Model,
    label: &str,
) -> Result<(), HttpError> {
    let mut active: phantasi_note_docs::ActiveModel = doc.clone().into();
    active.status = Set(NoteDocStatus::Draft.as_str().to_string());
    active.last_error = Set(Some(label.to_string()));
    active.updated_at = Set(Utc::now().into());
    active.revision = Set(doc.revision + 1);
    active
        .update(db)
        .await
        .map_err(|e| phantasi_store_http("revert scheduled note", e))?;
    Ok(())
}

pub async fn upsert_doc_for_published_item<C: ConnectionTrait>(
    db: &C,
    user_id: i32,
    item: &PublishedNote,
    title: &str,
    content_md: &str,
    topic: Option<String>,
    image: Option<String>,
    published_at_ms: Option<i64>,
) -> Result<phantasi_note_docs::Model, HttpError> {
    let now = Utc::now();
    let published_at = published_at_ms.and_then(millis_to_datetime);
    if let Some(existing) = phantasi_note_docs::Entity::find()
        .filter(phantasi_note_docs::Column::ItemId.eq(item.id))
        .one(db)
        .await
        .map_err(|e| phantasi_store_http("find note doc", e))?
    {
        let mut active: phantasi_note_docs::ActiveModel = existing.clone().into();
        active.title = Set(title.to_string());
        active.content_md = Set(content_md.to_string());
        active.topic = Set(topic.filter(|value| !value.trim().is_empty()));
        active.image = Set(image.filter(|value| !value.trim().is_empty()));
        active.status = Set(NoteDocStatus::Published.as_str().to_string());
        active.last_error = Set(None);
        if let Some(at) = published_at {
            active.published_at = Set(Some(at.into()));
        }
        active.updated_at = Set(now.into());
        active.revision = Set(existing.revision + 1);
        return active
            .update(db)
            .await
            .map_err(|e| phantasi_store_http("save note doc", e));
    }

    let doc = phantasi_note_docs::ActiveModel {
        user_id: Set(user_id),
        item_id: Set(Some(item.id)),
        title: Set(title.to_string()),
        content_md: Set(content_md.to_string()),
        topic: Set(topic.filter(|value| !value.trim().is_empty())),
        image: Set(image.filter(|value| !value.trim().is_empty())),
        status: Set(NoteDocStatus::Published.as_str().to_string()),
        published_at: Set(published_at.map(|at| at.into())),
        revision: Set(1),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
        ..Default::default()
    };
    doc.insert(db)
        .await
        .map_err(|e| phantasi_store_http("create note doc", e))
}

/// 删订阅源会 CASCADE 掉文章；笔记文档没有这条外键，先把指向这些文章的文档解开。
pub async fn detach_note_docs_for_source<C: ConnectionTrait>(
    db: &C,
    source_id: i32,
) -> Result<(), HttpError> {
    db.execute_raw(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
        UPDATE phantasi_note_docs AS d
        SET item_id = NULL,
            status = CASE WHEN d.status = 'published' THEN 'draft' ELSE d.status END,
            revision = d.revision + 1,
            updated_at = NOW()
        WHERE d.item_id IN (SELECT id FROM phantasi_items WHERE source_id = $1)
        "#,
        [SeaValue::Int(Some(source_id))],
    ))
    .await
    .map_err(|e| phantasi_store_http("detach note docs for source", e))?;
    Ok(())
}

/// 公开笔记的写入 + 对应云端文档同步，一个事务。`create_note` / `update_note` 用。
pub async fn write_note_with_doc(
    db: &DatabaseConnection,
    user_id: i32,
    item_id: Option<i32>,
    title: &str,
    content_md: &str,
    topic: Option<String>,
    image: Option<String>,
    published_at_ms: Option<i64>,
) -> Result<PublishedNote, HttpError> {
    let txn = db
        .begin()
        .await
        .map_err(|e| phantasi_store_http("begin note write", e))?;
    let outcome = async {
        let item = write_published_item(
            &txn,
            user_id,
            item_id,
            title,
            content_md,
            topic.clone(),
            image.clone(),
            published_at_ms,
            None,
        )
        .await?;
        let doc = upsert_doc_for_published_item(
            &txn,
            user_id,
            &item,
            title,
            content_md,
            topic,
            image,
            published_at_ms,
        )
        .await?;
        crate::services::note_authors::ensure_note_author(&txn, doc.id, user_id, doc.user_id)
            .await?;
        crate::services::note_authors::sync_published_author_line(&txn, Some(item.id), doc.id)
            .await?;
        Ok::<_, HttpError>(item)
    }
    .await;
    match outcome {
        Ok(item) => {
            txn.commit()
                .await
                .map_err(|e| phantasi_store_http("commit note write", e))?;
            Ok(item)
        }
        Err(error) => {
            if let Err(rollback) = txn.rollback().await {
                tracing::warn!(error = %rollback, "note write rollback failed");
            }
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_source_is_shared_catalog_not_creator_keyed() {
        let src = include_str!("note_publish.rs");
        let start = src
            .find("async fn ensure_note_source")
            .expect("ensure_note_source");
        let body = &src[start..];
        let end = body[1..]
            .find("\nasync fn ")
            .map(|index| index + 1)
            .unwrap_or(body.len());
        let finder = &body[..end];
        assert!(finder.contains("SourceType::Note"));
        assert!(
            !finder.contains("UserId.eq"),
            "shared note source must not be keyed by the creating admin"
        );
    }

    #[test]
    fn millis_round_trip_for_doc_timestamps() {
        let ms = 1_700_000_000_000;
        let dt = millis_to_datetime(ms).expect("valid millis");
        assert_eq!(datetime_to_millis(dt.into()), ms);
    }

    fn body_of(src: &str, signature: &str) -> String {
        let start = src.find(signature).expect(signature);
        let body = &src[start..];
        let end = body[1..]
            .find("\npub async fn ")
            .or_else(|| body[1..].find("\nasync fn "))
            .map(|index| index + 1)
            .unwrap_or(body.len());
        body[..end].to_string()
    }

    #[test]
    fn due_publish_claims_then_publishes_and_reverts_client_failures() {
        let src = include_str!("note_publish.rs");
        let due = body_of(src, "pub async fn publish_due_note_docs");
        assert!(
            due.contains("claim_due_doc"),
            "must claim before publishing"
        );
        assert!(
            due.contains("publish_doc("),
            "must go through the transactional path"
        );
        assert!(due.contains("is_client_error"));
        assert!(due.contains("revert_due_doc"));
        let revert = body_of(src, "async fn revert_due_doc");
        assert!(
            revert.contains("NoteDocStatus::Draft"),
            "4xx must put the doc back to draft"
        );
        assert!(revert.contains("last_error"));
    }

    #[test]
    fn claim_is_conditional_on_status_and_revision() {
        let src = include_str!("note_publish.rs");
        let claim = body_of(src, "async fn claim_due_doc");
        assert!(claim.contains("Column::Status.eq(NoteDocStatus::Scheduled"));
        assert!(claim.contains("Column::Revision.eq(doc.revision)"));
        assert!(claim.contains("rows_affected == 0"));
    }

    #[test]
    fn source_delete_unpublishes_docs_before_items_cascade() {
        let src = include_str!("note_publish.rs");
        let detach = body_of(src, "pub async fn detach_note_docs_for_source");
        assert!(
            detach.contains("item_id = NULL"),
            "must clear the dangling article id"
        );
        assert!(
            detach.contains("THEN 'draft'"),
            "published docs without an article must go back to draft"
        );
        let delete = include_str!("../api/phantasi/feeds_sources.rs");
        let start = delete
            .find("pub(crate) async fn delete_source")
            .expect("delete_source");
        let body = &delete[start..];
        assert!(
            body.contains("detach_note_docs_for_source"),
            "deleting a source must detach note docs first"
        );
        assert!(
            body.contains(".begin()"),
            "source delete must be transactional"
        );
        let heal = include_str!("../db/schema_check/ensure_heals.rs");
        assert!(
            heal.contains("AND NOT EXISTS (SELECT 1 FROM phantasi_items i WHERE i.id = d.item_id)"),
            "boot heal must unpublish docs whose article is already gone"
        );
    }

    #[test]
    fn publish_and_write_run_in_a_transaction() {
        let src = include_str!("note_publish.rs");
        for signature in [
            "pub async fn publish_doc",
            "pub async fn write_note_with_doc",
        ] {
            let body = body_of(src, signature);
            assert!(
                body.contains(".begin()"),
                "{signature} must open a transaction"
            );
            assert!(body.contains("commit()"), "{signature} must commit");
            assert!(
                body.contains("rollback()"),
                "{signature} must roll back on error"
            );
        }
    }
}
