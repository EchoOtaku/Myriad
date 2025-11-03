use crate::services::analyzer::AiAnalyzer;
use crate::services::fetcher::PlatformFetcher;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::{DateTime, Duration, Utc};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

// 数据缓存结构
#[derive(Debug, Serialize, Deserialize, Clone)]
struct PlatformDataCache {
    data: Value,
    fetched_at: DateTime<Utc>,
}

const PLATFORM_CACHE_FILE: &str = "./cache/platform_data.json";
const PLATFORM_CACHE_HOURS: i64 = 12; // 数据缓存12小时

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonalReport {
    pub cards: Vec<ReportCard>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub all_cards: Option<Vec<ReportCard>>,
    pub generated_at: String,
    pub expires_at: String,
    pub selected_topics: Vec<u8>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReportCard {
    pub topic_id: u8,
    pub title: String,
    pub category: String,
    pub icon: String,
    pub color: String,
    pub content: CardContent,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CardContent {
    pub summary: String,
    pub details: Vec<String>,
    pub highlight: Option<String>,
    pub tags: Vec<String>,
}

// 持久化缓存（保存到磁盘，重启后依然有效）
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

const CACHE_FILE_PATH: &str = "./cache/reports.json";
const MAX_CACHE_ENTRIES: usize = 20;

type ReportCacheEntry = (PersonalReport, DateTime<Utc>);
type ReportCache = Arc<Mutex<HashMap<String, ReportCacheEntry>>>;

lazy_static::lazy_static! {
    static ref REPORT_CACHE: ReportCache = {
        let cache = load_cache_from_disk().unwrap_or_else(|_| HashMap::new());
        Arc::new(Mutex::new(cache))
    };
}

/// 从磁盘加载缓存
fn load_cache_from_disk() -> Result<HashMap<String, ReportCacheEntry>, Box<dyn std::error::Error>> {
    let path = PathBuf::from(CACHE_FILE_PATH);
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let content = fs::read_to_string(path)?;
    let cache: HashMap<String, ReportCacheEntry> = serde_json::from_str(&content)?;

    // 清理过期缓存（7天前）
    let now = Utc::now();
    let valid_cache: HashMap<String, ReportCacheEntry> = cache
        .into_iter()
        .filter(|(_, (_, created_at))| now - *created_at < Duration::days(7))
        .collect();

    tracing::info!("✓ Loaded {} cached reports from disk", valid_cache.len());
    Ok(valid_cache)
}

/// 保存缓存到磁盘
fn save_cache_to_disk() -> Result<(), Box<dyn std::error::Error>> {
    let cache = REPORT_CACHE.lock().unwrap();
    let path = PathBuf::from(CACHE_FILE_PATH);

    tracing::info!("💾 Saving cache to disk: {}", path.display());
    tracing::info!("   Total entries: {}", cache.len());

    // 确保目录存在
    if let Some(parent) = path.parent() {
        tracing::info!("   Creating directory: {}", parent.display());
        fs::create_dir_all(parent)?;
    }

    let content = serde_json::to_string_pretty(&*cache)?;
    tracing::info!("   Writing {} bytes", content.len());
    fs::write(&path, content)?;
    tracing::info!("✅ Cache saved successfully");
    Ok(())
}

/// 检查缓存是否有效（7天内）- 返回最新的报告，并合并所有历史卡片
fn get_cached_report(user_id: &str, force_refresh: bool) -> Option<PersonalReport> {
    if force_refresh {
        tracing::info!("⚡ Force refresh requested, skipping cache");
        return None;
    }

    let cache = REPORT_CACHE.lock().unwrap();
    let now = Utc::now();

    // 查找该用户的所有有效缓存
    let mut valid_reports: Vec<(String, PersonalReport, DateTime<Utc>)> = cache
        .iter()
        .filter(|(key, (_, created_at))| {
            key.starts_with(user_id) && now - *created_at < Duration::days(7)
        })
        .map(|(key, (report, created_at))| (key.clone(), report.clone(), *created_at))
        .collect();

    // 按时间排序，最新的在前
    valid_reports.sort_by(|a, b| b.2.cmp(&a.2));

    if let Some((_, latest_report, _)) = valid_reports.first() {
        tracing::info!(
            "✓ Found {} valid cached reports for {}",
            valid_reports.len(),
            user_id
        );

        // 合并所有历史报告的卡片（去重）
        let mut all_cards_map: std::collections::HashMap<u8, ReportCard> =
            std::collections::HashMap::new();

        for (_, report, _) in valid_reports.iter() {
            for card in &report.cards {
                // 使用 topic_id 作为 key，保留最新的卡片
                all_cards_map
                    .entry(card.topic_id)
                    .or_insert_with(|| card.clone());
            }
        }

        // 转换为 Vec 并按 topic_id 排序
        let mut all_cards: Vec<ReportCard> = all_cards_map.into_values().collect();
        all_cards.sort_by_key(|card| card.topic_id);

        tracing::info!(
            "📦 Merged cards: {} unique cards from {} reports",
            all_cards.len(),
            valid_reports.len()
        );

        // 创建新的报告，包含最新报告的 cards 和所有历史的 all_cards
        let report_with_all = PersonalReport {
            cards: latest_report.cards.clone(),
            all_cards: Some(all_cards),
            generated_at: latest_report.generated_at.clone(),
            expires_at: latest_report.expires_at.clone(),
            selected_topics: latest_report.selected_topics.clone(),
        };

        return Some(report_with_all);
    }

    None
}

/// 保存报告到缓存（限制最多20个）- 使用唯一ID
fn cache_report(user_id: &str, report: PersonalReport) {
    let mut cache = REPORT_CACHE.lock().unwrap();

    // 使用时间戳生成唯一的缓存key
    let timestamp = Utc::now().timestamp();
    let cache_key = format!("{}_{}", user_id, timestamp);

    // 如果缓存已满，删除最旧的条目
    if cache.len() >= MAX_CACHE_ENTRIES {
        if let Some(oldest_key) = cache
            .iter()
            .min_by_key(|(_, (_, created_at))| created_at)
            .map(|(k, _)| k.clone())
        {
            cache.remove(&oldest_key);
            tracing::info!("🗑️ Cache full, removed oldest entry: {}", oldest_key);
        }
    }

    cache.insert(cache_key.clone(), (report, Utc::now()));
    let total_cache = cache.len();
    let user_cache_count = cache.iter().filter(|(k, _)| k.starts_with(user_id)).count();

    tracing::info!("💾 Cached report with key: {}", cache_key);
    tracing::info!(
        "📊 Cache stats - Total: {}, User: {}",
        total_cache,
        user_cache_count
    );

    // 列出所有缓存 key
    tracing::info!("📋 All cache keys:");
    for key in cache.keys() {
        tracing::info!("   - {}", key);
    }

    drop(cache); // 释放锁

    // 保存到磁盘
    tracing::info!("💿 Attempting to save cache to disk...");
    match save_cache_to_disk() {
        Ok(_) => tracing::info!("✅ Cache successfully saved to disk"),
        Err(e) => tracing::error!("❌ Failed to save cache to disk: {}", e),
    }
}

/// 从磁盘加载平台数据缓存
fn load_platform_data_cache() -> Option<PlatformDataCache> {
    let path = PathBuf::from(PLATFORM_CACHE_FILE);
    if !path.exists() {
        return None;
    }

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<PlatformDataCache>(&content) {
            Ok(cache) => {
                let age = Utc::now() - cache.fetched_at;
                if age < Duration::hours(PLATFORM_CACHE_HOURS) {
                    tracing::info!(
                        "✓ Loaded platform data from cache (age: {}h)",
                        age.num_hours()
                    );
                    Some(cache)
                } else {
                    tracing::info!("⏰ Platform data cache expired (age: {}h)", age.num_hours());
                    None
                }
            }
            Err(e) => {
                tracing::warn!("Failed to parse platform cache: {}", e);
                None
            }
        },
        Err(e) => {
            tracing::warn!("Failed to read platform cache: {}", e);
            None
        }
    }
}

/// 保存平台数据缓存到磁盘
fn save_platform_data_cache(data: &Value) -> Result<(), Box<dyn std::error::Error>> {
    let cache = PlatformDataCache {
        data: data.clone(),
        fetched_at: Utc::now(),
    };

    let path = PathBuf::from(PLATFORM_CACHE_FILE);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let content = serde_json::to_string_pretty(&cache)?;
    fs::write(&path, content)?;
    tracing::info!("💾 Platform data cache saved");
    Ok(())
}

/// 一键获取所有平台数据（带缓存）
pub async fn fetch_all_data(State(_db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    tracing::info!("Starting fetch all data...");

    // 检查缓存
    if let Some(cache) = load_platform_data_cache() {
        tracing::info!("📦 Returning cached platform data");
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "message": "Data loaded from cache",
                "data": cache.data,
                "fetched_at": cache.fetched_at.to_rfc3339(),
                "from_cache": true
            })),
        );
    }

    // 缓存不存在或已过期，重新获取
    tracing::info!("🔄 Fetching fresh platform data...");
    match fetch_fresh_platform_data().await {
        Ok(data) => {
            // 保存到缓存
            if let Err(e) = save_platform_data_cache(&data) {
                tracing::error!("Failed to save platform cache: {}", e);
            }

            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "message": "Data fetched successfully",
                    "data": data,
                    "fetched_at": chrono::Utc::now().to_rfc3339(),
                    "from_cache": false
                })),
            )
        }
        Err(e) => {
            tracing::error!("Failed to fetch platform data: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "message": format!("Failed to fetch data: {}", e)
                })),
            )
        }
    }
}

