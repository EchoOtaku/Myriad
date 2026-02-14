//! 报告系统能力定义

use crate::services::agent::types::*;
use serde_json::json;

use super::super::CapabilityRegistry;

pub fn register(registry: &mut CapabilityRegistry) {
    // 报告生成
    registry.register(Capability {
        id: "report.create".to_string(),
        name: "报告生成".to_string(),
        description: "生成数据分析报告".to_string(),
        category: CapabilityCategory::ResourceCreate,
        supported_actions: vec![IntentAction::Create],
        input_schema: json!({
            "type": "object",
            "properties": {
                "title": { "type": "string" },
                "data": { "type": "object" },
                "template": { "type": "string" },
                "format": { "type": "string", "enum": ["markdown", "html", "json"] }
            },
            "required": ["title", "data"]
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "reportId": { "type": "string" },
                "content": { "type": "string" }
            }
        }),
        required_permissions: vec!["report:write".to_string()],
        requires_ai: false,
        estimated_duration_ms: Some(2000),
        ..Default::default()
    });

    // 综合报告生成
    registry.register(Capability {
        id: "report.comprehensive".to_string(),
        name: "综合报告生成".to_string(),
        description: "生成跨平台综合分析报告".to_string(),
        category: CapabilityCategory::ResourceCreate,
        supported_actions: vec![IntentAction::Create, IntentAction::Analyze],
        input_schema: json!({
            "type": "object",
            "properties": {
                "platforms": { "type": "array", "items": { "type": "string" } },
                "style": { "type": "string", "enum": ["formal", "casual", "detailed"] }
            }
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "reportId": { "type": "string" },
                "summary": { "type": "string" },
                "insights": { "type": "array" }
            }
        }),
        required_permissions: vec!["report:write".to_string()],
        requires_ai: true,
        estimated_duration_ms: Some(8000),
        ..Default::default()
    });

    // 报告列表
    registry.register(Capability {
        id: "report.list".to_string(),
        name: "报告列表".to_string(),
        description: "获取历史报告列表".to_string(),
        category: CapabilityCategory::DataRead,
        supported_actions: vec![IntentAction::Query],
        input_schema: json!({
            "type": "object",
            "properties": {
                "limit": { "type": "integer", "default": 10 },
                "platform": { "type": "string" }
            }
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "reports": { "type": "array" },
                "total": { "type": "integer" }
            }
        }),
        required_permissions: vec!["report:read".to_string()],
        requires_ai: false,
        estimated_duration_ms: Some(200),
        ..Default::default()
    });
}
