//! 资源创建能力处理器
//!
//! 处理 tapp.generate, report.create, reminder.create 等资源创建类能力

use super::HandlerContext;
use crate::models::entities::{tapp_storage, tapps};
use crate::services::agent::executor::utils::is_valid_platform as validate_platform_name;
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

async fn execute_tapp_generate(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let analyzer = ctx
        .ai_analyzer
        .ok_or("AI analyzer not configured for Tapp generation")?;

    let description = params
        .get("description")
        .and_then(|v| v.as_str())
        .or_else(|| params.get("requirements").and_then(|v| v.as_str()))
        .unwrap_or("一个简单的 Tapp 应用");

    // 读取上游步骤通过 inputFrom 解析后注入的数据
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
        r#"请根据以下描述生成一个 Myriad Tapp 应用的代码。

描述：{description}{input_context}

要求：
1. 使用 TypeScript 编写
2. 遵循 Tapp API 规范（通过 window.TappSDK 访问 API）
3. 包含必要的 manifest 信息
4. 代码简洁、可运行
5. 如果有数据输入，将数据内嵌到代码中直接展示

请返回 JSON 格式：
{{
  "manifest": {{ "name": "...", "version": "1.0.0", "description": "..." }},
  "code": "完整的 TypeScript 代码"
}}"#
    );

    let result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("Tapp generation failed: {}", e))?;

    let parsed: Value = serde_json::from_str(&result).unwrap_or(json!({
        "code": result,
        "manifest": {
            "name": "Generated Tapp",
            "version": "1.0.0"
        }
    }));

    let tapp_id = format!("agent.generated.{}", Utc::now().timestamp_millis());
    let tapp_name = parsed
        .get("manifest")
        .and_then(|m| m.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("Agent Generated Tapp")
        .to_string();
    let tapp_description = parsed
        .get("manifest")
        .and_then(|m| m.get("description"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let code_content = parsed
        .get("code")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let manifest = parsed.get("manifest").cloned().unwrap_or(json!({
        "name": tapp_name,
        "version": "1.0.0"
    }));

    // 写入代码文件
    let code_dir = format!("data/tapps/{}", tapp_id);
    let code_path = format!("{}/index.ts", code_dir);
    let file_path = format!("{}/manifest.json", code_dir);
    tokio::fs::create_dir_all(&code_dir)
        .await
        .map_err(|e| format!("Failed to create tapp directory: {}", e))?;
    tokio::fs::write(&code_path, &code_content)
        .await
        .map_err(|e| format!("Failed to write tapp code: {}", e))?;
    tokio::fs::write(
        &file_path,
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    )
    .await
    .map_err(|e| format!("Failed to write manifest: {}", e))?;

    // 持久化到 tapps 表
    let now = Utc::now();
    let new_tapp = tapps::ActiveModel {
        tapp_id: Set(tapp_id.clone()),
        user_id: Set(ctx.user_id),
        name: Set(tapp_name.clone()),
        version: Set("1.0.0".to_string()),
        description: Set(tapp_description),
        author: Set(Some(json!({"name": "Arael Agent", "type": "ai_generated"}))),
        icon: Set(None),
        theme_color: Set(None),
        manifest: Set(manifest.clone()),
        status: Set(tapps::TappStatus::Installed),
        granted_permissions: Set(json!([])),
        file_path: Set(file_path),
        code_path: Set(code_path),
        installed_at: Set(now.into()),
        last_run_at: Set(None),
        updated_at: Set(now.into()),
        error_message: Set(None),
        ..Default::default()
    };
    let saved = new_tapp
        .insert(ctx.db)
        .await
        .map_err(|e| format!("Failed to persist tapp: {}", e))?;

    tracing::info!(
        tapp_id = %tapp_id,
        name = %tapp_name,
        "[TappGenerate] Tapp created and persisted (db id={})",
        saved.id
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
        .and_then(|v| v.as_str())
        .ok_or("Missing code parameter. Provide Tapp code to install.")?;

    let tapp_id = format!("agent.installed.{}", Utc::now().timestamp_millis());
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Installed Tapp");

    let manifest = json!({
        "name": name,
        "version": "1.0.0"
    });

    // Write code to file
    let code_dir = format!("data/tapps/{}", tapp_id);
    let code_path = format!("{}/index.ts", code_dir);
    let file_path = format!("{}/manifest.json", code_dir);
    tokio::fs::create_dir_all(&code_dir)
        .await
        .map_err(|e| format!("Failed to create tapp directory: {}", e))?;
    tokio::fs::write(&code_path, code)
        .await
        .map_err(|e| format!("Failed to write tapp code: {}", e))?;
    tokio::fs::write(
        &file_path,
        serde_json::to_string_pretty(&manifest).unwrap_or_default(),
    )
    .await
    .map_err(|e| format!("Failed to write manifest: {}", e))?;

    let now = Utc::now();
    let new_tapp = tapps::ActiveModel {
        tapp_id: Set(tapp_id.clone()),
        user_id: Set(ctx.user_id),
        name: Set(name.to_string()),
        version: Set("1.0.0".to_string()),
        description: Set(None),
        author: Set(Some(
            json!({"name": "Agent Install", "type": "user_install"}),
        )),
        icon: Set(None),
        theme_color: Set(None),
        manifest: Set(manifest),
        status: Set(tapps::TappStatus::Installed),
        granted_permissions: Set(json!([])),
        file_path: Set(file_path),
        code_path: Set(code_path),
        installed_at: Set(now.into()),
        last_run_at: Set(None),
        updated_at: Set(now.into()),
        error_message: Set(None),
        ..Default::default()
    };
    new_tapp
        .insert(ctx.db)
        .await
        .map_err(|e| format!("Failed to persist tapp: {}", e))?;

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
        .unwrap_or_else(|| vec!["steam", "bilibili", "github", "netease"]);

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
                    && !host.parse::<std::net::IpAddr>().map_or(false, |ip| {
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
                "title": crate::services::agent::response_agent::bookmark_saved(&final_title),
                "bookmarkId": bookmark_id,
                "url": url
            },
            "timestamp": now.timestamp_millis()
        }
    }))
}