/// 手动刷新平台数据
#[derive(Deserialize)]
pub struct RefreshQuery {
    #[serde(default)]
    force: bool,
}

pub async fn refresh_platform_data(
    State(_db): State<DatabaseConnection>,
    Query(query): Query<RefreshQuery>,
) -> (StatusCode, Json<Value>) {
    if !query.force {
        // 如果不是强制刷新，检查缓存
        if let Some(cache) = load_platform_data_cache() {
            let age = Utc::now() - cache.fetched_at;
            if age < Duration::hours(PLATFORM_CACHE_HOURS) {
                return (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "message": "Data still fresh, use force=true to refresh anyway",
                        "data": cache.data,
                        "fetched_at": cache.fetched_at.to_rfc3339(),
                        "age_hours": age.num_hours()
                    })),
                );
            }
        }
    }

    tracing::info!("🔄 Force refreshing platform data...");
    match fetch_fresh_platform_data().await {
        Ok(data) => {
            // 保存到缓存
            if let Err(e) = save_platform_data_cache(&data) {
                tracing::error!("Failed to save platform cache: {}", e);
            }

            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "message": "Data refreshed successfully",
                    "data": data,
                    "fetched_at": chrono::Utc::now().to_rfc3339()
                })),
            )
        }
        Err(e) => {
            tracing::error!("Failed to refresh platform data: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "message": format!("Failed to refresh data: {}", e)
                })),
            )
        }
    }
}

