//! AI 处理能力处理器
//!
//! 处理 ai.summarize, ai.analyze, ai.chat, ai.groundingSearch 等 AI 类能力

use super::HandlerContext;
use crate::GLOBAL_DYNAMIC_CONFIG;
use serde_json::{json, Value};
use std::collections::HashMap;

/// 执行 AI 处理能力
pub async fn execute(
    capability_id: &str,
    action: &str,
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let analyzer = ctx
        .ai_analyzer
        .ok_or("AI analyzer not configured")?;

    match capability_id {
        "ai.summarize" => execute_ai_summarize(params, analyzer).await,
        "ai.analyze" => execute_ai_analyze(params, analyzer).await,
        "ai.recommend" => execute_ai_recommend(params, analyzer).await,
        "ai.chat" => execute_ai_chat(params, analyzer).await,
        "ai.webSearch" | "ai.groundingSearch" => execute_gemini_grounding_search_wrapper(params).await,
        "brewlia.annotate" => execute_brewlia_annotate(params, analyzer).await,
        "brewlia.podcast" => execute_brewlia_podcast(params, analyzer).await,
        "speech.tts" => execute_speech_tts(params).await,
        "smart.filter" => execute_smart_filter(params, analyzer).await,
        "compare.content" => execute_compare_content(params, analyzer).await,
        "icon.recommend" => execute_icon_recommend(params).await,
        "prompt.generate" => execute_prompt_generate(params, analyzer).await,
        "translate.text" => execute_translate_text(params, analyzer).await,
        "code.explain" => execute_code_explain(params, analyzer).await,
        _ => Err(format!(
            "Unknown AI capability: {} (action: {})",
            capability_id, action
        )),
    }
}

// ============================================================================
// AI 核心能力
// ============================================================================

async fn execute_ai_summarize(
    params: &HashMap<String, Value>,
    analyzer: &crate::services::analyzer::AiAnalyzer,
) -> Result<Value, String> {
    let input = params.get("input").cloned().unwrap_or(json!(null));
    let style = params
        .get("style")
        .and_then(|v| v.as_str())
        .unwrap_or("brief");

    let prompt = format!(
        "请对以下内容进行{}总结：\n\n{}",
        match style {
            "detailed" => "详细",
            "bullet" => "要点式",
            _ => "简要",
        },
        serde_json::to_string_pretty(&input).unwrap_or_default()
    );

    let result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("AI summarize failed: {}", e))?;

    Ok(json!({
        "summary": result,
        "style": style
    }))
}

async fn execute_ai_analyze(
    params: &HashMap<String, Value>,
    analyzer: &crate::services::analyzer::AiAnalyzer,
) -> Result<Value, String> {
    let input = params.get("input").cloned().unwrap_or(json!(null));
    let analysis_type = params
        .get("analysisType")
        .and_then(|v| v.as_str())
        .unwrap_or("general");

    let prompt = match analysis_type {
        "trend" => format!(
            "请分析以下数据的趋势：\n\n{}",
            serde_json::to_string_pretty(&input).unwrap_or_default()
        ),
        "sentiment" => format!(
            "请分析以下内容的情感倾向：\n\n{}",
            serde_json::to_string_pretty(&input).unwrap_or_default()
        ),
        "compare" => format!(
            "请比较以下数据的异同：\n\n{}",
            serde_json::to_string_pretty(&input).unwrap_or_default()
        ),
        _ => format!(
            "请分析以下数据并提供见解：\n\n{}",
            serde_json::to_string_pretty(&input).unwrap_or_default()
        ),
    };

    let result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("AI analysis failed: {}", e))?;

    Ok(json!({
        "analysis": result,
        "type": analysis_type
    }))
}

async fn execute_ai_recommend(
    params: &HashMap<String, Value>,
    analyzer: &crate::services::analyzer::AiAnalyzer,
) -> Result<Value, String> {
    let context = params.get("context").cloned().unwrap_or(json!({}));
    let count = params.get("count").and_then(|v| v.as_u64()).unwrap_or(5);

    let prompt = format!(
        "基于以下用户数据，推荐 {} 个相关内容：\n\n{}",
        count,
        serde_json::to_string_pretty(&context).unwrap_or_default()
    );

    let result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("AI recommendation failed: {}", e))?;

    Ok(json!({
        "recommendations": result,
        "count": count
    }))
}

