//! Tripo 3D capabilities for Agent.

use crate::services::agent::types::*;
use serde_json::json;

use super::super::CapabilityRegistry;

pub fn register(registry: &mut CapabilityRegistry) {
    registry.register(Capability {
        id: "model3d.status".to_string(),
        name: "3D 服务状态".to_string(),
        description: "查询 Tripo 3D 是否启用且已配置（不返回密钥）".to_string(),
        category: CapabilityCategory::ResourceCreate,
        supported_actions: vec![IntentAction::Query],
        input_schema: json!({ "type": "object", "properties": {} }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "enabled": { "type": "boolean" },
                "configured": { "type": "boolean" },
                "capabilities": { "type": "array", "items": { "type": "string" } }
            }
        }),
        required_permissions: vec!["3d:generate".to_string()],
        requires_ai: false,
        estimated_duration_ms: Some(200),
        ..Default::default()
    });

    registry.register(Capability {
        id: "model3d.generate".to_string(),
        name: "3D 模型生成".to_string(),
        description:
            "从图或本站缓存图生成 GLB（image_to_model / multiview_to_model），服务端等待并持久化"
                .to_string(),
        category: CapabilityCategory::ResourceCreate,
        supported_actions: vec![IntentAction::Create],
        input_schema: json!({
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["image_to_model", "multiview_to_model"],
                    "default": "image_to_model"
                },
                "imageUrl": {
                    "type": "string",
                    "description": "仅本站 /api/brew/image-cache/... 路径，禁止任意外网抓取"
                },
                "imageBase64": { "type": "string" },
                "fileName": { "type": "string" },
                "contentType": { "type": "string" },
                "fileToken": { "type": "string" },
                "views": {
                    "type": "object",
                    "description": "multiview 方向 → imageUrl / imageBase64 / fileToken"
                },
                "payload": { "type": "object" }
            }
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "taskId": { "type": "string" },
                "status": { "type": "string" },
                "assets": { "type": "array" }
            }
        }),
        required_permissions: vec!["3d:generate".to_string()],
        requires_ai: false,
        estimated_duration_ms: Some(180_000),
        ..Default::default()
    });

    registry.register(Capability {
        id: "model3d.rig".to_string(),
        name: "3D 骨骼绑定".to_string(),
        description: "对已有 Tripo 任务做 rig_check 或 rig".to_string(),
        category: CapabilityCategory::ResourceCreate,
        supported_actions: vec![IntentAction::Create],
        input_schema: json!({
            "type": "object",
            "properties": {
                "operation": {
                    "type": "string",
                    "enum": ["rig_check", "rig"],
                    "default": "rig"
                },
                "input": { "type": "string", "description": "上游 task id 或 file token" },
                "payload": { "type": "object" }
            },
            "required": ["input"]
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "taskId": { "type": "string" },
                "status": { "type": "string" },
                "assets": { "type": "array" }
            }
        }),
        required_permissions: vec!["3d:generate".to_string()],
        requires_ai: false,
        estimated_duration_ms: Some(120_000),
        ..Default::default()
    });

    registry.register(Capability {
        id: "model3d.retarget".to_string(),
        name: "3D 动画重定向".to_string(),
        description: "对已绑定模型做动画 retarget 并持久化 GLB".to_string(),
        category: CapabilityCategory::ResourceCreate,
        supported_actions: vec![IntentAction::Create],
        input_schema: json!({
            "type": "object",
            "properties": {
                "input": { "type": "string", "description": "已 rig 的 task id" },
                "animation": { "type": "string" },
                "animations": { "type": "array", "items": { "type": "string" } },
                "payload": { "type": "object" }
            },
            "required": ["input"]
        }),
        output_schema: json!({
            "type": "object",
            "properties": {
                "taskId": { "type": "string" },
                "status": { "type": "string" },
                "assets": { "type": "array" }
            }
        }),
        required_permissions: vec!["3d:generate".to_string()],
        requires_ai: false,
        estimated_duration_ms: Some(120_000),
        ..Default::default()
    });
}