/// 获取新鲜的平台数据（实际执行API调用）
async fn fetch_fresh_platform_data() -> Result<Value, Box<dyn std::error::Error>> {
    tracing::info!("Starting fetch all data...");

    let fetcher = PlatformFetcher::new();
    let mut all_data = json!({});

    // 获取GitHub数据（包含仓库信息）
    if let Ok(github_username) = std::env::var("GITHUB_USERNAME") {
        let github_token = std::env::var("GITHUB_TOKEN").ok();

        // 获取用户基本信息
        match fetcher
            .fetch_github_user(&github_username, github_token.as_deref())
            .await
        {
            Ok(user_data) => {
                all_data["github"]["user"] = user_data;
                tracing::info!("✓ GitHub user data fetched");
            }
            Err(e) => tracing::warn!("GitHub user fetch failed: {}", e),
        }

        // 获取仓库列表
        match fetcher
            .fetch_github_repos(&github_username, github_token.as_deref())
            .await
        {
            Ok(repos) => {
                all_data["github"]["repos"] = json!(repos);
                tracing::info!("✓ GitHub repos fetched: {} repositories", repos.len());
            }
            Err(e) => tracing::warn!("GitHub repos fetch failed: {}", e),
        }
    }

    // 获取Bilibili数据
    if let Ok(uid_str) = std::env::var("BILIBILI_UID") {
        if let Ok(uid) = uid_str.parse::<i64>() {
            match fetcher.fetch_bilibili_user(uid).await {
                Ok(user_data) => {
                    all_data["bilibili"]["user"] = json!(user_data);
                    tracing::info!("✓ Bilibili user data fetched");
                }
                Err(e) => tracing::warn!("Bilibili user fetch failed: {}", e),
            }

            // 获取追番/追剧数据
            match fetcher.fetch_all_bilibili_bangumi(uid).await {
                Ok(bangumi_data) => {
                    all_data["bilibili"]["bangumi"] = json!(bangumi_data);
                    tracing::info!(
                        "✓ Bilibili bangumi data fetched: {} items",
                        bangumi_data.len()
                    );
                }
                Err(e) => tracing::warn!("Bilibili bangumi fetch failed: {}", e),
            }

            // 获取收藏夹
            match fetcher.fetch_bilibili_favorites(uid).await {
                Ok(favorites) => {
                    all_data["bilibili"]["favorites"] = json!(favorites);
                    tracing::info!("✓ Bilibili favorites fetched: {} items", favorites.len());
                }
                Err(e) => tracing::warn!("Bilibili favorites fetch failed: {}", e),
            }
        }
    }

    // 获取Steam数据（只保留游玩时间>=3小时的游戏）
    if let (Ok(api_key), Ok(steam_id)) = (std::env::var("STEAM_API_KEY"), std::env::var("STEAM_ID"))
    {
        match fetcher.fetch_steam_user(&api_key, &steam_id).await {
            Ok(user_data) => {
                all_data["steam"]["user"] = json!(user_data);
                tracing::info!("✓ Steam user data fetched");
            }
            Err(e) => tracing::warn!("Steam user fetch failed: {}", e),
        }

        match fetcher.fetch_steam_games(&api_key, &steam_id).await {
            Ok(games_data) => {
                // 过滤：只保留游玩时间>=180分钟(3小时)的游戏
                let filtered_games: Vec<_> = games_data
                    .into_iter()
                    .filter(|game| game.playtime_forever >= 180)
                    .collect();

                let total_count = filtered_games.len();
                all_data["steam"]["games"] = json!(filtered_games);
                tracing::info!(
                    "✓ Steam games fetched: {} games (filtered >=3h)",
                    total_count
                );
            }
            Err(e) => tracing::warn!("Steam games fetch failed: {}", e),
        }
    }

    // 获取网易云音乐数据
    if let Ok(user_id_str) = std::env::var("NETEASE_USER_ID") {
        if let Ok(user_id) = user_id_str.parse::<i64>() {
            match fetcher.fetch_netease_liked_songs(user_id).await {
                Ok(songs) => {
                    all_data["netease"]["liked_songs"] = json!(songs);
                    tracing::info!(
                        "✓ Netease Cloud Music liked songs fetched: {} songs",
                        songs.len()
                    );
                }
                Err(e) => tracing::warn!("Netease Cloud Music fetch failed: {}", e),
            }
        }
    }

    // 数据清洗：移除无用信息，保留核心5W1H信息
    clean_platform_data(&mut all_data);

    Ok(all_data)
}

