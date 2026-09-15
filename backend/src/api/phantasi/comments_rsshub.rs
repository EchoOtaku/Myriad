//! Phantasi comments (annotations) and RSSHub instance admin.
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseBackend,
    DatabaseConnection, EntityTrait, QueryFilter, QueryOrder, QuerySelect, Statement,
    Value as SeaValue,
};
use serde::Deserialize;
use serde_json::json;

use crate::error::HttpError;
use crate::models::entities::{phantasi_comments, phantasi_items, phantasi_sources, rsshub_instances};
use crate::services::rsshub_service::RsshubService;

use super::helpers::{
    get_admin_user_id_from_headers, get_optional_user_and_admin_status, get_user_and_admin_status,
    get_user_id_from_headers, phantasi_http_err,
};

fn comment_is_public(requested: Option<bool>, inherited: Option<bool>) -> bool {
    requested.or(inherited).unwrap_or(true)
}

fn can_delete_comment(author_id: i32, user_id: i32, is_admin: bool) -> bool {
    is_admin || author_id == user_id
}

fn comment_not_found() -> HttpError {
    HttpError::from((
        StatusCode::NOT_FOUND,
        Json(myriad_error::AppError::fail_json("Comment not found")),
    ))
}

fn item_not_found() -> HttpError {
    HttpError::from((
        StatusCode::NOT_FOUND,
        Json(myriad_error::AppError::fail_json("Article not found")),
    ))
}

fn comments_only_on_notes() -> HttpError {
    phantasi_http_err(
        StatusCode::BAD_REQUEST,
        "Comments are only available on notes",
    )
}

async fn visible_source(
    db: &DatabaseConnection,
    item_id: i32,
    is_admin: bool,
) -> Result<(phantasi_items::Model, phantasi_sources::Model), HttpError> {
    let item = match phantasi_items::Entity::find_by_id(item_id).one(db).await {
        Ok(Some(item)) => item,
        _ => return Err(item_not_found()),
    };
    let source = match phantasi_sources::Entity::find_by_id(item.source_id)
        .one(db)
        .await
    {
        Ok(Some(source)) => source,
        _ => return Err(item_not_found()),
    };
    if source.admin_only && !is_admin {
        return Err(item_not_found());
    }
    Ok((item, source))
}

async fn visible_item(
    db: &DatabaseConnection,
    item_id: i32,
    is_admin: bool,
) -> Result<phantasi_items::Model, HttpError> {
    let (item, source) = visible_source(db, item_id, is_admin).await?;
    if source.source_type != phantasi_sources::SourceType::Note {
        return Err(comments_only_on_notes());
    }
    Ok(item)
}

async fn load_user_faces(
    db: &DatabaseConnection,
    ids: &[i32],
) -> std::collections::HashMap<i32, (Option<String>, Option<String>, Option<String>)> {
    let mut unique = ids.to_vec();
    unique.sort_unstable();
    unique.dedup();
    unique.retain(|id| *id > 0);
    if unique.is_empty() {
        return std::collections::HashMap::new();
    }
    let list = unique
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let rows = db
        .query_all_raw(Statement::from_string(
            DatabaseBackend::Postgres,
            format!(
                "SELECT id, username, display_name, avatar_url FROM users WHERE id IN ({list})"
            ),
        ))
        .await
        .unwrap_or_default();
    let mut faces = std::collections::HashMap::new();
    for row in rows {
        let Ok(id) = row.try_get::<i32>("", "id") else {
            continue;
        };
        faces.insert(
            id,
            (
                row.try_get::<String>("", "username").ok(),
                row.try_get::<String>("", "display_name").ok(),
                row.try_get::<String>("", "avatar_url").ok(),
            ),
        );
    }
    faces
}

fn apply_user_face(
    response: &mut phantasi_comments::CommentResponse,
    faces: &std::collections::HashMap<i32, (Option<String>, Option<String>, Option<String>)>,
) {
    if let Some((name, display, avatar)) = faces.get(&response.user_id) {
        response.user_name = name.clone();
        response.user_display_name = display.clone();
        response.user_avatar = avatar.clone();
    }
}

