//! 数据写入能力处理器
//!
//! 处理 platform.write, brew.subscribe, brew.mark 等写入类能力

use super::HandlerContext;
use crate::models::entities::{brew_items, brew_sources, brew_user_states, tapp_storage};
use crate::services::brew_parser::FeedParser;
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter,
};
use serde_json::{json, Value};
use std::collections::HashMap;

/// 执行数据写入能力
pub async fn execute(
    capability_id: &str,
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    match capability_id {
        "platform.write" => execute_platform_write(params).await,
        "platform.refresh" => execute_platform_refresh(params).await,
        "storage.set" => execute_storage_set(params).await,
        "tapp.storage" => execute_tapp_storage(params, ctx).await,
        "brew.subscribe" => execute_brew_subscribe(params, ctx).await,
        "brew.mark" => execute_brew_mark(params, ctx).await,
        "content.write" => execute_content_write(params, ctx).await,
        _ => Err(format!("Unknown data_write capability: {}", capability_id)),
    }
}

// ============================================================================
// Platform 相关
// ============================================================================

async fn execute_platform_write(params: &HashMap<String, Value>) -> Result<Value, String> {
    let platform = params
        .get("platform")
        .and_then(|v| v.as_str())
        .ok_or("Missing platform parameter")?;

    let items = params.get("items").ok_or("Missing items parameter")?;

    let cache_file = format!("cache/platforms/{}_filtered.json", platform.to_lowercase());

    // 读取现有数据
    let mut data: Value = tokio::fs::read_to_string(&cache_file)
        .await
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(json!({"items": []}));

    // 追加新数据
    if let Some(existing_items) = data.get_mut("items").and_then(|v| v.as_array_mut()) {
        if let Some(new_items) = items.as_array() {
            existing_items.extend(new_items.clone());
        }
    }

    // 写入文件
    tokio::fs::write(&cache_file, serde_json::to_string_pretty(&data).unwrap())
        .await
        .map_err(|e| format!("Failed to write data: {}", e))?;

    Ok(json!({
        "success": true,
        "platform": platform
    }))
}

async fn execute_platform_refresh(params: &HashMap<String, Value>) -> Result<Value, String> {
    let platform = params
        .get("platform")
        .and_then(|v| v.as_str())
        .ok_or("Missing platform parameter")?;

    let platforms_to_refresh = if platform == "all" {
        vec!["steam", "bilibili", "github", "netease"]
    } else {
        vec![platform]
    };

    let mut results = Vec::new();
    for p in platforms_to_refresh {
        results.push(json!({
            "platform": p,
            "status": "queued",
            "message": format!("Refresh task queued for {}", p)
        }));
    }

    Ok(json!({
        "success": true,
        "message": format!("Refresh triggered for {} platform(s)", results.len()),
        "results": results,
        "note": "Actual data fetching requires fetcher service integration"
    }))
}

// ============================================================================
// Storage 相关
// ============================================================================

async fn execute_storage_set(_params: &HashMap<String, Value>) -> Result<Value, String> {
    Ok(json!({ "success": true }))
}

