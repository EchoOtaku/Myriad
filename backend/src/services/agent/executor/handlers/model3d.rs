//! Agent Tripo 3D execution. Host key stays on the outbound client.

use super::HandlerContext;
use crate::services::image_cache::ImageCacheService;
use crate::services::tripo::{
    apply_web_defaults, is_configured, is_enabled, persist_task_models, poll_until_terminal,
    validate_upload_type, PersistedTripoAsset, TripoClient, TripoError, TripoOperation, TripoTask,
    PUBLIC_CAPABILITIES, TAPP_UPLOAD_MAX_BYTES,
};
use crate::GLOBAL_DYNAMIC_CONFIG;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

pub async fn execute(
    capability_id: &str,
    params: &HashMap<String, Value>,
    _ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    match capability_id {
        "model3d.status" => execute_status().await,
        "model3d.generate" => execute_generate(params).await,
        "model3d.rig" => execute_rig(params).await,
        "model3d.retarget" => execute_retarget(params).await,
        _ => Err(format!("Unknown model3d capability: {capability_id}")),
    }
}

async fn execute_status() -> Result<Value, String> {
    let dynamic = GLOBAL_DYNAMIC_CONFIG.read().await;
    Ok(json!({
        "enabled": is_enabled(&dynamic),
        "configured": is_configured(&dynamic),
        "capabilities": PUBLIC_CAPABILITIES,
    }))
}

async fn client() -> Result<TripoClient, String> {
    let dynamic = GLOBAL_DYNAMIC_CONFIG.read().await;
    let config = crate::services::tripo::TripoRuntimeConfig::resolve(&dynamic)
        .map_err(|error| error.to_string())?;
    drop(dynamic);
    TripoClient::new(config)
        .await
        .map_err(|error| error.to_string())
}

async fn run_operation(operation: TripoOperation, mut payload: Value) -> Result<Value, String> {
    let client = client().await?;
    payload = apply_web_defaults(operation, payload, client.config()).map_err(map_err)?;
    let task_id = client
        .create_task(operation, payload)
        .await
        .map_err(map_err)?;
    let task = poll_until_terminal(&client, &task_id)
        .await
        .map_err(map_err)?;
    let assets = if task.status == "success" {
        persist_task_models(&task, client.config().max_download_bytes)
            .await
            .map_err(map_err)?
    } else {
        Vec::new()
    };
    Ok(task_json(task, assets))
}

fn task_json(task: TripoTask, assets: Vec<PersistedTripoAsset>) -> Value {
    json!({
        "taskId": task.task_id,
        "status": task.status,
        "asset": assets.first(),
        "assets": assets,
    })
}

fn map_err(error: TripoError) -> String {
    error.to_string()
}

fn extra_payload(params: &HashMap<String, Value>) -> Map<String, Value> {
    params
        .get("payload")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}

async fn execute_generate(params: &HashMap<String, Value>) -> Result<Value, String> {
    let operation = match params
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("image_to_model")
    {
        "multiview_to_model" => TripoOperation::MultiviewToModel,
        "image_to_model" => TripoOperation::ImageToModel,
        other => return Err(format!("Unsupported generate operation: {other}")),
    };

    let mut payload = extra_payload(params);
    match operation {
        TripoOperation::ImageToModel => {
            let token = resolve_single_input(params).await?;
            payload.insert("input".to_string(), json!(token));
        }
        TripoOperation::MultiviewToModel => {
            let inputs = resolve_multiview_inputs(params).await?;
            payload.insert("inputs".to_string(), inputs);
        }
        _ => {}
    }
    run_operation(operation, Value::Object(payload)).await
}

async fn execute_rig(params: &HashMap<String, Value>) -> Result<Value, String> {
    let operation = match params
        .get("operation")
        .and_then(Value::as_str)
        .unwrap_or("rig")
    {
        "rig_check" => TripoOperation::RigCheck,
        "rig" => TripoOperation::Rig,
        other => return Err(format!("Unsupported rig operation: {other}")),
    };
    let input = params
        .get("input")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "input is required".to_string())?;
    let mut payload = extra_payload(params);
    payload.insert("input".to_string(), json!(input));
    run_operation(operation, Value::Object(payload)).await
}

