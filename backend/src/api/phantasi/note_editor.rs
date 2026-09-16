//! Account-scoped editor preferences and version-checked history restoration.
use super::helpers::{get_admin_user_id_from_headers, phantasi_http_err, phantasi_store_http};
use super::note_docs::{broadcast_saved_doc, credit_and_respond, find_doc};
use crate::{
    error::HttpError, models::entities::phantasi_note_docs,
    services::note_publish::millis_to_datetime,
};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::Utc;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection, EntityTrait, QueryFilter,
    QuerySelect, Set, Statement, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum EditorView {
    Write,
    #[default]
    Visual,
    Preview,
}
#[derive(Deserialize, Serialize)]
pub(crate) struct EditorPreference {
    default_view: EditorView,
}

pub(crate) async fn get_preference(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
) -> Result<Json<Value>, HttpError> {
    let user_id = get_admin_user_id_from_headers(&headers, &db).await?;
    let row = db
        .query_one_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT note_editor_view FROM users WHERE id = $1",
            [user_id.into()],
        ))
        .await
        .map_err(|e| phantasi_store_http("load editor preference", e))?;
    let view = row
        .and_then(|row| row.try_get::<String>("", "note_editor_view").ok())
        .and_then(|value| serde_json::from_value::<EditorView>(json!(value)).ok())
        .unwrap_or_default();
    Ok(Json(json!({"default_view": view})))
}
pub(crate) async fn put_preference(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Json(req): Json<EditorPreference>,
) -> Result<Json<Value>, HttpError> {
    let user_id = get_admin_user_id_from_headers(&headers, &db).await?;
    let view = serde_json::to_value(req.default_view).unwrap();
    db.execute_raw(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "UPDATE users SET note_editor_view = $1 WHERE id = $2",
        [view.as_str().unwrap().into(), user_id.into()],
    ))
    .await
    .map_err(|e| phantasi_store_http("save editor preference", e))?;
    Ok(Json(json!({"default_view": req.default_view})))
}