/// 清洗平台数据，只保留核心信息（符合5W1H原则）
fn clean_platform_data(data: &mut Value) {
    // 清洗 GitHub 仓库数据
    if let Some(repos) = data["github"]["repos"].as_array_mut() {
        for repo in repos.iter_mut() {
            if let Some(obj) = repo.as_object_mut() {
                // 只保留核心信息
                let cleaned = json!({
                    "name": obj.get("name"),
                    "description": obj.get("description"),
                    "language": obj.get("language"),
                    "stargazers_count": obj.get("stargazers_count"),
                    "forks_count": obj.get("forks_count"),
                    "created_at": obj.get("created_at"),
                    "updated_at": obj.get("updated_at"),
                    "topics": obj.get("topics"),
                    "html_url": obj.get("html_url"),
                });
                *repo = cleaned;
            }
        }
    }

    // 清洗 GitHub 用户信息
    if let Some(user) = data["github"]["user"].as_object_mut() {
        let cleaned = json!({
            "login": user.get("login"),
            "name": user.get("name"),
            "bio": user.get("bio"),
            "avatar_url": user.get("avatar_url"),
            "company": user.get("company"),
            "location": user.get("location"),
            "public_repos": user.get("public_repos"),
            "followers": user.get("followers"),
            "following": user.get("following"),
            "created_at": user.get("created_at"),
        });
        data["github"]["user"] = cleaned;
    }

    // 清洗 Steam 游戏数据
    if let Some(games) = data["steam"]["games"].as_array_mut() {
        for game in games.iter_mut() {
            if let Some(obj) = game.as_object_mut() {
                // 只保留核心信息
                let cleaned = json!({
                    "appid": obj.get("appid"),
                    "name": obj.get("name"),
                    "playtime_forever": obj.get("playtime_forever"),
                    "playtime_2weeks": obj.get("playtime_2weeks"),
                });
                *game = cleaned;
            }
        }
    }

    // 清洗 Steam 用户信息
    if let Some(user) = data["steam"]["user"].as_object_mut() {
        let cleaned = json!({
            "steamid": user.get("steamid"),
            "personaname": user.get("personaname"),
            "avatar": user.get("avatar"),
            "avatarfull": user.get("avatarfull"),
            "profileurl": user.get("profileurl"),
            "timecreated": user.get("timecreated"),
        });
        data["steam"]["user"] = cleaned;
    }

    tracing::info!("✓ Platform data cleaned (removed unnecessary fields)");
}

/// 生成个人报告
#[derive(Deserialize)]
pub struct GenerateReportQuery {
    #[serde(default)]
    force: bool,
}