fn rsshub_mutate_error(error: String) -> HttpError {
    if error.starts_with("Failed to ") {
        return phantasi_http_err(StatusCode::INTERNAL_SERVER_ERROR, error);
    }
    if error == "Instance not found" {
        return phantasi_http_err(StatusCode::NOT_FOUND, error);
    }
    if error == "Permission denied" || error.starts_with("Only admins ") {
        return phantasi_http_err(StatusCode::FORBIDDEN, error);
    }
    phantasi_http_err(StatusCode::BAD_REQUEST, error)
}

// 用户评论（批注）

/// 文章下全部评论。能看见文章的人都能看。
pub(crate) async fn list_comments(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Path(item_id): Path<i32>,
) -> Result<Json<serde_json::Value>, HttpError> {
    let (_, is_admin) = get_optional_user_and_admin_status(&headers, &db).await?;
    let (_, source) = visible_source(&db, item_id, is_admin).await?;
    if source.source_type != phantasi_sources::SourceType::Note {
        return Ok(Json(
            json!({ "success": true, "comments": [], "has_comments": false }),
        ));
    }

    let comments = phantasi_comments::Entity::find()
        .filter(phantasi_comments::Column::ItemId.eq(item_id))
        .filter(phantasi_comments::Column::ParentId.is_null())
        .order_by_asc(phantasi_comments::Column::StartOffset)
        .all(&db)
        .await;

    match comments {
        Ok(comments) => {
            if comments.is_empty() {
                return Ok(Json(
                    json!({ "success": true, "comments": [], "has_comments": false }),
                ));
            }

            let comment_ids: Vec<i32> = comments.iter().map(|c| c.id).collect();
            let user_ids: Vec<i32> = comments.iter().map(|c| c.user_id).collect();
            let reply_counts: std::collections::HashMap<i32, i32> = phantasi_comments::Entity::find()
                .filter(phantasi_comments::Column::ParentId.is_in(comment_ids.clone()))
                .select_only()
                .column(phantasi_comments::Column::ParentId)
                .column_as(phantasi_comments::Column::Id.count(), "count")
                .group_by(phantasi_comments::Column::ParentId)
                .into_tuple::<(i32, i64)>()
                .all(&db)
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|(parent_id, count)| (parent_id, count as i32))
                .collect();
            let faces = load_user_faces(&db, &user_ids).await;

            let responses: Vec<phantasi_comments::CommentResponse> = comments
                .into_iter()
                .map(|comment| {
                    let mut response: phantasi_comments::CommentResponse = comment.clone().into();
                    response.reply_count = Some(*reply_counts.get(&comment.id).unwrap_or(&0));
                    apply_user_face(&mut response, &faces);
                    response
                })
                .collect();

            Ok(Json(json!({
                "success": true,
                "comments": responses,
                "has_comments": true
            })))
        }
        Err(error) => {
            tracing::error!(%error, "Failed to load comments");
            Err(phantasi_http_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load comments",
            ))
        }
    }
}

