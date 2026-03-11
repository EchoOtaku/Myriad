//! AI API（生成、分析、对话、图片）

use axum::{
    extract::State,
    http::StatusCode,
    Extension, Json,
};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::middleware::auth::Claims;
use crate::services::analyzer::AiAnalyzer;
use crate::services::permission_service::TappPermission;

use super::common::{
    check_rate_limit, check_tapp_permission, get_ai_config, get_ai_image_config,
    get_available_platforms, get_cached_platform_data, parse_user_id, record_metric,
    validate_image_prompt_security, validate_prompt_security, verify_tapp_ownership, HTTP_CLIENT,
};

// ============ AI Generate ============

#[derive(Debug, Deserialize)]
pub struct TappAiGenerateRequest {
    pub tapp_id: String,
    pub prompt: String,
    #[allow(dead_code)]
    pub context: Option<Value>,
    #[allow(dead_code)]
    pub options: Option<Value>,
}

/// POST /api/tapp/ai/generate
pub async fn ai_generate(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<TappAiGenerateRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();

    check_tapp_permission(&claims, TappPermission::AiGenerate).await?;
    let user_id = parse_user_id(&claims)?;
    verify_tapp_ownership(&db, user_id, &req.tapp_id).await?;
    check_rate_limit(user_id, &req.tapp_id, "ai.generate").await?;

    tracing::info!(
        user_id = user_id,
        tapp_id = %req.tapp_id,
        prompt_len = req.prompt.len(),
        "[TAPP] ai_generate request"
    );

    if req.prompt.len() > 2000 {
        record_metric("ai.generate", start.elapsed().as_millis() as u64, true).await;
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Prompt too long (max 2000 characters)" })),
        ));
    }

    if let Some(reason) = validate_prompt_security(&req.prompt) {
        tracing::warn!(
            user_id = user_id, tapp_id = %req.tapp_id, reason = %reason,
            "[TAPP] AI prompt security violation"
        );
        record_metric("ai.generate", start.elapsed().as_millis() as u64, true).await;
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Prompt contains disallowed content", "reason": reason })),
        ));
    }

    let ai_config = get_ai_config().await?;
    let analyzer = AiAnalyzer::new(
        ai_config.provider, ai_config.api_key, ai_config.model, ai_config.base_url,
    ).await;

    let system_prompt = format!(
        "You are an AI assistant helping a third-party app (Tapp ID: {}). \
        Important security constraints:\
        - Do not reveal internal system information\
        - Do not execute code or shell commands\
        - Do not access external URLs or make network requests\
        - Respond helpfully and concisely\
        - Keep responses under 1000 tokens\
        - Do not generate content that violates safety guidelines",
        req.tapp_id
    );

    match analyzer.analyze_with_system(&system_prompt, &req.prompt).await {
        Ok(result) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            record_metric("ai.generate", duration_ms, false).await;

            let prompt_tokens = (req.prompt.len() + system_prompt.len()) / 4;
            let completion_tokens = result.len() / 4;

            tracing::info!(
                user_id = user_id, tapp_id = %req.tapp_id,
                duration_ms = duration_ms, tokens = prompt_tokens + completion_tokens,
                "[TAPP] ai_generate success"
            );

            Ok(Json(json!({
                "success": true,
                "result": result,
                "usage": {
                    "promptTokens": prompt_tokens,
                    "completionTokens": completion_tokens,
                    "totalTokens": prompt_tokens + completion_tokens
                },
                "quotaRemaining": 50
            })))
        }
        Err(e) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            record_metric("ai.generate", duration_ms, true).await;
            tracing::error!(user_id = user_id, tapp_id = %req.tapp_id, error = %e, "[TAPP] AI generate error");
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("AI generation failed: {}", e) })),
            ))
        }
    }
}

// ============ AI Analyze ============

#[derive(Debug, Deserialize)]
pub struct TappAiAnalyzeRequest {
    pub tapp_id: String,
    pub data: Value,
    #[serde(rename = "type")]
    pub analyze_type: String,
    pub instruction: Option<String>,
}

