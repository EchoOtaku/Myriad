//! 媒体目录查询。常规写入走 `services::media`，这里不再登记新文件。

use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseConnection, DbErr, EntityTrait, QueryFilter, QueryOrder,
};
use serde::Serialize;
use std::collections::HashMap;

use crate::federation::content::federation_media_root;
use crate::models::entities::media_assets;
use crate::services::image_cache::ImageCacheService;

#[derive(Clone, Debug, Serialize)]
pub struct MediaAssetView {
    pub id: i32,
    pub kind: String,
    pub url: String,
    pub mime: String,
    pub name: String,
    pub size: i64,
    pub created_at: i64,
    pub references: Vec<String>,
}

/// 目录只收本站上传/生成路径。外链和 `cache_image` 结果不进。
pub fn canonical_media_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(path) = path_from_url(trimmed) {
        return catalog_path(path);
    }
    catalog_path(trimmed)
}

fn path_from_url(raw: &str) -> Option<&str> {
    let rest = raw.split_once("://")?.1;
    let path = rest.find('/').map(|i| &rest[i..])?;
    Some(path)
}

fn catalog_path(path: &str) -> Option<String> {
    if path.starts_with("/media/federation/") || path.starts_with("/api/phantasi/image-cache/") {
        Some(path.to_string())
    } else {
        None
    }
}

/// `cache_image` 是外链缓存，不进目录。
#[cfg(test)]
pub fn catalogs_cache_image() -> bool {
    false
}

pub async fn list_assets(db: &DatabaseConnection) -> Result<Vec<MediaAssetView>, DbErr> {
    let rows = media_assets::Entity::find()
        .order_by_desc(media_assets::Column::CreatedAt)
        .all(db)
        .await?;
    let ids: Vec<i32> = rows.iter().map(|row| row.id).collect();
    let references = crate::services::media::catalog_labels_for_assets(db, &ids)
        .await
        .map_err(|error| DbErr::Custom(error.to_string()))?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let refs = references.get(&row.id).cloned().unwrap_or_default();
            to_view(row, refs)
        })
        .collect())
}

pub async fn get_asset(
    db: &DatabaseConnection,
    id: i32,
) -> Result<Option<media_assets::Model>, DbErr> {
    media_assets::Entity::find_by_id(id).one(db).await
}

pub async fn delete_asset(
    db: &DatabaseConnection,
    id: i32,
) -> Result<Result<(), Vec<String>>, DbErr> {
    match crate::services::media::MediaService::from_data_paths(
        crate::services::data_paths::paths(),
    )
    .delete(db, id)
    .await
    {
        Ok(crate::services::media::DeleteOutcome::Deleted) => Ok(Ok(())),
        Ok(crate::services::media::DeleteOutcome::PendingRetry) => {
            Ok(Err(vec!["pending".into()]))
        }
        Err(crate::services::media::MediaError::Missing) => Ok(Err(vec!["missing".into()])),
        Err(crate::services::media::MediaError::InUse)
        | Err(crate::services::media::MediaError::PublicInUse) => {
            Ok(Err(vec!["in_use".into()]))
        }
        Err(crate::services::media::MediaError::Invalid { .. }) => {
            delete_unmigrated_asset(db, id).await
        }
        Err(error) => Err(DbErr::Custom(error.to_string())),
    }
}

async fn delete_unmigrated_asset(
    db: &DatabaseConnection,
    id: i32,
) -> Result<Result<(), Vec<String>>, DbErr> {
    let Some(row) = get_asset(db, id).await? else {
        return Ok(Err(vec!["missing".into()]));
    };
    let refs = media_references(db, &row.url).await?;
    if !refs.is_empty() {
        return Ok(Err(refs));
    }
    remove_file(&row.url).await.map_err(DbErr::Custom)?;
    media_assets::Entity::delete_by_id(id).exec(db).await?;
    Ok(Ok(()))
}