/// 创建评论
/// 仅登录用户可用
pub(crate) async fn create_comment(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Path(item_id): Path<i32>,
    Json(req): Json<phantasi_comments::CreateCommentRequest>,
) -> Result<Json<serde_json::Value>, HttpError> {
    // 验证用户身份
    let user_id = get_user_id_from_headers(&headers, &db).await?;

    let (_, is_admin) = get_user_and_admin_status(&headers, &db).await;
    let item = visible_item(&db, item_id, is_admin).await?;

    // 回复挂在同一篇文章的任意一条评论下；没写 color / is_public 时跟父评。
    let mut inherited_color: Option<String> = None;
    let mut inherited_is_public: Option<bool> = None;
    if let Some(parent_id) = req.parent_id {
        let parent = phantasi_comments::Entity::find_by_id(parent_id)
            .filter(phantasi_comments::Column::ItemId.eq(item_id))
            .one(&db)
            .await
            .ok()
            .flatten();

        let Some(parent) = parent else {
            return Err(comment_not_found());
        };
        inherited_color = parent.color.clone();
        inherited_is_public = Some(parent.is_public);
    }

    // 验证 color 格式（仅允许十六进制颜色）
    let validated_color = req
        .color
        .and_then(|c| {
            let color_regex =
                regex::Regex::new(r"^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$").ok()?;
            if color_regex.is_match(&c) {
                Some(c)
            } else {
                None
            }
        })
        .or(inherited_color);

    // 验证输入长度限制
    if req.comment.len() > 2000 {
        return Err(HttpError::from((
            StatusCode::BAD_REQUEST,
            Json(AppError::fail_json("Comment too long (max 2000 chars)")),
        )));
    }
    if req.selected_text.len() > 5000 {
        return Err(HttpError::from((
            StatusCode::BAD_REQUEST,
            Json(AppError::fail_json(
                "Selected text too long (max 5000 chars)",
            )),
        )));
    }

    let now = Utc::now();
    let new_comment = phantasi_comments::ActiveModel {
        item_id: Set(item_id),
        user_id: Set(user_id),
        selected_text: Set(req.selected_text),
        comment: Set(req.comment),
        start_offset: Set(req.start_offset),
        end_offset: Set(req.end_offset),
        context_before: Set(req.context_before),
        context_after: Set(req.context_after),
        color: Set(validated_color),
        is_public: Set(comment_is_public(req.is_public, inherited_is_public)),
        parent_id: Set(req.parent_id),
        content_revision: Set(Some(item.content_revision)),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
        ..Default::default()
    };

    match new_comment.insert(&db).await {
        Ok(comment) => {
            let mut response: phantasi_comments::CommentResponse = comment.clone().into();

            // 查询用户信息
            if let Ok(Some(user_row)) = db
                .query_one_raw(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    "SELECT username, display_name, avatar_url FROM users WHERE id = $1",
                    vec![SeaValue::Int(Some(comment.user_id))],
                ))
                .await
            {
                response.user_name = user_row.try_get::<String>("", "username").ok();
                response.user_display_name = user_row.try_get::<String>("", "display_name").ok();
                response.user_avatar = user_row.try_get::<String>("", "avatar_url").ok();
            }

            Ok(Json(json!({ "success": true, "comment": response })))
        }
        Err(error) => {
            tracing::error!(%error, "Failed to save comment");
            Err(phantasi_http_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to save comment",
            ))
        }
    }
}

/// 更新评论
/// 仅评论作者可用
pub(crate) async fn update_comment(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Path(comment_id): Path<i32>,
    Json(req): Json<phantasi_comments::UpdateCommentRequest>,
) -> Result<Json<serde_json::Value>, HttpError> {
    // 验证用户身份
    let user_id = get_user_id_from_headers(&headers, &db).await?;

    // 获取评论并验证所有权
    let comment = phantasi_comments::Entity::find_by_id(comment_id)
        .filter(phantasi_comments::Column::UserId.eq(user_id))
        .one(&db)
        .await;

    match comment {
        Ok(Some(comment)) => {
            let mut active: phantasi_comments::ActiveModel = comment.clone().into();

            if let Some(comment_text) = req.comment {
                if comment_text.len() > 2000 {
                    return Err(HttpError::from((
                        StatusCode::BAD_REQUEST,
                        Json(AppError::fail_json("Comment too long (max 2000 chars)")),
                    )));
                }
                active.comment = Set(comment_text);
            }
            if let Some(color) = req.color {
                // 验证 color 格式（仅允许十六进制颜色）
                let color_regex =
                    regex::Regex::new(r"^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$").ok();
                if color_regex.is_some_and(|r| r.is_match(&color)) {
                    active.color = Set(Some(color));
                }
            }
            if let Some(is_public) = req.is_public {
                active.is_public = Set(is_public);
            }
            active.updated_at = Set(Utc::now().into());

            match active.update(&db).await {
                Ok(updated) => {
                    let mut response: phantasi_comments::CommentResponse = updated.clone().into();

                    // 查询用户信息
                    if let Ok(Some(user_row)) = db
                        .query_one_raw(Statement::from_sql_and_values(
                            DatabaseBackend::Postgres,
                            "SELECT username, display_name, avatar_url FROM users WHERE id = $1",
                            vec![SeaValue::Int(Some(updated.user_id))],
                        ))
                        .await
                    {
                        response.user_name = user_row.try_get::<String>("", "username").ok();
                        response.user_display_name =
                            user_row.try_get::<String>("", "display_name").ok();
                        response.user_avatar = user_row.try_get::<String>("", "avatar_url").ok();
                    }

                    Ok(Json(json!({ "success": true, "comment": response })))
                }
                Err(error) => {
                    tracing::error!(%error, "Failed to update comment");
                    Err(phantasi_http_err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to update comment",
                    ))
                }
            }
        }
        Ok(None) => Err(HttpError::from((
            StatusCode::NOT_FOUND,
            Json(AppError::fail_json("Comment not found")),
        ))),
        Err(error) => {
            tracing::error!(%error, "Failed to find comment");
            Err(phantasi_http_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to find comment",
            ))
        }
    }
}