pub async fn generate_report(
    State(_db): State<DatabaseConnection>,
    Query(query): Query<GenerateReportQuery>,
    Json(profile_data): Json<Value>,
) -> (StatusCode, Json<Value>) {
    tracing::info!("Generating personal report (force={})...", query.force);

    let user_id = "default_user"; // TODO: 从认证中获取真实用户ID

    // 检查缓存
    if let Some(cached_report) = get_cached_report(user_id, query.force) {
        tracing::info!("✓ Returning cached report");
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "report": cached_report,
                "from_cache": true
            })),
        );
    }

    // 获取AI配置
    let api_key = match std::env::var("GEMINI_API_KEY") {
        Ok(key) if !key.is_empty() => key,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "message": "Gemini API key not configured"
                })),
            );
        }
    };

    let model = std::env::var("GEMINI_MODEL").unwrap_or_else(|_| "gemini-pro".to_string());
    let analyzer = AiAnalyzer::new(api_key, model);

    // 获取话题风格配置
    let topic_style = std::env::var("TOPIC_STYLE").unwrap_or_else(|_| "balanced".to_string());
    let style_instruction = get_style_instruction(&topic_style);

    tracing::info!("Using topic style: {}", topic_style);

    // 第一步：让AI生成6个维度话题
    let topics_prompt = format!(
        r#"你是一位专业的数据分析师。请基于用户的真实数据，为他们设计6个不同维度的分析话题。

用户数据：
{}

风格偏好：{}

要求：
1. **必须生成恰好6个话题**
2. **话题必须基于实际数据**：确保用户数据中有足够信息支持这个话题
3. **话题要有创意和深度**：避免千篇一律，要能引发思考
4. **覆盖不同维度**：6个话题应该从不同角度分析用户
5. **标题简洁有趣**：每个标题控制在15字以内

返回JSON格式（只返回JSON，不要其他内容）：
{{
  "topics": [
    {{
      "id": 1,
      "title": "话题标题",
      "category": "类别名称",
      "icon": "emoji图标",
      "color": "from-blue-400 to-cyan-400",
      "analysis_focus": "这个话题要分析什么（给后续分析用的指引）"
    }},
    // ... 共6个话题
  ]
}}

可用的渐变色值：
- from-blue-400 to-cyan-400
- from-purple-400 to-pink-400
- from-green-400 to-teal-400
- from-orange-400 to-red-400
- from-pink-400 to-rose-400
- from-yellow-400 to-amber-400
- from-indigo-400 to-purple-400
- from-emerald-400 to-green-400

图标示例：🌈 🎮 🔬 🗺️ 🎭 🍜 🌌 🔮 🎪 📊 🎁 ✨ 🎨 💡 🚀 🎯 🌟"#,
        serde_json::to_string_pretty(&profile_data).unwrap_or_else(|_| "{}".to_string()),
        style_instruction
    );

    // 调用AI生成话题
    let topics_json = match analyzer
        .analyze_profile(&json!({"prompt": topics_prompt}))
        .await
    {
        Ok(response) => {
            let cleaned = response
                .trim()
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim();
            cleaned.to_string()
        }
        Err(e) => {
            tracing::error!("Failed to generate topics: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "message": format!("Failed to generate topics: {}", e)
                })),
            );
        }
    };

    // 解析生成的话题
    #[derive(Debug, Deserialize)]
    struct GeneratedTopic {
        id: u8,
        title: String,
        category: String,
        icon: String,
        color: String,
        analysis_focus: String,
    }

    #[derive(Debug, Deserialize)]
    struct TopicsResponse {
        topics: Vec<GeneratedTopic>,
    }

    let generated_topics: TopicsResponse = match serde_json::from_str(&topics_json) {
        Ok(topics) => topics,
        Err(e) => {
            tracing::error!(
                "Failed to parse generated topics: {}. Response: {}",
                e,
                topics_json
            );
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "message": format!("Failed to parse AI response: {}", e)
                })),
            );
        }
    };

    if generated_topics.topics.len() != 6 {
        tracing::error!(
            "AI generated {} topics instead of 6",
            generated_topics.topics.len()
        );
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": format!("AI generated {} topics instead of 6", generated_topics.topics.len())
            })),
        );
    }

    tracing::info!(
        "Generated topics: {:?}",
        generated_topics
            .topics
            .iter()
            .map(|t| &t.title)
            .collect::<Vec<_>>()
    );

    // 第二步：为每个话题生成详细内容
    let mut cards = Vec::new();
    let topic_ids: Vec<u8> = generated_topics.topics.iter().map(|t| t.id).collect();

    for (index, topic) in generated_topics.topics.iter().enumerate() {
        let content_prompt = format!(
            r#"你是一位专业的数据分析师。请基于用户的真实数据进行深度分析。

话题：{}
分析重点：{}

用户数据：
{}

要求：
1. **必须基于实际数据**：所有结论必须能从用户数据中找到证据支撑
2. **具体量化**：使用具体数字、时间、频率等可量化信息
3. **避免空洞夸奖**：不要使用"你很棒"、"继续加油"等无意义话语
4. **真实关联**：确保分析内容与用户实际行为强相关
5. **简洁专业**：语言简练，直击要点

返回JSON格式（只返回JSON，不要其他内容）：
{{
  "summary": "基于数据的核心发现（15字内，必须包含具体信息）",
  "details": ["数据点1（含具体数值/事实）", "数据点2（含具体数值/事实）", "数据点3（含具体数值/事实）"],
  "highlight": "最值得关注的数据趋势或异常（可选，需有数据支撑）",
  "tags": ["数据特征1", "数据特征2", "数据特征3"]
}}

示例（好的回答）：
- summary: "近30天提交47次，集中在深夜"
- details: ["最活跃时段：23:00-01:00", "周末贡献占比62%", "主要语言：Python 73%"]
- tags: ["夜猫子程序员", "周末战士", "Python专家"]

示例（避免的回答）：
- summary: "你是一个很努力的开发者" ❌
- details: ["你很有天赋", "继续保持", "未来可期"] ❌
- tags: ["优秀", "努力", "加油"] ❌"#,
            topic.title,
            topic.analysis_focus,
            serde_json::to_string_pretty(&profile_data).unwrap_or_else(|_| "{}".to_string())
        );

        match analyzer
            .analyze_profile(&json!({"prompt": content_prompt}))
            .await
        {
            Ok(analysis) => {
                // 清理AI返回的文本
                let cleaned = analysis
                    .trim()
                    .trim_start_matches("```json")
                    .trim_start_matches("```")
                    .trim_end_matches("```")
                    .trim();

                // 解析JSON
                if let Ok(content) = serde_json::from_str::<CardContent>(cleaned) {
                    cards.push(ReportCard {
                        topic_id: topic.id,
                        title: topic.title.clone(),
                        category: topic.category.clone(),
                        icon: topic.icon.clone(),
                        color: topic.color.clone(),
                        content,
                    });

                    tracing::info!("✓ Generated card {}/6: {}", index + 1, topic.title);
                } else {
                    tracing::warn!("Failed to parse AI response for topic: {}", topic.title);
                }
            }
            Err(e) => {
                tracing::error!("AI analysis failed for topic {}: {}", topic.title, e);
            }
        }
    }

    if cards.is_empty() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": "Failed to generate any cards"
            })),
        );
    }

    // 创建报告
    let now = Utc::now();
    let expires_at = now + Duration::days(7);

    let report = PersonalReport {
        cards,
        all_cards: None, // 新生成的报告不包含历史卡片
        generated_at: now.to_rfc3339(),
        expires_at: expires_at.to_rfc3339(),
        selected_topics: topic_ids,
    };

    // 缓存报告
    cache_report(user_id, report.clone());

    tracing::info!(
        "✓ Personal report generated successfully with {} cards",
        report.cards.len()
    );

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "report": report,
            "from_cache": false
        })),
    )
}