async fn execute_tapp_storage(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let tapp_id = params
        .get("tappId")
        .and_then(|v| v.as_str())
        .ok_or("Missing tappId")?;
    let action = params
        .get("action")
        .and_then(|v| v.as_str())
        .ok_or("Missing action")?;
    let key = params.get("key").and_then(|v| v.as_str());
    let value = params.get("value");
    let user_id = ctx.user_id;

    match action {
        "get" => {
            if let Some(key) = key {
                let result = tapp_storage::Entity::find()
                    .filter(tapp_storage::Column::TappId.eq(tapp_id))
                    .filter(tapp_storage::Column::Key.eq(key))
                    .filter(tapp_storage::Column::UserId.eq(user_id))
                    .one(ctx.db)
                    .await
                    .map_err(|e| format!("Database error: {}", e))?;

                Ok(json!({
                    "success": true,
                    "key": key,
                    "value": result.map(|r| r.value)
                }))
            } else {
                let results = tapp_storage::Entity::find()
                    .filter(tapp_storage::Column::TappId.eq(tapp_id))
                    .filter(tapp_storage::Column::UserId.eq(user_id))
                    .all(ctx.db)
                    .await
                    .map_err(|e| format!("Database error: {}", e))?;

                let data: HashMap<String, Value> =
                    results.into_iter().map(|r| (r.key, r.value)).collect();

                Ok(json!({
                    "success": true,
                    "data": data
                }))
            }
        }
        "set" => {
            let key = key.ok_or("Missing key for set action")?;
            let value = value.ok_or("Missing value for set action")?.clone();
            let now = Utc::now();

            let existing = tapp_storage::Entity::find()
                .filter(tapp_storage::Column::TappId.eq(tapp_id))
                .filter(tapp_storage::Column::Key.eq(key))
                .filter(tapp_storage::Column::UserId.eq(user_id))
                .one(ctx.db)
                .await
                .map_err(|e| format!("Database error: {}", e))?;

            if let Some(record) = existing {
                let mut active: tapp_storage::ActiveModel = record.into();
                active.value = Set(value.clone());
                active.updated_at = Set(now.into());
                active
                    .update(ctx.db)
                    .await
                    .map_err(|e| format!("Failed to update storage: {}", e))?;
            } else {
                let new_record = tapp_storage::ActiveModel {
                    tapp_id: Set(tapp_id.to_string()),
                    user_id: Set(user_id),
                    key: Set(key.to_string()),
                    value: Set(value.clone()),
                    created_at: Set(now.into()),
                    updated_at: Set(now.into()),
                    ..Default::default()
                };
                new_record
                    .insert(ctx.db)
                    .await
                    .map_err(|e| format!("Failed to insert storage: {}", e))?;
            }

            Ok(json!({
                "success": true,
                "key": key,
                "value": value
            }))
        }
        "delete" => {
            let key = key.ok_or("Missing key for delete action")?;

            let result = tapp_storage::Entity::delete_many()
                .filter(tapp_storage::Column::TappId.eq(tapp_id))
                .filter(tapp_storage::Column::Key.eq(key))
                .filter(tapp_storage::Column::UserId.eq(user_id))
                .exec(ctx.db)
                .await
                .map_err(|e| format!("Database error: {}", e))?;

            Ok(json!({
                "success": true,
                "key": key,
                "deleted": result.rows_affected > 0
            }))
        }
        _ => Err(format!("Unknown storage action: {}", action)),
    }
}

// ============================================================================
// Brew 相关
// ============================================================================