/// 删除评论。作者或站长。
pub(crate) async fn delete_comment(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Path(comment_id): Path<i32>,
) -> Result<Json<serde_json::Value>, HttpError> {
    let (user_id, is_admin) = get_user_and_admin_status(&headers, &db).await;
    let user_id = user_id.ok_or_else(|| {
        phantasi_http_err(StatusCode::UNAUTHORIZED, "Unauthorized")
    })?;

    let comment = phantasi_comments::Entity::find_by_id(comment_id)
        .one(&db)
        .await;

    match comment {
        Ok(Some(comment)) if can_delete_comment(comment.user_id, user_id, is_admin) => {
            // Cascade nested replies first (no DB self-FK on parent_id)
            if let Err(e) = phantasi_comments::Entity::delete_many()
                .filter(phantasi_comments::Column::ParentId.eq(comment_id))
                .exec(&db)
                .await
            {
                tracing::error!(%e, "Failed to delete comment replies");
                return Err(phantasi_http_err(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Failed to delete comment replies",
                ));
            }
            match phantasi_comments::Entity::delete_by_id(comment_id)
                .exec(&db)
                .await
            {
                Ok(_) => Ok(Json(json!({ "success": true }))),
                Err(error) => {
                    tracing::error!(%error, "Failed to delete comment");
                    Err(phantasi_http_err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Failed to delete comment",
                    ))
                }
            }
        }
        Ok(Some(_)) | Ok(None) => Err(comment_not_found()),
        Err(error) => {
            tracing::error!(%error, "Failed to find comment");
            Err(phantasi_http_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to find comment",
            ))
        }
    }
}

/// 某条评论下的全部回复。能看见文章就能看。
pub(crate) async fn list_comment_replies(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Path(comment_id): Path<i32>,
) -> Result<Json<serde_json::Value>, HttpError> {
    let (_, is_admin) = get_optional_user_and_admin_status(&headers, &db).await?;
    let parent = match phantasi_comments::Entity::find_by_id(comment_id)
        .one(&db)
        .await
    {
        Ok(Some(parent)) => parent,
        _ => return Err(comment_not_found()),
    };
    visible_item(&db, parent.item_id, is_admin).await?;

    let replies = phantasi_comments::Entity::find()
        .filter(phantasi_comments::Column::ParentId.eq(comment_id))
        .order_by_asc(phantasi_comments::Column::CreatedAt)
        .all(&db)
        .await;

    match replies {
        Ok(replies) => {
            if replies.is_empty() {
                return Ok(Json(json!({ "success": true, "replies": [] })));
            }

            let user_ids: Vec<i32> = replies.iter().map(|reply| reply.user_id).collect();
            let faces = load_user_faces(&db, &user_ids).await;
            let responses: Vec<phantasi_comments::CommentResponse> = replies
                .into_iter()
                .map(|reply| {
                    let mut response: phantasi_comments::CommentResponse = reply.into();
                    apply_user_face(&mut response, &faces);
                    response
                })
                .collect();

            Ok(Json(json!({ "success": true, "replies": responses })))
        }
        Err(error) => {
            tracing::error!(%error, "Failed to load comment replies");
            Err(phantasi_http_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load comment replies",
            ))
        }
    }
}