async fn execute_retarget(params: &HashMap<String, Value>) -> Result<Value, String> {
    let input = params
        .get("input")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "input is required".to_string())?;
    let mut payload = extra_payload(params);
    payload.insert("input".to_string(), json!(input));
    if let Some(animation) = params.get("animation").cloned() {
        payload.entry("animation".to_string()).or_insert(animation);
    }
    if let Some(animations) = params.get("animations").cloned() {
        payload
            .entry("animations".to_string())
            .or_insert(animations);
    }
    run_operation(TripoOperation::Retarget, Value::Object(payload)).await
}

async fn resolve_single_input(params: &HashMap<String, Value>) -> Result<String, String> {
    if let Some(token) = string_param(params, "fileToken") {
        return Ok(token);
    }
    if let Some(url) = string_param(params, "imageUrl") {
        return upload_local_image(&url, "reference.png", "image/png").await;
    }
    if let Some(base64) = string_param(params, "imageBase64") {
        let file_name =
            string_param(params, "fileName").unwrap_or_else(|| "upload.png".to_string());
        let content_type =
            string_param(params, "contentType").unwrap_or_else(|| "image/png".to_string());
        return upload_base64(&file_name, &content_type, &base64).await;
    }
    Err("Provide imageUrl (site image-cache), imageBase64, or fileToken".to_string())
}

async fn resolve_multiview_inputs(params: &HashMap<String, Value>) -> Result<Value, String> {
    if let Some(existing) = extra_payload(params).get("inputs") {
        return normalize_multiview_inputs(existing).await;
    }
    let views = params
        .get("views")
        .and_then(Value::as_object)
        .ok_or_else(|| "multiview_to_model requires views or payload.inputs".to_string())?;
    let mut inputs = Vec::new();
    for (direction, spec) in views {
        let token = resolve_view_spec(spec).await?;
        inputs.push(json!({ direction: token }));
    }
    Ok(Value::Array(inputs))
}

/// Accept only file tokens or host-local images. Do not forward Tripo `url` /
/// object-storage sources — those would make the provider fetch arbitrary URLs.
async fn normalize_multiview_inputs(inputs: &Value) -> Result<Value, String> {
    let array = inputs
        .as_array()
        .ok_or_else(|| "payload.inputs must be an array".to_string())?;
    if array.iter().all(Value::is_string) {
        for slot in array {
            let value = slot.as_str().unwrap_or("");
            if value.trim().is_empty() {
                continue;
            }
            resolve_view_spec(slot).await?;
        }
        return Ok(inputs.clone());
    }
    let mut normalized = Vec::new();
    for item in array {
        if item
            .as_object()
            .is_some_and(|object| object.contains_key("task_id"))
        {
            return Err(
                "payload.inputs cannot reuse a remote task; pass views, imageUrl, imageBase64, or fileToken"
                    .to_string(),
            );
        }
        let object = item.as_object().ok_or_else(|| {
            "each payload.inputs item must be a file token or {direction: spec}".to_string()
        })?;
        if object.len() != 1 {
            return Err("each payload.inputs item must contain exactly one direction".to_string());
        }
        let (direction, spec) = object.iter().next().unwrap();
        let token = resolve_view_spec(spec).await?;
        normalized.push(json!({ direction: token }));
    }
    Ok(Value::Array(normalized))
}

async fn resolve_view_spec(spec: &Value) -> Result<String, String> {
    if let Some(token) = spec.as_str() {
        return resolve_token_or_local_url(token).await;
    }
    let object = spec.as_object().ok_or_else(|| {
        "each view must be a file token or {imageUrl|imageBase64|fileToken}".to_string()
    })?;
    if object.contains_key("url") || object.contains_key("object") {
        return Err(
            "remote URL / object storage is not allowed; use imageUrl (site image-cache), imageBase64, or fileToken"
                .to_string(),
        );
    }
    if let Some(token) = object
        .get("fileToken")
        .or_else(|| object.get("file_token"))
        .and_then(Value::as_str)
    {
        return resolve_token_or_local_url(token).await;
    }
    if let Some(url) = object.get("imageUrl").and_then(Value::as_str) {
        return upload_local_image(url, "view.png", "image/png").await;
    }
    if let Some(base64) = object.get("imageBase64").and_then(Value::as_str) {
        let file_name = object
            .get("fileName")
            .and_then(Value::as_str)
            .unwrap_or("view.png");
        let content_type = object
            .get("contentType")
            .and_then(Value::as_str)
            .unwrap_or("image/png");
        return upload_base64(file_name, content_type, base64).await;
    }
    Err("view is missing imageUrl, imageBase64, or fileToken".to_string())
}

