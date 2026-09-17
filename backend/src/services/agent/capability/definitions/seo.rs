//! Site SEO / GEO capabilities (branding + original public content).

use crate::services::agent::types::*;
use serde_json::json;

use super::super::CapabilityRegistry;

pub fn register(registry: &mut CapabilityRegistry) {
    registry.register(Capability {
        id: "seo.inspect".to_string(),
        name: "Inspect site SEO/GEO".to_string(),
        description: "Agent SEO/GEO step 1: read branding plus guest-visible original writing, notes, and public apps. Ground truth. Excludes friend-links and third-party feeds.".to_string(),
        category: CapabilityCategory::DataRead,
        supported_actions: vec![IntentAction::Query],
        input_schema: json!({
            "type": "object",
            "properties": {},
            "additionalProperties": false
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "branding": { "type": "object" },
                "owner": { "type": "object" },
                "modules": { "type": "object" },
                "apps": { "type": "array" },
                "writing": { "type": "array" },
                "notes": { "type": "array" },
                "facts": { "type": "string" }
            }
        }),
        required_permissions: vec!["config:read".to_string()],
        requires_ai: false,
        estimated_duration_ms: Some(800),
        ..Default::default()
    });

    registry.register(Capability {
        id: "seo.generate".to_string(),
        name: "Draft SEO/GEO copy".to_string(),
        description: "Agent SEO/GEO step 2: draft site_description, site_keywords, and/or site_ai_intro from inspect facts. Does not save. Show the owner the draft, then seo.apply only if they confirm.".to_string(),
        category: CapabilityCategory::AiProcess,
        supported_actions: vec![IntentAction::Create],
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_title": { "type": "string" },
                "site_description": { "type": "string" },
                "hint": { "type": "string", "description": "Owner identity, topics, tone" },
                "language": { "type": "string", "description": "zh | zh-TW | en | ja | ko | fr | de" },
                "fields": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["site_description", "site_keywords", "site_ai_intro"]
                    }
                }
            },
            "additionalProperties": false
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "site_description": { "type": "string" },
                "site_keywords": { "type": "string" },
                "site_ai_intro": { "type": "string" },
                "source": { "type": "string" }
            },
            "required": ["source"]
        }),
        required_permissions: vec!["config:read".to_string()],
        requires_ai: false,
        estimated_duration_ms: Some(8000),
        ..Default::default()
    });

    registry.register(Capability {
        id: "seo.apply".to_string(),
        name: "Save SEO/GEO copy".to_string(),
        description: "Agent SEO/GEO step 3: save site_description, site_keywords, and/or site_ai_intro after the owner confirms. Never changes visibility policy. Scheduled review must not call this.".to_string(),
        category: CapabilityCategory::DataWrite,
        supported_actions: vec![IntentAction::Update],
        input_schema: json!({
            "type": "object",
            "properties": {
                "site_description": { "type": "string" },
                "site_keywords": { "type": "string" },
                "site_ai_intro": { "type": "string" }
            },
            "additionalProperties": false
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "ok": { "type": "boolean" },
                "saved": { "type": "array", "items": { "type": "string" } }
            },
            "required": ["ok", "saved"]
        }),
        required_permissions: vec!["system:admin".to_string()],
        requires_ai: false,
        estimated_duration_ms: Some(400),
        requires_confirmation: true,
        confirmation_message: Some(
            "This will save Agent SEO/GEO copy to the public site. Visibility policy is not changed.".to_string(),
        ),
        risk_level: RiskLevel::Medium,
        ..Default::default()
    });
}
