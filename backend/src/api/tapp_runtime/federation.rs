//! Role-aware federation feed exposed only through a Tapp runtime grant.

use std::collections::HashSet;

use axum::{extract::State, http::StatusCode, Json};
use chrono::{DateTime, FixedOffset};
use sea_orm::{DatabaseBackend, DatabaseConnection, FromQueryResult, Statement};
use serde_json::{json, Value};

use crate::services::permission_service::TappPermission;

use super::RuntimeGrantContext;

const AP_PUBLIC: &str = "https://www.w3.org/ns/activitystreams#Public";
const FEED_LIMIT: usize = 100;

#[derive(Debug, FromQueryResult)]
struct FeedRow {
    activity_id: String,
    activity_type: Option<String>,
    object_type: Option<String>,
    content_preview: Option<String>,
    content_json: Option<Value>,
    received_at: DateTime<FixedOffset>,
    actor_url: Option<String>,
    username: Option<String>,
    domain: Option<String>,
    display_name: Option<String>,
    avatar_url: Option<String>,
    scope: String,
    is_local: Option<bool>,
}

fn db_unavailable() -> (StatusCode, Json<Value>) {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(json!({"error": "Federation feed is unavailable"})),
    )
}

fn feed_item(row: FeedRow) -> Value {
    let timestamp = row.received_at.to_rfc3339();
    let object_id = row
        .content_json
        .as_ref()
        .and_then(crate::federation::interactions::extract_object_id);
    json!({
        "activity_id": row.activity_id,
        "activity_type": row.activity_type,
        "object_type": row.object_type,
        "content_preview": row.content_preview,
        "content_json": row.content_json,
        "object_id": object_id,
        "is_read": false,
        "created_at": timestamp,
        "received_at": timestamp,
        "scope": row.scope,
        "actor": {
            "actor_url": row.actor_url,
            "username": row.username,
            "domain": row.domain,
            "display_name": row.display_name,
            "avatar_url": row.avatar_url,
            "is_local": row.is_local.unwrap_or(false),
        },
    })
}

