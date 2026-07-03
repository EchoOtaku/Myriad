use axum::{http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::services::ai::create_ai_analyzer;

#[derive(Debug, Deserialize)]
pub struct GeneratePromptRequest {
    pub title: String,
    pub summary: String,
    pub category: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct GeneratePromptResponse {
    pub prompt: String,
    pub negative_prompt: String,
}

/// 生成图片生成提示词的 API 端点
pub async fn generate_prompt(
    Json(payload): Json<GeneratePromptRequest>,
) -> Result<Json<GeneratePromptResponse>, (StatusCode, Json<Value>)> {
    tracing::info!("Generating prompt for: {}", payload.title);

    let system_prompt = r#"You are a professional prompt engineer for AI image generation.
Your task is to convert the user's description into a high-quality Studio Ghibli style illustration prompt.

Requirements:
1. Create prompts for transparent background PNG images with a single isolated subject
2. Use "A [character description]" format
3. Include quality keywords: masterpiece, highest quality, 8K resolution, ultra detailed
4. Add Ghibli-specific terms: Studio Ghibli art style, Hayao Miyazaki inspired, watercolor texture, hand-drawn animation style
5. The character should be cute chibi/kawaii style
6. Keep the prompt concise but descriptive (under 150 words)
7. If the subject is a known character (anime, game, etc.), include their accurate visual features
8. Output ONLY the prompt text, no explanations"#;

    let user_prompt = format!(
        "Create a Studio Ghibli style illustration prompt for this activity:\nTitle: {}\nDescription: {}\nCategory: {}",
        payload.title,
        payload.summary,
        payload.category.as_deref().unwrap_or("general")
    );

    let negative_prompt = "background, scenery, landscape, complex background, busy background, multiple subjects, crowd, low quality, blurry, distorted, deformed, ugly, bad anatomy, duplicate, text, watermark".to_string();

    // 尝试使用 AI 生成高质量提示词
    if let Some(analyzer) = create_ai_analyzer().await {
        match analyzer
            .analyze_with_system(system_prompt, &user_prompt)
            .await
        {
            Ok(result) => {
                let cleaned = result.trim().trim_matches('"').trim_matches('`').trim();
                if !cleaned.is_empty() {
                    tracing::info!("AI-generated prompt length: {} chars", cleaned.len());
                    return Ok(Json(GeneratePromptResponse {
                        prompt: cleaned.to_string(),
                        negative_prompt,
                    }));
                }
            }
            Err(e) => {
                tracing::warn!("AI prompt generation failed, falling back to rules: {}", e);
            }
        }
    }

    // AI 不可用时使用规则引擎降级
    let prompt = generate_prompt_with_rules(&payload.title, &payload.summary);
    tracing::info!("Rule-generated prompt length: {} chars", prompt.len());

    Ok(Json(GeneratePromptResponse {
        prompt,
        negative_prompt,
    }))
}

/// 使用规则生成提示词（可以替换为真实的 AI API 调用）
fn generate_prompt_with_rules(title: &str, summary: &str) -> String {
    let content = format!("{} {}", title, summary).to_lowercase();

    // 分析内容类型
    let character = if content.contains("编程")
        || content.contains("代码")
        || content.contains("开发")
        || content.contains("技术")
    {
        "cute chibi programmer character with laptop and glowing holographic code"
    } else if content.contains("游戏") || content.contains("玩") {
        "cheerful gamer character holding game controller with pixel effects"
    } else if content.contains("音乐") || content.contains("歌") {
        "gentle musician character with musical notes floating around"
    } else if content.contains("艺术") || content.contains("设计") || content.contains("画") {
        "artistic character with paintbrush and colorful palette"
    } else if content.contains("旅行") || content.contains("旅游") {
        "adventurous traveler character with backpack and map"
    } else if content.contains("美食") || content.contains("食物") || content.contains("烹饪")
    {
        "happy chef character with chef hat and delicious food"
    } else if content.contains("阅读") || content.contains("书") {
        "peaceful reader character holding an open book with glowing pages"
    } else if content.contains("运动") || content.contains("健身") {
        "energetic athlete character in active pose with motion effects"
    } else if content.contains("学习") || content.contains("教育") {
        "focused student character with books and lightbulb ideas"
    } else if content.contains("社交") || content.contains("分享") {
        "friendly character waving with speech bubbles and hearts"
    } else {
        "gentle character with soft smile and sparkles"
    };

    // 提取关键活动
    let activity_hint = extract_activity_context(title, summary);

    format!(
        "A {}, {}, in Studio Ghibli art style, transparent background, PNG format, no background, isolated subject, masterpiece, highest quality, detailed character design, soft lighting, hand-drawn animation style, Hayao Miyazaki inspired, watercolor texture, gentle colors, whimsical atmosphere, professional illustration, 8K resolution, ultra detailed, cute kawaii style",
        character,
        activity_hint
    )
}

/// 提取活动上下文
fn extract_activity_context(title: &str, summary: &str) -> String {
    // 简化处理：只提取标题中的关键活动词
    let content = format!("{} {}", title, summary);

    // 如果内容主要是中文，使用简短描述
    let has_chinese = content
        .chars()
        .any(|c| ('\u{4e00}'..='\u{9fa5}').contains(&c));

    if has_chinese {
        // 对于中文内容，只使用类型描述，不包含具体文本
        "engaged in their favorite activity".to_string()
    } else {
        // 对于英文内容，可以包含一些具体信息
        let max_len = 40;
        if content.len() <= max_len {
            content
        } else {
            format!("{}...", &content[..max_len])
        }
    }
}
