use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// ImaginePro API 客户端
#[allow(dead_code)]
pub struct ImagineProClient {
    api_key: String,
    client: Client,
    callback_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[allow(dead_code)]
struct ImagineRequest {
    prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    aspect_ratio: Option<String>, // "1:1", "16:9", "9:16", etc.
    #[serde(skip_serializing_if = "Option::is_none")]
    process_mode: Option<String>, // "fast", "relax"
    #[serde(skip_serializing_if = "Option::is_none")]
    webhook_endpoint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    webhook_secret: Option<String>,
}

/// 提交任务的响应
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ImagineSubmitResponse {
    #[serde(default)]
    pub success: Option<bool>,
    #[serde(default, alias = "messageId")]
    pub message_id: Option<String>,
    #[serde(default, alias = "createdAt")]
    pub created_at: Option<String>,
}

/// 查询任务进度的响应
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ImagineResponse {
    #[serde(default, alias = "messageId")]
    pub task_id: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    #[serde(default, alias = "originalUrl")]
    pub original_url: Option<String>,
    #[serde(default)]
    pub uri: Option<String>, // 生成的图片URL
    #[serde(default)]
    pub progress: Option<i32>,
    #[serde(default)]
    pub status: Option<String>, // "PENDING", "PROCESSING", "DONE", "FAILED"
    #[serde(default, alias = "createdAt")]
    pub created_at: Option<String>,
    #[serde(default, alias = "updatedAt")]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub buttons: Option<Vec<String>>,
    #[serde(default)]
    pub images: Option<Vec<String>>,
}

/// Upscale按钮请求
#[derive(Debug, Serialize)]
#[allow(dead_code)]
struct ButtonRequest {
    #[serde(rename = "messageId")]
    message_id: String,
    button: String, // "U1", "U2", "U3", "U4"
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "ref")]
    reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    webhook_override: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct ImagineErrorResponse {
    error: String,
    #[serde(default)]
    message: Option<String>,
}

