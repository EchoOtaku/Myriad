//! Provider-side execution for host-governed AI Tasks.
//!
//! Text (AiAnalyzer) and image (Pollinations / PixAI) live here so the HTTP
//! orchestration module does not own outbound provider logic. Task registry,
//! quota, and local cancel state stay with the caller.

use std::time::Duration;

use serde_json::{json, Value};

use crate::services::ai_config::{AiConfig, AiImageConfig};
use crate::services::analyzer::AiAnalyzer;
use crate::services::http_client::TAPP_HTTP_CLIENT;

/// Stable provider error (code + message) shared with the AI Task API surface.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderError {
    pub code: String,
    pub message: String,
}

impl ProviderError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    pub fn into_pair(self) -> (String, String) {
        (self.code, self.message)
    }
}

impl std::fmt::Display for ProviderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ProviderError {}

/// Parse image width/height: JSON int, whole float, or numeric string (`"768"` / `"768px"`).
pub fn parse_image_dim(value: &Value) -> Option<u32> {
    if let Some(n) = value.as_u64() {
        return u32::try_from(n).ok().filter(|&n| n > 0);
    }
    if let Some(n) = value.as_i64() {
        return u32::try_from(n).ok().filter(|&n| n > 0);
    }
    if let Some(n) = value.as_f64() {
        if n.is_finite() && n > 0.0 && n.fract() == 0.0 && n <= u32::MAX as f64 {
            return Some(n as u32);
        }
        return None;
    }
    if let Some(s) = value.as_str() {
        let s = s.trim();
        let s = s
            .strip_suffix("px")
            .or_else(|| s.strip_suffix("PX"))
            .unwrap_or(s)
            .trim();
        return s.parse::<u32>().ok().filter(|&n| n > 0);
    }
    None
}

/// Read resolution from task input; missing keys use local defaults (not global config).
pub fn image_size_from_input(input: &Value) -> (u32, u32) {
    const DEFAULT_W: u32 = 1024;
    const DEFAULT_H: u32 = 1024;
    const MIN: u32 = 256;
    const MAX: u32 = 2048;
    let width = input
        .get("width")
        .and_then(parse_image_dim)
        .map(|v| v.clamp(MIN, MAX))
        .unwrap_or(DEFAULT_W);
    let height = input
        .get("height")
        .and_then(parse_image_dim)
        .map(|v| v.clamp(MIN, MAX))
        .unwrap_or(DEFAULT_H);
    (width, height)
}

fn pixai_task_id(value: &Value) -> Option<String> {
    value
        .pointer("/data/task/id")
        .or_else(|| value.pointer("/data/id"))
        .or_else(|| value.get("id"))
        .and_then(|value| match value {
            Value::String(value) => Some(value.clone()),
            Value::Number(value) => Some(value.to_string()),
            _ => None,
        })
}

fn pixai_image_url(value: &Value) -> Option<String> {
    let task = value
        .pointer("/data/task")
        .or_else(|| value.get("data"))
        .unwrap_or(value);
    task.pointer("/outputs/mediaUrls/0")
        .or_else(|| task.pointer("/outputs/0/url"))
        .or_else(|| task.pointer("/outputs/0/mediaUrl"))
        .and_then(Value::as_str)
        .map(str::to_owned)
        .or_else(|| {
            task.pointer("/outputs/mediaIds/0").map(|id| {
                format!(
                    "https://api.pixai.art/v1/media/{}/download",
                    id.as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| id.to_string())
                )
            })
        })
}

/// Run a text model. When `stream` is true, `on_delta` receives each token chunk.
///
/// Returns `(raw_text, estimated_input_tokens, estimated_output_tokens)`.
pub async fn run_text_provider<F>(
    config: AiConfig,
    system: &str,
    prompt: &str,
    stream: bool,
    mut on_delta: F,
) -> Result<(String, usize, usize), ProviderError>
where
    F: FnMut(&str) -> bool + Send,
{
    let analyzer =
        AiAnalyzer::new(config.provider, config.api_key, config.model, config.base_url).await;
    let raw = if stream {
        analyzer
            .analyze_stream(&format!("{system}\n\n{prompt}"), |delta| on_delta(delta))
            .await
    } else {
        analyzer.analyze_with_system(system, prompt).await
    }
    .map_err(|_| {
        ProviderError::new(
            "AI_PROVIDER_ERROR",
            "AI provider failed to complete the task",
        )
    })?;
    let input_tokens = (system.len() + prompt.len()) / 4;
    let output_tokens = raw.len() / 4;
    Ok((raw, input_tokens, output_tokens))
}