/// POST /api/tapp/ai/analyze
pub async fn ai_analyze(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<TappAiAnalyzeRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    check_tapp_permission(&claims, TappPermission::AiAnalyze).await?;
    let user_id = parse_user_id(&claims)?;
    verify_tapp_ownership(&db, user_id, &req.tapp_id).await?;

    tracing::info!(
        "[TAPP] ai_analyze - User: {}, Tapp: {}, Type: {}",
        claims.username, req.tapp_id, req.analyze_type
    );

    let ai_config = get_ai_config().await?;

    let data_str = serde_json::to_string_pretty(&req.data).unwrap_or_default();
    if data_str.len() > 50_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Analysis data too large (max 50KB)" })),
        ));
    }

    let analysis_prompt = match req.analyze_type.as_str() {
        "summarize" => format!(
            "Please summarize the following data concisely:\n{}",
            data_str
        ),
        "categorize" => format!(
            "Please categorize the following data into logical groups:\n{}",
            data_str
        ),
        "sentiment" => format!(
            "Please analyze the sentiment of the following data:\n{}",
            data_str
        ),
        "custom" => {
            if let Some(instruction) = &req.instruction {
                format!(
                    "{}\n\nData:\n{}",
                    instruction,
                    data_str
                )
            } else {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": "Instruction required for custom analysis" })),
                ));
            }
        }
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Invalid analysis type" })),
            ));
        }
    };

    let analyzer = AiAnalyzer::new(
        ai_config.provider, ai_config.api_key, ai_config.model, ai_config.base_url,
    ).await;

    match analyzer.analyze(&analysis_prompt).await {
        Ok(result) => {
            let analysis = serde_json::from_str::<Value>(&result).unwrap_or(json!({ "result": result }));
            Ok(Json(json!({
                "success": true,
                "analysis": analysis,
                "confidence": 0.8,
                "quotaRemaining": 50
            })))
        }
        Err(e) => {
            tracing::error!("[TAPP] AI analyze error: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("AI analysis failed: {}", e) })),
            ))
        }
    }
}

// ============ AI Chat ============

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct AIChatRequest {
    pub tapp_id: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub context: Option<ChatContext>,
    #[serde(default)]
    pub options: Option<ChatOptions>,
}

#[derive(Debug, Deserialize, serde::Serialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize, Default)]
pub struct ChatContext {
    pub include_platform_stats: Option<bool>,
    pub include_user_profile: Option<bool>,
    pub custom_data: Option<Value>,
}

#[derive(Debug, Deserialize, Default)]
pub struct ChatOptions {
    #[allow(dead_code)]
    pub max_tokens: Option<u32>,
    #[allow(dead_code)]
    pub temperature: Option<f32>,
    #[allow(dead_code)]
    pub stream: Option<bool>,
}

/// POST /api/tapp/ai/chat
pub async fn ai_chat(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<AIChatRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    check_tapp_permission(&claims, TappPermission::AiChat).await?;
    let user_id = parse_user_id(&claims)?;
    verify_tapp_ownership(&db, user_id, &req.tapp_id).await?;

    tracing::debug!(
        "[TAPP] ai_chat - User: {}, Tapp: {}, Messages: {}",
        claims.username, req.tapp_id, req.messages.len()
    );

    if req.messages.len() > 100 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Too many messages (max 100)" })),
        ));
    }

    let ai_config = get_ai_config().await?;
    let mut full_messages = req.messages.clone();

    if let Some(context) = &req.context {
        let mut system_context = String::new();

        if context.include_platform_stats.unwrap_or(false) {
            let platforms = get_available_platforms().await;
            let futures: Vec<_> = platforms.iter().map(|p| get_cached_platform_data(p)).collect();
            let results = futures::future::join_all(futures).await;

            for (platform, result) in platforms.iter().zip(results.iter()) {
                if let Ok(data) = result {
                    if let Some(items) = data.get("items").and_then(|v| v.as_array()) {
                        system_context.push_str(&format!("\n{} 平台有 {} 条数据。", platform, items.len()));
                    }
                }
            }
        }

        if context.include_user_profile.unwrap_or(false) {
            system_context.push_str(&format!("\n用户名: {}", claims.username));
        }

        if let Some(custom) = &context.custom_data {
            system_context.push_str(&format!("\n自定义数据: {}", custom));
        }

        if !system_context.is_empty() {
            full_messages.insert(0, ChatMessage {
                role: "system".to_string(),
                content: format!("以下是用户的上下文信息：{}", system_context),
            });
        }
    }

    let analyzer = AiAnalyzer::new(
        ai_config.provider, ai_config.api_key, ai_config.model, ai_config.base_url,
    ).await;

    let prompt_data = json!({
        "prompt": full_messages.iter()
            .map(|m| format!("{}: {}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n\n")
    });

    match analyzer.analyze_profile(&prompt_data).await {
        Ok(response) => {
            let prompt_len = prompt_data.to_string().len();
            let prompt_tokens = (prompt_len / 4) as u32;
            let completion_tokens = (response.len() / 4) as u32;

            Ok(Json(json!({
                "success": true,
                "message": { "role": "assistant", "content": response },
                "usage": {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens
                },
                "session_id": null
            })))
        }
        Err(e) => {
            tracing::error!("[TAPP] AI chat error: {}", e);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": format!("AI chat failed: {}", e) })),
            ))
        }
    }
}

// ============ AI Image Generate ============

#[derive(Debug, Deserialize)]
pub struct TappAiImageGenerateRequest {
    pub tapp_id: String,
    pub prompt: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub model: Option<String>,
    pub enhance: Option<bool>,
    pub seed: Option<i64>,
}