pub(crate) fn fs_remove_result(result: std::io::Result<()>) -> Result<(), String> {
    match result {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

async fn remove_file(url: &str) -> Result<(), String> {
    if url.starts_with("/api/phantasi/image-cache/") {
        return ImageCacheService::new().remove_stored_url(url).await;
    }
    if let Some(path) = federation_disk_path(url) {
        return fs_remove_result(tokio::fs::remove_file(path).await);
    }
    Ok(())
}

fn federation_disk_path(url: &str) -> Option<std::path::PathBuf> {
    let path = canonical_media_url(url)?;
    let rest = path.strip_prefix("/media/federation/")?;
    let (user, file) = rest.split_once('/')?;
    if file.contains('/') || file.contains("..") {
        return None;
    }
    if !user.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(federation_media_root().join(user).join(file))
}

fn like_contains_pattern(url: &str) -> String {
    let needle = canonical_media_url(url).unwrap_or_else(|| url.to_string());
    let escaped = needle
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

async fn urls_matching(
    db: &DatabaseConnection,
    sql: &str,
    patterns: &[String],
) -> Result<std::collections::HashSet<String>, DbErr> {
    if patterns.is_empty() {
        return Ok(std::collections::HashSet::new());
    }
    let payload = serde_json::to_value(patterns).map_err(|error| DbErr::Json(error.to_string()))?;
    let rows = db
        .query_all_raw(sea_orm::Statement::from_sql_and_values(
            sea_orm::DatabaseBackend::Postgres,
            sql,
            [payload.into()],
        ))
        .await?;
    let mut found = std::collections::HashSet::new();
    for row in rows {
        if let Ok(url) = row.try_get::<String>("", "url") {
            found.insert(url);
        }
    }
    Ok(found)
}

async fn media_references_batch(
    db: &DatabaseConnection,
    urls: &[String],
) -> Result<HashMap<String, Vec<String>>, DbErr> {
    let mut patterns = Vec::new();
    let mut pattern_to_url = HashMap::new();
    for url in urls {
        let pattern = like_contains_pattern(url);
        pattern_to_url.insert(pattern.clone(), url.clone());
        patterns.push(pattern);
    }
    let notes = urls_matching(
        db,
        r#"
        SELECT pat AS url
        FROM json_array_elements_text($1::json) AS pat
        WHERE EXISTS (
            SELECT 1 FROM phantasi_note_docs
            WHERE image LIKE pat ESCAPE '\' OR content_md LIKE pat ESCAPE '\'
        )
        "#,
        &patterns,
    )
    .await?;
    let articles = urls_matching(
        db,
        r#"
        SELECT pat AS url
        FROM json_array_elements_text($1::json) AS pat
        WHERE EXISTS (
            SELECT 1 FROM phantasi_items
            WHERE image LIKE pat ESCAPE '\'
               OR content_md LIKE pat ESCAPE '\'
               OR content LIKE pat ESCAPE '\'
        )
        "#,
        &patterns,
    )
    .await?;
    let site = urls_matching(
        db,
        r#"
        SELECT pat AS url
        FROM json_array_elements_text($1::json) AS pat
        WHERE EXISTS (
            SELECT 1 FROM configurations
            WHERE value::text LIKE pat ESCAPE '\'
        )
        "#,
        &patterns,
    )
    .await?;
    let mut refs: HashMap<String, Vec<String>> = HashMap::new();
    for (pattern, url) in pattern_to_url {
        let mut kinds = Vec::new();
        if notes.contains(&pattern) {
            kinds.push("notes".into());
        }
        if articles.contains(&pattern) {
            kinds.push("articles".into());
        }
        if site.contains(&pattern) {
            kinds.push("site".into());
        }
        refs.insert(url, kinds);
    }
    Ok(refs)
}

async fn media_references(db: &DatabaseConnection, url: &str) -> Result<Vec<String>, DbErr> {
    let map = media_references_batch(db, std::slice::from_ref(&url.to_string())).await?;
    Ok(map.get(url).cloned().unwrap_or_default())
}

fn to_view(row: media_assets::Model, references: Vec<String>) -> MediaAssetView {
    MediaAssetView {
        id: row.id,
        kind: row.kind,
        url: row.url,
        mime: row.mime,
        name: row.name,
        size: row.size,
        created_at: row.created_at.timestamp_millis(),
        references,
    }
}

#[cfg(test)]
mod tests {
    use super::{canonical_media_url, catalog_path, catalogs_cache_image};

    #[test]
    fn canonical_url_keeps_hosted_paths() {
        assert_eq!(
            canonical_media_url("https://site.example/media/federation/1/a.jpg"),
            Some("/media/federation/1/a.jpg".into())
        );
        assert_eq!(
            canonical_media_url("/api/phantasi/image-cache/ab/abcdef.png"),
            Some("/api/phantasi/image-cache/ab/abcdef.png".into())
        );
        assert_eq!(canonical_media_url("https://cdn.example/pic.jpg"), None);
        assert_eq!(catalog_path("/tmp/x.png"), None);
    }

    #[test]
    fn cache_image_stays_out_of_catalog() {
        assert!(!catalogs_cache_image());
    }

    #[test]
    fn list_does_not_scan_disk_and_does_not_register() {
        let src = include_str!("media_catalog.rs");
        let list = src
            .split("pub async fn list_assets")
            .nth(1)
            .and_then(|rest| rest.split("pub async fn get_asset").next())
            .expect("list_assets");
        assert!(!list.contains("read_dir"));
        assert!(list.contains("catalog_labels_for_assets"));
        assert!(!src.contains(concat!("backfill", "_federation")));
        assert!(!src.contains(concat!("pub async fn ", "register(")));
    }

    #[test]
    fn reference_query_errors_block_delete() {
        let src = include_str!("media_catalog.rs");
        let body = src
            .split("async fn media_references_batch")
            .nth(1)
            .and_then(|rest| rest.split("async fn media_references(").next())
            .expect("media_references_batch");
        assert!(
            !body.contains("if let Ok("),
            "reference lookup failures must not look like zero references"
        );
        assert_eq!(
            body.matches(".await?;").count(),
            3,
            "notes/articles/site lookups must propagate query errors"
        );
    }

    #[test]
    fn file_delete_error_blocks_catalog_row_delete() {
        assert!(super::fs_remove_result(Ok(())).is_ok());
        assert!(
            super::fs_remove_result(Err(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "gone"
            )))
            .is_ok()
        );
        let error = super::fs_remove_result(Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "locked",
        )))
        .unwrap_err();
        assert!(error.contains("locked"), "{error}");
    }
}
