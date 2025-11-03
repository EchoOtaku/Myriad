use crate::models::topics::select_random_topics;
use crate::services::analyzer::AiAnalyzer;
use crate::services::fetcher::PlatformFetcher;
use axum::{extract::State, http::StatusCode, Json};
use chrono::{DateTime, Duration, Utc};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PersonalReport {
    pub cards: Vec<ReportCard>,
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

// 内存缓存（简单实现，生产环境应使用Redis）
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

type ReportCacheEntry = (PersonalReport, DateTime<Utc>);
type ReportCache = Arc<Mutex<HashMap<String, ReportCacheEntry>>>;

lazy_static::lazy_static! {
    static ref REPORT_CACHE: ReportCache =
        Arc::new(Mutex::new(HashMap::new()));
}

/// 检查缓存是否有效（7天内）
fn get_cached_report(user_id: &str) -> Option<PersonalReport> {
    let cache = REPORT_CACHE.lock().unwrap();
    if let Some((report, created_at)) = cache.get(user_id) {
        let now = Utc::now();
        if now - *created_at < Duration::days(7) {
            return Some(report.clone());
        }
    }
    None
}

/// 保存报告到缓存
fn cache_report(user_id: &str, report: PersonalReport) {
    let mut cache = REPORT_CACHE.lock().unwrap();
    cache.insert(user_id.to_string(), (report, Utc::now()));
}

/// 一键获取所有平台数据
pub async fn fetch_all_data(State(_db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    tracing::info!("Starting fetch all data...");

    let fetcher = PlatformFetcher::new();
    let mut all_data = json!({});

    // 获取GitHub数据
    if let Ok(github_username) = std::env::var("GITHUB_USERNAME") {
        let github_token = std::env::var("GITHUB_TOKEN").ok();
        match fetcher
            .fetch_github_user(&github_username, github_token.as_deref())
            .await
        {
            Ok(user_data) => {
                all_data["github"] = user_data;
                tracing::info!("✓ GitHub data fetched");
            }
            Err(e) => tracing::warn!("GitHub fetch failed: {}", e),
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
                Err(e) => tracing::warn!("Bilibili fetch failed: {}", e),
            }

            // 获取追番数据
            match fetcher.fetch_all_bilibili_bangumi(uid).await {
                Ok(bangumi_data) => {
                    all_data["bilibili"]["bangumi"] = json!(bangumi_data);
                    tracing::info!("✓ Bilibili bangumi data fetched");
                }
                Err(e) => tracing::warn!("Bilibili bangumi fetch failed: {}", e),
            }
        }
    }

    // 获取Steam数据
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
                all_data["steam"]["games"] = json!(games_data);
                tracing::info!("✓ Steam games data fetched");
            }
            Err(e) => tracing::warn!("Steam games fetch failed: {}", e),
        }
    }

    // TODO: 存储到数据库

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "Data fetched successfully",
            "data": all_data,
            "fetched_at": chrono::Utc::now().to_rfc3339()
        })),
    )
}

/// 生成个人报告
pub async fn generate_report(
    State(_db): State<DatabaseConnection>,
    Json(profile_data): Json<Value>,
) -> (StatusCode, Json<Value>) {
    tracing::info!("Generating personal report...");

    let user_id = "default_user"; // TODO: 从认证中获取真实用户ID

    // 检查缓存
    if let Some(cached_report) = get_cached_report(user_id) {
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

    // 随机选择6个话题
    let selected_topics = select_random_topics();
    let topic_ids: Vec<u8> = selected_topics.iter().map(|t| t.id).collect();

    tracing::info!(
        "Selected topics: {:?}",
        selected_topics.iter().map(|t| &t.title).collect::<Vec<_>>()
    );

    // 为每个话题生成内容
    let mut cards = Vec::new();

    for (index, topic) in selected_topics.iter().enumerate() {
        let prompt = format!(
            r#"作为一位懂你的数字人类学家，基于以下用户数据，完成这个分析话题：

话题：{}
分析维度：
{}

用户数据：
{}

请以JSON格式返回分析结果：
{{
  "summary": "一句话总结（20字内）",
  "details": ["要点1", "要点2", "要点3"],
  "highlight": "最有洞察力的发现（可选）",
  "tags": ["标签1", "标签2", "标签3"]
}}

用轻松、有趣、有洞察力的语言。标签应该是2-3个词的简短关键词（如"高产出"、"创意十足"、"持续学习"）。只返回JSON，不要其他文字。"#,
            topic.title,
            topic.prompt_template,
            serde_json::to_string_pretty(&profile_data).unwrap_or_else(|_| "{}".to_string())
        );

        match analyzer.analyze_profile(&json!({"prompt": prompt})).await {
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
                    // 为不同类别分配颜色和图标
                    let (color, icon) = get_card_style(&topic.category);

                    cards.push(ReportCard {
                        topic_id: topic.id,
                        title: topic.title.clone(),
                        category: topic.category.clone(),
                        icon,
                        color,
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

/// 根据类别获取卡片样式
fn get_card_style(category: &str) -> (String, String) {
    match category {
        "隐喻类" => ("from-blue-400 to-cyan-400".to_string(), "🌈".to_string()),
        "游戏化" => ("from-purple-400 to-pink-400".to_string(), "🎮".to_string()),
        "科学实验室" => ("from-green-400 to-teal-400".to_string(), "🔬".to_string()),
        "旅行地图" => ("from-orange-400 to-red-400".to_string(), "🗺️".to_string()),
        "剧场角色" => ("from-pink-400 to-rose-400".to_string(), "🎭".to_string()),
        "美食配方" => ("from-yellow-400 to-amber-400".to_string(), "🍜".to_string()),
        "宇宙玄学" => (
            "from-indigo-400 to-purple-400".to_string(),
            "🌌".to_string(),
        ),
        "占卜预测" => (
            "from-violet-400 to-fuchsia-400".to_string(),
            "🔮".to_string(),
        ),
        "社交关系" => (
            "from-emerald-400 to-green-400".to_string(),
            "🎪".to_string(),
        ),
        "对比镜像" => ("from-sky-400 to-blue-400".to_string(), "📊".to_string()),
        "惊喜彩蛋" => ("from-rose-400 to-pink-400".to_string(), "🎁".to_string()),
        _ => ("from-gray-400 to-slate-400".to_string(), "✨".to_string()),
    }
}

/// 获取已保存的报告
pub async fn get_report(State(_db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    let user_id = "default_user"; // TODO: 从认证中获取真实用户ID

    // 检查缓存
    if let Some(cached_report) = get_cached_report(user_id) {
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