async fn execute_ai_chat(
    params: &HashMap<String, Value>,
    analyzer: &crate::services::analyzer::AiAnalyzer,
) -> Result<Value, String> {
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .ok_or("Missing message parameter")?;

    let system_prompt = params
        .get("systemPrompt")
        .and_then(|v| v.as_str())
        .unwrap_or("你是一个友好的AI助手，擅长帮助用户处理各种问题。");

    let context = params.get("context").and_then(|v| v.as_array());

    let mut full_prompt = format!("系统提示：{}\n\n", system_prompt);

    if let Some(history) = context {
        for msg in history {
            if let (Some(role), Some(content)) = (
                msg.get("role").and_then(|v| v.as_str()),
                msg.get("content").and_then(|v| v.as_str()),
            ) {
                full_prompt.push_str(&format!("{}：{}\n", role, content));
            }
        }
    }

    full_prompt.push_str(&format!("用户：{}\n\n请回复：", message));

    let result = analyzer
        .analyze(&full_prompt)
        .await
        .map_err(|e| format!("AI chat failed: {}", e))?;

    Ok(json!({
        "reply": result
    }))
}

/// Gemini Grounding Search 包装器
async fn execute_gemini_grounding_search_wrapper(
    params: &HashMap<String, Value>,
) -> Result<Value, String> {
    let query = params
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or("Missing query parameter")?;

    let search_type = params
        .get("searchType")
        .and_then(|v| v.as_str())
        .unwrap_or("general");

    let max_results = params
        .get("maxResults")
        .and_then(|v| v.as_u64())
        .unwrap_or(5) as usize;

    let (ai_text, results) = execute_gemini_grounding_search(query, search_type, max_results).await?;

    Ok(json!({
        "success": true,
        "query": query,
        "searchType": search_type,
        "aiSummary": ai_text,
        "results": results,
        "totalResults": results.len()
    }))
}

/// 使用 Gemini Grounding (Google Search) 进行联网搜索
async fn execute_gemini_grounding_search(
    query: &str,
    search_type: &str,
    max_results: usize,
) -> Result<(String, Vec<Value>), String> {
    // 从全局配置读取
    let config = GLOBAL_DYNAMIC_CONFIG.read().await;

    let api_key = config
        .gemini_api_key
        .clone()
        .ok_or("Gemini API Key 未配置")?;

    if api_key.is_empty() {
        return Err("Gemini API Key 未配置".to_string());
    }

    let model = if config.gemini_model.is_empty() {
        "gemini-3-flash-preview".to_string() // 使用支持 grounding 的模型
    } else {
        config.gemini_model.clone()
    };

    drop(config);

    // 构建搜索提示词
    let search_prompt = match search_type {
        "rss_source" => format!(
            "搜索「{}」的 RSS 或 Atom 订阅源地址。\n\
            要求：\n\
            1. 返回可直接访问的 RSS/Atom feed URL\n\
            2. 优先返回官方 RSS 源\n\
            3. 也可以返回 RSSHub (rsshub.app) 提供的路由\n\
            4. 最多返回 {} 个结果\n\n\
            请以 JSON 数组格式返回，每个元素包含：\n\
            - name: 源名称\n\
            - url: RSS/Atom feed URL\n\
            - description: 简要说明\n\
            - source: 来源（official/rsshub/third-party）",
            query, max_results
        ),
        "api_docs" => format!(
            "搜索「{}」的官方 API 文档链接。最多返回 {} 个结果。\n\
            以 JSON 数组格式返回，每个元素包含：name, url, description",
            query, max_results
        ),
        _ => format!(
            "搜索关于「{}」的信息，最多返回 {} 个相关结果。\n\
            以 JSON 数组格式返回结果。",
            query, max_results
        ),
    };

    // 构建 Gemini API 请求（带 Google Search grounding）
    let request_body = json!({
        "contents": [{
            "parts": [{
                "text": search_prompt
            }]
        }],
        "tools": [{
            "google_search": {}
        }],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 2048
        }
    });

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    tracing::info!("🔍 Calling Gemini Grounding Search for: {}", query);

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Gemini API request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Gemini API error {}: {}", status, error_text));
    }

    let response_json: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

    // 提取 AI 回复内容
    let ai_text = response_json
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.get(0))
        .and_then(|p| p.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("");

    // 尝试从回复中提取 JSON 数组
    let mut results = extract_json_array_from_text(ai_text);

    // 提取 grounding 元数据中的搜索结果
    if let Some(grounding_metadata) = response_json
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("groundingMetadata"))
    {
        if let Some(chunks) = grounding_metadata
            .get("groundingChunks")
            .and_then(|c| c.as_array())
        {
            for chunk in chunks {
                if let Some(web) = chunk.get("web") {
                    let uri = web.get("uri").and_then(|u| u.as_str()).unwrap_or("");
                    let title = web.get("title").and_then(|t| t.as_str()).unwrap_or("");

                    if results.is_empty() && !uri.is_empty() {
                        results.push(json!({
                            "name": title,
                            "url": uri,
                            "description": format!("来源: {}", title),
                            "source": "google_search"
                        }));
                    }
                }
            }
        }
    }

    // 如果仍然没有结果，返回 AI 的文本回复作为单个结果
    if results.is_empty() && !ai_text.is_empty() {
        results.push(json!({
            "name": "AI 搜索结果",
            "description": ai_text,
            "source": "gemini_grounding"
        }));
    }

    Ok((ai_text.to_string(), results))
}