/// Run an image provider (Pollinations URL or PixAI poll).
///
/// `on_progress(attempt, max_attempts)` is invoked while polling PixAI.
/// Result value shape: `{ format: "image", value: { url, width, height }, contextProvenance: [] }`.
pub async fn run_image_provider<F>(
    config: AiImageConfig,
    prompt: &str,
    width: u32,
    height: u32,
    mut on_progress: F,
) -> Result<Value, ProviderError>
where
    F: FnMut(u32, u32) + Send,
{
    let width = width.clamp(256, 2048);
    let height = height.clamp(256, 2048);
    if config.provider == "pollinations" {
        return Ok(json!({
            "format": "image",
            "value": {
                "url": format!(
                    "https://image.pollinations.ai/prompt/{}?width={width}&height={height}&model={}&nologo=true&private=true&enhance=true",
                    urlencoding::encode(prompt),
                    urlencoding::encode(&config.model),
                ),
                "width": width,
                "height": height,
            },
            "contextProvenance": [],
        }));
    }
    if config.provider != "pixai" {
        return Err(ProviderError::new(
            "AI_PROVIDER_UNAVAILABLE",
            "Configured image provider is not supported",
        ));
    }
    let api_key = config
        .pixai_api_key
        .filter(|key| !key.is_empty())
        .ok_or_else(|| {
            ProviderError::new("AI_PROVIDER_UNAVAILABLE", "PixAI API key is not configured")
        })?;
    let response = TAPP_HTTP_CLIENT
        .post("https://api.pixai.art/v1/task")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("x-apollo-operation-name", "createTask")
        .json(&json!({
            "parameters": {
                "prompts": prompt,
                "modelId": config.model,
                "width": width,
                "height": height,
                "batchSize": 1,
            }
        }))
        .send()
        .await
        .map_err(|_| ProviderError::new("AI_PROVIDER_ERROR", "Failed to submit PixAI task"))?;
    if !response.status().is_success() {
        return Err(ProviderError::new(
            "AI_PROVIDER_ERROR",
            format!("PixAI rejected the task with status {}", response.status()),
        ));
    }
    let created: Value = response.json().await.map_err(|_| {
        ProviderError::new(
            "AI_PROVIDER_ERROR",
            "PixAI returned an invalid task response",
        )
    })?;
    let task_id = pixai_task_id(&created).ok_or_else(|| {
        ProviderError::new("AI_PROVIDER_ERROR", "PixAI returned no task ID")
    })?;

    for attempt in 1..=40 {
        tokio::time::sleep(Duration::from_secs(3)).await;
        on_progress(attempt, 40);
        let response = TAPP_HTTP_CLIENT
            .get(format!("https://api.pixai.art/v1/task/{task_id}"))
            .header("Authorization", format!("Bearer {api_key}"))
            .header("x-apollo-operation-name", "getTask")
            .send()
            .await
            .map_err(|_| ProviderError::new("AI_PROVIDER_ERROR", "Failed to poll PixAI task"))?;
        if !response.status().is_success() {
            continue;
        }
        let status_value: Value = response.json().await.map_err(|_| {
            ProviderError::new(
                "AI_PROVIDER_ERROR",
                "PixAI returned an invalid status response",
            )
        })?;
        let task = status_value
            .pointer("/data/task")
            .or_else(|| status_value.get("data"))
            .unwrap_or(&status_value);
        let status = task
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_ascii_lowercase();
        if matches!(status.as_str(), "completed" | "success" | "succeeded") {
            let url = pixai_image_url(&status_value).ok_or_else(|| {
                ProviderError::new(
                    "AI_PROVIDER_ERROR",
                    "PixAI completed without an image URL",
                )
            })?;
            return Ok(json!({
                "format": "image",
                "value": { "url": url, "width": width, "height": height },
                "contextProvenance": [],
            }));
        }
        if matches!(status.as_str(), "failed" | "error" | "cancelled") {
            return Err(ProviderError::new(
                "AI_PROVIDER_ERROR",
                "PixAI image task failed",
            ));
        }
    }
    Err(ProviderError::new(
        "AI_TASK_TIMEOUT",
        "PixAI image generation timed out",
    ))
}

#[cfg(test)]
mod tests {
    use super::{image_size_from_input, parse_image_dim, ProviderError};
    use serde_json::json;

    #[test]
    fn parse_image_dim_accepts_number_and_string() {
        assert_eq!(parse_image_dim(&json!(768)), Some(768));
        assert_eq!(parse_image_dim(&json!(768.0)), Some(768));
        assert_eq!(parse_image_dim(&json!("1024")), Some(1024));
        assert_eq!(parse_image_dim(&json!(" 768px ")), Some(768));
        assert_eq!(parse_image_dim(&json!(0)), None);
        assert_eq!(parse_image_dim(&json!("nope")), None);
    }

    #[test]
    fn image_size_from_input_defaults_clamps_and_parses_strings() {
        assert_eq!(image_size_from_input(&json!({})), (1024, 1024));
        assert_eq!(
            image_size_from_input(&json!({ "width": "768", "height": "1024px" })),
            (768, 1024)
        );
        assert_eq!(
            image_size_from_input(&json!({ "width": 100, "height": 5000 })),
            (256, 2048)
        );
        assert_eq!(image_size_from_input(&json!("a cat")), (1024, 1024));
    }

    #[test]
    fn provider_error_pair_preserves_code() {
        let err = ProviderError::new("AI_PROVIDER_ERROR", "boom");
        let (code, message) = err.into_pair();
        assert_eq!(code, "AI_PROVIDER_ERROR");
        assert_eq!(message, "boom");
    }
}