/// 执行订阅源添加 - 支持智能尝试多个源
async fn execute_brew_subscribe(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let user_id = ctx.user_id;
    
    // 调试：打印收到的参数
    tracing::debug!(
        params_keys = ?params.keys().collect::<Vec<_>>(),
        "[Brew Subscribe] 收到的参数"
    );

    let custom_name = params.get("name").and_then(|v| v.as_str());
    let category = params.get("category").and_then(|v| v.as_str());
    let update_interval = params
        .get("updateInterval")
        .and_then(|v| v.as_i64())
        .unwrap_or(30) as i32;

    // 收集要尝试的 URL 列表
    let urls_to_try: Vec<(String, Option<String>)> = if let Some(feeds) = params.get("feeds") {
        tracing::debug!(feeds = ?feeds, "[Brew Subscribe] 从 feeds 参数提取 URL");
        // 从 feeds 数组中提取 URL，按优先级排序
        extract_and_prioritize_feeds(feeds)
    } else if let Some(url) = params.get("url").and_then(|v| v.as_str()) {
        tracing::debug!(url = %url, "[Brew Subscribe] 使用单个 URL");
        // 单个 URL
        vec![(url.to_string(), None)]
    } else {
        tracing::warn!("[Brew Subscribe] 缺少 url 和 feeds 参数");
        return Err("缺少 url 或 feeds 参数".to_string());
    };

    if urls_to_try.is_empty() {
        return Err("没有可用的订阅源 URL".to_string());
    }

    tracing::info!(
        count = urls_to_try.len(),
        "[Brew] 开始尝试订阅，共 {} 个候选源",
        urls_to_try.len()
    );

    let parser = FeedParser::new();
    let mut last_error = String::new();
    let mut tried_urls = Vec::new();

    // 遍历尝试每个 URL
    for (url, feed_name) in urls_to_try {
        tried_urls.push(url.clone());

        // 检查是否已订阅
        let existing = brew_sources::Entity::find()
            .filter(brew_sources::Column::UserId.eq(user_id))
            .filter(brew_sources::Column::Url.eq(&url))
            .one(ctx.db)
            .await
            .map_err(|e| format!("数据库错误: {}", e))?;

        if existing.is_some() {
            tracing::debug!(url = %url, "[Brew] 跳过已订阅的源");
            continue;
        }

        // 尝试解析这个 URL
        tracing::debug!(url = %url, "[Brew] 尝试解析订阅源");

        match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            parser.fetch_and_parse(&url),
        )
        .await
        {
            Ok(Ok(feed)) => {
                // 成功解析！创建订阅
                let now = chrono::Utc::now();
                let name = custom_name
                    .map(|s| s.to_string())
                    .or(feed_name)
                    .unwrap_or(feed.title.clone());

                let new_source = brew_sources::ActiveModel {
                    user_id: Set(user_id),
                    name: Set(name.clone()),
                    url: Set(url.clone()),
                    feed_type: Set(feed.feed_type.clone()),
                    description: Set(feed.description.clone()),
                    site_url: Set(feed.site_url.clone()),
                    icon: Set(feed.icon.clone()),
                    category: Set(category.map(|s| s.to_string())),
                    enabled: Set(true),
                    error_count: Set(0),
                    item_count: Set(feed.items.len() as i32),
                    unread_count: Set(feed.items.len() as i32),
                    update_interval: Set(update_interval),
                    created_at: Set(now.into()),
                    updated_at: Set(now.into()),
                    ..Default::default()
                };

                let source = new_source
                    .insert(ctx.db)
                    .await
                    .map_err(|e| format!("创建订阅源失败: {}", e))?;

                // 插入文章
                let mut inserted_count = 0;
                for item in feed.items.iter().take(50) {
                    let empty_string = String::new();
                    let content_text = item
                        .content
                        .as_ref()
                        .or(item.summary.as_ref())
                        .unwrap_or(&empty_string);
                    let word_count = content_text.chars().count() as i32;
                    let reading_time = (word_count / 400).max(1);

                    let enclosures_json: Option<serde_json::Value> =
                        if item.enclosures.is_empty() {
                            None
                        } else {
                            Some(
                                serde_json::to_value(&item.enclosures)
                                    .unwrap_or(serde_json::json!([])),
                            )
                        };
                    let categories_json: Option<serde_json::Value> =
                        if item.categories.is_empty() {
                            None
                        } else {
                            Some(
                                serde_json::to_value(&item.categories)
                                    .unwrap_or(serde_json::json!([])),
                            )
                        };
                    let published_at = item.published_at.unwrap_or(now);

                    let new_item = brew_items::ActiveModel {
                        source_id: Set(source.id),
                        guid: Set(item.guid.clone()),
                        title: Set(item.title.clone()),
                        link: Set(item.link.clone()),
                        summary: Set(item.summary.clone()),
                        content: Set(item.content.clone()),
                        author: Set(item.author.clone()),
                        image: Set(item.image.clone()),
                        audio_url: Set(item.audio_url.clone()),
                        video_url: Set(item.video_url.clone()),
                        enclosures: Set(enclosures_json),
                        categories: Set(categories_json),
                        published_at: Set(published_at.into()),
                        fetched_at: Set(now.into()),
                        word_count: Set(Some(word_count)),
                        reading_time: Set(Some(reading_time)),
                        fulltext_fetched: Set(false),
                        ..Default::default()
                    };

                    if new_item.insert(ctx.db).await.is_ok() {
                        inserted_count += 1;
                    }
                }

                tracing::info!(
                    url = %url,
                    name = %name,
                    items = inserted_count,
                    "[Brew] 订阅成功"
                );

                return Ok(json!({
                    "success": true,
                    "sourceId": source.id,
                    "name": name,
                    "url": url,
                    "itemCount": inserted_count,
                    "feedType": match feed.feed_type {
                        brew_sources::FeedType::Rss => "rss",
                        brew_sources::FeedType::Atom => "atom",
                        brew_sources::FeedType::JsonFeed => "json_feed",
                        brew_sources::FeedType::Notion => "notion",
                        brew_sources::FeedType::RssHub => "rsshub",
                    },
                    "triedUrls": tried_urls.len(),
                    "message": format!("成功订阅「{}」，已获取 {} 篇文章", name, inserted_count)
                }));
            }
            Ok(Err(e)) => {
                tracing::debug!(url = %url, error = %e, "[Brew] 解析失败，尝试下一个");
                last_error = format!("{}: {}", url, e);
            }
            Err(_) => {
                tracing::debug!(url = %url, "[Brew] 请求超时，尝试下一个");
                last_error = format!("{}: 请求超时", url);
            }
        }
    }

    // 所有 URL 都失败了
    Err(format!(
        "尝试了 {} 个源都无法订阅。最后一个错误: {}",
        tried_urls.len(),
        last_error
    ))
}

