//! 资源创建能力处理器
//!
//! 处理 tapp.generate, report.create, reminder.create 等资源创建类能力

use super::HandlerContext;
use crate::models::entities::{tapp_storage, tapps};
use crate::services::agent::executor::utils::is_valid_platform as validate_platform_name;
use crate::services::data_paths::paths;
use crate::services::permission_service::{TappPermissionService, UserRole};
use crate::GLOBAL_DYNAMIC_CONFIG;
use chrono::Utc;
use sea_orm::{ActiveModelTrait, ActiveValue::Set};
use serde_json::{json, Value};
use std::collections::HashMap;

/// 简易 HTML 转义
fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// 执行资源创建能力
pub async fn execute(
    capability_id: &str,
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    match capability_id {
        "tapp.generate" => execute_tapp_generate(params, ctx).await,
        "tapp.install" => execute_tapp_install(params, ctx).await,
        "report.create" => execute_report_create(params, ctx).await,
        "report.comprehensive" => execute_report_comprehensive(params, ctx).await,
        "reminder.create" => execute_reminder_create(params, ctx).await,
        "note.create" => execute_note_create(params, ctx).await,
        "bookmark.save" => execute_bookmark_save(params, ctx).await,
        _ => Err(format!(
            "Unknown resource_create capability: {}",
            capability_id
        )),
    }
}

// ============================================================================
// Tapp 生成
// ============================================================================

fn parse_generated_tapp_json(raw: &str) -> Option<Value> {
    serde_json::from_str(raw).ok().or_else(|| {
        let start = raw.find('{')?;
        let end = raw.rfind('}')?;
        serde_json::from_str(&raw[start..=end]).ok()
    })
}

