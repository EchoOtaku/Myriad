//! Bind business consumers to ready assets. Callers pass an open transaction.

use sea_orm::{ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, QueryFilter, Statement};
use serde_json::Value;
use uuid::Uuid;

use crate::models::entities::{media_assets, media_url_aliases};

use super::assets;
use super::error::MediaError;
use super::references::{NewReference, replace_for_consumer};
use super::urls::cite_local_path;

pub fn extract_registered_paths(text: &str, origins: &[String]) -> Vec<String> {
    let mut found = Vec::new();
    push_delimited(text, "](", ')', origins, &mut found);
    push_src_attr(text, origins, &mut found);
    found
}

fn push_unique(found: &mut Vec<String>, path: String) {
    if !found.iter().any(|existing| existing == &path) {
        found.push(path);
    }
}

fn push_delimited(
    text: &str,
    open: &str,
    close: char,
    origins: &[String],
    found: &mut Vec<String>,
) {
    let mut rest = text;
    while let Some(start) = rest.find(open) {
        rest = &rest[start + open.len()..];
        let Some(end) = rest.find(close) else {
            break;
        };
        if let Some(path) = cite_local_path(&rest[..end], origins) {
            push_unique(found, path);
        }
        rest = &rest[end + close.len_utf8()..];
    }
}

fn push_src_attr(text: &str, origins: &[String], found: &mut Vec<String>) {
    let mut rest = text;
    while let Some(start) = rest.find("src=") {
        rest = &rest[start + 4..];
        let mut chars = rest.chars();
        let Some(quote) = chars.next() else {
            break;
        };
        if quote != '"' && quote != '\'' {
            continue;
        }
        let body = &rest[quote.len_utf8()..];
        let Some(end) = body.find(quote) else {
            break;
        };
        if let Some(path) = cite_local_path(&body[..end], origins) {
            push_unique(found, path);
        }
        rest = &body[end + quote.len_utf8()..];
    }
}

pub async fn resolve_asset_id(
    db: &impl ConnectionTrait,
    path: &str,
) -> Result<Option<i32>, MediaError> {
    if let Some(id) = parse_content_id(path) {
        if assets::find_by_id(db, id).await?.is_some() {
            return Ok(Some(id));
        }
    }
    if let Some(public_id) = parse_public_id(path) {
        if let Some(row) = assets::find_by_public_id(db, public_id).await? {
            return Ok(Some(row.id));
        }
    }
    if let Some(alias) = media_url_aliases::Entity::find()
        .filter(media_url_aliases::Column::LocalPath.eq(path))
        .one(db)
        .await?
    {
        return Ok(Some(alias.asset_id));
    }
    if let Some(row) = media_assets::Entity::find()
        .filter(media_assets::Column::Url.eq(path))
        .one(db)
        .await?
    {
        return Ok(Some(row.id));
    }
    Ok(None)
}

fn parse_content_id(path: &str) -> Option<i32> {
    let rest = path.strip_prefix("/api/media/")?;
    let id = rest
        .strip_suffix("/content")
        .unwrap_or(rest.split('/').next()?);
    id.parse().ok().filter(|value| *value > 0)
}

fn parse_public_id(path: &str) -> Option<Uuid> {
    let rest = path.strip_prefix("/media/assets/")?;
    Uuid::parse_str(rest.split('/').next()?).ok()
}

pub async fn references_from_fields(
    db: &impl ConnectionTrait,
    origins: &[String],
    cover: Option<&str>,
    body: &str,
    requires_public: bool,
) -> Result<Vec<NewReference>, MediaError> {
    let mut refs = Vec::new();
    if let Some(cover) = cover {
        if let Some(path) = cite_local_path(cover, origins) {
            push_ref(db, &mut refs, &path, "cover", requires_public).await?;
        }
    }
    for (index, path) in extract_registered_paths(body, origins)
        .into_iter()
        .enumerate()
    {
        let slot = format!("body:{index}");
        push_ref(db, &mut refs, &path, &slot, requires_public).await?;
    }
    Ok(refs)
}

pub async fn references_from_urls(
    db: &impl ConnectionTrait,
    origins: &[String],
    urls: &[String],
    slot: impl Fn(usize) -> String,
    requires_public: bool,
) -> Result<Vec<NewReference>, MediaError> {
    let mut refs = Vec::new();
    for (index, url) in urls.iter().enumerate() {
        let Some(path) = cite_local_path(url, origins) else {
            continue;
        };
        let name = slot(index);
        push_ref(db, &mut refs, &path, &name, requires_public).await?;
    }
    Ok(refs)
}

async fn push_ref(
    db: &impl ConnectionTrait,
    refs: &mut Vec<NewReference>,
    path: &str,
    slot: &str,
    requires_public: bool,
) -> Result<(), MediaError> {
    let Some(asset_id) = resolve_asset_id(db, path).await? else {
        return Ok(());
    };
    if refs
        .iter()
        .any(|item| item.asset_id == asset_id && item.slot == slot)
    {
        return Ok(());
    }
    refs.push(NewReference {
        asset_id,
        slot: slot.to_string(),
        requires_public,
        expires_at: None,
    });
    Ok(())
}

pub async fn bind_consumer(
    txn: &impl ConnectionTrait,
    consumer_type: &str,
    consumer_id: impl AsRef<str>,
    refs: &[NewReference],
) -> Result<(), MediaError> {
    replace_for_consumer(txn, consumer_type, consumer_id.as_ref(), refs).await
}

pub async fn bind_note_draft(
    txn: &impl ConnectionTrait,
    doc_id: i32,
    image: Option<&str>,
    content_md: &str,
    origins: &[String],
) -> Result<(), MediaError> {
    let refs = references_from_fields(txn, origins, image, content_md, false).await?;
    bind_consumer(txn, "note_draft", doc_id.to_string(), &refs).await?;
    sync_note_history_refs(txn, doc_id, origins).await
}