/// 从文本中提取 JSON 数组
fn extract_json_array_from_text(text: &str) -> Vec<Value> {
    // 尝试找到 JSON 数组
    let json_start = text.find('[');
    let json_end = text.rfind(']');

    if let (Some(start), Some(end)) = (json_start, json_end) {
        if end > start {
            let json_str = &text[start..=end];
            if let Ok(arr) = serde_json::from_str::<Vec<Value>>(json_str) {
                return arr;
            }
        }
    }

    // 尝试解析 markdown 代码块中的 JSON
    if text.contains("```json") {
        let parts: Vec<&str> = text.split("```json").collect();
        if parts.len() > 1 {
            if let Some(json_part) = parts[1].split("```").next() {
                if let Ok(arr) = serde_json::from_str::<Vec<Value>>(json_part.trim()) {
                    return arr;
                }
            }
        }
    }

    vec![]
}

// ============================================================================
// Brewlia 能力
// ============================================================================

async fn execute_brewlia_annotate(
    params: &HashMap<String, Value>,
    analyzer: &crate::services::analyzer::AiAnalyzer,
) -> Result<Value, String> {
    let item_id = params
        .get("itemId")
        .and_then(|v| v.as_i64())
        .ok_or("Missing itemId parameter")?;

    let prompt = format!(
        "为文章ID {} 生成阅读注释，包括：\n\
        1. 关键术语解释\n\
        2. 背景知识补充\n\
        3. 相关概念链接\n\
        请以JSON数组格式返回注释列表。",
        item_id
    );

    let result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("Annotation generation failed: {}", e))?;

    let annotations: Value = serde_json::from_str(&result).unwrap_or(json!([{
        "type": "note",
        "term": "AI 生成注释",
        "explanation": result
    }]));

    Ok(json!({
        "annotations": annotations,
        "fromCache": false,
        "itemId": item_id
    }))
}

async fn execute_brewlia_podcast(
    params: &HashMap<String, Value>,
    analyzer: &crate::services::analyzer::AiAnalyzer,
) -> Result<Value, String> {
    let item_id = params
        .get("itemId")
        .and_then(|v| v.as_i64())
        .ok_or("Missing itemId parameter")?;

    let style = params
        .get("style")
        .and_then(|v| v.as_str())
        .unwrap_or("casual");

    let style_desc = match style {
        "professional" => "专业、正式的商业播客风格",
        "educational" => "教育性质、通俗易懂的讲解风格",
        _ => "轻松、对话式的闲聊风格",
    };

    let prompt = format!(
        "将文章ID {} 转换为播客对话文稿。\n\
        风格要求：{}\n\
        格式要求：\n\
        - 两个主持人对话\n\
        - 开场介绍、正文讨论、结尾总结\n\
        - 每段对话标注说话人\n\
        请直接输出对话文稿。",
        item_id, style_desc
    );

    let result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("Podcast script generation failed: {}", e))?;

    let estimated_duration = result.chars().count() as f64 / 150.0;

    Ok(json!({
        "script": result,
        "duration": estimated_duration,
        "style": style,
        "itemId": item_id
    }))
}