pub(crate) async fn list_history(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(id): Path<i32>,
) -> Result<Json<Value>, HttpError> {
    get_admin_user_id_from_headers(&headers, &db).await?;
    find_doc(&db, id).await?;
    let rows = db.query_all_raw(Statement::from_sql_and_values(DatabaseBackend::Postgres,
        "SELECT h.revision, h.actor_id, h.snapshot, (EXTRACT(EPOCH FROM h.saved_at) * 1000)::bigint AS saved_at, COALESCE(u.display_name, u.username) AS actor_name FROM phantasi_note_history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.doc_id = $1 ORDER BY h.revision DESC LIMIT 10", [id.into()])).await
        .map_err(|e| phantasi_store_http("load note history", e))?;
    let history = rows
        .into_iter()
        .map(|row| -> Result<Value, sea_orm::DbErr> {
            Ok(json!({
                "revision": row.try_get::<i64>("", "revision")?,
                "actor_id": row.try_get::<Option<i32>>("", "actor_id")?,
                "actor_name": row.try_get::<Option<String>>("", "actor_name")?,
                "saved_at": row.try_get::<i64>("", "saved_at")?,
                "snapshot": row.try_get::<Value>("", "snapshot")?,
            }))
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| phantasi_store_http("read note history", e))?;
    Ok(Json(json!({"history": history})))
}

#[derive(Deserialize)]
pub(crate) struct RestoreRequest {
    revision: i64,
    client_request_id: Option<String>,
    current: Snapshot,
}
#[derive(Deserialize)]
struct Snapshot {
    title: String,
    content_md: String,
    topic: Option<String>,
    image: Option<String>,
    published_at: Option<i64>,
}

pub(crate) async fn restore_history(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path((id, version)): Path<(i32, i64)>,
    Json(req): Json<RestoreRequest>,
) -> Result<Json<Value>, HttpError> {
    let user_id = get_admin_user_id_from_headers(&headers, &db).await?;
    let saved = restore_version(&db, id, version, user_id, &req).await?;
    broadcast_saved_doc(&saved, user_id, req.client_request_id);
    Ok(Json(
        json!({"success": true, "doc": credit_and_respond(&db, saved, user_id).await?}),
    ))
}

async fn restore_version(
    db: &DatabaseConnection,
    id: i32,
    version: i64,
    user_id: i32,
    req: &RestoreRequest,
) -> Result<phantasi_note_docs::Model, HttpError> {
    let txn = db
        .begin()
        .await
        .map_err(|e| phantasi_store_http("begin note restore", e))?;
    let doc = phantasi_note_docs::Entity::find_by_id(id)
        .lock_exclusive()
        .one(&txn)
        .await
        .map_err(|e| phantasi_store_http("lock note restore", e))?
        .ok_or_else(|| phantasi_http_err(StatusCode::NOT_FOUND, "Note draft not found"))?;
    if doc.revision != req.revision {
        return Err(phantasi_http_err(
            StatusCode::CONFLICT,
            "Note draft was updated elsewhere",
        ));
    }
    // Read before preserving the current input, which can evict the oldest version.
    let row = txn
        .query_one_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT snapshot FROM phantasi_note_history WHERE doc_id = $1 AND revision = $2",
            [id.into(), version.into()],
        ))
        .await
        .map_err(|e| phantasi_store_http("load history version", e))?
        .ok_or_else(|| phantasi_http_err(StatusCode::NOT_FOUND, "Note version not found"))?;
    let snapshot: Value = row
        .try_get("", "snapshot")
        .map_err(|e| phantasi_store_http("read history version", e))?;
    let snapshot: Snapshot = serde_json::from_value(snapshot)
        .map_err(|e| phantasi_store_http("decode history version", e))?;
    let current = &req.current;
    let preserve = phantasi_note_docs::ActiveModel {
        title: Set(current.title.clone()),
        content_md: Set(current.content_md.clone()),
        topic: Set(current.topic.clone()),
        image: Set(current.image.clone()),
        published_at: Set(current
            .published_at
            .and_then(millis_to_datetime)
            .map(Into::into)),
        last_edited_by: Set(Some(user_id)),
        revision: Set(req.revision + 1),
        updated_at: Set(Utc::now().into()),
        ..Default::default()
    };
    phantasi_note_docs::Entity::update_many()
        .set(preserve)
        .filter(phantasi_note_docs::Column::Id.eq(id))
        .filter(phantasi_note_docs::Column::Revision.eq(req.revision))
        .exec(&txn)
        .await
        .map_err(|e| phantasi_store_http("preserve note before restore", e))?;
    let active = phantasi_note_docs::ActiveModel {
        title: Set(snapshot.title),
        content_md: Set(snapshot.content_md),
        topic: Set(snapshot.topic),
        image: Set(snapshot.image),
        published_at: Set(snapshot
            .published_at
            .and_then(millis_to_datetime)
            .map(Into::into)),
        // A linked article stays published, with its public body untouched. Cancel
        // scheduled publication so a restored draft cannot publish unexpectedly.
        status: Set(if doc.item_id.is_some() {
            "published"
        } else {
            "draft"
        }
        .into()),
        scheduled_at: Set(None),
        last_error: Set(None),
        last_edited_by: Set(Some(user_id)),
        revision: Set(req.revision + 2),
        updated_at: Set(Utc::now().into()),
        ..Default::default()
    };
    let mut rows = phantasi_note_docs::Entity::update_many()
        .set(active)
        .filter(phantasi_note_docs::Column::Id.eq(id))
        .filter(phantasi_note_docs::Column::Revision.eq(req.revision + 1))
        .exec_with_returning(&txn)
        .await
        .map_err(|e| phantasi_store_http("restore note version", e))?;
    let saved = rows.pop().ok_or_else(|| {
        phantasi_http_err(StatusCode::CONFLICT, "Note draft was updated elsewhere")
    })?;
    txn.commit()
        .await
        .map_err(|e| phantasi_store_http("commit note restore", e))?;
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preference_accepts_only_editor_views() {
        for view in ["visual", "write", "preview"] {
            assert!(
                serde_json::from_value::<EditorPreference>(json!({"default_view": view})).is_ok()
            );
        }
        assert!(
            serde_json::from_value::<EditorPreference>(json!({"default_view": "arbitrary"}))
                .is_err()
        );
        assert_eq!(
            serde_json::to_value(EditorView::default()).unwrap(),
            "visual"
        );
    }
    /// Opt-in real Postgres regression, isolated in a unique schema and removed afterward.
    #[tokio::test]
    async fn restore_oldest_with_unsaved_input_is_atomic_and_rejects_stale_writers() {
        let Ok(url) = std::env::var("NOTE_EDITOR_TEST_DATABASE_URL") else {
            return;
        };
        let admin = sea_orm::Database::connect(&url).await.unwrap();
        let schema = format!("note_editor_test_{}", uuid::Uuid::new_v4().simple());
        admin
            .execute_unprepared(&format!("CREATE SCHEMA {schema}"))
            .await
            .unwrap();
        let mut options = sea_orm::ConnectOptions::new(url);
        options.set_schema_search_path(&schema).max_connections(2);
        let db = sea_orm::Database::connect(options).await.unwrap();
        db.execute_unprepared(r#"
            CREATE TABLE users (id INTEGER PRIMARY KEY);
            CREATE TABLE phantasi_note_docs (
                id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, item_id INTEGER,
                title TEXT NOT NULL DEFAULT '', content_md TEXT NOT NULL DEFAULT '',
                topic TEXT, image TEXT, status VARCHAR NOT NULL DEFAULT 'draft',
                scheduled_at TIMESTAMPTZ, published_at TIMESTAMPTZ,
                revision BIGINT NOT NULL DEFAULT 1, last_error TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );
        "#).await.unwrap();
        db.execute_unprepared(include_str!("../../../migrations/note_editor.sql"))
            .await
            .unwrap();
        db.execute_unprepared(r#"
            INSERT INTO phantasi_note_docs(id, user_id, title, content_md, status, scheduled_at) VALUES (1, 1, 'Note', 'original', 'scheduled', now() + interval '1 day');
            DO $$ BEGIN FOR i IN 1..12 LOOP
                UPDATE phantasi_note_docs SET content_md = 'edit-' || i, revision = revision + 1, last_edited_by = 1 WHERE id = 1;
            END LOOP; END $$;
        "#).await.unwrap();
        let req = RestoreRequest {
            revision: 13,
            client_request_id: None,
            current: Snapshot {
                title: "Note".into(),
                content_md: "unsaved input".into(),
                topic: None,
                image: None,
                published_at: None,
            },
        };
        // Version 3 is the oldest retained entry; preserving current input evicts it.
        let restored = restore_version(&db, 1, 3, 2, &req).await.unwrap();
        assert_eq!(restored.content_md, "edit-2");
        assert_eq!(restored.revision, 15);
        assert_eq!(restored.status, "draft");
        assert!(restored.scheduled_at.is_none());
        let latest = db.query_one_raw(Statement::from_string(DatabaseBackend::Postgres,
            "SELECT snapshot->>'content_md' AS body, actor_id FROM phantasi_note_history WHERE doc_id = 1 ORDER BY revision DESC LIMIT 1")).await.unwrap().unwrap();
        assert_eq!(
            latest.try_get::<String>("", "body").unwrap(),
            "unsaved input"
        );
        assert_eq!(latest.try_get::<i32>("", "actor_id").unwrap(), 2);
        assert!(restore_version(&db, 1, 14, 2, &req).await.is_err());
        let fresh = RestoreRequest {
            revision: 15,
            current: Snapshot {
                content_md: "edit-2".into(),
                ..req.current
            },
            ..req
        };
        let (first, second) = tokio::join!(
            restore_version(&db, 1, 14, 2, &fresh),
            restore_version(&db, 1, 13, 1, &fresh)
        );
        assert_ne!(
            first.is_ok(),
            second.is_ok(),
            "only one concurrent restoration can win"
        );
        let row = db
            .query_one_raw(Statement::from_string(
                DatabaseBackend::Postgres,
                "SELECT count(*) AS count FROM phantasi_note_history WHERE doc_id = 1",
            ))
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.try_get::<i64>("", "count").unwrap(), 10);
        db.close().await.unwrap();
        admin
            .execute_unprepared(&format!("DROP SCHEMA {schema} CASCADE"))
            .await
            .unwrap();
    }
}