async fn persist_agent_tapp(
    ctx: &HandlerContext<'_>,
    tapp_id: &str,
    name: &str,
    description: Option<String>,
    code: &str,
    mut manifest: Value,
    author: Value,
) -> Result<chrono::DateTime<Utc>, String> {
    if code.trim().is_empty() {
        return Err("Generated Tapp code is empty".to_string());
    }

    let manifest_object = manifest
        .as_object_mut()
        .ok_or("Tapp manifest must be an object")?;
    manifest_object.insert("id".to_string(), json!(tapp_id));
    manifest_object.insert("name".to_string(), json!(name));
    manifest_object
        .entry("version".to_string())
        .or_insert_with(|| json!("1.0.0"));
    manifest_object.insert("main".to_string(), json!("main.js"));
    manifest_object
        .entry("permissions".to_string())
        .or_insert_with(|| json!([]));
    if let Some(description) = &description {
        manifest_object.insert("description".to_string(), json!(description));
    }
    manifest_object
        .entry("author".to_string())
        .or_insert_with(|| author.clone());

    let requested_permissions: Vec<String> = manifest_object
        .get("permissions")
        .and_then(Value::as_array)
        .map(|permissions| {
            permissions
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default();
    let role = if crate::services::agent::user_is_current_admin(ctx.db, ctx.user_id).await {
        UserRole::Admin
    } else {
        UserRole::User
    };
    let granted_permissions = {
        let config = GLOBAL_DYNAMIC_CONFIG.read().await;
        TappPermissionService::filter_permissions_for_role(&config, role, &requested_permissions)
    };

    let tapp_dir = paths().tapp_user_dir(ctx.user_id).join(tapp_id);
    let code_path = tapp_dir.join("main.js");
    let manifest_path = tapp_dir.join("manifest.json");
    tokio::fs::create_dir_all(&tapp_dir)
        .await
        .map_err(|e| format!("Failed to create Tapp directory: {e}"))?;
    tokio::fs::write(&code_path, code)
        .await
        .map_err(|e| format!("Failed to write Tapp code: {e}"))?;
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize Tapp manifest: {e}"))?;
    tokio::fs::write(&manifest_path, manifest_json)
        .await
        .map_err(|e| format!("Failed to write Tapp manifest: {e}"))?;

    let version = manifest
        .get("version")
        .and_then(Value::as_str)
        .unwrap_or("1.0.0")
        .to_string();
    let icon = manifest
        .get("icon")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let theme_color = manifest
        .get("themeColor")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let now = Utc::now();
    let new_tapp = tapps::ActiveModel {
        tapp_id: Set(tapp_id.to_string()),
        user_id: Set(ctx.user_id),
        name: Set(name.to_string()),
        version: Set(version),
        description: Set(description),
        author: Set(Some(author)),
        icon: Set(icon),
        theme_color: Set(theme_color),
        manifest: Set(manifest),
        status: Set(tapps::TappStatus::Installed),
        granted_permissions: Set(json!(granted_permissions)),
        file_path: Set(manifest_path.to_string_lossy().to_string()),
        code_path: Set(code_path.to_string_lossy().to_string()),
        installed_at: Set(now.into()),
        last_run_at: Set(None),
        updated_at: Set(now.into()),
        error_message: Set(None),
        ..Default::default()
    };
    if let Err(error) = new_tapp.insert(ctx.db).await {
        let _ = tokio::fs::remove_dir_all(&tapp_dir).await;
        return Err(format!("Failed to persist Tapp: {error}"));
    }

    Ok(now)
}

async fn execute_tapp_generate(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let analyzer = ctx
        .ai_analyzer
        .ok_or("AI analyzer not configured for Tapp generation")?;

    let description = params
        .get("description")
        .and_then(Value::as_str)
        .or_else(|| params.get("requirements").and_then(Value::as_str))
        .unwrap_or("一个简单的 Tapp 应用");
    let input_data = params.get("input").or_else(|| params.get("data"));
    let input_context = if let Some(data) = input_data {
        let truncated = serde_json::to_string(data)
            .unwrap_or_default()
            .chars()
            .take(4000)
            .collect::<String>();
        format!(
            "\n\n以下是需要可视化/展示的数据（来自上游步骤的输出）：\n```json\n{}\n```\n\n请基于这些数据生成可视化看板或交互界面。",
            truncated
        )
    } else {
        String::new()
    };

    let prompt = format!(
        r#"请根据以下描述生成一个 Myriad Tapp 应用。

描述：{description}{input_context}

要求：
1. 输出浏览器可直接运行的 JavaScript，不要输出需要构建的 TypeScript
2. 使用全局 Tapp SDK（例如 Tapp.storage、Tapp.pages、Tapp.widgets）
3. core 只放共享状态和后台逻辑，Page/Widget 只负责视图；需要刷新后自动常驻时在 manifest.backgroundRequirements 声明
4. manifest 必须包含 permissions，并按需包含 hasPage、widgets、backgroundRequirements
5. 如果有数据输入，将数据内嵌到代码中直接展示

只返回合法 JSON：
{{
  "manifest": {{
    "name": "...",
    "version": "1.0.0",
    "description": "...",
    "permissions": [],
    "hasPage": true
  }},
  "code": "完整 JavaScript 代码"
}}"#
    );

    let result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("Tapp generation failed: {e}"))?;
    let parsed = parse_generated_tapp_json(&result).unwrap_or_else(|| {
        json!({
            "code": result,
            "manifest": {
                "name": "Generated Tapp",
                "version": "1.0.0",
                "permissions": []
            }
        })
    });

    let tapp_id = format!("agent.generated.{}", uuid::Uuid::new_v4().simple());
    let manifest = parsed.get("manifest").cloned().unwrap_or_else(|| json!({}));
    let tapp_name = manifest
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or("Agent Generated Tapp")
        .to_string();
    let tapp_description = manifest
        .get("description")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let code = parsed
        .get("code")
        .and_then(Value::as_str)
        .ok_or("Generated response is missing code")?;
    let author = json!({"name": "Arael Agent", "type": "ai_generated"});
    let now = persist_agent_tapp(
        ctx,
        &tapp_id,
        &tapp_name,
        tapp_description,
        code,
        manifest,
        author,
    )
    .await?;

    tracing::info!(
        tapp_id = %tapp_id,
        name = %tapp_name,
        "[TappGenerate] Tapp created through the current runtime layout"
    );

    Ok(json!({
        "success": true,
        "tappId": tapp_id,
        "name": tapp_name,
        "tapp": parsed,
        "frontendAction": {
            "type": "open_window",
            "tappId": tapp_id,
            "timestamp": now.timestamp_millis()
        }
    }))
}

// ============================================================================
// Tapp 安装
// ============================================================================

async fn execute_tapp_install(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let code = params
        .get("code")
        .and_then(Value::as_str)
        .ok_or("Missing code parameter. Provide browser-ready Tapp JavaScript.")?;
    let mut manifest = params.get("manifest").cloned().unwrap_or_else(|| json!({}));
    if !manifest.is_object() {
        return Err("manifest must be an object".to_string());
    }

    let name = params
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| manifest.get("name").and_then(Value::as_str))
        .unwrap_or("Installed Tapp")
        .to_string();
    let description = manifest
        .get("description")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let tapp_id = format!("agent.installed.{}", uuid::Uuid::new_v4().simple());
    let author = json!({"name": "Agent Install", "type": "user_install"});
    if let Some(object) = manifest.as_object_mut() {
        object
            .entry("permissions".to_string())
            .or_insert_with(|| json!([]));
    }
    let now = persist_agent_tapp(ctx, &tapp_id, &name, description, code, manifest, author).await?;

    Ok(json!({
        "success": true,
        "tappId": tapp_id,
        "name": name,
        "frontendAction": {
            "type": "open_window",
            "tappId": tapp_id,
            "timestamp": now.timestamp_millis()
        }
    }))
}