// ============================================================================
// 其他 AI 能力
// ============================================================================

async fn execute_speech_tts(params: &HashMap<String, Value>) -> Result<Value, String> {
    let text = params
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or("Missing text parameter")?;

    let voice = params
        .get("voice")
        .and_then(|v| v.as_str())
        .unwrap_or("default");

    let speed = params.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.0);

    Ok(json!({
        "success": true,
        "text": text,
        "voice": voice,
        "speed": speed,
        "message": "TTS request queued. Actual audio generation requires speech service integration.",
        "estimatedDuration": text.chars().count() as f64 / 5.0
    }))
}

async fn execute_smart_filter(
    params: &HashMap<String, Value>,
    analyzer: &crate::services::analyzer::AiAnalyzer,
) -> Result<Value, String> {
    let platform = params
        .get("platform")
        .and_then(|v| v.as_str())
        .unwrap_or("all");

    let filtered_file = format!("cache/platforms/{}_filtered.json", platform);

    if let Ok(content) = tokio::fs::read_to_string(&filtered_file).await {
        if let Ok(data) = serde_json::from_str::<Value>(&content) {
            return Ok(json!({
                "platform": platform,
                "status": "cached",
                "data": data.get("content_analysis").cloned().unwrap_or(json!({})),
                "message": "Using cached filtered data"
            }));
        }
    }

    let raw_file = format!("cache/raw/{}.json", platform);
    if let Ok(content) = tokio::fs::read_to_string(&raw_file).await {
        if let Ok(raw_data) = serde_json::from_str::<Value>(&content) {
            let prompt = format!(
                "请分析以下 {} 平台的数据，提取关键信息并分类：\n\n{}\n\n\
                请返回JSON格式的分析结果。",
                platform,
                serde_json::to_string_pretty(&raw_data)
                    .unwrap_or_default()
                    .chars()
                    .take(5000)
                    .collect::<String>()
            );

            let result = analyzer
                .analyze(&prompt)
                .await
                .map_err(|e| format!("Smart filter failed: {}", e))?;

            return Ok(json!({
                "platform": platform,
                "status": "analyzed",
                "analysis": result
            }));
        }
    }

    Err(format!("No data available for platform: {}", platform))
}

async fn execute_compare_content(
    params: &HashMap<String, Value>,
    analyzer: &crate::services::analyzer::AiAnalyzer,
) -> Result<Value, String> {
    let platform = params
        .get("platform")
        .and_then(|v| v.as_str())
        .unwrap_or("all");
    let start_date = params.get("startDate").and_then(|v| v.as_str());
    let end_date = params.get("endDate").and_then(|v| v.as_str());

    let cache_file = format!("cache/platforms/{}_filtered.json", platform);

    if let Ok(content) = tokio::fs::read_to_string(&cache_file).await {
        if let Ok(data) = serde_json::from_str::<Value>(&content) {
            let prompt = format!(
                "请分析以下 {} 平台数据的变化趋势：\n\n{}\n\n\
                时间范围：{} 到 {}\n\n\
                请分析：数据量变化、内容偏好变化、活跃度变化、重要发现",
                platform,
                serde_json::to_string_pretty(&data)
                    .unwrap_or_default()
                    .chars()
                    .take(5000)
                    .collect::<String>(),
                start_date.unwrap_or("开始"),
                end_date.unwrap_or("现在")
            );

            let result = analyzer
                .analyze(&prompt)
                .await
                .map_err(|e| format!("Content comparison failed: {}", e))?;

            return Ok(json!({
                "platform": platform,
                "period": { "start": start_date, "end": end_date },
                "analysis": result
            }));
        }
    }

    Err(format!("No data available for comparison: {}", platform))
}