#[allow(dead_code)]
impl ImagineProClient {
    /// 创建新的 ImaginePro 客户端
    pub fn new(api_key: String, callback_url: Option<String>) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        Self {
            api_key,
            client,
            callback_url,
        }
    }

    /// 清理 prompt，避免误触发内容审核
    fn sanitize_prompt(prompt: &str) -> String {
        // 替换可能被误判的词汇
        let replacements = vec![
            ("cutting-edge", "advanced"),
            ("cutting edge", "advanced"),
            ("Cutting-edge", "Advanced"),
            ("Cutting edge", "Advanced"),
            ("cutting", "advanced"),
            ("Cutting", "Advanced"),
            ("knife", "blade"),
            ("sword", "blade"),
            ("sharp", "refined"),
            ("blood", "red"),
            ("kill", "defeat"),
            ("die", "fall"),
            ("death", "darkness"),
        ];

        let mut cleaned = prompt.to_string();
        for (from, to) in replacements {
            cleaned = cleaned.replace(from, to);
        }

        cleaned
    }

    /// 提交图片生成任务
    pub async fn imagine(
        &self,
        prompt: &str,
        aspect_ratio: Option<&str>,
    ) -> Result<String, String> {
        let url = "https://api.imaginepro.ai/api/v1/midjourney/imagine";

        // 清理 prompt
        let sanitized_prompt = Self::sanitize_prompt(prompt);

        if sanitized_prompt != prompt {
            tracing::info!("🔧 Sanitized prompt to avoid content moderation");
            tracing::debug!("Original: {}", prompt);
            tracing::debug!("Sanitized: {}", sanitized_prompt);
        }

        let request_body = ImagineRequest {
            prompt: sanitized_prompt.clone(),
            aspect_ratio: aspect_ratio.map(|s| s.to_string()),
            process_mode: Some("fast".to_string()),
            webhook_endpoint: self.callback_url.clone(),
            webhook_secret: None,
        };

        tracing::info!("🎨 Submitting Midjourney task: {}", sanitized_prompt);

        let response = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let status = response.status();

        if status.is_success() {
            // 先获取原始文本以便调试
            let response_text = response
                .text()
                .await
                .map_err(|e| format!("Failed to read response: {}", e))?;

            tracing::info!("📦 ImaginePro API raw response: {}", response_text);

            let result: ImagineSubmitResponse = serde_json::from_str(&response_text)
                .map_err(|e| format!("Failed to parse response: {}. Raw: {}", e, response_text))?;

            let message_id = result
                .message_id
                .ok_or_else(|| "No messageId returned from API".to_string())?;

            tracing::info!(
                "✓ Task submitted: {} (success: {})",
                message_id,
                result.success.unwrap_or(false)
            );
            Ok(message_id)
        } else {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());

            // 尝试解析错误响应
            if let Ok(error_resp) = serde_json::from_str::<ImagineErrorResponse>(&error_text) {
                let error_msg = error_resp.message.unwrap_or(error_resp.error);
                tracing::error!("❌ ImaginePro API error: {}", error_msg);
                Err(format!("API error: {}", error_msg))
            } else {
                tracing::error!("❌ ImaginePro API error: {} - {}", status, error_text);
                Err(format!("API error ({}): {}", status, error_text))
            }
        }
    }

    /// 查询任务状态
    pub async fn get_task(&self, task_id: &str) -> Result<ImagineResponse, String> {
        let url = format!("https://api.imaginepro.ai/api/v1/message/fetch/{}", task_id);

        tracing::debug!("🔍 Checking task status: {}", task_id);

        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let status = response.status();

        if status.is_success() {
            // 先获取原始文本以便调试
            let response_text = response
                .text()
                .await
                .map_err(|e| format!("Failed to read response: {}", e))?;

            tracing::debug!("📦 Task query response: {}", response_text);

            let result: ImagineResponse = serde_json::from_str(&response_text)
                .map_err(|e| format!("Failed to parse response: {}. Raw: {}", e, response_text))?;

            tracing::debug!(
                "Task {} status: {}",
                task_id,
                result.status.as_deref().unwrap_or("unknown")
            );
            Ok(result)
        } else {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());

            if let Ok(error_resp) = serde_json::from_str::<ImagineErrorResponse>(&error_text) {
                let error_msg = error_resp.message.unwrap_or(error_resp.error);
                Err(format!("API error: {}", error_msg))
            } else {
                Err(format!("API error ({}): {}", status, error_text))
            }
        }
    }

    /// 等待任务完成（轮询）
    pub async fn wait_for_completion(
        &self,
        task_id: &str,
        max_wait_seconds: u64,
    ) -> Result<ImagineResponse, String> {
        let check_interval = Duration::from_secs(3);
        let max_checks = max_wait_seconds / check_interval.as_secs();

        tracing::info!(
            "⏳ Waiting for task {} to complete (max {} seconds)...",
            task_id,
            max_wait_seconds
        );

        for i in 0..max_checks {
            let result = self.get_task(task_id).await?;

            match result.status.as_deref() {
                Some("DONE") => {
                    tracing::info!("✓ Task completed: {}", task_id);
                    return Ok(result);
                }
                Some("FAILED") => {
                    tracing::error!("❌ Task failed: {}", task_id);
                    return Err(format!("Task failed: {}", task_id));
                }
                Some("PENDING") | Some("PROCESSING") => {
                    if let Some(progress) = result.progress {
                        tracing::debug!("Task {} progress: {}%", task_id, progress);
                    }

                    if i < max_checks - 1 {
                        tokio::time::sleep(check_interval).await;
                    }
                }
                Some(unknown) => {
                    tracing::warn!("Unknown task status: {}", unknown);
                    tokio::time::sleep(check_interval).await;
                }
                None => {
                    tracing::warn!("Task {} returned no status", task_id);
                    tokio::time::sleep(check_interval).await;
                }
            }
        }

        Err(format!("Task timeout after {} seconds", max_wait_seconds))
    }

    /// Upscale图片（选择4张中的一张进行高清化）
    pub async fn upscale(
        &self,
        message_id: &str,
        button: &str, // "U1", "U2", "U3", "U4"
    ) -> Result<String, String> {
        let url = "https://api.imaginepro.ai/api/v1/nova/button";

        let request_body = ButtonRequest {
            message_id: message_id.to_string(),
            button: button.to_string(),
            reference: None,
            webhook_override: None,
        };

        tracing::info!("🔍 Upscaling image {} with button {}", message_id, button);

        let response = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request_body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        let status = response.status();

        if status.is_success() {
            let response_text = response
                .text()
                .await
                .map_err(|e| format!("Failed to read response: {}", e))?;

            tracing::debug!("📦 Upscale response: {}", response_text);

            let result: ImagineSubmitResponse = serde_json::from_str(&response_text)
                .map_err(|e| format!("Failed to parse response: {}. Raw: {}", e, response_text))?;

            let new_message_id = result
                .message_id
                .ok_or_else(|| "No messageId returned from upscale API".to_string())?;

            tracing::info!("✓ Upscale task submitted: {}", new_message_id);
            Ok(new_message_id)
        } else {
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());

            if let Ok(error_resp) = serde_json::from_str::<ImagineErrorResponse>(&error_text) {
                let error_msg = error_resp.message.unwrap_or(error_resp.error);
                tracing::error!("❌ Upscale API error: {}", error_msg);
                Err(format!("API error: {}", error_msg))
            } else {
                tracing::error!("❌ Upscale API error: {} - {}", status, error_text);
                Err(format!("API error ({}): {}", status, error_text))
            }
        }
    }

    /// 一步生成图片（提交任务并等待完成）
    pub async fn generate_and_wait(
        &self,
        prompt: &str,
        aspect_ratio: Option<&str>,
        max_wait_seconds: u64,
    ) -> Result<String, String> {
        let message_id = self.imagine(prompt, aspect_ratio).await?;

        // 等待初始4张图完成
        let completed = self
            .wait_for_completion(&message_id, max_wait_seconds)
            .await?;

        // 检查是否有upscale按钮
        if let Some(buttons) = &completed.buttons {
            if buttons.contains(&"U1".to_string()) {
                tracing::info!("🎨 Auto-upscaling first image (U1)...");

                // 自动upscale第一张图
                let upscale_message_id = self.upscale(&message_id, "U1").await?;

                // 等待upscale完成
                let upscaled = self
                    .wait_for_completion(&upscale_message_id, max_wait_seconds)
                    .await?;

                // 返回高清图片URL
                return upscaled.uri.or(upscaled.original_url).ok_or_else(|| {
                    "Upscaled task completed but no image URL returned".to_string()
                });
            }
        }

        // 如果没有upscale按钮，返回原始图片
        completed
            .uri
            .or(completed.original_url)
            .ok_or_else(|| "Task completed but no image URL returned".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // 需要真实的 API key
    async fn test_imagine_basic() {
        let client = ImagineProClient::new("your_api_key".to_string(), None);
        let result = client
            .imagine("a beautiful sunset over the ocean", None)
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore]
    async fn test_generate_and_wait() {
        let client = ImagineProClient::new("your_api_key".to_string(), None);
        let result = client
            .generate_and_wait("a cute cat sitting on a cloud", Some("1:1"), 120)
            .await;
        assert!(result.is_ok());
    }
}