// ============================================================================
// 报告创建
// ============================================================================

async fn execute_report_create(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("未命名报告");

    // 读取上游步骤通过 inputFrom/analysisFrom 解析后注入的数据
    let analysis = params
        .get("analysis")
        .or_else(|| params.get("input"))
        .or_else(|| params.get("data"))
        .cloned()
        .unwrap_or(json!({}));

    let format = params
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("markdown");

    let content = match format {
        "markdown" => format!(
            "# {}\n\n生成时间：{}\n\n## 分析结果\n\n{}",
            title,
            Utc::now().format("%Y-%m-%d %H:%M:%S"),
            serde_json::to_string_pretty(&analysis).unwrap_or_default()
        ),
        "html" => format!(
            "<h1>{}</h1><p>生成时间：{}</p><pre>{}</pre>",
            escape_html(title),
            Utc::now().format("%Y-%m-%d %H:%M:%S"),
            escape_html(&serde_json::to_string_pretty(&analysis).unwrap_or_default())
        ),
        _ => serde_json::to_string_pretty(&json!({
            "title": title,
            "generatedAt": Utc::now().to_rfc3339(),
            "analysis": analysis
        }))
        .unwrap_or_default(),
    };

    let report_id = format!("report_{}", Utc::now().timestamp_millis());
    let now = Utc::now();

    // 持久化到 tapp_storage
    let report_data = json!({
        "id": report_id,
        "title": title,
        "format": format,
        "content": content,
        "analysis": analysis,
        "createdAt": now.to_rfc3339()
    });

    let new_record = tapp_storage::ActiveModel {
        tapp_id: Set("agent_reports".to_string()),
        user_id: Set(ctx.user_id),
        key: Set(report_id.clone()),
        value: Set(report_data),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
        ..Default::default()
    };
    new_record
        .insert(ctx.db)
        .await
        .map_err(|e| format!("Failed to save report: {}", e))?;

    tracing::info!(report_id = %report_id, title = %title, "[ReportCreate] Report persisted");

    Ok(json!({
        "success": true,
        "reportId": report_id,
        "title": title,
        "format": format,
        "content": content,
        "frontendAction": {
            "type": "show_report",
            "params": {
                "reportId": report_id,
                "title": title,
                "format": format
            },
            "timestamp": now.timestamp_millis()
        }
    }))
}