#[derive(Deserialize, Default)]
pub(crate) struct AdminCommentsQuery {
    q: Option<String>,
    source_id: Option<i32>,
    item_id: Option<i32>,
}

/// 工作台：全站评论。仅站长。
pub(crate) async fn list_admin_comments(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Query(query): Query<AdminCommentsQuery>,
) -> Result<Json<serde_json::Value>, HttpError> {
    get_admin_user_id_from_headers(&headers, &db).await?;

    let needle = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{text}%"));
    let rows = db
        .query_all_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
            SELECT
              c.id, c.item_id, c.user_id, c.selected_text, c.comment,
              c.start_offset, c.end_offset, c.context_before, c.context_after,
              c.color, c.is_public, c.parent_id, c.content_revision,
              c.created_at, c.updated_at,
              i.title AS item_title, i.source_id, s.name AS source_name,
              u.username, u.display_name, u.avatar_url
            FROM phantasi_comments c
            INNER JOIN phantasi_items i ON i.id = c.item_id
            INNER JOIN phantasi_sources s ON s.id = i.source_id
            INNER JOIN users u ON u.id = c.user_id
            WHERE ($1::text IS NULL
                OR c.comment ILIKE $1
                OR c.selected_text ILIKE $1
                OR i.title ILIKE $1
                OR COALESCE(u.display_name, u.username, '') ILIKE $1)
              AND s.source_type = 'note'
              AND ($2::int IS NULL OR i.source_id = $2)
              AND ($3::int IS NULL OR c.item_id = $3)
            ORDER BY c.created_at DESC
            LIMIT 200
            "#,
            vec![
                SeaValue::String(needle),
                SeaValue::Int(query.source_id),
                SeaValue::Int(query.item_id),
            ],
        ))
        .await
        .map_err(|error| {
            tracing::error!(%error, "Failed to load admin comments");
            phantasi_http_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load comments",
            )
        })?;

    let comments: Vec<phantasi_comments::CommentResponse> = rows
        .into_iter()
        .filter_map(|row| {
            let id = row.try_get::<i32>("", "id").ok()?;
            let item_id = row.try_get::<i32>("", "item_id").ok()?;
            let user_id = row.try_get::<i32>("", "user_id").ok()?;
            let created_at = row
                .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "created_at")
                .ok()?;
            let updated_at = row
                .try_get::<chrono::DateTime<chrono::FixedOffset>>("", "updated_at")
                .ok()?;
            Some(phantasi_comments::CommentResponse {
                id,
                item_id,
                user_id,
                user_name: row.try_get::<String>("", "username").ok(),
                user_display_name: row.try_get::<String>("", "display_name").ok(),
                user_avatar: row.try_get::<String>("", "avatar_url").ok(),
                selected_text: row
                    .try_get::<String>("", "selected_text")
                    .unwrap_or_default(),
                comment: row.try_get::<String>("", "comment").unwrap_or_default(),
                start_offset: row.try_get::<i32>("", "start_offset").ok(),
                end_offset: row.try_get::<i32>("", "end_offset").ok(),
                context_before: row.try_get::<String>("", "context_before").ok(),
                context_after: row.try_get::<String>("", "context_after").ok(),
                color: row.try_get::<String>("", "color").ok(),
                is_public: row.try_get::<bool>("", "is_public").unwrap_or(true),
                parent_id: row.try_get::<i32>("", "parent_id").ok(),
                content_revision: row.try_get::<i64>("", "content_revision").ok(),
                created_at: created_at.timestamp_millis(),
                updated_at: updated_at.timestamp_millis(),
                replies: None,
                reply_count: None,
                item_title: row.try_get::<String>("", "item_title").ok(),
                source_id: row.try_get::<i32>("", "source_id").ok(),
                source_name: row.try_get::<String>("", "source_name").ok(),
            })
        })
        .collect();

    Ok(Json(json!({ "success": true, "comments": comments })))
}