async fn enrich_feed_items(db: &DatabaseConnection, user_id: i32, items: &mut [Value]) {
    let object_ids: Vec<String> = items
        .iter()
        .filter_map(|it| {
            it.get("object_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .collect();
    let Ok(stats_map) =
        crate::federation::interactions::interaction_stats_for_objects(db, user_id, &object_ids)
            .await
    else {
        return;
    };
    for item in items.iter_mut() {
        let Some(oid) = item
            .get("object_id")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
        else {
            continue;
        };
        let Some(st) = stats_map.get(&oid) else {
            continue;
        };
        if let Some(obj) = item.as_object_mut() {
            obj.insert("liked_by_me".into(), json!(st.liked_by_me));
            obj.insert("bookmarked_by_me".into(), json!(st.bookmarked_by_me));
            obj.insert("announced_by_me".into(), json!(st.announced_by_me));
            obj.insert("like_count".into(), json!(st.like_count));
            obj.insert("bookmark_count".into(), json!(st.bookmark_count));
            obj.insert("announce_count".into(), json!(st.announce_count));
            obj.insert("reply_count".into(), json!(st.reply_count));
            obj.insert("is_bookmarked".into(), json!(st.bookmarked_by_me));
        }
    }
}

/// SQL expression: resolved local-user avatar URL when present (OAuth/provider or
/// ui-avatars placeholder last). Used only for the post author, never the viewer.
const LOCAL_USER_AVATAR_SQL: &str = r#"
COALESCE(
    NULLIF(
        CASE
            WHEN {alias}.avatar_url LIKE 'https://ui-avatars.com/%'
                 OR {alias}.avatar_url LIKE 'http://ui-avatars.com/%'
            THEN NULL
            ELSE {alias}.avatar_url
        END,
        ''
    ),
    (
        SELECT NULLIF(ui.avatar_url, '')
        FROM user_identities ui
        WHERE ui.user_id = {alias}.id
          AND ui.avatar_url IS NOT NULL
          AND ui.avatar_url <> ''
        ORDER BY ui.is_primary DESC, ui.last_login_at DESC NULLS LAST, ui.linked_at DESC
        LIMIT 1
    ),
    NULLIF({alias}.avatar_url, '')
)"#;

fn local_user_avatar_expr(alias: &str) -> String {
    LOCAL_USER_AVATAR_SQL.replace("{alias}", alias)
}

async fn load_personal_feed(
    db: &DatabaseConnection,
    user_id: i32,
) -> Result<Vec<Value>, (StatusCode, Json<Value>)> {
    let base_url = crate::federation::types::get_base_url().await;
    let base = base_url.trim_end_matches('/').to_string();
    let domain = crate::federation::types::extract_domain(&base_url).unwrap_or_default();
    // Author identity must come from remote_actor (remote/same-instance posts) or
    // the local author row for self-posts. Never fall back to the timeline owner
    // (viewer) when remote_actor.display_name/avatar is missing — that made every
    // post show the viewer's nickname.
    let author_avatar = local_user_avatar_expr("author");
    let peer_avatar = local_user_avatar_expr("peer");
    let sql = format!(
        r#"SELECT t.activity_id, t.activity_type, t.object_type,
                  t.content_preview, t.content_json, t.received_at,
                  COALESCE(
                      ra.actor_url,
                      CASE WHEN author.username IS NOT NULL
                           THEN $2 || '/users/' || author.username
                           ELSE NULL END
                  ) AS actor_url,
                  COALESCE(ra.username, author.username) AS username,
                  COALESCE(
                      NULLIF(ra.domain, ''),
                      CASE WHEN ra.id IS NULL THEN $3 ELSE NULL END
                  ) AS domain,
                  CASE
                      WHEN ra.id IS NOT NULL THEN
                          COALESCE(
                              NULLIF(ra.display_name, ''),
                              NULLIF(peer.display_name, ''),
                              ra.username,
                              peer.username
                          )
                      ELSE
                          COALESCE(NULLIF(author.display_name, ''), author.username)
                  END AS display_name,
                  CASE
                      WHEN ra.id IS NOT NULL THEN
                          COALESCE(
                              NULLIF(ra.avatar_url, ''),
                              CASE
                                  WHEN peer.username IS NOT NULL AND ({peer_avatar}) IS NOT NULL
                                  THEN $2 || '/users/' || peer.username || '/avatar'
                                  ELSE NULL
                              END
                          )
                      ELSE
                          CASE
                              WHEN author.username IS NOT NULL AND ({author_avatar}) IS NOT NULL
                              THEN $2 || '/users/' || author.username || '/avatar'
                              ELSE NULL
                          END
                  END AS avatar_url,
                  'personal'::TEXT AS scope,
                  (ra.id IS NULL) AS is_local
           FROM federation_timeline t
           LEFT JOIN federation_remote_actors ra ON ra.id = t.remote_actor_id
           -- Self-authored timeline rows only (remote_actor_id IS NULL).
           LEFT JOIN users author ON ra.id IS NULL AND author.id = t.user_id
           -- Same-instance peer enrichment for remote_actor stubs (local followees).
           LEFT JOIN users peer ON ra.id IS NOT NULL
               AND ra.username IS NOT NULL
               AND peer.username = ra.username
               AND (
                   ra.actor_url LIKE ($2 || '/users/%')
                   OR ra.domain = $3
               )
           WHERE t.user_id = $1
             AND (t.activity_type IS NULL OR t.activity_type <> 'Like')
           ORDER BY t.received_at DESC
           LIMIT 100"#,
        peer_avatar = peer_avatar,
        author_avatar = author_avatar,
    );
    let rows = FeedRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        sql,
        [user_id.into(), base.into(), domain.into()],
    ))
    .all(db)
    .await
    .map_err(|error| {
        tracing::warn!(%error, "Failed to load personal federation feed");
        db_unavailable()
    })?;

    let mut items: Vec<Value> = rows.into_iter().map(feed_item).collect();
    enrich_feed_items(db, user_id, &mut items).await;
    Ok(items)
}

async fn load_public_feed(
    db: &DatabaseConnection,
) -> Result<Vec<Value>, (StatusCode, Json<Value>)> {
    let rows = FeedRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"WITH public_items AS (
               SELECT DISTINCT ON (a.activity_id)
                      a.activity_id,
                      a.activity_type,
                      a.object_type,
                      LEFT(COALESCE(
                          a.object_json #>> '{object,content}',
                          a.object_json #>> '{object,source,content}',
                          a.object_json ->> 'content',
                          a.object_json #>> '{object,summary}',
                          a.object_json ->> 'summary'
                      ), 200) AS content_preview,
                      COALESCE(
                          a.object_json -> 'object',
                          a.object_json
                      ) AS content_json,
                      COALESCE(a.received_at, a.published_at) AS received_at,
                      COALESCE(
                          a.object_json ->> 'actor',
                          a.object_json #>> '{object,attributedTo}',
                          a.object_json ->> 'attributedTo',
                          ra.actor_url
                      ) AS actor_url,
                      COALESCE(u.username, ra.username) AS username,
                      ra.domain,
                      COALESCE(u.display_name, ra.display_name, u.username, ra.username) AS display_name,
                      COALESCE(u.avatar_url, ra.avatar_url) AS avatar_url,
                      'public'::TEXT AS scope,
                      a.is_local AS is_local
               FROM federation_activities a
               LEFT JOIN federation_published_content pc ON pc.activity_id = a.activity_id
               LEFT JOIN users u ON u.id = a.user_id
               LEFT JOIN federation_remote_actors ra ON ra.id = a.remote_actor_id
               WHERE pc.visibility = 'public'
                  OR (
                      a.is_local = false
                      AND (
                          COALESCE((a.object_json -> 'to')::JSONB, '[]'::JSONB) ? $1
                          OR COALESCE((a.object_json -> 'cc')::JSONB, '[]'::JSONB) ? $1
                          OR COALESCE((a.object_json #> '{object,to}')::JSONB, '[]'::JSONB) ? $1
                          OR COALESCE((a.object_json #> '{object,cc}')::JSONB, '[]'::JSONB) ? $1
                      )
                  )
               ORDER BY a.activity_id, COALESCE(a.received_at, a.published_at) DESC
           )
           SELECT *
           FROM public_items
           ORDER BY received_at DESC
           LIMIT 100"#,
        [AP_PUBLIC.into()],
    ))
    .all(db)
    .await
    .map_err(|error| {
        tracing::warn!(%error, "Failed to load public federation feed");
        db_unavailable()
    })?;

    Ok(rows.into_iter().map(feed_item).collect())
}

fn merge_feed(mut personal: Vec<Value>, public: Vec<Value>) -> Vec<Value> {
    let mut seen = HashSet::new();
    personal.retain(|item| {
        item.get("activity_id")
            .and_then(Value::as_str)
            .is_some_and(|id| seen.insert(id.to_string()))
    });
    for item in public {
        let Some(id) = item.get("activity_id").and_then(Value::as_str) else {
            continue;
        };
        if seen.insert(id.to_string()) {
            personal.push(item);
        }
    }
    personal.sort_by(|left, right| {
        let left_time = left
            .get("received_at")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_time = right
            .get("received_at")
            .and_then(Value::as_str)
            .unwrap_or_default();
        right_time.cmp(left_time)
    });
    personal.truncate(FEED_LIMIT);
    personal
}

/// GET /api/tapp/federation/feed
///
/// Guests receive public activities only. Authenticated users receive their
/// personal federation timeline merged with the same public activities.
pub async fn get_federation_feed(
    State(db): State<DatabaseConnection>,
    runtime_grant: RuntimeGrantContext,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require(TappPermission::FederationRead)?;

    let public = load_public_feed(&db).await?;
    let is_guest = runtime_grant.subject_id() < 0;
    let personal = if is_guest {
        Vec::new()
    } else {
        load_personal_feed(&db, runtime_grant.subject_id()).await?
    };
    let mut items = merge_feed(personal, public);
    // Re-enrich after merge so public-only rows also get counts / me-flags.
    if !is_guest {
        enrich_feed_items(&db, runtime_grant.subject_id(), &mut items).await;
    }
    let total = items.len();

    Ok(Json(json!({
        "items": items,
        "total": total,
        "audience": if is_guest { "public" } else { "public+personal" },
    })))
}

#[cfg(test)]
mod tests {
    use super::merge_feed;
    use serde_json::json;

    #[test]
    fn personal_copy_wins_when_public_feed_contains_same_activity() {
        let merged = merge_feed(
            vec![json!({
                "activity_id": "same",
                "received_at": "2026-07-15T10:00:00+00:00",
                "scope": "personal"
            })],
            vec![json!({
                "activity_id": "same",
                "received_at": "2026-07-15T10:00:00+00:00",
                "scope": "public"
            })],
        );

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["scope"], "personal");
    }

    #[test]
    fn merged_feed_is_newest_first() {
        let merged = merge_feed(
            vec![json!({
                "activity_id": "older",
                "received_at": "2026-07-14T10:00:00+00:00"
            })],
            vec![json!({
                "activity_id": "newer",
                "received_at": "2026-07-15T10:00:00+00:00"
            })],
        );

        assert_eq!(merged[0]["activity_id"], "newer");
    }
}
