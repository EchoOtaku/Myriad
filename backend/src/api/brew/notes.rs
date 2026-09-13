//! 手记：站长自己写的 Markdown 内容。
//!
//! 手记不是第二套文章系统 —— 它就是 `brew_items` 里的一条，挂在一个
//! `source_type = note` 的本地源下面。这样阅读器、评论、AI 注释、播客、收藏、
//! 已读、sitemap、联邦投递和 Agent 的 brew 技能全部零改动生效。
//!
//! 与抓来的文章只有两点不同：
//! - `content_md` 有值（原文），`content` 是它渲染并消毒之后的 HTML
//! - `guid` 是平台生成的 `note:<uuid>`，没有上游 feed
//!
//! 渲染只在写入这一侧发生。读路径永远读 `content`，绝不在渲染一次 ——
//! 否则阅读器、RSS、联邦三处会各自拿到一份不同的 HTML。

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{TimeZone, Utc};
use myriad_brew_notes::{render_markdown, validate_note};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, PaginatorTrait, QueryFilter,
    Set,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::helpers::{brew_http_err, brew_store_http, get_admin_user_id_from_headers};
use crate::error::HttpError;
use crate::models::entities::{brew_items, brew_note_docs, brew_sources};

/// 手记源的固定名字。和分类「我」一样是**数据值**而不是界面文案 ——
/// 站长可以像改任何订阅源一样把它改掉，改了也不影响这里的查找（按
/// `source_type` 找，不按名字找）。
const NOTE_SOURCE_NAME: &str = "手记";

/// 手记源的 URL。调度器按 `source_type` 跳过抓取。
const NOTE_SOURCE_URL: &str = "myriad:notes";

/// 手记落在「我」分类下 —— 这是站内唯一可做文章级 SEO 的分类。
/// 直接引用 `api::seo` 的那份取值，不另抄一个字面量。
use crate::api::seo::BREW_MINE_CATEGORY as NOTE_SOURCE_CATEGORY;

#[derive(Debug, Deserialize)]
pub(crate) struct NoteWriteRequest {
    pub title: String,
    /// Markdown 原文。字段名与 `brew_items.content_md` 同名。
    #[serde(default)]
    pub content_md: String,
    /// 主题字符串。留空则存 NULL。
    #[serde(default)]
    pub topic: Option<String>,
    /// 封面。不给就用正文里第一张图。
    #[serde(default)]
    pub image: Option<String>,
    /// 发布时间（毫秒）。不给就用当前时间；改稿时不给则保持原值。
    #[serde(default)]
    pub published_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct NotePreviewRequest {
    #[serde(default)]
    pub content_md: String,
}

/// 编辑器要读回的那份原文。比 `ItemResponse` 多一个 `content_md`，
/// 少掉所有阅读态字段 —— 这个响应只服务编辑器。
#[derive(Debug, Serialize)]
pub(crate) struct NoteDraftResponse {
    pub id: i32,
    pub title: String,
    pub content_md: String,
    pub topic: Option<String>,
    pub image: Option<String>,
    pub published_at: i64,
}

fn validation_err(err: myriad_brew_notes::NoteError) -> HttpError {
    brew_http_err(StatusCode::BAD_REQUEST, err.message())
}

/// 校验这条 item 确实是该站长的手记。
///
/// 两道关都要过：源属于当前用户，且源确实是手记源。少了第二道，这些接口就
/// 变成了「可以改任何抓来的文章」的后门。
async fn find_own_note(
    db: &DatabaseConnection,
    user_id: i32,
    item_id: i32,
) -> Result<(brew_items::Model, brew_sources::Model), HttpError> {
    let item = brew_items::Entity::find_by_id(item_id)
        .one(db)
        .await
        .map_err(|e| brew_store_http("find note", e))?
        .ok_or_else(|| brew_http_err(StatusCode::NOT_FOUND, "Note not found"))?;

    let source = brew_sources::Entity::find_by_id(item.source_id)
        .filter(brew_sources::Column::UserId.eq(user_id))
        .filter(brew_sources::Column::SourceType.eq(brew_sources::SourceType::Note))
        .one(db)
        .await
        .map_err(|e| brew_store_http("find note source", e))?
        .ok_or_else(|| brew_http_err(StatusCode::NOT_FOUND, "Note not found"))?;

    Ok((item, source))
}

fn millis_to_datetime(ms: i64) -> Option<chrono::DateTime<Utc>> {
    Utc.timestamp_millis_opt(ms).single()
}

/// 维护源上的条目计数缓存。手记不走抓取路径，没人替它更新这个数。
async fn sync_item_count(db: &DatabaseConnection, source: &brew_sources::Model) {
    let count = brew_items::Entity::find()
        .filter(brew_items::Column::SourceId.eq(source.id))
        .count(db)
        .await
        .unwrap_or(0);
    let mut active: brew_sources::ActiveModel = source.clone().into();
    active.item_count = Set(i32::try_from(count).unwrap_or(i32::MAX));
    active.updated_at = Set(Utc::now().into());
    if let Err(error) = active.update(db).await {
        tracing::warn!(%error, source_id = source.id, "failed to sync note item count");
    }
}

/// `POST /api/brew/notes/preview` — 编辑器预览。
///
/// 预览调 `render_markdown`；发布调 `render_note`（内部仍用 `render_markdown`）。前端不自己渲染。
pub(crate) async fn preview_note(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Json(req): Json<NotePreviewRequest>,
) -> Result<Json<serde_json::Value>, HttpError> {
    get_admin_user_id_from_headers(&headers, &db).await?;
    validate_note("Preview", &req.content_md).map_err(validation_err)?;
    Ok(Json(json!({
        "success": true,
        "html": render_markdown(&req.content_md),
    })))
}

/// `GET /api/brew/notes/{id}` — 取回原文供编辑。
pub(crate) async fn get_note_draft(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, HttpError> {
    let user_id = get_admin_user_id_from_headers(&headers, &db).await?;
    let (item, _) = find_own_note(&db, user_id, id).await?;

    Ok(Json(json!({
        "success": true,
        "note": NoteDraftResponse {
            id: item.id,
            title: item.title,
            content_md: item.content_md.unwrap_or_default(),
            topic: item.topic,
            image: item.image,
            published_at: item.published_at.timestamp_millis(),
        },
    })))
}

/// `POST /api/brew/notes` — 写一篇手记。
pub(crate) async fn create_note(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Json(req): Json<NoteWriteRequest>,
) -> Result<Json<serde_json::Value>, HttpError> {
    let user_id = get_admin_user_id_from_headers(&headers, &db).await?;
    let item = crate::services::note_publish::write_published_item(
        &db,
        user_id,
        None,
        &req.title,
        &req.content_md,
        req.topic.clone(),
        req.image.clone(),
        req.published_at,
    )
    .await?;
    let _ = crate::services::note_publish::upsert_doc_for_published_item(
        &db,
        user_id,
        &item,
        &req.title,
        &req.content_md,
        req.topic.clone(),
        req.image.clone(),
        req.published_at,
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "id": item.id,
        "link": item.link,
    })))
}