/// 根据话题风格获取AI生成指引
fn get_style_instruction(style: &str) -> String {
    // 检查是否是自定义风格
    if style.starts_with("custom:") {
        let custom_style = style.strip_prefix("custom:").unwrap_or("").trim();
        if !custom_style.is_empty() {
            return format!("风格：自定义 - {}", custom_style);
        }
        // 如果自定义内容为空，使用默认平衡风格
        return "风格：平衡多元、兼具深度与趣味。既有数据支撑，又有创意表达。".to_string();
    }

    match style {
        "playful" => {
            "风格：轻松活泼、趣味十足。使用游戏化、拟人化、隐喻等创意手法。话题要像玩游戏一样有趣，让用户会心一笑。
            示例：你是哪种天气？你的背包里有什么？如果你是一道菜".to_string()
        },
        "professional" => {
            "风格：专业严谨、数据驱动。使用量化分析、对比研究、趋势预测等专业方法。话题要有深度和洞察力。
            示例：技能矩阵分析、成长曲线对比、效率分布图、时间投资回报率".to_string()
        },
        "artistic" => {
            "风格：文艺感性、富有诗意。使用隐喻、意象、哲学思考等艺术手法。话题要引发深层思考和情感共鸣。
            示例：你的灵魂色彩、内心的生态系统、时间的河流、精神的原住民".to_string()
        },
        "balanced" => {
            "风格：平衡多元、兼具深度与趣味。既有数据支撑，又有创意表达。话题覆盖行为分析、兴趣洞察、成长轨迹等多个维度。
            示例：你的数字人格、兴趣光谱分析、注意力地图、隐藏的超能力、一年前vs现在的你".to_string()
        },
        "experimental" => {
            "风格：前卫大胆、打破常规。使用科幻、玄学、未来学等实验性概念。话题要让用户感到新奇和意外。
            示例：平行宇宙的你、量子纠缠的兴趣、时间旅行护照、数字考古发现、能量光谱".to_string()
        },
        _ => {
            "风格：平衡多元、兼具深度与趣味。既有数据支撑，又有创意表达。".to_string()
        }
    }
}

/// 获取已保存的报告
pub async fn get_report(State(_db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    let user_id = "default_user"; // TODO: 从认证中获取真实用户ID

    // 检查缓存（不强制刷新）
    if let Some(cached_report) = get_cached_report(user_id, false) {
        tracing::info!("✓ Retrieved cached report");
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "report": cached_report,
                "from_cache": true
            })),
        );
    }

    // 没有缓存
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "No cached report found. Please generate a new report.",
            "report": null
        })),
    )
}

