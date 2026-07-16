//! AI API（生成、分析、对话、图片）

use axum::{extract::State, http::StatusCode, Extension, Json};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::middleware::auth::Claims;
use crate::services::analyzer::AiAnalyzer;
use crate::services::permission_service::TappPermission;

use super::ai_quota::{
    get_ai_usage, release_ai_token_reservation, reserve_ai_quota, settle_ai_quota,
};
use super::common::{
    authorize_tapp_permission, check_rate_limit, current_tapp_user_role, get_ai_config_for_tier,
    get_ai_image_config, get_available_platforms, get_cached_platform_data, record_metric,
    validate_image_prompt_security, validate_prompt_security, HTTP_CLIENT,
};
use super::runtime_grant::RuntimeGrantContext;

/// GET /api/tapp/ai/usage
pub async fn ai_usage(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if ![
        TappPermission::AiGenerate,
        TappPermission::AiAnalyze,
        TappPermission::AiChat,
        TappPermission::AiImage,
    ]
    .into_iter()
    .any(|permission| runtime_grant.has(permission))
    {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Runtime grant has no AI capability",
                "code": "RUNTIME_GRANT_PERMISSION_DENIED"
            })),
        ));
    }

    let role = current_tapp_user_role(&claims).await;
    let usage = get_ai_usage(
        &db,
        role,
        runtime_grant.subject_id(),
        runtime_grant.owner_id(),
        runtime_grant.tapp_id(),
    )
    .await?;
    Ok(Json(json!({ "success": true, "usage": usage })))
}

// ============ AI Generate ============

#[derive(Debug, Deserialize)]
pub struct TappAiGenerateRequest {
    pub tapp_id: String,
    pub prompt: String,
    pub context: Option<Value>,
    pub options: Option<Value>,
    /// 是否偏好使用 Pro 模型（可选，默认 false，Pro 未配置时自动回退标准模型）
    #[serde(default)]
    pub prefer_pro: Option<bool>,
}

/// POST /api/tapp/ai/generate
pub async fn ai_generate(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
    Json(req): Json<TappAiGenerateRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require_tapp_id(&req.tapp_id)?;
    runtime_grant.require(TappPermission::AiGenerate)?;
    if req.context.is_some() || req.options.is_some() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Legacy generate context/options are not implemented; use the AI Task API",
                "code": "UNSUPPORTED_V1_OPTION",
                "fields": ["context", "options"]
            })),
        ));
    }
    let start = std::time::Instant::now();

    // 输入验证前置：在昂贵的权限/DB查询之前进行廉价检查
    if req.prompt.len() > 2000 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Prompt too long (max 2000 characters)" })),
        ));
    }

    if let Some(reason) = validate_prompt_security(&req.prompt) {
        tracing::warn!(
            tapp_id = %req.tapp_id, reason = %reason,
            "[TAPP] AI prompt security violation"
        );
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Prompt contains disallowed content", "reason": reason })),
        ));
    }

    let user_id =
        authorize_tapp_permission(&db, &claims, &req.tapp_id, TappPermission::AiGenerate).await?;
    check_rate_limit(user_id, &req.tapp_id, "ai.generate").await?;

    tracing::info!(
        user_id = user_id,
        tapp_id = %req.tapp_id,
        prompt_len = req.prompt.len(),
        "[TAPP] ai_generate request"
    );

    let tier = if req.prefer_pro.unwrap_or(false) {
        crate::config::ModelTier::Pro
    } else {
        crate::config::ModelTier::Standard
    };
    let ai_config = get_ai_config_for_tier(tier).await?;
    let analyzer = AiAnalyzer::new(
        ai_config.provider,
        ai_config.api_key,
        ai_config.model,
        ai_config.base_url,
    )
    .await;

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
    let role = current_tapp_user_role(&claims).await;
    let reservation = reserve_ai_quota(
        &db,
        role,
        user_id,
        runtime_grant.owner_id(),
        &req.tapp_id,
        (req.prompt.len() + system_prompt.len()) / 4 + 1000,
    )
    .await?;

    match analyzer
        .analyze_with_system(&system_prompt, &req.prompt)
        .await
    {
        Ok(result) => {
            let duration_ms = start.elapsed().as_millis() as u64;
            record_metric("ai.generate", duration_ms, false).await;

            let prompt_tokens = (req.prompt.len() + system_prompt.len()) / 4;
            let completion_tokens = result.len() / 4;
            settle_ai_quota(&db, &reservation, prompt_tokens + completion_tokens).await?;
            let usage_snapshot =
                get_ai_usage(&db, role, user_id, runtime_grant.owner_id(), &req.tapp_id).await?;

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
                "usageSnapshot": usage_snapshot
            })))
        }
        Err(e) => {
            if let Err(error) = release_ai_token_reservation(&db, &reservation).await {
                tracing::error!(?error, "[TAPP] Failed to release AI token reservation");
            }
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
    /// 是否偏好使用 Pro 模型（可选，默认 false，Pro 未配置时自动回退标准模型）
    #[serde(default)]
    pub prefer_pro: Option<bool>,
}

