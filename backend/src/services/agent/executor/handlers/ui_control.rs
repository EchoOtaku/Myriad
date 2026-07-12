//! UI 控制能力处理器
//!
//! 处理 tapp.ui, tapp.interact, router.navigate 等 UI 控制类能力
//! 包含完整的 Tapp UI 分析、交互和多窗口管理功能

use super::HandlerContext;
use crate::models::entities::{
    tapp_scheduled_tasks, tapp_storage, tapp_task_executions, tapp_widgets, tapps,
};
use once_cell::sync::Lazy;
use regex::Regex;
use sea_orm::{ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder};
use serde_json::{json, Value};
use std::collections::HashMap;

// HTML element parsing regexes (compiled once)
static RE_BUTTON: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"<button[^>]*(?:id=[\"']([^\"']*)[\"'])?[^>]*(?:class=[\"']([^\"']*)[\"'])?[^>]*(?:title=[\"']([^\"']*)[\"'])?[^>]*>([^<]*)"#).unwrap()
});
static RE_INPUT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"<(?:input|textarea)[^>]*(?:id=[\"']([^\"']*)[\"'])?[^>]*(?:type=[\"']([^\"']*)[\"'])?[^>]*(?:placeholder=[\"']([^\"']*)[\"'])?[^>]*"#).unwrap()
});
static RE_FORM: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"<form[^>]*(?:id=[\"']([^\"']*)[\"'])?[^>]*(?:action=[\"']([^\"']*)[\"'])?[^>]*"#)
        .unwrap()
});
static RE_LINK: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"<a[^>]*href=[\"']([^\"']*)[\"'][^>]*>([^<]*)"#).unwrap());
static RE_ONCLICK: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"<(\w+)[^>]*onclick=[\"']([^\"']*)[\"'][^>]*(?:id=[\"']([^\"']*)[\"'])?"#).unwrap()
});

