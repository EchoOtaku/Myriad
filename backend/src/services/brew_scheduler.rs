//! Brew 阅读 - 订阅调度引擎
//!
//! 后端独立运行的调度器，负责：
//! 1. 定时检查需要更新的订阅源
//! 2. 抓取并解析订阅源内容
//! 3. 存储新文章到数据库
//! 4. 推送更新通知到前端

use chrono::{Duration, Utc};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, Condition, DatabaseConnection, EntityTrait,
    QueryFilter, QueryOrder, QuerySelect, sea_query::OnConflict,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

use crate::models::entities::{brew_items, brew_sources};
use crate::services::brew_parser::{calculate_reading_stats, FeedParser, ParsedFeed};
use crate::services::notion_service::{NotionConfig, NotionService};
use crate::services::rsshub_service::RsshubService;

/// 新文章通知消息
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NewItemsNotification {
    #[serde(rename = "type")]
    pub msg_type: String,
    /// 订阅源 ID
    pub source_id: i32,
    /// 订阅源名称
    pub source_name: String,
    /// 新文章数量
    pub new_count: i32,
    /// 新文章标题列表（最多 5 个）
    pub titles: Vec<String>,
    /// 时间戳
    pub timestamp: i64,
}

/// Brew 调度引擎
pub struct BrewSchedulerEngine {
    db: DatabaseConnection,
    parser: FeedParser,
    notion_service: NotionService,
    rsshub_service: RsshubService,
    /// 前端通知通道
    notification_tx: broadcast::Sender<NewItemsNotification>,
    /// 是否正在运行
    running: Arc<RwLock<bool>>,
}

impl BrewSchedulerEngine {
    /// 创建调度引擎
    pub fn new(db: DatabaseConnection) -> Self {
        let (notification_tx, _) = broadcast::channel(100);
        Self {
            rsshub_service: RsshubService::new(db.clone()),
            db,
            parser: FeedParser::new(),
            notion_service: NotionService::new(),
            notification_tx,
            running: Arc::new(RwLock::new(false)),
        }
    }

    /// 获取通知订阅
    pub fn subscribe_notifications(&self) -> broadcast::Receiver<NewItemsNotification> {
        self.notification_tx.subscribe()
    }

