//! 资源创建能力处理器
//!
//! 处理 tapp.generate, report.create, reminder.create 等资源创建类能力

use super::HandlerContext;
use crate::models::entities::tapp_storage;
use chrono::Utc;
use sea_orm::{ActiveModelTrait, ActiveValue::Set};
use serde_json::{json, Value};
use std::collections::HashMap;

/// 执行资源创建能力
pub async fn execute(
    capability_id: &str,
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    match capability_id {
        "tapp.generate" => execute_tapp_generate(params, ctx).await,
        "report.create" => execute_report_create(params).await,
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

    let prompt = format!(
        r#"请根据以下描述生成一个 Myriad Tapp 应用的代码。

描述：{}

要求：
1. 使用 TypeScript 编写
2. 遵循 Tapp API 规范
3. 包含必要的 manifest 信息
4. 代码简洁、可运行

请返回 JSON 格式：
{{
  "manifest": {{ "name": "...", "version": "1.0.0", ... }},
  "code": "完整的 TypeScript 代码"
}}"#,
        description
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

    Ok(json!({
        "success": true,
        "tapp": parsed
    }))
}

// ============================================================================
// 报告创建
// ============================================================================

async fn execute_report_create(params: &HashMap<String, Value>) -> Result<Value, String> {
    let title = params
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("未命名报告");

    let analysis = params.get("analysis").cloned().unwrap_or(json!({}));

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
            title,
            Utc::now().format("%Y-%m-%d %H:%M:%S"),
            serde_json::to_string_pretty(&analysis).unwrap_or_default()
        ),
        _ => serde_json::to_string_pretty(&json!({
            "title": title,
            "generatedAt": Utc::now().to_rfc3339(),
            "analysis": analysis
        }))
        .unwrap_or_default(),
    };

    Ok(json!({
        "success": true,
        "reportId": uuid::Uuid::new_v4().to_string(),
        "title": title,
        "format": format,
        "content": content
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

    // 收集所有平台数据
    let mut platform_data = Vec::new();
    for platform in &platforms {
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

    let prompt = format!(
        "请根据以下多平台数据生成一份综合分析报告。\n\n\
        风格要求：{}\n\n\
        平台数据：\n{}\n\n\
        请包含：用户画像概述、各平台使用习惯分析、兴趣爱好总结、跨平台关联发现、个性化建议\n\n\
        请以 Markdown 格式输出。",
        style_instruction,
        serde_json::to_string_pretty(&platform_data).unwrap_or_default()
    );

    let result = analyzer
        .analyze(&prompt)
        .await
        .map_err(|e| format!("Comprehensive report generation failed: {}", e))?;

    let report_id = uuid::Uuid::new_v4().to_string();

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

    Ok(json!({
        "success": true,
        "reportId": report_id,
        "platforms": platforms,
        "style": style,
        "summary": result,
        "insights": insights,
        "generatedAt": Utc::now().to_rfc3339()
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
        "message": "Reminder created and saved"
    }))
}

async fn execute_note_create(
    params: &HashMap<String, Value>,
    ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    let content = params
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or("Missing content")?;
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
        "createdAt": now.to_rfc3339()
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

    // 尝试获取网页标题
    let fetched_title = if title.is_none() {
        let client = reqwest::Client::new();
        if let Ok(resp) = client.get(url).send().await {
            if let Ok(body) = resp.text().await {
                if let Some(start) = body.find("<title>") {
                    body[start..]
                        .find("</title>")
                        .map(|end| body[start + 7..start + end].to_string())
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
        "createdAt": now.to_rfc3339()
    }))
}