async fn execute_report_comprehensive(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let analyzer = ctx
        .ai_analyzer
        .ok_or("AI analyzer not configured for comprehensive report")?;

    let platforms = params
        .get("platforms")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>())
        .unwrap_or_else(|| vec!["steam", "bilibili", "bangumi", "github", "netease"]);

    let style = params
        .get("style")
        .and_then(|v| v.as_str())
        .unwrap_or("casual");

    // 收集所有平台数据（白名单校验，防止路径穿越）
    let mut platform_data = Vec::new();
    for platform in &platforms {
        if !validate_platform_name(platform) {
            tracing::warn!(platform = %platform, "[Report] 跳过无效平台名");
            continue;
        }
        let cache_file = format!("cache/platforms/{}_filtered.json", platform);
        if let Ok(content) = tokio::fs::read_to_string(&cache_file).await {
            if let Ok(data) = serde_json::from_str::<Value>(&content) {
                platform_data.push(json!({
                    "platform": platform,
                    "data": data.get("content_analysis").cloned().unwrap_or(json!({})),
                    "user": data.get("user_summary").cloned().unwrap_or(json!({}))
                }));
            }
        }
    }

    let style_instruction = match style {
        "formal" => "使用正式、专业的语言风格",
        "detailed" => "提供详细的数据分析和深入见解",
        _ => "使用轻松、友好的语言风格",
    };

    let platform_data_str = serde_json::to_string_pretty(&platform_data).unwrap_or_default();
    let truncated_data: String = platform_data_str.chars().take(10000).collect();

    let prompt = format!(
        "你是一个专业的数据分析师。请根据以下用户的多平台数据生成一份综合分析报告。\n\n\
        风格要求：{}\n\n\
        平台数据：\n{}\n\n\
        报告结构要求（使用 Markdown 格式）：\n\
        ## 用户画像概述\n\
        简要描述用户的整体数字形象\n\n\
        ## 各平台使用习惯\n\
        逐平台分析用户的使用模式和特点\n\n\
        ## 兴趣爱好总结\n\
        归纳用户的核心兴趣领域，提供具体证据\n\n\
        ## 跨平台关联发现\n\
        分析平台间的关联和交叉兴趣\n\n\
        ## 个性化建议\n\
        基于数据分析给出 3-5 条具体建议\n\n\
        请确保分析基于实际数据，不要编造信息。报告长度约 800-1500 字。",
        style_instruction, truncated_data
    );

    let result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("Comprehensive report generation failed: {}", e))?;

    let report_id = format!("report_{}", Utc::now().timestamp_millis());
    let now = Utc::now();

    let insights: Vec<String> = result
        .lines()
        .filter(|line| line.starts_with("- ") || line.starts_with("* "))
        .take(5)
        .map(|s| {
            s.trim_start_matches("- ")
                .trim_start_matches("* ")
                .to_string()
        })
        .collect();

    // 持久化到 tapp_storage
    let report_data = json!({
        "id": report_id,
        "title": "综合分析报告",
        "format": "markdown",
        "content": result,
        "platforms": platforms,
        "style": style,
        "insights": insights,
        "createdAt": now.to_rfc3339()
    });

    let new_record = tapp_storage::ActiveModel {
        tapp_id: Set("agent_reports".to_string()),
        user_id: Set(ctx.user_id),
        key: Set(report_id.clone()),
        value: Set(report_data),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
        ..Default::default()
    };
    new_record
        .insert(ctx.db)
        .await
        .map_err(|e| format!("Failed to save comprehensive report: {}", e))?;

    tracing::info!(report_id = %report_id, "[ReportComprehensive] Report persisted");

    Ok(json!({
        "success": true,
        "reportId": report_id,
        "platforms": platforms,
        "style": style,
        "summary": result,
        "insights": insights,
        "generatedAt": now.to_rfc3339(),
        "frontendAction": {
            "type": "show_report",
            "params": {
                "reportId": report_id,
                "title": "综合分析报告",
                "format": "markdown"
            },
            "timestamp": now.timestamp_millis()
        }
    }))
}

// ============================================================================
// 提醒/笔记/书签创建
// ============================================================================

async fn execute_reminder_create(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .ok_or("Missing title")?;
    let datetime = params
        .get("datetime")
        .and_then(|v| v.as_str())
        .ok_or("Missing datetime")?;
    let repeat = params
        .get("repeat")
        .and_then(|v| v.as_str())
        .unwrap_or("none");

    let reminder_id = format!("reminder_{}", Utc::now().timestamp_millis());
    let now = Utc::now();

    let reminder_data = json!({
        "id": reminder_id,
        "title": title,
        "datetime": datetime,
        "repeat": repeat,
        "status": "active",
        "createdAt": now.to_rfc3339()
    });

    let new_record = tapp_storage::ActiveModel {
        tapp_id: Set("agent_reminders".to_string()),
        user_id: Set(ctx.user_id),
        key: Set(reminder_id.clone()),
        value: Set(reminder_data),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
        ..Default::default()
    };
    new_record
        .insert(ctx.db)
        .await
        .map_err(|e| format!("Failed to save reminder: {}", e))?;

    Ok(json!({
        "success": true,
        "reminderId": reminder_id,
        "title": title,
        "datetime": datetime,
        "repeat": repeat,
        "message": "Reminder created and saved",
        "frontendAction": {
            "type": "show_notification",
            "params": {
                "title": crate::services::agent::response_agent::reminder_created(title),
                "message": crate::services::agent::response_agent::reminder_time(datetime),
                "reminderId": reminder_id
            },
            "timestamp": now.timestamp_millis()
        }
    }))
}