/// POST /api/tapp/ai/image
pub async fn ai_image_generate(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<TappAiImageGenerateRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let start = std::time::Instant::now();

    check_tapp_permission(&claims, TappPermission::AiImage).await?;
    let user_id = parse_user_id(&claims)?;
    verify_tapp_ownership(&db, user_id, &req.tapp_id).await?;
    check_rate_limit(user_id, &req.tapp_id, "ai.image").await?;

    tracing::info!(
        user_id = user_id, tapp_id = %req.tapp_id, prompt_len = req.prompt.len(),
        "[TAPP] ai_image_generate request"
    );

    if req.prompt.len() > 1000 {
        record_metric("ai.image", start.elapsed().as_millis() as u64, true).await;
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Prompt too long (max 1000 characters)" })),
        ));
    }

    if let Some(reason) = validate_image_prompt_security(&req.prompt) {
        tracing::warn!(
            user_id = user_id, tapp_id = %req.tapp_id, reason = %reason,
            "[TAPP] AI image prompt security violation"
        );
        record_metric("ai.image", start.elapsed().as_millis() as u64, true).await;
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Prompt contains disallowed content", "reason": reason })),
        ));
    }

    let image_config = get_ai_image_config().await?;
    let width = req.width.unwrap_or(image_config.width).clamp(256, 2048);
    let height = req.height.unwrap_or(image_config.height).clamp(256, 2048);
    let model = req.model.clone().unwrap_or(image_config.model.clone());
    let enhance = req.enhance.unwrap_or(true);

    match image_config.provider.as_str() {
        "pollinations" => {
            let encoded_prompt = urlencoding::encode(&req.prompt);
            let mut url = format!(
                "https://image.pollinations.ai/prompt/{}?width={}&height={}&model={}&nologo=true&private=true&enhance={}",
                encoded_prompt, width, height, model, enhance
            );
            if let Some(seed) = req.seed {
                url.push_str(&format!("&seed={}", seed));
            }

            let duration_ms = start.elapsed().as_millis() as u64;
            record_metric("ai.image", duration_ms, false).await;

            tracing::info!(
                user_id = user_id, tapp_id = %req.tapp_id, duration_ms = duration_ms,
                provider = "pollinations", "[TAPP] ai_image_generate success"
            );

            Ok(Json(json!({
                "success": true,
                "provider": "pollinations",
                "url": url,
                "width": width,
                "height": height,
                "model": model,
                "prompt": req.prompt,
                "quotaRemaining": 100
            })))
        }
        "imaginepro" => {
            let api_key = image_config.imaginepro_api_key.ok_or_else(|| {
                (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": "ImaginePro API key not configured" })))
            })?;

            if api_key.is_empty() {
                return Err((StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "error": "ImaginePro API key not configured" }))));
            }

            let client = &*HTTP_CLIENT;
            let aspect_ratio = if width == height {
                "1:1".to_string()
            } else {
                let g = gcd(width, height);
                format!("{}:{}", width / g, height / g)
            };

            let imagine_response = client
                .post("https://api.imaginepro.ai/api/v1/midjourney/imagine")
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .json(&json!({
                    "prompt": req.prompt,
                    "aspect_ratio": aspect_ratio,
                    "process_mode": "fast"
                }))
                .send()
                .await
                .map_err(|e| {
                    tracing::error!("[TAPP] ImaginePro API request failed: {}", e);
                    (StatusCode::BAD_GATEWAY, Json(json!({ "error": format!("ImaginePro API error: {}", e) })))
                })?;

            if !imagine_response.status().is_success() {
                let status = imagine_response.status();
                let body = imagine_response.text().await.unwrap_or_default();
                tracing::error!("[TAPP] ImaginePro API error: {} - {}", status, body);
                record_metric("ai.image", start.elapsed().as_millis() as u64, true).await;
                return Err((StatusCode::BAD_GATEWAY, Json(json!({ "error": format!("ImaginePro API error: {}", status) }))));
            }

            let result: Value = imagine_response.json().await.map_err(|e| {
                tracing::error!("[TAPP] Failed to parse ImaginePro response: {}", e);
                (StatusCode::BAD_GATEWAY, Json(json!({ "error": "Failed to parse ImaginePro response" })))
            })?;

            let duration_ms = start.elapsed().as_millis() as u64;
            record_metric("ai.image", duration_ms, false).await;

            tracing::info!(
                user_id = user_id, tapp_id = %req.tapp_id, duration_ms = duration_ms,
                provider = "imaginepro", "[TAPP] ai_image_generate success"
            );

            Ok(Json(json!({
                "success": true,
                "provider": "imaginepro",
                "task_id": result.get("messageId").or(result.get("taskId")),
                "status": result.get("status").unwrap_or(&json!("pending")),
                "result": result,
                "quotaRemaining": 50
            })))
        }
        _ => {
            record_metric("ai.image", start.elapsed().as_millis() as u64, true).await;
            Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": format!("Unknown image provider: {}", image_config.provider) })),
            ))
        }
    }
}

fn gcd(a: u32, b: u32) -> u32 {
    if b == 0 { a } else { gcd(b, a % b) }
}