/// 获取所有缓存的报告列表
pub async fn list_reports(State(_db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    let user_id = "default_user"; // TODO: 从认证中获取真实用户ID

    let cache = REPORT_CACHE.lock().unwrap();
    let now = Utc::now();

    // 获取该用户所有有效的报告
    let mut reports: Vec<Value> = cache
        .iter()
        .filter(|(key, (_, created_at))| {
            key.starts_with(user_id) && now - *created_at < Duration::days(7)
        })
        .map(|(key, (report, created_at))| {
            json!({
                "id": key,
                "generated_at": report.generated_at,
                "expires_at": report.expires_at,
                "card_count": report.cards.len(),
                "selected_topics": report.selected_topics,
                "cached_at": created_at.to_rfc3339()
            })
        })
        .collect();

    // 按时间倒序排序
    reports.sort_by(|a, b| {
        let time_a = a["generated_at"].as_str().unwrap_or("");
        let time_b = b["generated_at"].as_str().unwrap_or("");
        time_b.cmp(time_a)
    });

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "reports": reports,
            "total": reports.len()
        })),
    )
}

/// 根据ID获取特定报告
pub async fn get_report_by_id(
    State(_db): State<DatabaseConnection>,
    axum::extract::Path(report_id): axum::extract::Path<String>,
) -> (StatusCode, Json<Value>) {
    let cache = REPORT_CACHE.lock().unwrap();

    if let Some((report, created_at)) = cache.get(&report_id) {
        let now = Utc::now();
        if now - *created_at < Duration::days(7) {
            return (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "report": report,
                    "from_cache": true
                })),
            );
        }
    }

    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "success": false,
            "message": "Report not found or expired"
        })),
    )
}

/// 获取最近一次获取的原始元数据（用于调试）
pub async fn get_raw_metadata(State(_db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    tracing::info!("📊 Reading cached platform metadata for debugging...");

    // 尝试从缓存文件读取
    if let Some(cache) = load_platform_data_cache() {
        let age = Utc::now() - cache.fetched_at;
        let age_hours = age.num_hours();

        tracing::info!("✅ Found cached platform data (age: {}h)", age_hours);

        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "data": cache.data,
                "fetched_at": cache.fetched_at.to_rfc3339(),
                "cache_age_hours": age_hours,
                "is_fresh": age_hours < PLATFORM_CACHE_HOURS
            })),
        );
    }

    // 如果没有缓存，返回提示信息
    tracing::warn!("⚠️ No cached platform data found");
    (
        StatusCode::OK,
        Json(json!({
            "success": false,
            "message": "No cached platform data found. Please fetch data first or generate a report.",
            "data": {}
        })),
    )
}

/// 获取所有缓存数据的详细信息（用于调试）
pub async fn get_cache_debug_info(
    State(_db): State<DatabaseConnection>,
) -> (StatusCode, Json<Value>) {
    let cache = REPORT_CACHE.lock().unwrap();
    let now = Utc::now();

    // 加载平台数据缓存以获取原始数据
    let platform_cache = load_platform_data_cache();
    let raw_data = platform_cache.as_ref().map(|c| c.data.clone());

    let cache_info: Vec<Value> = cache
        .iter()
        .map(|(key, (report, created_at))| {
            let age_seconds = (now - *created_at).num_seconds();
            let age_hours = age_seconds / 3600;
            let age_days = age_seconds / 86400;

            json!({
                "cache_key": key,
                "card_count": report.cards.len(),
                "selected_topics": report.selected_topics,
                "generated_at": report.generated_at,
                "expires_at": report.expires_at,
                "cached_at": created_at.to_rfc3339(),
                "age": {
                    "seconds": age_seconds,
                    "hours": age_hours,
                    "days": age_days
                },
                "is_valid": age_days < 7,
                "raw_data": raw_data.as_ref()
            })
        })
        .collect();

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "total_entries": cache_info.len(),
            "cache_entries": cache_info,
            "max_entries": MAX_CACHE_ENTRIES,
            "cache_file": CACHE_FILE_PATH
        })),
    )
}

/// 从缓存中获取用户信息（支持多平台）
pub async fn get_user_info(State(_db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    // 从缓存获取平台数据
    if let Some(cache) = load_platform_data_cache() {
        let data = &cache.data;

        // 优先从 Bilibili 获取
        if let Some(bilibili_user) = data.get("bilibili").and_then(|b| b.get("user")) {
            return (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "user_info": {
                        "name": bilibili_user.get("name"),
                        "avatar": bilibili_user.get("face"),
                        "bio": bilibili_user.get("sign").and_then(|s| s.as_str()).filter(|s| !s.is_empty()).unwrap_or("这家伙很懒，没有介绍呢"),
                        "platform": "Bilibili"
                    }
                })),
            );
        }

        // 其次从 GitHub 获取
        if let Some(github_user) = data.get("github").and_then(|g| g.get("user")) {
            return (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "user_info": {
                        "name": github_user.get("name").and_then(|n| n.as_str()).or_else(|| github_user.get("login").and_then(|l| l.as_str())),
                        "avatar": github_user.get("avatar_url"),
                        "bio": github_user.get("bio").and_then(|b| b.as_str()).filter(|s| !s.is_empty()).unwrap_or("这家伙很懒，没有介绍呢"),
                        "platform": "GitHub"
                    }
                })),
            );
        }

        // 最后从 Steam 获取
        if let Some(steam_user) = data.get("steam").and_then(|s| s.get("user")) {
            return (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "user_info": {
                        "name": steam_user.get("personaname"),
                        "avatar": steam_user.get("avatarfull").or_else(|| steam_user.get("avatar")),
                        "bio": "Steam 玩家",
                        "platform": "Steam"
                    }
                })),
            );
        }
    }

    // 没有缓存或没有用户信息
    (
        StatusCode::NOT_FOUND,
        Json(json!({
            "success": false,
            "message": "No user info found in cache. Please fetch platform data first."
        })),
    )
}