/// 从 feeds 数组中提取并排序 URL
/// 优先级：已验证 > 官方源 > HTTPS > HTTP
fn extract_and_prioritize_feeds(feeds: &Value) -> Vec<(String, Option<String>)> {
    let Some(feeds_arr) = feeds.as_array() else {
        return vec![];
    };

    let mut result: Vec<(String, Option<String>, i32)> = feeds_arr
        .iter()
        .filter_map(|f| {
            let url = f.get("url")?.as_str()?.to_string();
            let name = f
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let verified = f.get("verified").and_then(|v| v.as_bool()).unwrap_or(false);
            let source = f.get("source").and_then(|v| v.as_str()).unwrap_or("");

            // 计算优先级分数（越高越优先）
            let mut score = 0;
            if verified {
                score += 100;
            }
            // 官方源优先
            if source.contains("official") || url.contains("zhihu.com") {
                score += 50;
            }
            // HTTPS 优先
            if url.starts_with("https://") {
                score += 20;
            }
            // 知名服务优先
            if url.contains("feedx.net") || url.contains("feedburner") {
                score += 30;
            }
            // RSSHub 可能不稳定，降低优先级
            if url.contains("rsshub") {
                score -= 10;
            }

            Some((url, name, score))
        })
        .collect();

    // 按分数降序排序
    result.sort_by(|a, b| b.2.cmp(&a.2));

    // 返回 URL 和名称
    result
        .into_iter()
        .map(|(url, name, _)| (url, name))
        .collect()
}

async fn execute_brew_mark(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let item_id = params
        .get("itemId")
        .and_then(|v| v.as_i64())
        .ok_or("Missing itemId")? as i32;
    let action = params
        .get("action")
        .and_then(|v| v.as_str())
        .ok_or("Missing action")?;

    let now = Utc::now();
    let user_id = ctx.user_id;

    // 验证文章存在
    let item = brew_items::Entity::find_by_id(item_id)
        .one(ctx.db)
        .await
        .map_err(|e| format!("Database error: {}", e))?
        .ok_or("Article not found")?;

    // 查找或创建用户状态
    let existing = brew_user_states::Entity::find()
        .filter(brew_user_states::Column::UserId.eq(user_id))
        .filter(brew_user_states::Column::ItemId.eq(item_id))
        .one(ctx.db)
        .await
        .map_err(|e| format!("Database error: {}", e))?;

    let (is_read, is_starred) = match action {
        "read" => (Some(true), None),
        "unread" => (Some(false), None),
        "star" => (None, Some(true)),
        "unstar" => (None, Some(false)),
        "later" => (Some(false), Some(true)),
        _ => return Err(format!("Unknown mark action: {}", action)),
    };

    let was_read = existing.as_ref().map(|e| e.is_read).unwrap_or(false);

    if let Some(state) = existing {
        let mut active: brew_user_states::ActiveModel = state.into();
        if let Some(read) = is_read {
            active.is_read = Set(read);
            if read {
                active.read_at = Set(Some(now.into()));
            }
        }
        if let Some(starred) = is_starred {
            active.is_starred = Set(starred);
            if starred {
                active.starred_at = Set(Some(now.into()));
            }
        }
        active.updated_at = Set(now.into());
        active
            .update(ctx.db)
            .await
            .map_err(|e| format!("Failed to update state: {}", e))?;
    } else {
        let new_state = brew_user_states::ActiveModel {
            user_id: Set(user_id),
            item_id: Set(item_id),
            is_read: Set(is_read.unwrap_or(false)),
            is_starred: Set(is_starred.unwrap_or(false)),
            read_at: Set(if is_read == Some(true) {
                Some(now.into())
            } else {
                None
            }),
            starred_at: Set(if is_starred == Some(true) {
                Some(now.into())
            } else {
                None
            }),
            updated_at: Set(now.into()),
            ..Default::default()
        };
        new_state
            .insert(ctx.db)
            .await
            .map_err(|e| format!("Failed to create state: {}", e))?;
    }

    // 更新 source 的 unread_count
    if let Some(read) = is_read {
        if read != was_read {
            let delta = if read { -1 } else { 1 };
            let _ = ctx
                .db
                .execute(sea_orm::Statement::from_sql_and_values(
                    sea_orm::DatabaseBackend::Postgres,
                    "UPDATE brew_sources SET unread_count = unread_count + $1 WHERE id = $2",
                    [delta.into(), item.source_id.into()],
                ))
                .await;
        }
    }

    let status = match action {
        "read" => "已读",
        "unread" => "未读",
        "star" => "已收藏",
        "unstar" => "取消收藏",
        "later" => "稍后阅读",
        _ => "未知",
    };

    Ok(json!({
        "success": true,
        "itemId": item_id,
        "action": action,
        "status": status,
        "title": item.title
    }))
}

// ============================================================================
// Content 相关
// ============================================================================

async fn execute_content_write(
    params: &HashMap<String, Value>,
    _ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let content_type = params
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("text");
    let content = params.get("content").cloned().unwrap_or(json!(null));

    Ok(json!({
        "success": true,
        "type": content_type,
        "content": content,
        "message": "Content write requires further implementation"
    }))
}