/// `PUT /api/brew/notes/{id}` — 改一篇手记。
pub(crate) async fn update_note(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Path(id): Path<i32>,
    Json(req): Json<NoteWriteRequest>,
) -> Result<Json<serde_json::Value>, HttpError> {
    let user_id = get_admin_user_id_from_headers(&headers, &db).await?;
    let (item, _) = find_own_note(&db, user_id, id).await?;
    let item = crate::services::note_publish::write_published_item(
        &db,
        user_id,
        Some(item.id),
        &req.title,
        &req.content_md,
        req.topic.clone(),
        req.image.clone(),
        req.published_at,
    )
    .await?;
    let _ = crate::services::note_publish::upsert_doc_for_published_item(
        &db,
        user_id,
        &item,
        &req.title,
        &req.content_md,
        req.topic.clone(),
        req.image.clone(),
        req.published_at,
    )
    .await;

    Ok(Json(json!({
        "success": true,
        "id": item.id,
        "link": item.link,
    })))
}

/// `DELETE /api/brew/notes/{id}` — 删一篇手记。
pub(crate) async fn delete_note(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, HttpError> {
    let user_id = get_admin_user_id_from_headers(&headers, &db).await?;
    let (item, source) = find_own_note(&db, user_id, id).await?;

    brew_items::Entity::delete_by_id(item.id)
        .exec(&db)
        .await
        .map_err(|e| brew_store_http("delete note", e))?;
    brew_note_docs::Entity::delete_many()
        .filter(brew_note_docs::Column::ItemId.eq(item.id))
        .exec(&db)
        .await
        .map_err(|e| brew_store_http("delete note doc", e))?;

    sync_item_count(&db, &source).await;

    Ok(Json(json!({ "success": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_source_lands_in_the_own_content_category() {
        // 手记必须落在「我」分类下，否则 api::seo 不会把它当自有内容收录。
        // 手记板块按 `source_type = note` 取。
        assert_eq!(NOTE_SOURCE_CATEGORY, "我");
    }

    #[test]
    fn note_source_url_is_not_fetchable() {
        // 非 http(s)：即便某天有人漏掉了 source_type 判断，抓取也发不出请求
        assert!(!NOTE_SOURCE_NAME.is_empty());
        assert!(!NOTE_SOURCE_URL.starts_with("http"));
    }

    #[test]
    fn millis_round_trip() {
        let ms = 1_700_000_000_000;
        assert_eq!(millis_to_datetime(ms).unwrap().timestamp_millis(), ms);
    }

    #[test]
    fn absurd_millis_are_rejected_rather_than_panicking() {
        assert!(millis_to_datetime(i64::MAX).is_none());
    }

    #[test]
    fn public_item_list_does_not_read_note_docs() {
        let src = include_str!("feeds_articles.rs");
        let start = src
            .find("pub(crate) async fn list_items")
            .expect("list_items");
        let body = &src[start..];
        let end = body[1..]
            .find("\npub(crate) async fn ")
            .map(|index| index + 1)
            .unwrap_or(body.len());
        let list = &body[..end];
        assert!(list.contains("brew_items"));
        assert!(
            !list.contains("brew_note_docs"),
            "drafts must not leak into the public item list"
        );
    }
}
