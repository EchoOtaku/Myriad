//! Agent handlers for site SEO / GEO capabilities.

use super::HandlerContext;
use crate::api::seo_geo::{GenerateSiteSeoRequest, generate_site_seo_copy_with_db};
use crate::error::HttpError;
use serde_json::{Value, json};
use std::collections::HashMap;

pub(super) async fn execute_seo_inspect(ctx: &HandlerContext<'_>) -> Result<Value, String> {
    Ok(crate::api::seo::public_geo_inspect(ctx.db).await)
}

pub(super) async fn execute_seo_generate(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let (title, description, ai_intro) = crate::api::seo::site_branding_copy(ctx.db).await;
    let mut payload = GenerateSiteSeoRequest {
        site_title: string_param(params, "site_title"),
        site_description: string_param(params, "site_description"),
        hint: string_param(params, "hint"),
        language: string_param(params, "language"),
        fields: params
            .get("fields")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default(),
    };
    if payload.site_title.trim().is_empty() {
        payload.site_title = title;
    }
    if payload.site_description.trim().is_empty() {
        payload.site_description = description;
    }
    if payload.site_title.trim().is_empty() && payload.hint.trim().is_empty() {
        payload.hint = ai_intro;
    }

    match generate_site_seo_copy_with_db(ctx.db, payload).await {
        Ok(resp) => serde_json::to_value(resp).map_err(|error| {
            tracing::error!(%error, "seo.generate serialize failed");
            "Failed to encode generated SEO copy".to_string()
        }),
        Err(HttpError(err)) => {
            let message = err
                .to_json()
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("SEO copy generation failed")
                .to_string();
            Err(message)
        }
    }
}

pub(super) async fn execute_seo_apply(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let mut updates = HashMap::new();
    let mut saved = Vec::new();
    cap_field(params, "site_description", 200, &mut updates, &mut saved);
    cap_field(params, "site_keywords", 300, &mut updates, &mut saved);
    cap_field(params, "site_ai_intro", 500, &mut updates, &mut saved);
    if updates.is_empty() {
        return Err(
            "Provide site_description, site_keywords, and/or site_ai_intro to save".to_string(),
        );
    }

    let service = crate::services::config_service::ConfigService::new(ctx.db.clone());
    if let Err(error) = service.update_configs(updates).await {
        tracing::error!(%error, "seo.apply failed to write configurations");
        return Err("Failed to save site SEO fields".to_string());
    }
    match service.load_config().await {
        Ok(config) => {
            *crate::GLOBAL_DYNAMIC_CONFIG.write().await = config;
        }
        Err(error) => {
            tracing::warn!(%error, "seo.apply saved but could not reload dynamic config");
        }
    }
    Ok(json!({ "ok": true, "saved": saved }))
}

fn string_param(params: &HashMap<String, Value>, key: &str) -> String {
    params
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn cap_field(
    params: &HashMap<String, Value>,
    key: &str,
    max_chars: usize,
    updates: &mut HashMap<String, Value>,
    saved: &mut Vec<String>,
) {
    let Some(raw) = params.get(key).and_then(Value::as_str) else {
        return;
    };
    let capped: String = raw.chars().take(max_chars).collect();
    updates.insert(key.to_string(), json!(capped));
    saved.push(key.to_string());
}
