use super::super::HandlerContext;
use super::phantasi::phantasi_query_failed;
use crate::models::entities::{phantasi_items, phantasi_sources, phantasi_user_states};
use crate::services::agent::executor::utils::truncate_str;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde_json::{Value, json};
use std::collections::HashMap;

pub(super) async fn execute_phantasi_page_content(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    use crate::services::agent::executor::utils::{
        normalize_phantasi_category_filter, phantasi_category_token_matches,
    };

    let level = params
        .get("level")
        .and_then(|v| v.as_str())
        .unwrap_or("sources");
    let source_id = params.get("sourceId").and_then(|v| v.as_i64());
    let item_id = params.get("itemId").and_then(|v| v.as_str());
    let filter = params
        .get("filter")
        .and_then(|v| v.as_str())
        .unwrap_or("all");
    let category_filter = params
        .get("category")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(normalize_phantasi_category_filter);
    let limit = params.get("limit").and_then(|v| v.as_u64()).unwrap_or(20);

    match level {
        "sources" => {
            let sources = phantasi_sources::Entity::find()
                .order_by_desc(phantasi_sources::Column::UpdatedAt)
                .all(ctx.db)
                .await
                .map_err(|error| phantasi_query_failed("fetch phantasi sources", error))?;

            let filtered: Vec<&phantasi_sources::Model> = sources
                .iter()
                .filter(|s| {
                    let Some(ref cat) = category_filter else {
                        return true;
                    };
                    let ok = s
                        .category
                        .as_deref()
                        .map(|c| phantasi_category_token_matches(c, cat))
                        .unwrap_or(false);
                    // Same friend-link legacy fallback as phantasi.sources
                    if !ok && cat == "友情链接" {
                        s.source_type == phantasi_sources::SourceType::Link
                            && s.category
                                .as_deref()
                                .map(|c| c.trim().is_empty())
                                .unwrap_or(true)
                    } else {
                        ok
                    }
                })
                .collect();

            let source_list: Vec<Value> = filtered
                .iter()
                .map(|s| {
                    json!({
                        "id": s.id,
                        "name": s.name,
                        "url": s.url.clone(),
                        "siteUrl": s.site_url.clone(),
                        "icon": s.icon.clone(),
                        "category": s.category.clone(),
                        "sourceType": s.source_type.as_str(),
                        "unreadCount": s.unread_count,
                        "itemCount": s.item_count,
                        "lastUpdated": s.updated_at.to_string()
                    })
                })
                .collect();

            let title = category_filter.as_deref().unwrap_or("Feeds").to_string();

            Ok(json!({
                "level": "sources",
                "hierarchy": {
                    "level": "list",
                    "current": { "view": "all_sources" }
                },
                "content": {
                    "title": title,
                    "sources": source_list,
                    "metadata": {
                        "totalSources": filtered.len(),
                        "totalInSystem": sources.len(),
                        "category": category_filter.clone()
                    }
                },
                "stats": {
                    "totalSources": filtered.len(),
                    "totalItems": 0,
                    "unreadCount": 0
                },
                "navigation": {
                    "currentFilter": filter,
                    "category": category_filter,
                    "availableFilters": ["all", "unread", "starred", "today"],
                    "canGoBack": false,
                    "parentPath": "/"
                }
            }))
        }
        "items" => {
            let source_id = source_id.ok_or("Missing sourceId for items level")?;

            let source = phantasi_sources::Entity::find_by_id(source_id as i32)
                .one(ctx.db)
                .await
                .map_err(|error| phantasi_query_failed("fetch phantasi source", error))?
                .ok_or("Source not found")?;

            let items = phantasi_items::Entity::find()
                .filter(phantasi_items::Column::SourceId.eq(source_id as i32))
                .order_by_desc(phantasi_items::Column::PublishedAt)
                .all(ctx.db)
                .await
                .map_err(|error| phantasi_query_failed("fetch phantasi items", error))?;

            let item_list: Vec<Value> = items
                .iter()
                .take(limit as usize)
                .map(|item| {
                    json!({
                        "id": item.id,
                        "guid": item.guid.clone(),
                        "title": item.title.clone(),
                        "summary": item.summary.as_ref().map(|s| {
                            if s.len() > 200 { format!("{}...", truncate_str(s, 200)) } else { s.clone() }
                        }),
                        "link": item.link.clone(),
                        "author": item.author.clone(),
                        "publishedAt": item.published_at.to_string(),
                        "isRead": false,
                        "isStarred": false
                    })
                })
                .collect();

            Ok(json!({
                "level": "items",
                "hierarchy": {
                    "level": "nested",
                    "parent": {
                        "type": "source",
                        "id": source.id,
                        "name": source.name.clone()
                    },
                    "current": { "view": "item_list" }
                },
                "content": {
                    "title": source.name.clone(),
                    "items": item_list,
                    "metadata": {
                        "sourceId": source.id,
                        "totalItems": items.len()
                    }
                },
                "stats": {
                    "totalItems": items.len(),
                    "unreadCount": items.len(),
                    "starredCount": 0
                },
                "navigation": {
                    "currentFilter": filter,
                    "availableFilters": ["all", "unread", "starred"],
                    "canGoBack": true,
                    "parentPath": format!("/journal/feeds/{}", source.id)
                }
            }))
        }
        "detail" | "reader" => {
            let item_guid = item_id.ok_or("Missing itemId for detail/reader level")?;

            let item = phantasi_items::Entity::find()
                .filter(phantasi_items::Column::Guid.eq(item_guid))
                .one(ctx.db)
                .await
                .map_err(|error| phantasi_query_failed("fetch phantasi item", error))?
                .ok_or("Item not found")?;

            let source = phantasi_sources::Entity::find_by_id(item.source_id)
                .one(ctx.db)
                .await
                .map_err(|error| phantasi_query_failed("fetch phantasi source", error))?;

            let user_id = params
                .get("userId")
                .and_then(|v| v.as_i64())
                .map(|v| v as i32);

            let user_state = if let Some(uid) = user_id {
                phantasi_user_states::Entity::find()
                    .filter(phantasi_user_states::Column::UserId.eq(uid))
                    .filter(phantasi_user_states::Column::ItemId.eq(item.id))
                    .one(ctx.db)
                    .await
                    .ok()
                    .flatten()
            } else {
                None
            };

            let word_count = item.word_count.unwrap_or_else(|| {
                item.content
                    .as_ref()
                    .map(|c| c.chars().count() as i32)
                    .unwrap_or(0)
            });
            let reading_time = item
                .reading_time
                .unwrap_or_else(|| (word_count as f32 / 500.0).ceil() as i32);

            Ok(json!({
                "level": "reader",
                "hierarchy": {
                    "level": "detail",
                    "parent": {
                        "type": "source",
                        "id": item.source_id,
                        "name": source.as_ref().map(|s| s.name.clone())
                    },
                    "current": {
                        "type": "item",
                        "id": item.id,
                        "guid": item.guid.clone()
                    }
                },
                "content": {
                    "title": item.title.clone(),
                    "article": {
                        "id": item.id,
                        "guid": item.guid.clone(),
                        "title": item.title.clone(),
                        "content": item.content.clone(),
                        "summary": item.summary.clone(),
                        "link": item.link.clone(),
                        "author": item.author.clone(),
                        "image": item.image.clone(),
                        "publishedAt": item.published_at.to_string(),
                        "wordCount": word_count,
                        "readingTime": reading_time,
                        "fulltextFetched": item.fulltext_fetched,
                        "audioUrl": item.audio_url.clone(),
                        "videoUrl": item.video_url.clone()
                    },
                    "source": source.as_ref().map(|s| json!({
                        "id": s.id,
                        "name": s.name.clone(),
                        "icon": s.icon.clone(),
                        "siteUrl": s.site_url.clone(),
                        "sourceType": format!("{:?}", s.source_type)
                    }))
                },
                "readerState": {
                    "isRead": user_state.as_ref().map(|s| s.is_read).unwrap_or(false),
                    "isStarred": user_state.as_ref().map(|s| s.is_starred).unwrap_or(false),
                    "readProgress": user_state.as_ref().and_then(|s| s.read_progress),
                    "readAt": user_state.as_ref().and_then(|s| s.read_at.map(|t| t.to_string())),
                    "notes": user_state.as_ref().and_then(|s| s.notes.clone())
                },
                "navigation": {
                    "canGoBack": true,
                    "parentPath": format!("/journal/feeds/{}", item.source_id)
                },
                "actions": {
                    "available": [
                        "markAsRead", "toggleStar", "updateProgress",
                        "addNote", "fetchFulltext", "shareArticle"
                    ]
                }
            }))
        }
        _ => Err(format!("Unknown phantasi page level: {}", level)),
    }
}

// Tapp 页面内容

pub(super) async fn execute_tapp_page_content(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    super::super::ui_control::execute_tapp_page_content(params, ctx).await
}