pub async fn bind_note_published(
    txn: &impl ConnectionTrait,
    item_id: i32,
    image: Option<&str>,
    content_md: &str,
    origins: &[String],
) -> Result<(), MediaError> {
    let refs = references_from_fields(txn, origins, image, content_md, true).await?;
    bind_consumer(txn, "note_published", item_id.to_string(), &refs).await
}

pub async fn bind_persona(
    txn: &impl ConnectionTrait,
    portrait: Option<&str>,
    avatar: Option<&str>,
    visual_profile: Option<&Value>,
    origins: &[String],
) -> Result<(), MediaError> {
    let mut portrait_urls = Vec::new();
    if let Some(portrait) = portrait {
        portrait_urls.push(portrait.to_string());
    }
    if let Some(avatar) = avatar {
        portrait_urls.push(avatar.to_string());
    }
    let portrait_refs = references_from_urls(
        txn,
        origins,
        &portrait_urls,
        |i| format!("portrait:{i}"),
        false,
    )
    .await?;
    bind_consumer(txn, "persona_portrait", "persona", &portrait_refs).await?;
    let mut outfit_urls = Vec::new();
    if let Some(profile) = visual_profile {
        collect_strings(profile, &mut outfit_urls);
    }
    let outfit_refs =
        references_from_urls(txn, origins, &outfit_urls, |i| format!("outfit:{i}"), false).await?;
    bind_consumer(txn, "persona_outfit", "persona", &outfit_refs).await
}

fn collect_strings(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(text) => out.push(text.clone()),
        Value::Array(items) => {
            for item in items {
                collect_strings(item, out);
            }
        }
        Value::Object(map) => {
            for item in map.values() {
                collect_strings(item, out);
            }
        }
        _ => {}
    }
}

pub async fn bind_stickers(
    txn: &impl ConnectionTrait,
    layout: &str,
    origins: &[String],
) -> Result<(), MediaError> {
    let refs = references_from_fields(txn, origins, None, layout, false).await?;
    bind_consumer(txn, "sticker", "dashboard", &refs).await
}

pub async fn bind_ai_task(
    txn: &impl ConnectionTrait,
    task_id: &str,
    result: &Value,
    origins: &[String],
    expires_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<(), MediaError> {
    let mut urls = Vec::new();
    collect_strings(result, &mut urls);
    let mut refs = references_from_urls(txn, origins, &urls, |_| "result".into(), false).await?;
    for item in &mut refs {
        item.expires_at = expires_at;
    }
    bind_consumer(txn, "ai_task", task_id, &refs).await
}

pub async fn bind_channel_message(
    txn: &impl ConnectionTrait,
    consumer_id: &str,
    payload: &Value,
    origins: &[String],
) -> Result<(), MediaError> {
    let mut urls = Vec::new();
    collect_strings(payload, &mut urls);
    let refs = references_from_urls(txn, origins, &urls, |i| format!("inbound:{i}"), false).await?;
    bind_consumer(txn, "channel_message", consumer_id, &refs).await
}

pub async fn clear_note_doc(
    txn: &impl ConnectionTrait,
    doc_id: i32,
    item_id: Option<i32>,
) -> Result<(), MediaError> {
    replace_for_consumer(txn, "note_draft", &doc_id.to_string(), &[]).await?;
    clear_history_prefix(txn, doc_id).await?;
    if let Some(item_id) = item_id {
        replace_for_consumer(txn, "note_published", &item_id.to_string(), &[]).await?;
    }
    Ok(())
}

async fn sync_note_history_refs(
    txn: &impl ConnectionTrait,
    doc_id: i32,
    origins: &[String],
) -> Result<(), MediaError> {
    let rows = txn
        .query_all_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT revision, snapshot FROM phantasi_note_history WHERE doc_id = $1",
            [doc_id.into()],
        ))
        .await?;
    clear_history_prefix(txn, doc_id).await?;
    for row in rows {
        let revision: i64 = row.try_get("", "revision")?;
        let snapshot: Value = row.try_get("", "snapshot")?;
        let md = snapshot
            .get("content_md")
            .and_then(Value::as_str)
            .unwrap_or("");
        let image = snapshot.get("image").and_then(Value::as_str);
        let refs = references_from_fields(txn, origins, image, md, false).await?;
        replace_for_consumer(txn, "note_history", &format!("{doc_id}:{revision}"), &refs).await?;
    }
    Ok(())
}

async fn clear_history_prefix(txn: &impl ConnectionTrait, doc_id: i32) -> Result<(), MediaError> {
    let prefix = format!("{doc_id}:%");
    txn.execute_raw(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "DELETE FROM media_references WHERE consumer_type = 'note_history' AND consumer_id LIKE $1",
        [prefix.into()],
    ))
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_only_delimited_registered_paths() {
        let md = "see ![cover](/media/assets/11111111-1111-1111-1111-111111111111/a.png) and <img src=\"/api/phantasi/image-cache/aa/abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd.png\"> plus /media/assets/11111111-1111-1111-1111-111111111111/ignored.png in prose";
        let paths = extract_registered_paths(md, &[]);
        assert_eq!(
            paths,
            vec![
                "/media/assets/11111111-1111-1111-1111-111111111111/a.png".to_string(),
                "/api/phantasi/image-cache/aa/abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd.png"
                    .to_string()
            ]
        );
        assert!(
            extract_registered_paths(
                "![x](https://evil.example/media/assets/11111111-1111-1111-1111-111111111111/a.png)",
                &["https://site.example".into()]
            )
            .is_empty()
        );
    }
}