async fn execute_note_create(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    // 支持从上游步骤通过 inputFrom 解析后注入的内容
    let content_str = params
        .get("content")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let content = if let Some(s) = content_str {
        s
    } else if let Some(input) = params.get("input").or_else(|| params.get("data")) {
        // 上游步骤的输出作为笔记内容
        match input.as_str() {
            Some(s) => s.to_string(),
            None => serde_json::to_string_pretty(input).unwrap_or_default(),
        }
    } else {
        return Err("Missing content".to_string());
    };

    let title = params.get("title").and_then(|v| v.as_str());
    let tags = params
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>())
        .unwrap_or_default();

    let note_id = format!("note_{}", Utc::now().timestamp_millis());
    let now = Utc::now();

    let auto_title = title
        .map(|s| s.to_string())
        .unwrap_or_else(|| content.chars().take(30).collect::<String>());

    let note_data = json!({
        "id": note_id,
        "title": auto_title,
        "content": content,
        "tags": tags,
        "createdAt": now.to_rfc3339(),
        "updatedAt": now.to_rfc3339()
    });

    let new_record = tapp_storage::ActiveModel {
        tapp_id: Set("agent_notes".to_string()),
        user_id: Set(ctx.user_id),
        key: Set(note_id.clone()),
        value: Set(note_data),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
        ..Default::default()
    };
    new_record
        .insert(ctx.db)
        .await
        .map_err(|e| format!("Failed to save note: {}", e))?;

    Ok(json!({
        "success": true,
        "noteId": note_id,
        "title": auto_title,
        "content": content,
        "tags": tags,
        "createdAt": now.to_rfc3339(),
        "frontendAction": {
            "type": "show_notification",
            "params": {
                "title": crate::services::agent::response_agent::note_saved(&auto_title),
                "noteId": note_id
            },
            "timestamp": now.timestamp_millis()
        }
    }))
}

async fn execute_bookmark_save(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let url = params
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or("Missing url")?;
    let title = params.get("title").and_then(|v| v.as_str());
    let description = params.get("description").and_then(|v| v.as_str());
    let tags = params
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect::<Vec<_>>())
        .unwrap_or_default();

    let bookmark_id = format!("bookmark_{}", Utc::now().timestamp_millis());
    let now = Utc::now();

    // 尝试获取网页标题（SSRF 防护：仅允许 http/https，阻止内网地址）
    let fetched_title = if title.is_none() {
        let is_safe = url::Url::parse(url)
            .ok()
            .filter(|u| matches!(u.scheme(), "http" | "https"))
            .and_then(|u| u.host_str().map(|h| h.to_string()))
            .filter(|host| {
                host != "localhost"
                    && !host.ends_with(".local")
                    && !host.ends_with(".internal")
                    && !host.parse::<std::net::IpAddr>().is_ok_and(|ip| {
                        ip.is_loopback()
                            || match ip {
                                std::net::IpAddr::V4(v4) => v4.is_private() || v4.is_link_local(),
                                std::net::IpAddr::V6(v6) => v6.is_loopback(),
                            }
                    })
            })
            .is_some();
        if !is_safe {
            None
        } else {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .ok();
            if let Some(client) = client {
                if let Ok(resp) = client.get(url).send().await {
                    if let Ok(body) = resp.text().await {
                        let body_limited: String = body.chars().take(100_000).collect();
                        if let Some(start) = body_limited.find("<title>") {
                            body_limited[start..]
                                .find("</title>")
                                .map(|end| body_limited[start + 7..start + end].to_string())
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            }
        }
    } else {
        None
    };

    let final_title = title.or(fetched_title.as_deref()).unwrap_or("Untitled");

    let bookmark_data = json!({
        "id": bookmark_id,
        "url": url,
        "title": final_title,
        "description": description,
        "tags": tags,
        "createdAt": now.to_rfc3339()
    });

    let new_record = tapp_storage::ActiveModel {
        tapp_id: Set("agent_bookmarks".to_string()),
        user_id: Set(ctx.user_id),
        key: Set(bookmark_id.clone()),
        value: Set(bookmark_data),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
        ..Default::default()
    };
    new_record
        .insert(ctx.db)
        .await
        .map_err(|e| format!("Failed to save bookmark: {}", e))?;

    Ok(json!({
        "success": true,
        "bookmarkId": bookmark_id,
        "url": url,
        "title": final_title,
        "description": description,
        "tags": tags,
        "createdAt": now.to_rfc3339(),
        "frontendAction": {
            "type": "show_notification",
            "params": {
                "title": crate::services::agent::response_agent::bookmark_saved(final_title),
                "bookmarkId": bookmark_id,
                "url": url
            },
            "timestamp": now.timestamp_millis()
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::parse_generated_tapp_json;

    #[test]
    fn parses_json_from_a_markdown_fence() {
        let parsed = parse_generated_tapp_json(
            "```json\n{\"manifest\":{\"name\":\"Demo\"},\"code\":\"console.log(1)\"}\n```",
        )
        .expect("fenced JSON should parse");

        assert_eq!(parsed["manifest"]["name"], "Demo");
        assert_eq!(parsed["code"], "console.log(1)");
    }
}