// JS analysis regexes (compiled once)
static RE_JS_FUNC: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"(?:async\s+)?function\s+(\w+)\s*\([^)]*\)"#).unwrap());
static RE_TAPP_API: Lazy<Regex> = Lazy::new(|| Regex::new(r#"Tapp\.(\w+)\.(\w+)"#).unwrap());
static RE_ADDEVENT: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"\.addEventListener\(['\"](\w+)['\"]"#).unwrap());
static RE_ON_PROP: Lazy<Regex> = Lazy::new(|| Regex::new(r#"\.on(\w+)\s*="#).unwrap());
static RE_I18N_KEY: Lazy<Regex> = Lazy::new(|| Regex::new(r#"t\(['\"]([^'\"]+)['\"]\)"#).unwrap());
static RE_FUNC_NAME: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(\w+)\s*\("#).unwrap());

/// Escape a string for safe embedding in a JS single-quoted string literal.
/// Prevents injection when values are interpolated into generated JavaScript.
fn sanitize_js_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
        .replace('<', "\\x3c")
}

/// 执行 UI 控制能力
pub async fn execute(
    capability_id: &str,
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    match capability_id {
        "tapp.ui" => execute_tapp_ui_analysis(params, ctx).await,
        "tapp.understand" => execute_tapp_understand(params, ctx).await,
        "tapp.interact" => execute_tapp_interact(params, ctx).await,
        "tapp.pageContent" => execute_tapp_page_content(params, ctx).await,
        "tapp.windows" => execute_tapp_windows_query(params, ctx).await,
        "tapp.window.open" => execute_tapp_window_open(params, ctx).await,
        "tapp.window.close" => execute_tapp_window_close(params, ctx).await,
        "tapp.window.focus" => execute_tapp_window_focus(params).await,
        "tapp.fill" => execute_tapp_fill(params, ctx).await,
        "tapp.read" => execute_tapp_read(params, ctx).await,
        "router.navigate" => execute_router_navigate(params).await,
        "router.state" => execute_router_state(params).await,
        "page.interact" => execute_page_interact(params).await,
        "page.understand" => execute_page_understand(params, ctx).await,
        "page.content" => execute_page_content(params).await,
        "music.control" => execute_music_control(params).await,
        "music.status" => execute_music_status().await,
        "music.playlist" => execute_music_playlist(params).await,
        _ => Err(format!("Unknown ui_control capability: {}", capability_id)),
    }
}

// ============================================================================
// Tapp UI 相关
// ============================================================================

/// 执行 Tapp UI 结构解析
async fn execute_tapp_ui_analysis(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let tapp_id = params
        .get("tappId")
        .and_then(|v| v.as_str())
        .ok_or("Missing tappId")?;
    // 始终使用已认证的 user_id，防止 IDOR 越权
    let user_id = ctx.user_id;
    let include_code = params
        .get("includeCode")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let element_filter = params
        .get("elementFilter")
        .and_then(|v| v.as_str())
        .unwrap_or("interactive");

    // 验证 tapp_id 安全性，防止路径穿越
    if tapp_id.contains("..")
        || tapp_id.contains('/')
        || tapp_id.contains('\\')
        || tapp_id.contains('\0')
    {
        return Err("无效的 tappId".to_string());
    }

    // 获取 Tapp 信息
    let tapp = tapps::Entity::find()
        .filter(tapps::Column::TappId.eq(tapp_id))
        .filter(tapps::Column::UserId.eq(user_id))
        .one(ctx.db)
        .await
        .map_err(|e| format!("Failed to fetch tapp: {}", e))?
        .ok_or("Tapp not found")?;

    // 构建文件路径
    let base_path = format!("data/tapps/{}/{}", user_id, tapp_id);

    // 读取 HTML 文件
    let html_content = tokio::fs::read_to_string(format!("{}/page.html", base_path))
        .await
        .unwrap_or_default();

    // 读取 JS 文件
    let js_content = if include_code {
        tokio::fs::read_to_string(format!("{}/main.js", base_path))
            .await
            .unwrap_or_default()
    } else {
        String::new()
    };

    // 解析 HTML 结构
    let structure = parse_html_structure(&html_content);
    let elements = parse_html_elements(&html_content, element_filter);
    let functions = if include_code {
        parse_js_functions(&js_content)
    } else {
        vec![]
    };
    let events = parse_js_events(&js_content);
    let i18n = parse_i18n(&js_content);
    let suggested_actions = generate_suggested_actions(&elements, &functions);

    Ok(json!({
        "tappId": tapp_id,
        "tappName": tapp.name,
        "version": tapp.version,
        "status": format!("{:?}", tapp.status),
        "structure": structure,
        "elements": elements,
        "functions": functions,
        "events": events,
        "i18n": i18n,
        "suggestedActions": suggested_actions,
        "files": {
            "hasHtml": !html_content.is_empty(),
            "hasJs": !js_content.is_empty(),
            "htmlSize": html_content.len(),
            "jsSize": js_content.len()
        }
    }))
}

/// 执行 Tapp UI 智能理解 - 使用 AI 分析 UI 并生成操作指令
async fn execute_tapp_understand(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let analyzer = ctx
        .ai_analyzer
        .ok_or("AI analyzer not configured for UI understanding")?;

    let tapp_id = params
        .get("tappId")
        .and_then(|v| v.as_str())
        .ok_or("Missing tappId")?;
    // 始终使用已认证的 user_id，防止 IDOR
    let user_id = ctx.user_id;
    let user_intent = params
        .get("userIntent")
        .and_then(|v| v.as_str())
        .ok_or("Missing userIntent - 请描述你想要执行的操作")?;
    let window_id = params.get("windowId").and_then(|v| v.as_str());
    let auto_execute = params
        .get("autoExecute")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // 获取或复用 UI 分析结果
    let ui_analysis = if let Some(existing) = params.get("uiAnalysis") {
        existing.clone()
    } else {
        let mut ui_params = HashMap::new();
        ui_params.insert("tappId".to_string(), json!(tapp_id));
        ui_params.insert("userId".to_string(), json!(user_id));
        ui_params.insert("includeCode".to_string(), json!(true));
        ui_params.insert("elementFilter".to_string(), json!("interactive"));

        execute_tapp_ui_analysis(&ui_params, ctx).await?
    };

    let tapp_name = ui_analysis
        .get("tappName")
        .and_then(|v| v.as_str())
        .unwrap_or("未知应用");

    // 构建 AI 提示词
    let prompt = format!(
        r#"你是一个 UI 交互分析专家。分析以下 Tapp 应用的 UI 结构，根据用户意图生成操作指令。

## 应用信息
- 应用名称：{tapp_name}
- 应用 ID：{tapp_id}

## UI 结构
{ui_structure}

## 用户意图
{user_intent}

请返回 JSON 格式：
```json
{{
  "understanding": {{
    "appPurpose": "应用主要用途",
    "currentState": "当前 UI 状态",
    "availableActions": []
  }},
  "plan": {{
    "canFulfill": true/false,
    "explanation": "是否能完成用户意图",
    "steps": [
      {{ "step": 1, "action": "click|input|submit", "target": "元素ID", "value": "输入值", "reason": "原因" }}
    ],
    "requiredInputs": []
  }}
}}
```"#,
        tapp_name = tapp_name,
        tapp_id = tapp_id,
        ui_structure = serde_json::to_string_pretty(&ui_analysis).unwrap_or_default(),
        user_intent = user_intent,
    );

    let ai_result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("AI analysis failed: {}", e))?;

    let parsed: Value = extract_json_from_response(&ai_result)
        .and_then(|json_str| serde_json::from_str(&json_str).ok())
        .unwrap_or_else(|| {
            json!({
                "understanding": { "appPurpose": "无法解析", "currentState": "未知", "availableActions": [] },
                "plan": { "canFulfill": false, "explanation": ai_result, "steps": [], "requiredInputs": [] }
            })
        });

    let frontend_action = if auto_execute {
        if let Some(steps) = parsed
            .get("plan")
            .and_then(|p| p.get("steps"))
            .and_then(|s| s.as_array())
        {
            if !steps.is_empty()
                && parsed
                    .get("plan")
                    .and_then(|p| p.get("canFulfill"))
                    .and_then(|c| c.as_bool())
                    .unwrap_or(false)
            {
                let sequence: Vec<Value> = steps.iter().map(|step| {
                    json!({
                        "action": step.get("action").and_then(|a| a.as_str()).unwrap_or("click"),
                        "target": step.get("target").and_then(|t| t.as_str()).unwrap_or(""),
                        "value": step.get("value"),
                        "delay": 100
                    })
                }).collect();

                Some(json!({
                    "type": "tapp_interact",
                    "tappId": tapp_id,
                    "windowId": window_id,
                    "commands": sequence,
                    "timestamp": chrono::Utc::now().timestamp_millis()
                }))
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    Ok(json!({
        "tappId": tapp_id,
        "tappName": tapp_name,
        "userIntent": user_intent,
        "understanding": parsed.get("understanding").cloned().unwrap_or(json!({})),
        "plan": parsed.get("plan").cloned().unwrap_or(json!({})),
        "frontendAction": frontend_action,
        "uiAnalysis": { "included": true }
    }))
}

/// 执行 Tapp UI 交互操作
async fn execute_tapp_interact(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let tapp_id = params
        .get("tappId")
        .and_then(|v| v.as_str())
        .ok_or("Missing tappId")?;
    // 始终使用已认证的 user_id，防止 IDOR
    let user_id = ctx.user_id;
    let action = params.get("action").and_then(|v| v.as_str());
    let target = params.get("target").and_then(|v| v.as_str());
    let value = params.get("value").and_then(|v| v.as_str());
    let function_name = params.get("functionName").and_then(|v| v.as_str());
    let args = params.get("args").and_then(|v| v.as_array());
    let sequence = params.get("sequence").and_then(|v| v.as_array());

    // 验证 Tapp 存在
    let tapp = tapps::Entity::find()
        .filter(tapps::Column::TappId.eq(tapp_id))
        .filter(tapps::Column::UserId.eq(user_id))
        .one(ctx.db)
        .await
        .map_err(|e| format!("Failed to fetch tapp: {}", e))?
        .ok_or("Tapp not found")?;

    let mut commands = vec![];
    let mut script_parts = vec![];

    // 处理序列操作
    if let Some(seq) = sequence {
        for (i, op) in seq.iter().enumerate() {
            let op_action = op.get("action").and_then(|v| v.as_str()).unwrap_or("click");
            let op_target = op.get("target").and_then(|v| v.as_str()).unwrap_or("");
            let op_value = op.get("value").and_then(|v| v.as_str());
            let op_delay = op.get("delay").and_then(|v| v.as_u64()).unwrap_or(0);

            let (cmd, script) =
                generate_interaction_command(op_action, op_target, op_value, None, None, op_delay);

            commands.push(json!({
                "step": i + 1,
                "action": op_action,
                "target": op_target,
                "value": op_value,
                "delay": op_delay,
                "command": cmd
            }));
            script_parts.push(script);
        }
    } else if let Some(act) = action {
        let (cmd, script) =
            generate_interaction_command(act, target.unwrap_or(""), value, function_name, args, 0);
        commands.push(json!({ "action": act, "target": target, "value": value, "command": cmd }));
        script_parts.push(script);
    }

    let full_script = if script_parts.len() > 1 {
        format!(
            "(async function() {{\n  {}\n}})();",
            script_parts.join("\n  ")
        )
    } else {
        script_parts.join("")
    };

    let ws_message = json!({
        "type": "tapp_interact",
        "tappId": tapp_id,
        "userId": user_id,
        "commands": commands,
        "timestamp": chrono::Utc::now().timestamp_millis()
    });

    Ok(json!({
        "success": true,
        "tappId": tapp_id,
        "tappName": tapp.name,
        "commands": commands,
        "script": full_script,
        "frontendAction": {
            "type": "tapp_interact",
            "tappId": tapp_id,
            "commands": commands,
            "timestamp": chrono::Utc::now().timestamp_millis()
        },
        "websocketMessage": ws_message,
        "instructions": {
            "frontend": "前端可通过以下方式执行操作",
            "methods": [
                { "name": "直接执行脚本", "description": "在 Tapp iframe 的 contentWindow 中执行 script 字段" },
                { "name": "WebSocket 消息", "description": "通过 WebSocket 发送 websocketMessage" },
                { "name": "postMessage", "description": "使用 postMessage API 向 Tapp iframe 发送" }
            ]
        }
    }))
}

// ============================================================================
// Tapp 页面内容层级展示
// ============================================================================

async fn find_accessible_tapp(
    ctx: &HandlerContext<'_>,
    tapp_id: &str,
) -> Result<tapps::Model, String> {
    crate::api::tapp_runtime::common::verify_tapp_ownership(ctx.db, ctx.user_id, tapp_id)
        .await
        .map_err(|(_, body)| {
            body.0
                .get("message")
                .or_else(|| body.0.get("error"))
                .and_then(Value::as_str)
                .unwrap_or("Tapp access denied")
                .to_string()
        })?;

    if let Some(tapp) = tapps::Entity::find()
        .filter(tapps::Column::TappId.eq(tapp_id))
        .filter(tapps::Column::UserId.eq(ctx.user_id))
        .one(ctx.db)
        .await
        .map_err(|e| format!("Failed to fetch Tapp: {e}"))?
    {
        return Ok(tapp);
    }

    let mut query = tapps::Entity::find().filter(tapps::Column::TappId.eq(tapp_id));
    if !crate::services::agent::user_is_current_admin(ctx.db, ctx.user_id).await {
        let admin_id = crate::api::tapp_runtime::common::get_admin_user_id(ctx.db)
            .await
            .map_err(|(_, body)| {
                body.0
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Failed to resolve administrator")
                    .to_string()
            })?;
        query = query.filter(tapps::Column::UserId.eq(admin_id));
    }

    query
        .one(ctx.db)
        .await
        .map_err(|e| format!("Failed to fetch Tapp: {e}"))?
        .ok_or_else(|| "Tapp not found".to_string())
}

/// 执行 Tapp 页面内容 - 按层级展示 Tapp 数据
pub(super) async fn execute_tapp_page_content(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let level = params
        .get("level")
        .and_then(|v| v.as_str())
        .unwrap_or("apps");
    let tapp_id = params.get("tappId").and_then(|v| v.as_str());
    let task_id = params.get("taskId").and_then(|v| v.as_str());
    // 始终使用已认证的 user_id，防止 IDOR
    let user_id = ctx.user_id;
    let filter = params
        .get("filter")
        .and_then(|v| v.as_str())
        .unwrap_or("all");
    let limit = params.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;

    match level {
        "apps" => {
            // 应用列表层级
            let mut query = tapps::Entity::find();
            let admin_id = crate::api::tapp_runtime::common::get_admin_user_id(ctx.db)
                .await
                .map_err(|(_, body)| {
                    body.0
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("Failed to resolve administrator")
                        .to_string()
                })?;
            if !crate::services::agent::user_is_current_admin(ctx.db, user_id).await {
                query = query.filter(
                    tapps::Column::UserId
                        .eq(user_id)
                        .or(tapps::Column::UserId.eq(admin_id)),
                );
            }

            // 状态筛选
            match filter {
                "running" => {
                    query = query.filter(tapps::Column::Status.eq(tapps::TappStatus::Running));
                }
                "installed" => {
                    query = query.filter(tapps::Column::Status.eq(tapps::TappStatus::Installed));
                }
                "error" => {
                    query = query.filter(tapps::Column::Status.eq(tapps::TappStatus::Error));
                }
                _ => {}
            }

            let apps = query
                .order_by_desc(tapps::Column::UpdatedAt)
                .all(ctx.db)
                .await
                .map_err(|e| format!("Failed to fetch tapps: {}", e))?;

            let running_count = apps
                .iter()
                .filter(|a| a.status == tapps::TappStatus::Running)
                .count();

            let app_list: Vec<Value> = apps
                .iter()
                .take(limit)
                .map(|app| {
                    json!({
                        "id": app.id,
                        "tappId": app.tapp_id.clone(),
                        "name": app.name.clone(),
                        "version": app.version.clone(),
                        "description": app.description.clone(),
                        "icon": app.icon.clone(),
                        "themeColor": app.theme_color.clone(),
                        "status": format!("{:?}", app.status),
                        "lastRunAt": app.last_run_at.map(|t| t.to_string()),
                        "errorMessage": app.error_message.clone()
                    })
                })
                .collect();

            Ok(json!({
                "level": "apps",
                "hierarchy": {
                    "level": "list",
                    "current": { "view": "all_apps" }
                },
                "content": {
                    "title": "Tapp 应用",
                    "apps": app_list,
                    "metadata": { "totalApps": apps.len() }
                },
                "stats": {
                    "totalApps": apps.len(),
                    "runningApps": running_count,
                    "currentFilter": filter
                },
                "navigation": {
                    "currentFilter": filter,
                    "availableFilters": ["all", "running", "installed", "error"],
                    "canGoBack": false,
                    "parentPath": "/"
                },
                "actions": {
                    "available": ["installTapp", "uninstallTapp", "runTapp", "stopTapp"]
                }
            }))
        }
        "detail" => {
            // 应用详情层级
            let tapp_id_str = tapp_id.ok_or("Missing tappId for detail level")?;
            let app = find_accessible_tapp(ctx, tapp_id_str).await?;

            // 获取组件数量
            let widget_count = tapp_widgets::Entity::find()
                .filter(tapp_widgets::Column::TappId.eq(tapp_id_str))
                .filter(tapp_widgets::Column::UserId.eq(app.user_id))
                .count(ctx.db)
                .await
                .unwrap_or(0);

            // 获取存储数量
            let storage_count = tapp_storage::Entity::find()
                .filter(tapp_storage::Column::TappId.eq(tapp_id_str))
                .filter(tapp_storage::Column::UserId.eq(user_id))
                .count(ctx.db)
                .await
                .unwrap_or(0);

            // 获取任务数量
            let task_count = tapp_scheduled_tasks::Entity::find()
                .filter(tapp_scheduled_tasks::Column::TappId.eq(tapp_id_str))
                .filter(tapp_scheduled_tasks::Column::UserId.eq(user_id))
                .count(ctx.db)
                .await
                .unwrap_or(0);

            Ok(json!({
                "level": "detail",
                "hierarchy": {
                    "level": "detail",
                    "current": {
                        "type": "tapp",
                        "id": app.id,
                        "tappId": app.tapp_id.clone()
                    }
                },
                "content": {
                    "title": app.name.clone(),
                    "detail": {
                        "id": app.id,
                        "tappId": app.tapp_id.clone(),
                        "name": app.name.clone(),
                        "version": app.version.clone(),
                        "description": app.description.clone(),
                        "author": app.author.clone(),
                        "icon": app.icon.clone(),
                        "themeColor": app.theme_color.clone(),
                        "status": format!("{:?}", app.status),
                        "grantedPermissions": app.granted_permissions.clone(),
                        "manifest": app.manifest.clone(),
                        "installedAt": app.installed_at.to_string(),
                        "lastRunAt": app.last_run_at.map(|t| t.to_string()),
                        "errorMessage": app.error_message.clone()
                    }
                },
                "stats": {
                    "widgetCount": widget_count,
                    "storageCount": storage_count,
                    "taskCount": task_count
                },
                "navigation": {
                    "canGoBack": true,
                    "parentPath": "/tapps",
                    "childPaths": {
                        "widgets": format!("/tapps/{}/widgets", tapp_id_str),
                        "storage": format!("/tapps/{}/storage", tapp_id_str),
                        "tasks": format!("/tapps/{}/tasks", tapp_id_str)
                    }
                },
                "actions": {
                    "available": [
                        "runTapp", "stopTapp", "restartTapp",
                        "updatePermissions", "viewLogs", "uninstallTapp"
                    ]
                }
            }))
        }
        "widgets" => {
            // 组件列表层级
            let tapp_id_str = tapp_id.ok_or("Missing tappId for widgets level")?;
            let app = find_accessible_tapp(ctx, tapp_id_str).await?;

            let widgets = tapp_widgets::Entity::find()
                .filter(tapp_widgets::Column::TappId.eq(tapp_id_str))
                .filter(tapp_widgets::Column::UserId.eq(app.user_id))
                .all(ctx.db)
                .await
                .map_err(|e| format!("Failed to fetch widgets: {}", e))?;

            let widget_list: Vec<Value> = widgets
                .iter()
                .map(|w| {
                    json!({
                        "id": w.id,
                        "widgetId": w.widget_id.clone(),
                        "name": w.name.clone(),
                        "description": w.description.clone(),
                        "icon": w.icon.clone(),
                        "defaultSize": w.default_size.clone(),
                        "sizes": w.sizes.clone(),
                        "category": w.category.clone(),
                        "config": w.config.clone()
                    })
                })
                .collect();

            Ok(json!({
                "level": "widgets",
                "hierarchy": {
                    "level": "nested",
                    "parent": { "type": "tapp", "tappId": tapp_id_str },
                    "current": { "view": "widget_list" }
                },
                "content": {
                    "title": "组件列表",
                    "widgets": widget_list,
                    "metadata": { "tappId": tapp_id_str, "totalWidgets": widgets.len() }
                },
                "stats": { "totalWidgets": widgets.len() },
                "navigation": {
                    "canGoBack": true,
                    "parentPath": format!("/tapps/{}", tapp_id_str)
                },
                "actions": {
                    "available": ["addWidget", "removeWidget", "configureWidget"]
                }
            }))
        }
        "storage" => {
            // 存储数据层级
            let tapp_id_str = tapp_id.ok_or("Missing tappId for storage level")?;
            find_accessible_tapp(ctx, tapp_id_str).await?;

            let mut query =
                tapp_storage::Entity::find().filter(tapp_storage::Column::TappId.eq(tapp_id_str));
            query = query.filter(tapp_storage::Column::UserId.eq(user_id));

            let storage_items = query
                .order_by_desc(tapp_storage::Column::UpdatedAt)
                .all(ctx.db)
                .await
                .map_err(|e| format!("Failed to fetch storage: {}", e))?;

            let storage_list: Vec<Value> = storage_items
                .iter()
                .take(limit)
                .map(|s| {
                    json!({
                        "id": s.id,
                        "key": s.key.clone(),
                        "value": s.value.clone(),
                        "createdAt": s.created_at.to_string(),
                        "updatedAt": s.updated_at.to_string()
                    })
                })
                .collect();

            Ok(json!({
                "level": "storage",
                "hierarchy": {
                    "level": "nested",
                    "parent": { "type": "tapp", "tappId": tapp_id_str },
                    "current": { "view": "storage_list" }
                },
                "content": {
                    "title": "存储数据",
                    "storage": storage_list,
                    "metadata": {
                        "tappId": tapp_id_str,
                        "totalItems": storage_items.len()
                    }
                },
                "stats": { "totalItems": storage_items.len() },
                "navigation": {
                    "canGoBack": true,
                    "parentPath": format!("/tapps/{}", tapp_id_str)
                },
                "actions": {
                    "available": ["getStorage", "setStorage", "deleteStorage", "clearStorage"]
                }
            }))
        }
        "tasks" => {
            // 定时任务列表层级
            let tapp_id_str = tapp_id.ok_or("Missing tappId for tasks level")?;
            find_accessible_tapp(ctx, tapp_id_str).await?;

            let tasks = tapp_scheduled_tasks::Entity::find()
                .filter(tapp_scheduled_tasks::Column::TappId.eq(tapp_id_str))
                .filter(tapp_scheduled_tasks::Column::UserId.eq(user_id))
                .order_by_desc(tapp_scheduled_tasks::Column::UpdatedAt)
                .all(ctx.db)
                .await
                .map_err(|e| format!("Failed to fetch tasks: {}", e))?;

            let enabled_count = tasks.iter().filter(|t| t.enabled).count();

            let task_list: Vec<Value> = tasks
                .iter()
                .take(limit)
                .map(|t| {
                    let schedule_type = match t.schedule_type {
                        tapp_scheduled_tasks::ScheduleType::Cron => "cron",
                        tapp_scheduled_tasks::ScheduleType::Interval => "interval",
                        tapp_scheduled_tasks::ScheduleType::Once => "once",
                        tapp_scheduled_tasks::ScheduleType::Daily => "daily",
                    };
                    let execution_target = match t.execution_target {
                        tapp_scheduled_tasks::ExecutionTarget::Backend => "backend",
                        tapp_scheduled_tasks::ExecutionTarget::Frontend => "frontend",
                        tapp_scheduled_tasks::ExecutionTarget::Both => "both",
                    };
                    let scope = match t.scope {
                        tapp_scheduled_tasks::TaskScope::User => "user",
                        tapp_scheduled_tasks::TaskScope::Tapp => "tapp",
                        tapp_scheduled_tasks::TaskScope::TappPerUser => "tapp-per-user",
                        tapp_scheduled_tasks::TaskScope::Global => "global",
                    };
                    json!({
                        "id": t.id,
                        "taskId": t.task_id.clone(),
                        "name": t.name.clone(),
                        "scheduleType": schedule_type,
                        "scheduleConfig": t.schedule_config.clone(),
                        "executionTarget": execution_target,
                        "scope": scope,
                        "enabled": t.enabled,
                        "nextRunAt": t.next_run_at.map(|t| t.to_string()),
                        "lastRunAt": t.last_run_at.map(|t| t.to_string()),
                        "lastRunResult": t.last_run_result.clone(),
                        "stats": t.stats.clone()
                    })
                })
                .collect();

            Ok(json!({
                "level": "tasks",
                "hierarchy": {
                    "level": "nested",
                    "parent": { "type": "tapp", "tappId": tapp_id_str },
                    "current": { "view": "task_list" }
                },
                "content": {
                    "title": "定时任务",
                    "tasks": task_list,
                    "metadata": {
                        "tappId": tapp_id_str,
                        "totalTasks": tasks.len()
                    }
                },
                "stats": {
                    "totalTasks": tasks.len(),
                    "enabledTasks": enabled_count
                },
                "navigation": {
                    "canGoBack": true,
                    "parentPath": format!("/tapps/{}", tapp_id_str)
                },
                "actions": {
                    "available": ["enableTask", "disableTask", "runTaskNow", "viewExecutions"]
                }
            }))
        }
        "executions" => {
            // 任务执行记录层级
            let task_id_str = task_id.ok_or("Missing taskId for executions level")?;

            // 任务 ID 只在 Tapp 内唯一；按当前用户收窄，并在有歧义时要求 tappId。
            let mut task_query = tapp_scheduled_tasks::Entity::find()
                .filter(tapp_scheduled_tasks::Column::TaskId.eq(task_id_str))
                .filter(tapp_scheduled_tasks::Column::UserId.eq(user_id));
            if let Some(tapp_id) = tapp_id {
                task_query = task_query.filter(tapp_scheduled_tasks::Column::TappId.eq(tapp_id));
            }
            let matching_tasks = task_query
                .all(ctx.db)
                .await
                .map_err(|e| format!("Failed to fetch task: {}", e))?;
            let task = match matching_tasks.as_slice() {
                [task] => Some(task.clone()),
                [] => None,
                _ => return Err("Task ID is ambiguous; provide tappId".to_string()),
            };

            let mut execution_query = tapp_task_executions::Entity::find()
                .filter(tapp_task_executions::Column::TaskId.eq(task_id_str))
                .filter(tapp_task_executions::Column::UserId.eq(user_id));
            if let Some(tapp_id) = tapp_id {
                execution_query =
                    execution_query.filter(tapp_task_executions::Column::TappId.eq(tapp_id));
            }
            let executions = execution_query
                .order_by_desc(tapp_task_executions::Column::ExecutedAt)
                .all(ctx.db)
                .await
                .map_err(|e| format!("Failed to fetch executions: {}", e))?;

            let success_count = executions
                .iter()
                .filter(|e| e.status == tapp_task_executions::ExecutionStatus::Success)
                .count();

            let execution_list: Vec<Value> = executions
                .iter()
                .take(limit)
                .map(|e| {
                    json!({
                        "id": e.id,
                        "status": format!("{:?}", e.status).to_lowercase(),
                        "scheduledAt": e.scheduled_at.to_string(),
                        "executedAt": e.executed_at.to_string(),
                        "completedAt": e.completed_at.map(|t| t.to_string()),
                        "durationMs": e.duration_ms,
                        "result": e.result.clone(),
                        "error": e.error.clone(),
                        "retryCount": e.retry_count,
                        "isCompensation": e.is_compensation
                    })
                })
                .collect();

            Ok(json!({
                "level": "executions",
                "hierarchy": {
                    "level": "detail",
                    "parent": task.as_ref().map(|t| json!({
                        "type": "task",
                        "taskId": t.task_id.clone(),
                        "name": t.name.clone()
                    })),
                    "current": { "view": "execution_list" }
                },
                "content": {
                    "title": task.as_ref().map(|t| format!("{} 执行记录", t.name)).unwrap_or_else(|| "执行记录".to_string()),
                    "executions": execution_list,
                    "task": task.as_ref().map(|t| json!({
                        "id": t.id,
                        "taskId": t.task_id.clone(),
                        "name": t.name.clone(),
                        "enabled": t.enabled
                    })),
                    "metadata": {
                        "taskId": task_id_str,
                        "totalExecutions": executions.len()
                    }
                },
                "stats": {
                    "totalExecutions": executions.len(),
                    "successCount": success_count,
                    "failureCount": executions.len() - success_count
                },
                "navigation": {
                    "canGoBack": true,
                    "parentPath": task.as_ref().map(|t| format!("/tapps/{}/tasks", t.tapp_id))
                },
                "actions": {
                    "available": ["retryExecution", "clearExecutions"]
                }
            }))
        }
        _ => Err(format!("Unknown tapp page level: {}", level)),
    }
}

// ============================================================================
// Tapp 多窗口管理
// ============================================================================

/// 查询当前打开的窗口状态
async fn execute_tapp_windows_query(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let include_ui = params
        .get("includeUiAnalysis")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // 获取用户所有有页面的 Tapp
    let all_tapps = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(ctx.user_id))
        .all(ctx.db)
        .await
        .map_err(|e| format!("Failed to fetch tapps: {}", e))?;

    let available_tapps: Vec<Value> = all_tapps
        .iter()
        .filter(|t| {
            t.manifest
                .get("hasPage")
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        })
        .map(|t| {
            json!({
                "tappId": t.tapp_id,
                "name": t.name,
                "description": t.description,
                "icon": t.icon,
                "version": t.version
            })
        })
        .collect();

    Ok(json!({
        "success": true,
        "message": "窗口状态需要从前端获取",
        "availableTapps": available_tapps,
        "maxWindows": 3,
        "frontendAction": {
            "type": "query_windows",
            "action": "getWindowState",
            "includeUiAnalysis": include_ui,
            "timestamp": chrono::Utc::now().timestamp_millis()
        },
        "instructions": {
            "description": "前端应返回当前窗口状态",
            "expectedResponse": {
                "windows": "当前打开的窗口列表",
                "activeWindowId": "活跃窗口 ID",
                "windowCount": "窗口数量"
            }
        }
    }))
}

/// 打开新的 Tapp 窗口
async fn execute_tapp_window_open(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let tapp_id = params.get("tappId").and_then(|v| v.as_str());
    let tapp_name = params.get("tappName").and_then(|v| v.as_str());
    let position = params.get("position");
    let size = params.get("size");

    let tapp = if let Some(id) = tapp_id {
        tapps::Entity::find()
            .filter(tapps::Column::TappId.eq(id))
            .filter(tapps::Column::UserId.eq(ctx.user_id))
            .one(ctx.db)
            .await
            .map_err(|e| format!("Database error: {}", e))?
    } else if let Some(name) = tapp_name {
        tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(ctx.user_id))
            .filter(tapps::Column::Name.contains(name))
            .one(ctx.db)
            .await
            .map_err(|e| format!("Database error: {}", e))?
    } else {
        return Err("Missing tappId or tappName parameter".to_string());
    };

    let tapp = tapp.ok_or("Tapp not found")?;

    let has_page = tapp
        .manifest
        .get("hasPage")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if !has_page {
        return Err(format!(
            "Tapp '{}' does not have a page component",
            tapp.name
        ));
    }

    Ok(json!({
        "success": true,
        "tappId": tapp.tapp_id,
        "tappName": tapp.name,
        "frontendAction": {
            "type": "open_window",
            "tappId": tapp.tapp_id,
            "position": position,
            "size": size,
            "timestamp": chrono::Utc::now().timestamp_millis()
        }
    }))
}

/// 关闭 Tapp 窗口
async fn execute_tapp_window_close(
    params: &HashMap<String, Value>,
    _ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let window_id = params.get("windowId").and_then(|v| v.as_str());
    let tapp_id = params.get("tappId").and_then(|v| v.as_str());
    let position = params.get("position").and_then(|v| v.as_str());

    let close_target = if let Some(wid) = window_id {
        json!({ "windowId": wid })
    } else if let Some(tid) = tapp_id {
        json!({ "tappId": tid })
    } else if let Some(pos) = position {
        json!({ "position": pos })
    } else {
        return Err("Must specify windowId, tappId, or position".to_string());
    };

    Ok(json!({
        "success": true,
        "frontendAction": {
            "type": "close_window",
            "target": close_target,
            "timestamp": chrono::Utc::now().timestamp_millis()
        }
    }))
}

/// 聚焦窗口
async fn execute_tapp_window_focus(params: &HashMap<String, Value>) -> Result<Value, String> {
    let window_id = params.get("windowId").and_then(|v| v.as_str());
    let tapp_id = params.get("tappId").and_then(|v| v.as_str());
    let tapp_name = params.get("tappName").and_then(|v| v.as_str());
    let position = params.get("position").and_then(|v| v.as_str());

    let focus_target = if let Some(wid) = window_id {
        json!({ "windowId": wid })
    } else if let Some(tid) = tapp_id {
        json!({ "tappId": tid })
    } else if let Some(name) = tapp_name {
        json!({ "tappName": name })
    } else if let Some(pos) = position {
        json!({ "position": pos })
    } else {
        return Err("Must specify windowId, tappId, tappName, or position".to_string());
    };

    Ok(json!({
        "success": true,
        "frontendAction": {
            "type": "focus_window",
            "target": focus_target,
            "timestamp": chrono::Utc::now().timestamp_millis()
        }
    }))
}

/// 填充数据到 Tapp 窗口
async fn execute_tapp_fill(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let target_window = params
        .get("targetWindow")
        .ok_or("Missing targetWindow parameter")?;
    let data = params.get("data").ok_or("Missing data parameter")?;
    let auto_submit = params
        .get("autoSubmit")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let window_target = resolve_window_target(target_window, ctx).await?;

    let mut commands = vec![];
    let mut script_parts = vec![];

    if let Some(fields) = data.get("fields").and_then(|f| f.as_array()) {
        for field in fields {
            let target = field.get("target").and_then(|t| t.as_str()).unwrap_or("");
            let value = field.get("value").and_then(|v| v.as_str()).unwrap_or("");
            let field_type = field
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("input");

            let (cmd, script) =
                generate_interaction_command(field_type, target, Some(value), None, None, 0);

            commands.push(
                json!({ "action": field_type, "target": target, "value": value, "command": cmd }),
            );
            script_parts.push(script);
        }
    }

    if let Some(content) = data.get("content").and_then(|c| c.as_str()) {
        let (cmd, script) =
            generate_interaction_command("input", "main-input", Some(content), None, None, 0);
        commands.push(json!({ "action": "input", "target": "main-input", "value": content, "command": cmd, "autoDetect": true }));
        script_parts.push(script);
    }

    if auto_submit {
        let (cmd, script) =
            generate_interaction_command("click", "submit-button", None, None, None, 100);
        commands.push(json!({ "action": "submit", "target": "submit-button", "command": cmd, "autoDetect": true }));
        script_parts.push(script);
    }

    let full_script = if script_parts.len() > 1 {
        format!(
            "(async function() {{\n  {}\n}})();",
            script_parts.join("\n  ")
        )
    } else {
        script_parts.join("")
    };

    Ok(json!({
        "success": true,
        "filledFields": commands.len(),
        "targetWindow": window_target,
        "commands": commands,
        "script": full_script,
        "frontendAction": {
            "type": "fill_data",
            "target": target_window,
            "data": data,
            "commands": commands,
            "autoSubmit": auto_submit,
            "timestamp": chrono::Utc::now().timestamp_millis()
        }
    }))
}

/// 从 Tapp 窗口读取数据
async fn execute_tapp_read(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let source_window = params
        .get("sourceWindow")
        .ok_or("Missing sourceWindow parameter")?;
    let read_type = params
        .get("readType")
        .and_then(|v| v.as_str())
        .unwrap_or("all");
    let selector = params.get("selector").and_then(|v| v.as_str());

    let window_target = resolve_window_target(source_window, ctx).await?;

    let read_script = match read_type {
        "inputs" => r#"
            const inputs = {};
            document.querySelectorAll('input, textarea, select').forEach(el => {
                if (el.id) inputs[el.id] = el.value;
            });
            return inputs;
        "#.to_string(),
        "content" => {
            if let Some(sel) = selector {
                let safe_sel = sanitize_js_string(sel);
                format!(r#"const el = document.querySelector('{}'); return el ? el.textContent : null;"#, safe_sel)
            } else {
                r#"return document.body.textContent;"#.to_string()
            }
        }
        "storage" => r#"return Tapp.storage ? Tapp.storage.getAll() : {};"#.to_string(),
        _ => r#"
            const data = { inputs: {}, content: document.body.textContent, storage: Tapp.storage ? Tapp.storage.getAll() : {} };
            document.querySelectorAll('input, textarea, select').forEach(el => { if (el.id) data.inputs[el.id] = el.value; });
            return data;
        "#.to_string(),
    };

    Ok(json!({
        "success": true,
        "targetWindow": window_target,
        "readType": read_type,
        "frontendAction": {
            "type": "read_data",
            "target": source_window,
            "readType": read_type,
            "selector": selector,
            "script": read_script,
            "timestamp": chrono::Utc::now().timestamp_millis()
        },
        "instructions": {
            "description": "前端执行 script 并返回结果",
            "scriptContext": "在目标 Tapp 的 iframe contentWindow 中执行"
        }
    }))
}

// ============================================================================
// 路由和页面交互
// ============================================================================

async fn execute_router_navigate(params: &HashMap<String, Value>) -> Result<Value, String> {
    let path = params
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or("Missing path parameter")?;
    let route_params = params.get("params").cloned().unwrap_or(json!({}));
    let query_params = params.get("query").cloned().unwrap_or(json!({}));
    let replace = params
        .get("replace")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    // 验证路由路径
    let valid_prefixes = [
        "/",
        "/home",
        "/brew",
        "/platform",
        "/tapp",
        "/report",
        "/settings",
        "/profile",
        "/agent",
    ];
    let is_valid = valid_prefixes
        .iter()
        .any(|prefix| path.starts_with(prefix) || path == *prefix);

    if !is_valid {
        return Err(format!("Invalid route path: {}", path));
    }

    // 构建完整 URL
    let mut full_path = path.to_string();
    if let Some(query_obj) = query_params.as_object() {
        if !query_obj.is_empty() {
            let query_string: Vec<String> = query_obj
                .iter()
                .map(|(k, v)| format!("{}={}", k, v.as_str().unwrap_or(&v.to_string())))
                .collect();
            full_path = format!("{}?{}", path, query_string.join("&"));
        }
    }

    Ok(json!({
        "success": true,
        "currentPath": full_path,
        "frontendAction": {
            "type": "navigate",
            "path": path,
            "params": route_params,
            "query": query_params,
            "fullPath": full_path,
            "replace": replace,
            "timestamp": chrono::Utc::now().timestamp_millis()
        }
    }))
}

async fn execute_page_interact(params: &HashMap<String, Value>) -> Result<Value, String> {
    let action = params
        .get("action")
        .and_then(|v| v.as_str())
        .ok_or("Missing action parameter")?;
    let target = params.get("target").ok_or("Missing target parameter")?;
    let value = params.get("value").and_then(|v| v.as_str());

    let valid_actions = [
        "click", "hover", "focus", "scroll", "select", "toggle", "expand", "collapse",
    ];
    if !valid_actions.contains(&action) {
        return Err(format!("Invalid action: {}", action));
    }

    Ok(json!({
        "success": true,
        "action": action,
        "target": target,
        "frontendAction": {
            "type": "page_interact",
            "action": action,
            "target": target,
            "value": value,
            "timestamp": chrono::Utc::now().timestamp_millis()
        }
    }))
}

async fn execute_page_understand(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let page_context = params.get("context").cloned().unwrap_or(json!({}));
    let query = params.get("query").and_then(|v| v.as_str()).unwrap_or("");

    if let Some(analyzer) = ctx.ai_analyzer {
        let context_str = serde_json::to_string_pretty(&page_context).unwrap_or_default();
        let truncated_context: String = context_str.chars().take(4000).collect();

        let prompt = format!(
            "你是一个页面交互分析助手。请分析当前页面上下文并理解用户意图，生成操作计划。\n\n\
            页面上下文：\n{}\n\n\
            用户请求：{}\n\n\
            请返回 JSON 格式的操作计划：\n\
            {{\n\
              \"understood_intent\": \"对用户意图的理解\",\n\
              \"actions\": [\n\
                {{\"type\": \"click|input|navigate|scroll\", \"target\": \"目标元素描述\", \"value\": \"输入值（如有）\"}}\n\
              ],\n\
              \"explanation\": \"操作计划说明\"\n\
            }}\n\n\
            请直接返回 JSON。",
            truncated_context, query
        );

        let result = analyzer
            .analyze(&prompt)
            .await
            .map_err(|e| format!("AI analysis failed: {}", e))?;

        return Ok(json!({
            "query": query,
            "plan": result,
            "understood": true
        }));
    }

    Ok(json!({
        "query": query,
        "understood": false,
        "message": "AI analyzer not available"
    }))
}

// ============================================================================
// 辅助函数
// ============================================================================

/// 解析 HTML 结构概览
fn parse_html_structure(html: &str) -> Value {
    let has_background =
        html.contains("id=\"tapp-background\"") || html.contains("id='tapp-background'");
    let has_content = html.contains("id=\"tapp-content\"") || html.contains("id='tapp-content'");

    let mut sections = vec![];
    for tag in [
        "header", "main", "footer", "nav", "aside", "article", "section", "form",
    ] {
        if html.contains(&format!("<{}", tag)) {
            sections.push(tag);
        }
    }

    json!({
        "hasBackground": has_background,
        "hasContent": has_content,
        "sections": sections,
        "estimatedComplexity": if html.len() > 5000 { "complex" } else if html.len() > 1000 { "moderate" } else { "simple" }
    })
}

/// 解析 HTML 元素
fn parse_html_elements(html: &str, filter: &str) -> Value {
    let mut buttons = vec![];
    let mut inputs = vec![];
    let mut forms = vec![];
    let mut links = vec![];
    let mut interactive = vec![];

    // 解析按钮
    for cap in RE_BUTTON.captures_iter(html) {
        let id = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let class = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let title = cap.get(3).map(|m| m.as_str()).unwrap_or("");
        let text = cap.get(4).map(|m| m.as_str()).unwrap_or("").trim();

        buttons.push(json!({
            "type": "button", "id": id, "class": class, "title": if !title.is_empty() { title } else { text }, "text": text,
            "action": infer_button_action(id, class, title, text)
        }));
    }

    // 解析输入框
    for cap in RE_INPUT.captures_iter(html) {
        let id = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let input_type = cap.get(2).map(|m| m.as_str()).unwrap_or("text");
        let placeholder = cap.get(3).map(|m| m.as_str()).unwrap_or("");

        inputs.push(json!({
            "type": "input", "inputType": input_type, "id": id, "placeholder": placeholder,
            "purpose": infer_input_purpose(id, input_type, placeholder)
        }));
    }

    // 解析表单
    for cap in RE_FORM.captures_iter(html) {
        let id = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let action = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        forms.push(json!({ "type": "form", "id": id, "action": action }));
    }

    // 解析链接
    for cap in RE_LINK.captures_iter(html) {
        let href = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let text = cap.get(2).map(|m| m.as_str()).unwrap_or("").trim();
        links.push(json!({ "type": "link", "href": href, "text": text }));
    }

    // 解析其他可交互元素
    for cap in RE_ONCLICK.captures_iter(html) {
        let tag = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let onclick = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let id = cap.get(3).map(|m| m.as_str()).unwrap_or("");

        if tag != "button" && tag != "a" {
            interactive.push(json!({
                "type": tag, "id": id, "onclick": onclick, "action": extract_function_name(onclick)
            }));
        }
    }

    match filter {
        "buttons" => json!({ "buttons": buttons }),
        "inputs" => json!({ "inputs": inputs }),
        "forms" => json!({ "forms": forms }),
        "interactive" => {
            json!({ "buttons": buttons, "inputs": inputs, "interactive": interactive })
        }
        _ => json!({
            "buttons": buttons, "inputs": inputs, "forms": forms, "links": links, "interactive": interactive,
            "summary": { "totalButtons": buttons.len(), "totalInputs": inputs.len(), "totalForms": forms.len(), "totalLinks": links.len() }
        }),
    }
}

/// 从按钮属性推断操作
fn infer_button_action(id: &str, class: &str, title: &str, text: &str) -> String {
    let combined = format!("{} {} {} {}", id, class, title, text).to_lowercase();

    if combined.contains("send") || combined.contains("submit") || combined.contains("发送") {
        "submit".to_string()
    } else if combined.contains("add") || combined.contains("新增") || combined.contains("添加")
    {
        "add".to_string()
    } else if combined.contains("delete")
        || combined.contains("remove")
        || combined.contains("删除")
    {
        "delete".to_string()
    } else if combined.contains("search") || combined.contains("搜索") {
        "search".to_string()
    } else if combined.contains("edit") || combined.contains("编辑") {
        "edit".to_string()
    } else if combined.contains("save") || combined.contains("保存") {
        "save".to_string()
    } else if combined.contains("cancel") || combined.contains("取消") {
        "cancel".to_string()
    } else if combined.contains("close") || combined.contains("关闭") {
        "close".to_string()
    } else {
        "click".to_string()
    }
}

/// 从输入框属性推断用途
fn infer_input_purpose(id: &str, input_type: &str, placeholder: &str) -> String {
    let combined = format!("{} {} {}", id, input_type, placeholder).to_lowercase();

    if combined.contains("search") || combined.contains("搜索") {
        "search".to_string()
    } else if combined.contains("password") || combined.contains("密码") {
        "password".to_string()
    } else if combined.contains("email") || combined.contains("邮箱") {
        "email".to_string()
    } else if combined.contains("name") || combined.contains("姓名") {
        "name".to_string()
    } else if combined.contains("note") || combined.contains("笔记") {
        "note".to_string()
    } else {
        "text".to_string()
    }
}

/// 解析 JS 函数
fn parse_js_functions(js: &str) -> Vec<Value> {
    let mut functions = vec![];

    for cap in RE_JS_FUNC.captures_iter(js) {
        let name = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        if !name.is_empty() && !name.starts_with('_') {
            functions.push(json!({ "name": name, "type": "function", "purpose": infer_function_purpose(name) }));
        }
    }

    let mut tapp_apis: std::collections::HashSet<String> = std::collections::HashSet::new();
    for cap in RE_TAPP_API.captures_iter(js) {
        let module = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let method = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        tapp_apis.insert(format!("Tapp.{}.{}", module, method));
    }

    for api in tapp_apis {
        functions.push(json!({ "name": api.clone(), "type": "tapp_api", "purpose": infer_tapp_api_purpose(&api) }));
    }

    functions
}

/// 解析 JS 事件绑定
fn parse_js_events(js: &str) -> Vec<Value> {
    let mut events = vec![];

    let event_re = &*RE_ADDEVENT;
    for cap in event_re.captures_iter(js) {
        let event_type = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        events.push(json!({ "type": event_type, "binding": "addEventListener" }));
    }

    let on_re = &*RE_ON_PROP;
    for cap in on_re.captures_iter(js) {
        let event_type = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        events.push(json!({ "type": event_type, "binding": "property" }));
    }

    events
}

/// 解析 i18n 配置
fn parse_i18n(js: &str) -> Value {
    let mut languages = vec![];
    let mut sample_keys = vec![];

    // 检测支持的语言
    if js.contains("'zh-CN'") || js.contains("\"zh-CN\"") {
        languages.push("zh-CN");
    }
    if js.contains("'en-US'") || js.contains("\"en-US\"") {
        languages.push("en-US");
    }
    if js.contains("'ja-JP'") || js.contains("\"ja-JP\"") {
        languages.push("ja-JP");
    }

    // 提取一些 i18n 键名
    for (i, cap) in RE_I18N_KEY.captures_iter(js).enumerate() {
        if i >= 10 {
            break;
        } // 只取前 10 个
        let key = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        if !key.is_empty() {
            sample_keys.push(key.to_string());
        }
    }

    json!({
        "supported": !languages.is_empty(),
        "languages": languages,
        "sampleKeys": sample_keys
    })
}

fn infer_function_purpose(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("init") {
        "initialization".to_string()
    } else if lower.contains("render") {
        "rendering".to_string()
    } else if lower.contains("update") {
        "update".to_string()
    } else if lower.contains("add") {
        "add_item".to_string()
    } else if lower.contains("delete") {
        "delete_item".to_string()
    } else if lower.contains("save") {
        "save_data".to_string()
    } else if lower.contains("load") {
        "load_data".to_string()
    } else {
        "utility".to_string()
    }
}

fn infer_tapp_api_purpose(api: &str) -> String {
    if api.contains("storage") {
        "data_persistence".to_string()
    } else if api.contains("ui") {
        "user_interface".to_string()
    } else if api.contains("lifecycle") {
        "lifecycle_management".to_string()
    } else {
        "api_call".to_string()
    }
}

fn extract_function_name(onclick: &str) -> String {
    RE_FUNC_NAME
        .captures(onclick)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| "inline".to_string())
}

/// 生成建议操作
fn generate_suggested_actions(elements: &Value, _functions: &[Value]) -> Vec<Value> {
    let mut actions = vec![];

    if let Some(buttons) = elements.get("buttons").and_then(|b| b.as_array()) {
        for btn in buttons {
            let id = btn.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let action = btn
                .get("action")
                .and_then(|v| v.as_str())
                .unwrap_or("click");
            let title = btn.get("title").and_then(|v| v.as_str()).unwrap_or("");

            if !id.is_empty() {
                actions.push(json!({
                    "action": format!("click_{}", action),
                    "target": id,
                    "description": format!("点击 {} 按钮", if !title.is_empty() { title } else { id }),
                    "command": format!("document.getElementById('{}').click()", id)
                }));
            }
        }
    }

    if let Some(inputs) = elements.get("inputs").and_then(|i| i.as_array()) {
        for input in inputs {
            let id = input.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let purpose = input
                .get("purpose")
                .and_then(|v| v.as_str())
                .unwrap_or("text");

            if !id.is_empty() {
                actions.push(json!({
                    "action": format!("input_{}", purpose),
                    "target": id,
                    "description": format!("在 {} 中输入内容", id),
                    "command": format!("document.getElementById('{}').value = '{{text}}'", id)
                }));
            }
        }
    }

    actions
}

/// 生成单个交互命令
fn generate_interaction_command(
    action: &str,
    target: &str,
    value: Option<&str>,
    function_name: Option<&str>,
    args: Option<&Vec<Value>>,
    delay: u64,
) -> (String, String) {
    let delay_script = if delay > 0 {
        format!("await new Promise(r => setTimeout(r, {}));\n  ", delay)
    } else {
        String::new()
    };

    let safe_target = target.replace('-', "_");
    let escaped_target = sanitize_js_string(target);

    match action {
        "click" => {
            let cmd = format!("document.getElementById('{}').click()", escaped_target);
            let script = format!(
                "{}const el_{} = document.getElementById('{}');\n  if (el_{}) el_{}.click();",
                delay_script, safe_target, escaped_target, safe_target, safe_target
            );
            (cmd, script)
        }
        "input" => {
            let val = value.unwrap_or("");
            let escaped_val = sanitize_js_string(val);
            let cmd = format!(
                "document.getElementById('{}').value = '{}'",
                escaped_target, escaped_val
            );
            let script = format!(
                "{}const input_{} = document.getElementById('{}');\n  if (input_{}) {{\n    input_{}.value = '{}';\n    input_{}.dispatchEvent(new Event('input', {{ bubbles: true }}));\n  }}",
                delay_script, safe_target, escaped_target, safe_target, safe_target, escaped_val, safe_target
            );
            (cmd, script)
        }
        "submit" => {
            let cmd = format!("document.getElementById('{}').submit()", escaped_target);
            let script = format!(
                "{}const form_{} = document.getElementById('{}');\n  if (form_{}) form_{}.submit();",
                delay_script, safe_target, escaped_target, safe_target, safe_target
            );
            (cmd, script)
        }
        "call" => {
            let func = function_name.unwrap_or(target);
            let safe_func = sanitize_js_string(func);
            let args_str = args
                .map(|a| {
                    a.iter()
                        .map(|v| {
                            if v.is_string() {
                                format!("'{}'", sanitize_js_string(v.as_str().unwrap_or("")))
                            } else {
                                v.to_string()
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(", ")
                })
                .unwrap_or_default();
            let cmd = format!("{}({})", safe_func, args_str);
            let script = format!(
                "{}if (typeof {} === 'function') {}({});",
                delay_script, safe_func, safe_func, args_str
            );
            (cmd, script)
        }
        "focus" => {
            let cmd = format!("document.getElementById('{}').focus()", escaped_target);
            let script = format!(
                "{}const focus_{} = document.getElementById('{}');\n  if (focus_{}) focus_{}.focus();",
                delay_script, safe_target, escaped_target, safe_target, safe_target
            );
            (cmd, script)
        }
        "clear" => {
            let cmd = format!("document.getElementById('{}').value = ''", escaped_target);
            let script = format!(
                "{}const clear_{} = document.getElementById('{}');\n  if (clear_{}) {{\n    clear_{}.value = '';\n    clear_{}.dispatchEvent(new Event('input', {{ bubbles: true }}));\n  }}",
                delay_script, safe_target, escaped_target, safe_target, safe_target, safe_target
            );
            (cmd, script)
        }
        "select" => {
            let val = value.unwrap_or("");
            let escaped_val = sanitize_js_string(val);
            let cmd = format!(
                "document.getElementById('{}').value = '{}'",
                escaped_target, escaped_val
            );
            let script = format!(
                "{}const select_{} = document.getElementById('{}');\n  if (select_{}) {{\n    select_{}.value = '{}';\n    select_{}.dispatchEvent(new Event('change', {{ bubbles: true }}));\n  }}",
                delay_script, safe_target, escaped_target, safe_target, safe_target, escaped_val, safe_target
            );
            (cmd, script)
        }
        _ => {
            let cmd = format!("// Unknown action: {}", action);
            let script = format!("{}// Unknown action: {}", delay_script, action);
            (cmd, script)
        }
    }
}

/// 解析窗口目标参数
async fn resolve_window_target(target: &Value, ctx: &HandlerContext<'_>) -> Result<Value, String> {
    let window_id = target.get("windowId").and_then(|v| v.as_str());
    let tapp_id = target.get("tappId").and_then(|v| v.as_str());
    let tapp_name = target.get("tappName").and_then(|v| v.as_str());
    let position = target.get("position").and_then(|v| v.as_str());

    let resolved_tapp_id = if let Some(name) = tapp_name {
        let tapp = tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(ctx.user_id))
            .filter(tapps::Column::Name.contains(name))
            .one(ctx.db)
            .await
            .map_err(|e| format!("Database error: {}", e))?;

        tapp.map(|t| t.tapp_id)
    } else {
        tapp_id.map(|s| s.to_string())
    };

    Ok(json!({
        "windowId": window_id,
        "tappId": resolved_tapp_id,
        "tappName": tapp_name,
        "position": position,
        "resolved": true
    }))
}

/// 从 AI 响应中提取 JSON
fn extract_json_from_response(response: &str) -> Option<String> {
    if let Some(start) = response.find("```json") {
        if let Some(end) = response[start..]
            .find("```\n")
            .or_else(|| response[start..].rfind("```"))
        {
            let json_start = start + 7;
            let json_content = &response[json_start..start + end];
            return Some(json_content.trim().to_string());
        }
    }

    if response.trim().starts_with('{') {
        return Some(response.trim().to_string());
    }

    if let (Some(start), Some(end)) = (response.find('{'), response.rfind('}')) {
        if end > start {
            return Some(response[start..=end].to_string());
        }
    }

    None
}

/// 检测页面类型
fn detect_page_type(path: &str) -> &'static str {
    let path_lower = path.to_lowercase();

    if path_lower == "/" || path_lower == "/home" {
        "home"
    } else if path_lower.starts_with("/platform")
        || path_lower.starts_with("/bilibili")
        || path_lower.starts_with("/steam")
        || path_lower.starts_with("/github")
        || path_lower.starts_with("/netease")
    {
        "platform"
    } else if path_lower.starts_with("/brew") {
        "brew"
    } else if path_lower.starts_with("/tapp") {
        "tapp"
    } else if path_lower.starts_with("/report") {
        "report"
    } else if path_lower.starts_with("/settings") || path_lower.starts_with("/config") {
        "settings"
    } else if path_lower.starts_with("/profile") || path_lower.starts_with("/user") {
        "profile"
    } else {
        "other"
    }
}

/// 获取页面名称
fn get_page_name(path: &str, page_type: &str) -> String {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    match page_type {
        "home" => "首页".to_string(),
        "platform" => {
            if let Some(platform) = segments.get(1).or(segments.first()) {
                match platform.to_lowercase().as_str() {
                    "bilibili" | "bili" => "哔哩哔哩".to_string(),
                    "steam" => "Steam 游戏".to_string(),
                    "github" => "GitHub 活动".to_string(),
                    "netease" => "网易云音乐".to_string(),
                    _ => format!("{} 数据", platform),
                }
            } else {
                "平台数据".to_string()
            }
        }
        "brew" => {
            if segments.len() > 1 {
                "订阅详情".to_string()
            } else {
                "信息聚合".to_string()
            }
        }
        "tapp" => {
            if segments.len() > 1 {
                "Tapp 详情".to_string()
            } else {
                "Tapp 工坊".to_string()
            }
        }
        "report" => "数据报告".to_string(),
        "settings" => "系统设置".to_string(),
        "profile" => "个人中心".to_string(),
        _ => "页面".to_string(),
    }
}

/// 从路由中提取上下文信息
fn extract_route_context(path: &str, params: &HashMap<String, Value>) -> Value {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let page_type = detect_page_type(path);

    let mut context = json!({
        "platform": null,
        "itemId": null,
        "viewMode": "list",
        "filters": {}
    });

    // 提取平台信息
    if page_type == "platform" {
        if let Some(platform) = segments.get(1).or(segments.first()) {
            let platform_lower = platform.to_lowercase();
            if [
                "bilibili", "bangumi", "steam", "github", "netease", "mal", "x", "discord",
                "xbox", "psn", "playstation",
            ]
            .contains(&platform_lower.as_str())
            {
                context["platform"] = json!(platform_lower);
            }
        }

        // 检查是否有详情页 ID
        if let Some(item_id) = segments.get(2) {
            context["itemId"] = json!(item_id);
            context["viewMode"] = json!("detail");
        }
    }

    // 从参数中提取视图模式
    if let Some(view_mode) = params.get("viewMode").and_then(|v| v.as_str()) {
        context["viewMode"] = json!(view_mode);
    }

    // 从参数中提取筛选条件
    if let Some(filters) = params.get("filters") {
        context["filters"] = filters.clone();
    }

    context
}

/// 构建面包屑导航
fn build_breadcrumb(path: &str) -> Vec<String> {
    let mut breadcrumb = vec!["首页".to_string()];
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    for (i, segment) in segments.iter().enumerate() {
        let name = match segment.to_lowercase().as_str() {
            "platform" | "platforms" => "平台数据".to_string(),
            "bilibili" | "bili" => "哔哩哔哩".to_string(),
            "steam" => "Steam".to_string(),
            "github" => "GitHub".to_string(),
            "netease" => "网易云音乐".to_string(),
            "brew" => "信息聚合".to_string(),
            "tapp" | "tapps" => "Tapp 工坊".to_string(),
            "report" | "reports" => "数据报告".to_string(),
            "settings" => "设置".to_string(),
            "profile" => "个人中心".to_string(),
            "detail" | "details" => "详情".to_string(),
            _ => {
                // 如果是 ID 或其他内容，检查是否是最后一个
                if i == segments.len() - 1 && segment.len() > 8 {
                    "详情".to_string()
                } else {
                    segment.to_string()
                }
            }
        };

        if name != "首页" {
            breadcrumb.push(name);
        }
    }

    breadcrumb
}

// ============================================================================
// 路由状态和音乐控制
// ============================================================================

/// 获取当前路由状态
async fn execute_router_state(params: &HashMap<String, Value>) -> Result<Value, String> {
    let current_path = params
        .get("currentPath")
        .and_then(|v| v.as_str())
        .unwrap_or("/");

    let page_type = detect_page_type(current_path);
    let page_name = get_page_name(current_path, page_type);
    let breadcrumb = build_breadcrumb(current_path);

    // 从路径中提取上下文信息
    let context = extract_route_context(current_path, params);

    Ok(json!({
        "currentPath": current_path,
        "params": params.get("routeParams").cloned().unwrap_or(json!({})),
        "query": params.get("queryParams").cloned().unwrap_or(json!({})),
        "pageName": page_name,
        "pageType": page_type,
        "context": context,
        "breadcrumb": breadcrumb,
        "canGoBack": current_path != "/" && current_path != "/home",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

/// 音乐播放器控制
async fn execute_music_control(params: &HashMap<String, Value>) -> Result<Value, String> {
    let action = params
        .get("action")
        .and_then(|v| v.as_str())
        .ok_or("缺少 action 参数（play/pause/next/previous/volume/mute/unmute）")?;

    let timestamp = chrono::Utc::now().timestamp_millis();

    let frontend_action = match action {
        "play" | "pause" | "toggle" => {
            json!({
                "type": "music_control",
                "action": if action == "toggle" { "toggle-play-pause" } else { action },
                "timestamp": timestamp
            })
        }
        "next" => {
            json!({
                "type": "music_control",
                "action": "next",
                "timestamp": timestamp
            })
        }
        "previous" => {
            json!({
                "type": "music_control",
                "action": "previous",
                "timestamp": timestamp
            })
        }
        "volume" => {
            let volume = params
                .get("volume")
                .and_then(|v| v.as_f64())
                .unwrap_or(50.0);
            json!({
                "type": "music_control",
                "action": "volume",
                "value": volume / 100.0,
                "timestamp": timestamp
            })
        }
        "mute" => {
            json!({
                "type": "music_control",
                "action": "mute",
                "value": true,
                "timestamp": timestamp
            })
        }
        "unmute" => {
            json!({
                "type": "music_control",
                "action": "mute",
                "value": false,
                "timestamp": timestamp
            })
        }
        "seek" => {
            let position = params
                .get("position")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            json!({
                "type": "music_control",
                "action": "seek",
                "value": position,
                "timestamp": timestamp
            })
        }
        _ => {
            return Err(format!("Unknown music control action: {}", action));
        }
    };

    Ok(json!({
        "success": true,
        "action": action,
        "frontendAction": frontend_action,
        "message": match action {
            "play" => "正在播放音乐",
            "pause" => "已暂停播放",
            "toggle" => "切换播放状态",
            "next" => "切换到下一首",
            "previous" => "切换到上一首",
            "volume" => "已调节音量",
            "mute" => "已静音",
            "unmute" => "已取消静音",
            "seek" => "已跳转播放位置",
            _ => "操作完成"
        }
    }))
}

/// 获取音乐播放器状态
async fn execute_music_status() -> Result<Value, String> {
    let timestamp = chrono::Utc::now().timestamp_millis();
    Ok(json!({
        "success": true,
        "frontendAction": {
            "type": "music_get_status",
            "timestamp": timestamp
        },
        "message": "请求获取播放器状态"
    }))
}

/// 加载并播放歌单
async fn execute_music_playlist(params: &HashMap<String, Value>) -> Result<Value, String> {
    let playlist_id = params.get("playlistId").and_then(|v| {
        if let Some(s) = v.as_str() {
            if !s.is_empty() {
                Some(s.to_string())
            } else {
                None
            }
        } else if let Some(n) = v.as_i64() {
            Some(n.to_string())
        } else {
            v.as_u64().map(|n| n.to_string())
        }
    });

    let playlist_id = match playlist_id {
        Some(id) => id,
        None => {
            tracing::warn!(
                params = ?params,
                "[ui_control] music.playlist: Missing playlistId"
            );
            return Err("Missing playlistId parameter. Use netease.searchPlaylist first to get a playlist ID.".to_string());
        }
    };

    let source = params
        .get("source")
        .and_then(|v| v.as_str())
        .unwrap_or("netease");
    let auto_play = params
        .get("autoPlay")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let timestamp = chrono::Utc::now().timestamp_millis();

    tracing::info!(
        playlist_id = %playlist_id,
        source = %source,
        auto_play = %auto_play,
        "[ui_control] music.playlist: Loading playlist"
    );

    Ok(json!({
        "success": true,
        "playlistId": playlist_id,
        "source": source,
        "autoPlay": auto_play,
        "frontendAction": {
            "type": "music_load_playlist",
            "playlistId": playlist_id,
            "source": source,
            "autoPlay": auto_play,
            "timestamp": timestamp
        },
        "message": format!("正在加载{}歌单...", if source == "netease" { "网易云" } else { "QQ音乐" })
    }))
}

// ============================================================================
// 页面内容
// ============================================================================

/// 读取当前页面内容
async fn execute_page_content(params: &HashMap<String, Value>) -> Result<Value, String> {
    let current_path = params
        .get("currentPath")
        .and_then(|v| v.as_str())
        .unwrap_or("/");
    let page_type = params
        .get("pageType")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| detect_page_type(current_path));
    let context = params.get("context").cloned().unwrap_or(json!({}));

    match page_type {
        "brew" => {
            // 简化版：返回基础信息
            Ok(json!({
                "pageType": "brew",
                "hierarchy": { "level": "list" },
                "content": { "title": "Brew 订阅" },
                "note": "详细内容请使用 brew.page 能力"
            }))
        }
        "platform" => {
            let platform = context
                .get("platform")
                .and_then(|v| v.as_str())
                .unwrap_or("steam");
            let item_id = context.get("itemId").and_then(|v| v.as_str());

            if let Some(id) = item_id {
                Ok(json!({
                    "pageType": "platform",
                    "hierarchy": {
                        "level": "detail",
                        "parent": { "platform": platform },
                        "current": { "itemId": id }
                    },
                    "content": {
                        "title": format!("{} 详情", platform),
                        "detail": { "id": id, "platform": platform }
                    },
                    "navigation": {
                        "canGoBack": true,
                        "parentPath": format!("/platform/{}", platform)
                    }
                }))
            } else {
                Ok(json!({
                    "pageType": "platform",
                    "hierarchy": { "level": "list", "platform": platform },
                    "content": { "title": format!("{} 列表", platform) },
                    "navigation": { "canGoBack": true }
                }))
            }
        }
        "tapp" => Ok(json!({
            "pageType": "tapp",
            "hierarchy": { "level": "apps" },
            "content": { "title": "Tapp 应用" },
            "note": "详细内容请使用 tapp.page 能力"
        })),
        _ => Ok(json!({
            "pageType": page_type,
            "currentPath": current_path,
            "content": { "title": "页面内容" },
            "navigation": { "canGoBack": true }
        })),
    }
}