/// POST /api/tapp/ai/analyze
pub async fn ai_analyze(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
    Json(req): Json<TappAiAnalyzeRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require_tapp_id(&req.tapp_id)?;
    runtime_grant.require(TappPermission::AiAnalyze)?;
    // 输入验证前置
    let data_str = serde_json::to_string_pretty(&req.data).unwrap_or_default();
    if data_str.len() > 50_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Analysis data too large (max 50KB)" })),
        ));
    }

    let user_id =
        authorize_tapp_permission(&db, &claims, &req.tapp_id, TappPermission::AiAnalyze).await?;
    check_rate_limit(user_id, &req.tapp_id, "ai.analyze").await?;

    tracing::info!(
        "[TAPP] ai_analyze - User: {}, Tapp: {}, Type: {}",
        claims.username,
        req.tapp_id,
        req.analyze_type
    );

    let tier = if req.prefer_pro.unwrap_or(false) {
        crate::config::ModelTier::Pro
    } else {
        crate::config::ModelTier::Standard
    };
    let ai_config = get_ai_config_for_tier(tier).await?;

    let analysis_prompt = match req.analyze_type.as_str() {
        "summarize" => format!(
            "You are a data analysis assistant. Please provide a clear, structured summary of the following data.\n\n\
            Requirements:\n\
            - Identify the most important information and key takeaways\n\
            - Organize the summary with clear structure\n\
            - Keep it concise but comprehensive\n\n\
            Data:\n{}",
            data_str
        ),
        "categorize" => format!(
            "You are a data classification specialist. Please categorize the following data into logical, meaningful groups.\n\n\
            Requirements:\n\
            - Create clear, distinct categories\n\
            - Place each item in the most appropriate category\n\
            - Return results as a JSON object where keys are category names and values are arrays of items\n\n\
            Data:\n{}",
            data_str
        ),
        "sentiment" => format!(
            "You are a sentiment analysis expert. Please analyze the sentiment of the following data.\n\n\
            Requirements:\n\
            - Identify overall sentiment (positive/neutral/negative) with confidence score (0-1)\n\
            - Highlight key phrases that indicate sentiment\n\
            - If multiple topics exist, analyze each separately\n\
            - Return as JSON: {{\"overall\": \"positive|neutral|negative\", \"confidence\": 0.X, \"details\": [...]}}\n\n\
            Data:\n{}",
            data_str
        ),
        "custom" => {
            if let Some(instruction) = &req.instruction {
                if let Some(reason) = validate_prompt_security(instruction) {
                    return Err((
                        StatusCode::BAD_REQUEST,
                        Json(json!({ "error": "Instruction contains disallowed content", "reason": reason })),
                    ));
                }
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
        ai_config.provider,
        ai_config.api_key,
        ai_config.model,
        ai_config.base_url,
    )
    .await;

    let role = current_tapp_user_role(&claims).await;
    let reservation = reserve_ai_quota(
        &db,
        role,
        user_id,
        runtime_grant.owner_id(),
        &req.tapp_id,
        analysis_prompt.len() / 4 + 1000,
    )
    .await?;

    match analyzer.analyze(&analysis_prompt).await {
        Ok(result) => {
            let actual_tokens = (analysis_prompt.len() + result.len()) / 4;
            settle_ai_quota(&db, &reservation, actual_tokens).await?;
            let usage_snapshot =
                get_ai_usage(&db, role, user_id, runtime_grant.owner_id(), &req.tapp_id).await?;
            let analysis =
                serde_json::from_str::<Value>(&result).unwrap_or(json!({ "result": result }));
            Ok(Json(json!({
                "success": true,
                "analysis": analysis,
                "confidence": 0.8,
                "usageSnapshot": usage_snapshot
            })))
        }
        Err(e) => {
            if let Err(error) = release_ai_token_reservation(&db, &reservation).await {
                tracing::error!(?error, "[TAPP] Failed to release AI token reservation");
            }
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
pub struct AIChatRequest {
    pub tapp_id: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub context: Option<ChatContext>,
    #[serde(default)]
    pub options: Option<ChatOptions>,
    /// 是否偏好使用 Pro 模型（可选，默认 false，Pro 未配置时自动回退标准模型）
    #[serde(default)]
    pub prefer_pro: Option<bool>,
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
    #[serde(rename = "maxTokens")]
    pub max_tokens: Option<u32>,
    #[serde(rename = "temperature")]
    pub temperature: Option<f32>,
    #[serde(rename = "stream")]
    pub stream: Option<bool>,
}

/// POST /api/tapp/ai/chat
pub async fn ai_chat(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
    Json(req): Json<AIChatRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require_tapp_id(&req.tapp_id)?;
    runtime_grant.require(TappPermission::AiChat)?;
    if req.options.as_ref().is_some_and(|options| {
        options.max_tokens.is_some() || options.temperature.is_some() || options.stream.is_some()
    }) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Legacy chat options are not implemented; use the AI Task API",
                "code": "UNSUPPORTED_V1_OPTION",
                "fields": ["options.maxTokens", "options.temperature", "options.stream"]
            })),
        ));
    }
    // 输入验证前置
    if req.messages.len() > 100 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Too many messages (max 100)" })),
        ));
    }
    let total_message_bytes: usize = req
        .messages
        .iter()
        .map(|message| message.content.len())
        .sum();
    if total_message_bytes > 50_000
        || req.messages.iter().any(|message| {
            message.content.len() > 10_000
                || !matches!(message.role.as_str(), "user" | "assistant" | "system")
        })
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid or oversized chat messages" })),
        ));
    }
    for message in &req.messages {
        if let Some(reason) = validate_prompt_security(&message.content) {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "Message contains disallowed content", "reason": reason })),
            ));
        }
    }

    let user_id =
        authorize_tapp_permission(&db, &claims, &req.tapp_id, TappPermission::AiChat).await?;
    check_rate_limit(user_id, &req.tapp_id, "ai.chat").await?;

    tracing::debug!(
        "[TAPP] ai_chat - User: {}, Tapp: {}, Messages: {}",
        claims.username,
        req.tapp_id,
        req.messages.len()
    );

    let tier = if req.prefer_pro.unwrap_or(false) {
        crate::config::ModelTier::Pro
    } else {
        crate::config::ModelTier::Standard
    };
    let ai_config = get_ai_config_for_tier(tier).await?;
    let mut full_messages = req.messages.clone();

    if let Some(context) = &req.context {
        let mut system_context = String::new();

        if context.include_platform_stats.unwrap_or(false) {
            let platforms = get_available_platforms().await;
            let futures: Vec<_> = platforms
                .iter()
                .map(|p| get_cached_platform_data(p))
                .collect();
            let results = futures::future::join_all(futures).await;

            for (platform, result) in platforms.iter().zip(results.iter()) {
                if let Ok(data) = result {
                    if let Some(items) = data.get("items").and_then(|v| v.as_array()) {
                        system_context.push_str(&format!(
                            "\n{} 平台有 {} 条数据。",
                            platform,
                            items.len()
                        ));
                    }
                }
            }
        }

        if context.include_user_profile.unwrap_or(false) {
            system_context.push_str(&format!("\n用户名: {}", claims.username));
        }

        if let Some(custom) = &context.custom_data {
            // 对 custom_data 施加与主 prompt 相同的安全校验，防止 prompt 注入
            let custom_str = match custom.as_str() {
                Some(s) => s.to_string(),
                None => custom.to_string(),
            };
            if let Some(reason) = validate_prompt_security(&custom_str) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(
                        json!({ "error": "custom_data contains disallowed content", "reason": reason }),
                    ),
                ));
            }
            system_context.push_str(&format!("\n自定义数据: {}", custom_str));
        }

        if !system_context.is_empty() {
            full_messages.insert(
                0,
                ChatMessage {
                    role: "system".to_string(),
                    content: format!("以下是用户的上下文信息：{}", system_context),
                },
            );
        }
    }

    let analyzer = AiAnalyzer::new(
        ai_config.provider,
        ai_config.api_key,
        ai_config.model,
        ai_config.base_url,
    )
    .await;

    // 构建提示词，保留角色结构
    let mut prompt_parts: Vec<String> = Vec::new();
    for msg in &full_messages {
        prompt_parts.push(format!("[{}]\n{}", msg.role.to_uppercase(), msg.content));
    }
    let combined_prompt = prompt_parts.join("\n\n");

    let prompt_data = json!({
        "prompt": combined_prompt
    });
    let role = current_tapp_user_role(&claims).await;
    let reservation = reserve_ai_quota(
        &db,
        role,
        user_id,
        runtime_grant.owner_id(),
        &req.tapp_id,
        prompt_data.to_string().len() / 4 + 1000,
    )
    .await?;

    match analyzer.analyze_profile(&prompt_data).await {
        Ok(response) => {
            let prompt_len = prompt_data.to_string().len();
            let prompt_tokens = (prompt_len / 4) as u32;
            let completion_tokens = (response.len() / 4) as u32;
            settle_ai_quota(
                &db,
                &reservation,
                (prompt_tokens + completion_tokens) as usize,
            )
            .await?;
            let usage_snapshot =
                get_ai_usage(&db, role, user_id, runtime_grant.owner_id(), &req.tapp_id).await?;

            Ok(Json(json!({
                "success": true,
                "message": { "role": "assistant", "content": response },
                "usage": {
                    "promptTokens": prompt_tokens,
                    "completionTokens": completion_tokens,
                    "totalTokens": prompt_tokens + completion_tokens
                },
                "usageSnapshot": usage_snapshot,
                "sessionId": null
            })))
        }
        Err(e) => {
            if let Err(error) = release_ai_token_reservation(&db, &reservation).await {
                tracing::error!(?error, "[TAPP] Failed to release AI token reservation");
            }
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

fn is_safe_external_id(value: &str, max_len: usize) -> bool {
    !value.is_empty()
        && value.len() <= max_len
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

/// POST /api/tapp/ai/image
pub async fn ai_image_generate(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
    Json(req): Json<TappAiImageGenerateRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require_tapp_id(&req.tapp_id)?;
    runtime_grant.require(TappPermission::AiImage)?;
    let start = std::time::Instant::now();

    // 输入验证前置
    if req.prompt.len() > 1000 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Prompt too long (max 1000 characters)" })),
        ));
    }

    if let Some(reason) = validate_image_prompt_security(&req.prompt) {
        tracing::warn!(
            tapp_id = %req.tapp_id, reason = %reason,
            "[TAPP] AI image prompt security violation"
        );
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Prompt contains disallowed content", "reason": reason })),
        ));
    }
    if req
        .model
        .as_deref()
        .is_some_and(|model| !is_safe_external_id(model, 128))
    {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid image model" })),
        ));
    }

    let user_id =
        authorize_tapp_permission(&db, &claims, &req.tapp_id, TappPermission::AiImage).await?;
    check_rate_limit(user_id, &req.tapp_id, "ai.image").await?;

    tracing::info!(
        user_id = user_id, tapp_id = %req.tapp_id, prompt_len = req.prompt.len(),
        "[TAPP] ai_image_generate request"
    );

    let image_config = get_ai_image_config().await?;
    let width = req.width.unwrap_or(image_config.width).clamp(256, 2048);
    let height = req.height.unwrap_or(image_config.height).clamp(256, 2048);
    let model = req.model.clone().unwrap_or(image_config.model.clone());
    let enhance = req.enhance.unwrap_or(true);
    let role = current_tapp_user_role(&claims).await;

    match image_config.provider.as_str() {
        "pollinations" => {
            let reservation = reserve_ai_quota(
                &db,
                role,
                user_id,
                runtime_grant.owner_id(),
                &req.tapp_id,
                0,
            )
            .await?;
            let encoded_prompt = urlencoding::encode(&req.prompt);
            let encoded_model = urlencoding::encode(&model);
            let mut url = format!(
                "https://image.pollinations.ai/prompt/{}?width={}&height={}&model={}&nologo=true&private=true&enhance={}",
                encoded_prompt, width, height, encoded_model, enhance
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
            settle_ai_quota(&db, &reservation, 0).await?;
            let usage_snapshot =
                get_ai_usage(&db, role, user_id, runtime_grant.owner_id(), &req.tapp_id).await?;

            Ok(Json(json!({
                "success": true,
                "provider": "pollinations",
                "url": url,
                "width": width,
                "height": height,
                "model": model,
                "prompt": req.prompt,
                "usageSnapshot": usage_snapshot
            })))
        }
        "pixai" => {
            let api_key = image_config.pixai_api_key.ok_or_else(|| {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({ "error": "PixAI API key not configured" })),
                )
            })?;

            if api_key.is_empty() {
                return Err((
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({ "error": "PixAI API key not configured" })),
                ));
            }

            let reservation = reserve_ai_quota(
                &db,
                role,
                user_id,
                runtime_grant.owner_id(),
                &req.tapp_id,
                0,
            )
            .await?;

            let client = &*HTTP_CLIENT;

            let pixai_response = match client
                .post("https://api.pixai.art/v1/task")
                .header("Authorization", format!("Bearer {}", api_key))
                .header("Content-Type", "application/json")
                .header("x-apollo-operation-name", "createTask")
                .json(&json!({
                    "parameters": {
                        "prompts": req.prompt,
                        "modelId": model,
                        "width": width,
                        "height": height,
                        "batchSize": 1
                    }
                }))
                .send()
                .await
            {
                Ok(response) => response,
                Err(e) => {
                    tracing::error!("[TAPP] PixAI API request failed: {}", e);
                    if let Err(error) = release_ai_token_reservation(&db, &reservation).await {
                        tracing::error!(?error, "[TAPP] Failed to release AI token reservation");
                    }
                    return Err((
                        StatusCode::BAD_GATEWAY,
                        Json(json!({ "error": format!("PixAI API error: {}", e) })),
                    ));
                }
            };

            if !pixai_response.status().is_success() {
                let status = pixai_response.status();
                let body = pixai_response.text().await.unwrap_or_default();
                tracing::error!("[TAPP] PixAI API error: {} - {}", status, body);
                record_metric("ai.image", start.elapsed().as_millis() as u64, true).await;
                return Err((
                    StatusCode::BAD_GATEWAY,
                    Json(json!({ "error": format!("PixAI API error: {}", status) })),
                ));
            }

            let result: Value = pixai_response.json().await.map_err(|e| {
                tracing::error!("[TAPP] Failed to parse PixAI response: {}", e);
                (
                    StatusCode::BAD_GATEWAY,
                    Json(json!({ "error": "Failed to parse PixAI response" })),
                )
            })?;

            let duration_ms = start.elapsed().as_millis() as u64;
            record_metric("ai.image", duration_ms, false).await;

            tracing::info!(
                user_id = user_id, tapp_id = %req.tapp_id, duration_ms = duration_ms,
                provider = "pixai", "[TAPP] ai_image_generate success"
            );
            settle_ai_quota(&db, &reservation, 0).await?;
            let usage_snapshot =
                get_ai_usage(&db, role, user_id, runtime_grant.owner_id(), &req.tapp_id).await?;

            Ok(Json(json!({
                "success": true,
                "provider": "pixai",
                "task_id": result.get("id"),
                "status": result.get("status").unwrap_or(&json!("waiting")),
                "result": result,
                "usageSnapshot": usage_snapshot
            })))
        }
        _ => {
            record_metric("ai.image", start.elapsed().as_millis() as u64, true).await;
            Err((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(
                    json!({ "error": format!("Unknown image provider: {}", image_config.provider) }),
                ),
            ))
        }
    }
}