async fn resolve_token_or_local_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("file token is empty".to_string());
    }
    if looks_like_remote_url(value) {
        return Err(
            "imageUrl must be a local /api/brew/image-cache path; remote URLs are not fetched"
                .to_string(),
        );
    }
    if value.contains("/api/brew/image-cache/") {
        return upload_local_image(value, "view.png", "image/png").await;
    }
    Ok(value.to_string())
}

fn looks_like_remote_url(value: &str) -> bool {
    let value = value.trim();
    value.starts_with("https://") || value.starts_with("http://") || value.starts_with("//")
}

async fn upload_local_image(
    url: &str,
    file_name: &str,
    fallback_type: &str,
) -> Result<String, String> {
    let (bytes, content_type) = ImageCacheService::new().read_local_public_url(url).await?;
    let content_type = if content_type == "application/octet-stream" {
        fallback_type
    } else {
        content_type.as_str()
    };
    upload_bytes(file_name, content_type, bytes).await
}

async fn upload_base64(
    file_name: &str,
    content_type: &str,
    base64: &str,
) -> Result<String, String> {
    let bytes = STANDARD
        .decode(base64.trim())
        .map_err(|_| "imageBase64 is invalid".to_string())?;
    upload_bytes(file_name, content_type, bytes).await
}

async fn upload_bytes(
    file_name: &str,
    content_type: &str,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if bytes.len() > TAPP_UPLOAD_MAX_BYTES {
        return Err("Upload exceeds the 16 MiB limit".to_string());
    }
    validate_upload_type(file_name, content_type).map_err(map_err)?;
    let client = client().await?;
    client
        .upload(file_name.to_string(), content_type.to_string(), bytes)
        .await
        .map_err(map_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn generate_rejects_remote_image_url() {
        let mut params = HashMap::new();
        params.insert(
            "imageUrl".to_string(),
            json!("https://evil.example/secret.png"),
        );
        let error = execute_generate(&params).await.unwrap_err();
        assert!(
            error.contains("image-cache") || error.contains("imageUrl"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn generate_rejects_unknown_operation() {
        let mut params = HashMap::new();
        params.insert("operation".to_string(), json!("text_to_model"));
        params.insert("fileToken".to_string(), json!("file_front"));
        let error = execute_generate(&params).await.unwrap_err();
        assert!(error.contains("Unsupported generate operation"), "{error}");
    }

    #[tokio::test]
    async fn generate_rejects_remote_url_in_payload_inputs() {
        let mut params = HashMap::new();
        params.insert("operation".to_string(), json!("multiview_to_model"));
        params.insert(
            "payload".to_string(),
            json!({
                "inputs": [
                    {"front": {"url": "https://evil.example/a.png"}},
                    {"back": "file_back"}
                ]
            }),
        );
        let error = execute_generate(&params).await.unwrap_err();
        assert!(
            error.contains("remote URL") || error.contains("image-cache"),
            "{error}"
        );
    }

    #[tokio::test]
    async fn resolve_view_spec_accepts_tokens_and_rejects_urls() {
        assert_eq!(
            resolve_view_spec(&json!("file_front")).await.unwrap(),
            "file_front"
        );
        assert_eq!(
            resolve_view_spec(&json!({"file_token": "file_front"}))
                .await
                .unwrap(),
            "file_front"
        );
        let error = resolve_view_spec(&json!({"url": "https://evil.example/x.png"}))
            .await
            .unwrap_err();
        assert!(error.contains("remote URL"), "{error}");
        let error = resolve_view_spec(&json!("https://evil.example/x.png"))
            .await
            .unwrap_err();
        assert!(error.contains("image-cache"), "{error}");
    }
}

fn string_param(params: &HashMap<String, Value>, key: &str) -> Option<String> {
    params
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
}