    /// 启动调度引擎
    pub async fn start(&self) {
        let mut running = self.running.write().await;
        if *running {
            tracing::warn!("[BrewScheduler] Already running");
            return;
        }
        *running = true;
        drop(running);

        tracing::info!("[BrewScheduler] 🍵 Starting Brew scheduler engine");

        // 克隆需要的数据
        let db = self.db.clone();
        let running = self.running.clone();
        let notification_tx = self.notification_tx.clone();

        // 启动主调度循环
        tokio::spawn(async move {
            // 每分钟检查一次
            let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));

            loop {
                interval.tick().await;

                // 检查是否停止
                if !*running.read().await {
                    tracing::info!("[BrewScheduler] Scheduler stopped");
                    break;
                }

                // 执行调度
                if let Err(e) = Self::tick(&db, &notification_tx).await {
                    tracing::error!("[BrewScheduler] Tick error: {}", e);
                }
            }
        });
    }

    /// 停止调度引擎
    pub async fn stop(&self) {
        let mut running = self.running.write().await;
        *running = false;
        tracing::info!("[BrewScheduler] 🍵 Stopping Brew scheduler engine");
    }

    /// 主调度循环 tick
    async fn tick(
        db: &DatabaseConnection,
        notification_tx: &broadcast::Sender<NewItemsNotification>,
    ) -> Result<(), String> {
        let now = Utc::now();
        tracing::debug!("[BrewScheduler] Tick at {}", now);

        // 查找需要更新的订阅源
        // 条件：enabled = true AND (last_fetched_at IS NULL OR last_fetched_at + interval < now)
        let sources = brew_sources::Entity::find()
            .filter(brew_sources::Column::Enabled.eq(true))
            .filter(
                Condition::any()
                    .add(brew_sources::Column::LastFetchedAt.is_null())
                    .add(brew_sources::Column::LastFetchedAt.lt(now - Duration::minutes(1))),
            )
            .order_by_asc(brew_sources::Column::LastFetchedAt)
            .all(db)
            .await
            .map_err(|e| format!("Failed to query sources: {}", e))?;

        let parser = FeedParser::new();
        let notion_service = NotionService::new();
        let rsshub_service = RsshubService::new(db.clone());

        for source in sources {
            // 检查是否到了更新时间
            let should_update = match source.last_fetched_at {
                None => true,
                Some(last) => {
                    let elapsed = now - last.with_timezone(&Utc);
                    elapsed.num_minutes() >= source.update_interval as i64
                }
            };

            if !should_update {
                continue;
            }

            tracing::info!(
                "[BrewScheduler] Updating source: {} ({}) [type: {:?}]",
                source.name,
                source.url,
                source.feed_type
            );

            // 更新 last_fetched_at（即使失败也更新，避免频繁重试失败的源）
            let mut active: brew_sources::ActiveModel = source.clone().into();
            active.last_fetched_at = Set(Some(now.into()));

            // 根据 feed_type 选择不同的抓取方式
            let fetch_result: Result<ParsedFeed, String> = match source.feed_type {
                brew_sources::FeedType::Notion => {
                    // Notion 源需要从 extra_config 获取 token
                    Self::fetch_notion_source(&notion_service, &source).await
                }
                brew_sources::FeedType::RssHub => {
                    // RSSHub 源使用故障转移服务
                    Self::fetch_rsshub_source(&rsshub_service, &source).await
                }
                _ => {
                    // RSS/Atom/JSON Feed 使用标准解析器
                    parser
                        .fetch_and_parse(&source.url)
                        .await
                        .map_err(|e| e.to_string())
                }
            };

            match fetch_result {
                Ok(feed) => {
                    // 更新订阅源信息
                    active.last_success_at = Set(Some(now.into()));
                    active.last_error = Set(None);
                    active.error_count = Set(0);

                    // 如果订阅源没有名称，用解析到的
                    if source.name.is_empty() || source.name == source.url {
                        active.name = Set(feed.title.clone());
                    }
                    if source.description.is_none() {
                        active.description = Set(feed.description.clone());
                    }
                    // 如果订阅源没有图标，下载并保存到本地
                    if source.icon.is_none() {
                        if let Some(icon_url) = &feed.icon {
                            let icon_service = crate::services::icon_service::IconService::new();
                            match icon_service.download_icon(source.id, icon_url).await {
                                Ok(Some(icon_info)) => {
                                    active.icon = Set(Some(icon_info.local_path));
                                    tracing::info!(
                                        "[BrewScheduler] Downloaded icon for source {}: {}",
                                        source.name,
                                        icon_url
                                    );
                                }
                                Ok(None) => {
                                    tracing::debug!(
                                        "[BrewScheduler] Icon download returned empty for source {}",
                                        source.name
                                    );
                                }
                                Err(e) => {
                                    tracing::warn!(
                                        "[BrewScheduler] Failed to download icon for source {}: {}",
                                        source.name,
                                        e
                                    );
                                }
                            }
                        }
                    }
                    if source.site_url.is_none() {
                        active.site_url = Set(feed.site_url.clone());
                    }

                    // 保存更新
                    let updated_source = active
                        .update(db)
                        .await
                        .map_err(|e| format!("Failed to update source: {}", e))?;

                    // 存储新文章
                    let new_count =
                        Self::save_items(db, &updated_source, &feed, notification_tx).await?;

                    if new_count > 0 {
                        tracing::info!(
                            "[BrewScheduler] Added {} new items for source: {}",
                            new_count,
                            updated_source.name
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        "[BrewScheduler] Failed to fetch source {}: {}",
                        source.name,
                        e
                    );

                    // 更新错误信息
                    active.last_error = Set(Some(e.to_string()));
                    active.error_count = Set(source.error_count + 1);

                    // 如果连续错误次数过多，可以考虑禁用
                    if source.error_count + 1 >= 10 {
                        tracing::warn!(
                            "[BrewScheduler] Source {} has too many errors, consider disabling",
                            source.name
                        );
                        // 暂时不自动禁用，让用户决定
                    }

                    active
                        .update(db)
                        .await
                        .map_err(|e| format!("Failed to update source: {}", e))?;
                }
            }

            // 短暂延迟，避免过快请求
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }

        Ok(())
    }

    /// 存储新文章
    /// 性能优化：批量检查文章是否存在，避免 N+1 查询
    async fn save_items(
        db: &DatabaseConnection,
        source: &brew_sources::Model,
        feed: &ParsedFeed,
        notification_tx: &broadcast::Sender<NewItemsNotification>,
    ) -> Result<i32, String> {
        let now = Utc::now();

        // 性能优化：批量获取所有已存在的 guid，避免 N+1 查询
        let all_guids: Vec<&str> = feed.items.iter().map(|item| item.guid.as_str()).collect();
        let existing_guids: std::collections::HashSet<String> = brew_items::Entity::find()
            .filter(brew_items::Column::SourceId.eq(source.id))
            .filter(brew_items::Column::Guid.is_in(all_guids))
            .select_only()
            .column(brew_items::Column::Guid)
            .into_tuple::<String>()
            .all(db)
            .await
            .map_err(|e| format!("Failed to check existing items: {}", e))?
            .into_iter()
            .collect();

        // 收集需要插入的新文章
        let mut new_items: Vec<brew_items::ActiveModel> = Vec::new();
        let mut new_titles: Vec<String> = Vec::new();

        // 图片缓存服务（用于 Notion 等临时 URL）
        let image_cache = crate::services::image_cache::ImageCacheService::new();

        for item in &feed.items {
            // 使用预查询的结果判断是否存在
            if existing_guids.contains(&item.guid) {
                continue;
            }

            // 计算阅读统计
            let content_for_stats = item
                .content
                .as_deref()
                .or(item.summary.as_deref())
                .unwrap_or("");
            let (word_count, reading_time) = calculate_reading_stats(content_for_stats);

            // 处理封面图片 - 对 Notion 临时 URL 进行缓存
            let processed_image = image_cache.process_image_url(item.image.as_deref()).await;

            // 创建新文章
            let new_item = brew_items::ActiveModel {
                source_id: Set(source.id),
                guid: Set(item.guid.clone()),
                title: Set(item.title.clone()),
                link: Set(item.link.clone()),
                summary: Set(item.summary.clone()),
                content: Set(item.content.clone()),
                author: Set(item.author.clone()),
                image: Set(processed_image),
                audio_url: Set(item.audio_url.clone()),
                video_url: Set(item.video_url.clone()),
                enclosures: Set(if item.enclosures.is_empty() {
                    None
                } else {
                    serde_json::to_value(&item.enclosures).ok()
                }),
                categories: Set(if item.categories.is_empty() {
                    None
                } else {
                    serde_json::to_value(&item.categories).ok()
                }),
                published_at: Set(item.published_at.unwrap_or(now).into()),
                fetched_at: Set(now.into()),
                word_count: Set(Some(word_count)),
                reading_time: Set(Some(reading_time)),
                fulltext_fetched: Set(item.content.is_some()),
                ..Default::default()
            };

            if new_titles.len() < 5 {
                new_titles.push(item.title.clone());
            }
            new_items.push(new_item);
        }

        // 批量插入新文章（ON CONFLICT DO NOTHING 防止竞态条件导致的重复键错误）
        let new_count = new_items.len() as i32;
        if !new_items.is_empty() {
            let on_conflict = OnConflict::columns([brew_items::Column::SourceId, brew_items::Column::Guid])
                .do_nothing()
                .to_owned();
            brew_items::Entity::insert_many(new_items)
                .on_conflict(on_conflict)
                .do_nothing()
                .exec(db)
                .await
                .map_err(|e| format!("Failed to batch insert items: {}", e))?;
        }

        // 更新订阅源的文章数量
        if new_count > 0 {
            let mut source_active: brew_sources::ActiveModel = source.clone().into();
            source_active.item_count = Set(source.item_count + new_count);
            source_active.unread_count = Set(source.unread_count + new_count);
            source_active.updated_at = Set(now.into());
            source_active
                .update(db)
                .await
                .map_err(|e| format!("Failed to update source counts: {}", e))?;

            // 发送通知
            let notification = NewItemsNotification {
                msg_type: "brew:new_items".to_string(),
                source_id: source.id,
                source_name: source.name.clone(),
                new_count,
                titles: new_titles,
                timestamp: now.timestamp_millis(),
            };

            if let Err(e) = notification_tx.send(notification) {
                tracing::debug!("[BrewScheduler] No notification subscribers: {}", e);
            }
        }

        Ok(new_count)
    }

    /// 抓取 Notion 订阅源
    async fn fetch_notion_source(
        notion_service: &NotionService,
        source: &brew_sources::Model,
    ) -> Result<ParsedFeed, String> {
        // 从 extra_config 获取 Notion 配置
        let extra_config = source
            .extra_config
            .as_ref()
            .ok_or_else(|| "Notion source requires extra_config with token".to_string())?;

        let token = extra_config["token"]
            .as_str()
            .ok_or_else(|| "Notion token not found in extra_config".to_string())?;

        // 解析 URL 获取资源类型和 ID
        let (resource_type, resource_id) =
            NotionService::parse_notion_url(&source.url).map_err(|e| e.to_string())?;

        // 从 extra_config 获取可选的过滤和排序条件
        let filter = extra_config.get("filter").cloned();
        let sort = extra_config.get("sort").cloned();

        let config = NotionConfig {
            token: token.to_string(),
            resource_id,
            resource_type,
            filter,
            sort,
        };

        notion_service
            .fetch(&config)
            .await
            .map_err(|e| e.to_string())
    }

    /// 抓取 RSSHub 订阅源（带故障转移）
    async fn fetch_rsshub_source(
        rsshub_service: &RsshubService,
        source: &brew_sources::Model,
    ) -> Result<ParsedFeed, String> {
        // 优先使用存储的 rsshub_route
        let route = if let Some(ref route) = source.rsshub_route {
            route.clone()
        } else {
            // 回退：从 URL 中解析路由
            rsshub_service
                .extract_route(&source.url)
                .ok_or_else(|| format!("Cannot extract RSSHub route from URL: {}", source.url))?
        };

        // 使用故障转移服务抓取
        rsshub_service
            .fetch_with_failover(&route, Some(source.user_id))
            .await
    }

    /// 手动刷新单个订阅源
    pub async fn refresh_source(&self, source_id: i32) -> Result<i32, String> {
        let source = brew_sources::Entity::find_by_id(source_id)
            .one(&self.db)
            .await
            .map_err(|e| format!("Failed to find source: {}", e))?
            .ok_or_else(|| "Source not found".to_string())?;

        let now = Utc::now();

        // 更新 last_fetched_at
        let mut active: brew_sources::ActiveModel = source.clone().into();
        active.last_fetched_at = Set(Some(now.into()));

        // 根据 feed_type 选择不同的抓取方式
        let fetch_result: Result<ParsedFeed, String> = match source.feed_type {
            brew_sources::FeedType::Notion => {
                Self::fetch_notion_source(&self.notion_service, &source).await
            }
            brew_sources::FeedType::RssHub => {
                Self::fetch_rsshub_source(&self.rsshub_service, &source).await
            }
            _ => self
                .parser
                .fetch_and_parse(&source.url)
                .await
                .map_err(|e| e.to_string()),
        };

        match fetch_result {
            Ok(feed) => {
                // 更新订阅源信息
                active.last_success_at = Set(Some(now.into()));
                active.last_error = Set(None);
                active.error_count = Set(0);

                if source.description.is_none() {
                    active.description = Set(feed.description.clone());
                }
                // 如果订阅源没有图标，下载并保存到本地
                if source.icon.is_none() {
                    if let Some(icon_url) = &feed.icon {
                        let icon_service = crate::services::icon_service::IconService::new();
                        match icon_service.download_icon(source.id, icon_url).await {
                            Ok(Some(icon_info)) => {
                                active.icon = Set(Some(icon_info.local_path));
                                tracing::info!(
                                    "[BrewScheduler] Downloaded icon for source {}: {}",
                                    source.name,
                                    icon_url
                                );
                            }
                            Ok(None) => {
                                tracing::debug!(
                                    "[BrewScheduler] Icon download returned empty for source {}",
                                    source.name
                                );
                            }
                            Err(e) => {
                                tracing::warn!(
                                    "[BrewScheduler] Failed to download icon for source {}: {}",
                                    source.name,
                                    e
                                );
                            }
                        }
                    }
                }
                if source.site_url.is_none() {
                    active.site_url = Set(feed.site_url.clone());
                }

                let updated_source = active
                    .update(&self.db)
                    .await
                    .map_err(|e| format!("Failed to update source: {}", e))?;

                // 存储新文章
                Self::save_items(&self.db, &updated_source, &feed, &self.notification_tx).await
            }
            Err(e) => {
                active.last_error = Set(Some(e.to_string()));
                active.error_count = Set(source.error_count + 1);
                active
                    .update(&self.db)
                    .await
                    .map_err(|ee| format!("Failed to update source: {}", ee))?;

                Err(e.to_string())
            }
        }
    }
}

/// 全局调度引擎实例
static BREW_SCHEDULER: once_cell::sync::OnceCell<Arc<BrewSchedulerEngine>> =
    once_cell::sync::OnceCell::new();

/// 初始化 Brew 调度引擎
pub async fn init_brew_scheduler(db: DatabaseConnection) {
    let engine = Arc::new(BrewSchedulerEngine::new(db));
    engine.start().await;

    if BREW_SCHEDULER.set(engine).is_err() {
        tracing::warn!("[BrewScheduler] Scheduler already initialized");
    }
}

/// 获取 Brew 调度引擎实例
pub fn get_brew_scheduler() -> Option<Arc<BrewSchedulerEngine>> {
    BREW_SCHEDULER.get().cloned()
}

/// 停止 Brew 调度引擎
pub async fn shutdown_brew_scheduler() {
    if let Some(engine) = BREW_SCHEDULER.get() {
        engine.stop().await;
    }
}