// ============ PixAI Task Status ============

#[derive(Debug, Deserialize)]
pub struct PixaiTaskStatusRequest {
    pub tapp_id: String,
    pub task_id: String,
}

/// POST /api/tapp/ai/image/status
pub async fn ai_image_task_status(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime_grant: RuntimeGrantContext,
    Json(req): Json<PixaiTaskStatusRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    runtime_grant.require_tapp_id(&req.tapp_id)?;
    runtime_grant.require(TappPermission::AiImage)?;
    if !is_safe_external_id(&req.task_id, 128) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid task ID" })),
        ));
    }
    authorize_tapp_permission(&db, &claims, &req.tapp_id, TappPermission::AiImage).await?;

    let image_config = get_ai_image_config().await?;
    let api_key = image_config.pixai_api_key.ok_or_else(|| {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": "PixAI API key not configured" })),
        )
    })?;

    let client = &*HTTP_CLIENT;
    let response = client
        .get(format!("https://api.pixai.art/v1/task/{}", req.task_id))
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("x-apollo-operation-name", "getTask")
        .send()
        .await
        .map_err(|e| {
            tracing::error!("[TAPP] PixAI task status request failed: {}", e);
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": format!("PixAI API error: {}", e) })),
            )
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        tracing::error!("[TAPP] PixAI task status error: {} - {}", status, body);
        return Err((
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": format!("PixAI API error: {}", status) })),
        ));
    }

    let result: Value = response.json().await.map_err(|e| {
        tracing::error!("[TAPP] Failed to parse PixAI task status response: {}", e);
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({ "error": "Failed to parse PixAI response" })),
        )
    })?;

    Ok(Json(json!({
        "success": true,
        "task_id": result.get("id"),
        "status": result.get("status"),
        "outputs": result.get("outputs"),
    })))
}