async fn execute_icon_recommend(params: &HashMap<String, Value>) -> Result<Value, String> {
    let platform_name = params
        .get("platformName")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let platform_lower = platform_name.to_lowercase();

    let (icon_name, color) = if platform_lower.contains("bilibili") || platform_lower.contains("b站") {
        ("SiBilibili", "#00A1D6")
    } else if platform_lower.contains("steam") {
        ("SiSteam", "#000000")
    } else if platform_lower.contains("github") {
        ("SiGithub", "#181717")
    } else if platform_lower.contains("netease") || platform_lower.contains("网易") {
        ("SiNeteasecloudmusic", "#C20C0C")
    } else if platform_lower.contains("twitter") || platform_lower.contains("x") {
        ("SiX", "#000000")
    } else if platform_lower.contains("youtube") {
        ("SiYoutube", "#FF0000")
    } else if platform_lower.contains("spotify") {
        ("SiSpotify", "#1DB954")
    } else if platform_lower.contains("discord") {
        ("SiDiscord", "#5865F2")
    } else {
        ("FaGlobe", "#6B7280")
    };

    Ok(json!({
        "platformName": platform_name,
        "iconType": "react-icons",
        "iconName": icon_name,
        "colorSuggestion": color
    }))
}

async fn execute_prompt_generate(
    params: &HashMap<String, Value>,
    analyzer: &crate::services::analyzer::AiAnalyzer,
) -> Result<Value, String> {
    let title = params.get("title").and_then(|v| v.as_str()).unwrap_or("");
    let summary = params.get("summary").and_then(|v| v.as_str()).unwrap_or("");
    let category = params.get("category").and_then(|v| v.as_str());

    let prompt = format!(
        "为以下活动生成 Studio Ghibli 风格的 AI 绘画提示词：\n\
        标题：{}\n\
        描述：{}\n\
        类别：{}\n\n\
        请生成英文提示词。",
        title,
        summary,
        category.unwrap_or("general")
    );

    let result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("Prompt generation failed: {}", e))?;

    Ok(json!({
        "prompt": result,
        "negativePrompt": "background, scenery, landscape, low quality, blurry",
        "title": title
    }))
}

async fn execute_translate_text(
    params: &HashMap<String, Value>,
    analyzer: &crate::services::analyzer::AiAnalyzer,
) -> Result<Value, String> {
    let text = params
        .get("text")
        .and_then(|v| v.as_str())
        .ok_or("Missing text parameter")?;
    let target_lang = params
        .get("targetLang")
        .and_then(|v| v.as_str())
        .unwrap_or("zh-CN");
    let source_lang = params.get("sourceLang").and_then(|v| v.as_str());

    let prompt = format!(
        "请将以下文本翻译成{}：\n\n{}\n\n直接输出翻译结果。",
        match target_lang {
            "zh-CN" | "zh" => "简体中文",
            "zh-TW" => "繁体中文",
            "en" => "英文",
            "ja" => "日文",
            "ko" => "韩文",
            _ => target_lang,
        },
        text
    );

    let result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("Translation failed: {}", e))?;

    Ok(json!({
        "originalText": text,
        "translated": result.trim(),
        "targetLang": target_lang,
        "sourceLang": source_lang
    }))
}

async fn execute_code_explain(
    params: &HashMap<String, Value>,
    analyzer: &crate::services::analyzer::AiAnalyzer,
) -> Result<Value, String> {
    let code = params
        .get("code")
        .and_then(|v| v.as_str())
        .ok_or("Missing code parameter")?;
    let language = params.get("language").and_then(|v| v.as_str());

    let prompt = format!(
        "请解释以下{}代码的功能和逻辑：\n\n```{}\n{}\n```\n\n\
        请包含：代码整体功能、主要逻辑步骤、关键变量说明。",
        language.unwrap_or(""),
        language.unwrap_or(""),
        code
    );

    let result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("Code explanation failed: {}", e))?;

    let complexity = if code.len() < 100 {
        "简单"
    } else if code.len() < 500 {
        "中等"
    } else {
        "复杂"
    };

    Ok(json!({
        "code": code.chars().take(200).collect::<String>() + if code.len() > 200 { "..." } else { "" },
        "language": language,
        "explanation": result,
        "complexity": complexity
    }))
}