/// 删除平台数据缓存
pub async fn delete_platform_cache(
    State(_db): State<DatabaseConnection>,
) -> (StatusCode, Json<Value>) {
    tracing::info!("🗑️ Deleting platform data cache...");

    let cache_path = PathBuf::from(PLATFORM_CACHE_FILE);

    if cache_path.exists() {
        match fs::remove_file(&cache_path) {
            Ok(_) => {
                tracing::info!("✓ Platform cache deleted successfully");
                (
                    StatusCode::OK,
                    Json(json!({
                        "success": true,
                        "message": "Platform cache deleted successfully"
                    })),
                )
            }
            Err(e) => {
                tracing::error!("❌ Failed to delete cache: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({
                        "success": false,
                        "message": format!("Failed to delete cache: {}", e)
                    })),
                )
            }
        }
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({
                "success": false,
                "message": "Platform cache file not found"
            })),
        )
    }
}

/// 删除指定的报告
pub async fn delete_report_by_id(
    State(_db): State<DatabaseConnection>,
    axum::extract::Path(report_id): axum::extract::Path<String>,
) -> (StatusCode, Json<Value>) {
    tracing::info!("🗑️ Deleting report: {}", report_id);

    let mut cache = REPORT_CACHE.lock().unwrap();

    if cache.remove(&report_id).is_some() {
        drop(cache); // 释放锁

        // 保存到磁盘
        if let Err(e) = save_cache_to_disk() {
            tracing::error!("❌ Failed to save cache after deletion: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "message": format!("Report deleted but failed to save: {}", e)
                })),
            );
        }

        tracing::info!("✓ Report deleted successfully");
        (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "message": "Report deleted successfully"
            })),
        )
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({
                "success": false,
                "message": "Report not found"
            })),
        )
    }
}

/// 删除所有报告
pub async fn delete_all_reports(
    State(_db): State<DatabaseConnection>,
) -> (StatusCode, Json<Value>) {
    tracing::info!("🗑️ Deleting all reports...");

    let mut cache = REPORT_CACHE.lock().unwrap();
    let count = cache.len();
    cache.clear();
    drop(cache); // 释放锁

    // 保存到磁盘
    if let Err(e) = save_cache_to_disk() {
        tracing::error!("❌ Failed to save cache after clearing: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "success": false,
                "message": format!("Reports cleared but failed to save: {}", e)
            })),
        );
    }

    tracing::info!("✓ All {} reports deleted successfully", count);
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": format!("All {} reports deleted successfully", count),
            "deleted_count": count
        })),
    )
}

/// 从报告中删除单个卡片
#[derive(Deserialize)]
pub struct DeleteCardRequest {
    pub card_index: usize,
}

pub async fn delete_card_from_report(
    State(_db): State<DatabaseConnection>,
    axum::extract::Path(report_id): axum::extract::Path<String>,
    Json(payload): Json<DeleteCardRequest>,
) -> (StatusCode, Json<Value>) {
    tracing::info!(
        "🗑️ Deleting card {} from report: {}",
        payload.card_index,
        report_id
    );

    let mut cache = REPORT_CACHE.lock().unwrap();

    if let Some((report, _created_at)) = cache.get_mut(&report_id) {
        if payload.card_index >= report.cards.len() {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "success": false,
                    "message": format!("Card index {} out of range (total: {})", payload.card_index, report.cards.len())
                })),
            );
        }

        // 删除指定索引的卡片
        let deleted_card = report.cards.remove(payload.card_index);
        tracing::info!("✓ Deleted card: {}", deleted_card.title);

        // 如果报告中没有卡片了，删除整个报告
        if report.cards.is_empty() {
            tracing::info!(
                "Report {} has no cards left, deleting entire report",
                report_id
            );
            cache.remove(&report_id);
        }

        drop(cache); // 释放锁

        // 保存到磁盘
        if let Err(e) = save_cache_to_disk() {
            tracing::error!("❌ Failed to save cache after card deletion: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "message": format!("Card deleted but failed to save: {}", e)
                })),
            );
        }

        tracing::info!("✓ Card deleted successfully");
        (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "message": "Card deleted successfully",
                "deleted_card_title": deleted_card.title
            })),
        )
    } else {
        (
            StatusCode::NOT_FOUND,
            Json(json!({
                "success": false,
                "message": "Report not found"
            })),
        )
    }
}