// RSSHub 实例管理

/// 获取 RSSHub 实例列表
pub(crate) async fn list_rsshub_instances(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, HttpError> {
    // 验证用户身份
    let user_id = get_user_id_from_headers(&headers, &db).await?;

    let rsshub_service = RsshubService::new(db);

    // 确保默认实例存在
    if let Err(e) = rsshub_service.ensure_default_instances().await {
        tracing::warn!("[RSSHub] Failed to ensure default instances: {}", e);
    }

    match rsshub_service.get_instances(Some(user_id)).await {
        Ok(instances) => {
            let responses: Vec<rsshub_instances::InstanceResponse> =
                instances.into_iter().map(|i| i.into()).collect();

            Ok(Json(json!({ "success": true, "instances": responses })))
        }
        Err(error) => {
            tracing::error!(%error, "Failed to fetch RSSHub instances");
            Err(phantasi_http_err(StatusCode::INTERNAL_SERVER_ERROR, error))
        }
    }
}

/// 添加 RSSHub 实例
#[derive(Deserialize)]
pub(crate) struct AddRsshubInstanceRequest {
    name: String,
    url: String,
    access_key: Option<String>,
    priority: Option<i32>,
}

pub(crate) async fn add_rsshub_instance(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Json(req): Json<AddRsshubInstanceRequest>,
) -> Result<Json<serde_json::Value>, HttpError> {
    // 验证用户身份
    let user_id = get_user_id_from_headers(&headers, &db).await?;
    let (_, is_admin) = get_user_and_admin_status(&headers, &db).await;

    let rsshub_service = RsshubService::new(db);

    match rsshub_service
        .add_instance(
            Some(user_id),
            req.name,
            req.url,
            req.access_key,
            req.priority,
            is_admin,
        )
        .await
    {
        Ok(instance) => {
            let response: rsshub_instances::InstanceResponse = instance.into();
            Ok(Json(json!({ "success": true, "instance": response })))
        }
        Err(error) => Err(rsshub_mutate_error(error)),
    }
}

/// 更新 RSSHub 实例
#[derive(Deserialize)]
pub(crate) struct UpdateRsshubInstanceRequest {
    name: Option<String>,
    url: Option<String>,
    access_key: Option<String>,
    priority: Option<i32>,
    enabled: Option<bool>,
}

pub(crate) async fn update_rsshub_instance(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Path(id): Path<i32>,
    Json(req): Json<UpdateRsshubInstanceRequest>,
) -> Result<Json<serde_json::Value>, HttpError> {
    // 验证用户身份
    let user_id = get_user_id_from_headers(&headers, &db).await?;
    let (_, is_admin) = get_user_and_admin_status(&headers, &db).await;

    let rsshub_service = RsshubService::new(db);

    match rsshub_service
        .update_instance(
            id,
            Some(user_id),
            req.name,
            req.url,
            req.access_key,
            req.priority,
            req.enabled,
            is_admin,
        )
        .await
    {
        Ok(instance) => {
            let response: rsshub_instances::InstanceResponse = instance.into();
            Ok(Json(json!({ "success": true, "instance": response })))
        }
        Err(error) => Err(rsshub_mutate_error(error)),
    }
}

/// 删除 RSSHub 实例
pub(crate) async fn delete_rsshub_instance(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, HttpError> {
    // 验证用户身份
    let user_id = get_user_id_from_headers(&headers, &db).await?;
    let (_, is_admin) = get_user_and_admin_status(&headers, &db).await;

    let rsshub_service = RsshubService::new(db);

    match rsshub_service
        .delete_instance(id, Some(user_id), is_admin)
        .await
    {
        Ok(()) => Ok(Json(json!({ "success": true }))),
        Err(error) => Err(rsshub_mutate_error(error)),
    }
}

/// 对单个实例执行健康检查
pub(crate) async fn health_check_rsshub_instance(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, HttpError> {
    // 验证用户身份
    let user_id = get_user_id_from_headers(&headers, &db).await?;

    let rsshub_service = RsshubService::new(db.clone());

    // 获取实例
    let instance = match rsshub_instances::Entity::find_by_id(id).one(&db).await {
        Ok(Some(i)) => i,
        Ok(None) => {
            return Err(HttpError::from((
                StatusCode::NOT_FOUND,
                Json(AppError::fail_json("Instance not found")),
            )));
        }
        Err(error) => {
            tracing::error!(%error, "Failed to find RSSHub instance");
            return Err(phantasi_http_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to find RSSHub instance",
            ));
        }
    };

    // 检查权限
    if instance.user_id != Some(user_id) && instance.user_id.is_some() {
        return Err(HttpError::from((
            StatusCode::FORBIDDEN,
            Json(AppError::fail_json("Permission denied")),
        )));
    }

    match rsshub_service.health_check(&instance).await {
        Ok(response_time) => Ok(Json(json!({
            "success": true,
            "healthy": true,
            "response_time_ms": response_time
        }))),
        Err(e) => Ok(Json(json!({
            "success": true,
            "healthy": false,
            "error": e
        }))),
    }
}

/// 重置实例统计
pub(crate) async fn reset_rsshub_instance(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, HttpError> {
    // 验证用户身份
    let user_id = get_user_id_from_headers(&headers, &db).await?;
    let (_, is_admin) = get_user_and_admin_status(&headers, &db).await;

    let rsshub_service = RsshubService::new(db);

    match rsshub_service
        .reset_instance_stats(id, Some(user_id), is_admin)
        .await
    {
        Ok(()) => Ok(Json(json!({ "success": true }))),
        Err(error) => Err(rsshub_mutate_error(error)),
    }
}

/// 对所有实例执行健康检查
pub(crate) async fn health_check_all_rsshub_instances(
    State(db): State<DatabaseConnection>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, HttpError> {
    // 验证用户身份
    let user_id = get_user_id_from_headers(&headers, &db).await?;

    let rsshub_service = RsshubService::new(db);

    match rsshub_service.check_all_instances(Some(user_id)).await {
        Ok(()) => Ok(Json(
            json!({ "success": true, "message": "Health check completed" }),
        )),
        Err(error) => {
            tracing::error!(%error, "Failed to check RSSHub instances");
            Err(phantasi_http_err(StatusCode::INTERNAL_SERVER_ERROR, error))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::helpers::build_feed_discovery_candidates;

    #[test]
    fn feed_discovery_candidates_cover_root_and_nested_paths() {
        let candidates = build_feed_discovery_candidates("example.com/blog").unwrap();

        assert_eq!(candidates.first().unwrap(), "https://example.com/blog");
        assert!(candidates.contains(&"https://example.com/blog/feed".to_string()));
        assert!(candidates.contains(&"https://example.com/rss.xml".to_string()));
    }

    #[test]
    fn feed_discovery_keeps_direct_feed_first_and_rejects_other_schemes() {
        let candidates = build_feed_discovery_candidates("https://example.com/feed.xml").unwrap();
        assert_eq!(candidates.first().unwrap(), "https://example.com/feed.xml");

        assert!(build_feed_discovery_candidates("ftp://example.com/feed.xml").is_err());
    }

    #[test]
    fn feed_discovery_rejects_empty_url() {
        assert!(build_feed_discovery_candidates("").is_err());
        assert!(build_feed_discovery_candidates("   ").is_err());
    }

    #[test]
    fn comments_only_attach_to_notes() {
        let src = include_str!("comments_rsshub.rs");
        assert!(src.contains("SourceType::Note"));
        assert!(src.contains("Comments are only available on notes"));
        assert!(src.contains("s.source_type = 'note'"));
    }

    #[test]
    fn comments_default_public_and_owner_or_admin_can_delete() {
        assert!(super::comment_is_public(None, None));
        assert!(!super::comment_is_public(Some(false), Some(true)));
        assert!(super::comment_is_public(None, Some(true)));
        assert!(super::can_delete_comment(3, 3, false));
        assert!(super::can_delete_comment(3, 9, true));
        assert!(!super::can_delete_comment(3, 9, false));
    }
}
use myriad_error::AppError;
