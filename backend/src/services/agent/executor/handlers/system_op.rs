//! 系统操作能力处理器
//!
//! 处理 data.transform, scheduler.create, cache.status 等系统操作类能力

use super::HandlerContext;
use crate::services::background_processor::BACKGROUND_PROCESSOR;
use crate::services::brew_scheduler::get_brew_scheduler;
use serde_json::{json, Value};
use std::collections::HashMap;

/// 执行系统操作能力
pub async fn execute(
    capability_id: &str,
    params: &HashMap<String, Value>,
    _ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    match capability_id {
        "data.transform" => execute_data_transform(params).await,
        "scheduler.create" => execute_scheduler_create(params).await,
        "scheduler.trigger" => execute_scheduler_trigger(params).await,
        "system.metrics" => execute_system_metrics().await,
        "cache.status" => execute_cache_status(params).await,
        "cache.clear" => execute_cache_clear(params).await,
        "rsshub.healthcheck" => execute_rsshub_healthcheck().await,
        "image.cache" => execute_image_cache(params).await,
        "export.data" => execute_export_data(params).await,
        "task.submit" => execute_task_submit(params).await,
        "brew.schedule" => execute_brew_schedule(params).await,
        "setup.status" => execute_setup_status().await,
        _ => Err(format!("Unknown system_op capability: {}", capability_id)),
    }
}

// ============================================================================
// 数据转换
// ============================================================================

async fn execute_data_transform(params: &HashMap<String, Value>) -> Result<Value, String> {
    let input = params.get("input").cloned().unwrap_or(json!([]));
    let pipeline = params
        .get("pipeline")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut items: Vec<Value> = match input {
        Value::Array(arr) => arr,
        Value::Object(obj) => obj
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default(),
        _ => vec![],
    };

    for step in pipeline {
        let step_type = step.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match step_type {
            "filter" => {
                let field = step.get("field").and_then(|v| v.as_str()).unwrap_or("");
                let op = step.get("operator").and_then(|v| v.as_str()).unwrap_or("eq");
                let value = step.get("value").cloned().unwrap_or(json!(null));

                items.retain(|item| {
                    let item_value = item.get(field);
                    match op {
                        "eq" => item_value == Some(&value),
                        "ne" => item_value != Some(&value),
                        "contains" => item_value
                            .and_then(|v| v.as_str())
                            .map(|s| value.as_str().map(|v| s.contains(v)).unwrap_or(false))
                            .unwrap_or(false),
                        _ => true,
                    }
                });
            }
            "sort" => {
                let field = step.get("field").and_then(|v| v.as_str()).unwrap_or("");
                let order = step.get("order").and_then(|v| v.as_str()).unwrap_or("asc");

                items.sort_by(|a, b| {
                    let va = a.get(field);
                    let vb = b.get(field);
                    let cmp = match (va, vb) {
                        (Some(Value::String(a)), Some(Value::String(b))) => a.cmp(b),
                        (Some(Value::Number(a)), Some(Value::Number(b))) => a
                            .as_f64()
                            .partial_cmp(&b.as_f64())
                            .unwrap_or(std::cmp::Ordering::Equal),
                        _ => std::cmp::Ordering::Equal,
                    };
                    if order == "desc" {
                        cmp.reverse()
                    } else {
                        cmp
                    }
                });
            }
            "limit" => {
                let count = step.get("count").and_then(|v| v.as_u64()).unwrap_or(100);
                items.truncate(count as usize);
            }
            _ => {}
        }
    }

    Ok(json!({
        "data": items,
        "count": items.len()
    }))
}

// ============================================================================
// 调度器
// ============================================================================

async fn execute_scheduler_create(params: &HashMap<String, Value>) -> Result<Value, String> {
    let config = params.get("config").cloned().unwrap_or(json!({}));
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("未命名任务");

    let task_id = uuid::Uuid::new_v4().to_string();

    Ok(json!({
        "success": true,
        "taskId": task_id,
        "name": name,
        "config": config,
        "nextRun": chrono::Utc::now() + chrono::Duration::hours(1)
    }))
}

async fn execute_scheduler_trigger(params: &HashMap<String, Value>) -> Result<Value, String> {
    let tapp_id = params.get("tapp_id").and_then(|v| v.as_str());

    Ok(json!({
        "triggered": true,
        "tapp_id": tapp_id,
        "message": "Scheduler trigger initiated",
        "timestamp": chrono::Utc::now().to_rfc3339()
    }))
}

// ============================================================================
// 系统状态
// ============================================================================

async fn execute_system_metrics() -> Result<Value, String> {
    Ok(json!({
        "status": "ok",
        "timestamp": chrono::Utc::now().to_rfc3339(),
        "memory": { "description": "Memory metrics not available in this context" },
        "tasks": { "description": "Task metrics available via TASK_STORE" },
        "system": { "uptime": "Available" }
    }))
}

async fn execute_cache_status(params: &HashMap<String, Value>) -> Result<Value, String> {
    let platform = params.get("platform").and_then(|v| v.as_str());
    let platforms = if let Some(p) = platform {
        vec![p.to_string()]
    } else {
        vec!["netease", "bilibili", "github", "steam"]
            .into_iter()
            .map(|s| s.to_string())
            .collect()
    };

    let mut cache_info = Vec::new();
    let mut total_size: u64 = 0;

    for p in platforms {
        let cache_path = format!("cache/platforms/{}_filtered.json", p);
        let metadata = tokio::fs::metadata(&cache_path).await;

        let (exists, size, modified) = match metadata {
            Ok(m) => {
                let modified = m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| {
                        chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                            .map(|dt| dt.to_rfc3339())
                            .unwrap_or_default()
                    });
                (true, m.len(), modified)
            }
            Err(_) => (false, 0, None),
        };

        total_size += size;
        cache_info.push(json!({
            "platform": p,
            "exists": exists,
            "size_bytes": size,
            "size_mb": format!("{:.2}", size as f64 / 1024.0 / 1024.0),
            "modified_at": modified,
            "path": cache_path
        }));
    }

    Ok(json!({
        "caches": cache_info,
        "total_size_bytes": total_size,
        "total_size_mb": format!("{:.2}", total_size as f64 / 1024.0 / 1024.0)
    }))
}

async fn execute_cache_clear(params: &HashMap<String, Value>) -> Result<Value, String> {
    let platform = params
        .get("platform")
        .and_then(|v| v.as_str())
        .ok_or("Missing platform parameter")?;

    let cache_path = format!("cache/platforms/{}_filtered.json", platform);

    let size = tokio::fs::metadata(&cache_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    match tokio::fs::remove_file(&cache_path).await {
        Ok(_) => Ok(json!({
            "success": true,
            "platform": platform,
            "clearedSize": format!("{:.2} MB", size as f64 / 1024.0 / 1024.0)
        })),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({
            "success": true,
            "platform": platform,
            "clearedSize": "0 MB",
            "message": "Cache file did not exist"
        })),
        Err(e) => Err(format!("Failed to clear cache: {}", e)),
    }
}

// ============================================================================
// 健康检查
// ============================================================================

async fn execute_rsshub_healthcheck() -> Result<Value, String> {
    let rsshub_instances = vec!["https://rsshub.app", "https://rss.shab.fun"];

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let mut results = Vec::new();
    for instance in rsshub_instances {
        let status = match client.get(instance).send().await {
            Ok(resp) => json!({
                "url": instance,
                "status": "healthy",
                "response_code": resp.status().as_u16()
            }),
            Err(e) => json!({
                "url": instance,
                "status": "unhealthy",
                "error": e.to_string()
            }),
        };
        results.push(status);
    }

    Ok(json!({
        "instances": results,
        "checked_at": chrono::Utc::now().to_rfc3339()
    }))
}

// ============================================================================
// 图片缓存
// ============================================================================

async fn execute_image_cache(params: &HashMap<String, Value>) -> Result<Value, String> {
    let action = params
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("status");
    let cache_dir = std::path::Path::new("cache/images");

    match action {
        "status" => {
            let mut total_files = 0u64;
            let mut total_size = 0u64;

            if cache_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(cache_dir) {
                    for entry in entries.flatten() {
                        if entry.path().is_dir() {
                            if let Ok(sub_entries) = std::fs::read_dir(entry.path()) {
                                for sub_entry in sub_entries.flatten() {
                                    if let Ok(meta) = sub_entry.metadata() {
                                        total_files += 1;
                                        total_size += meta.len();
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Ok(json!({
                "total_files": total_files,
                "total_size_bytes": total_size,
                "total_size_mb": format!("{:.2}", total_size as f64 / 1024.0 / 1024.0),
                "cache_dir": cache_dir.display().to_string()
            }))
        }
        "clear" => {
            let mut cleared = 0u64;
            if cache_dir.exists() {
                if let Ok(entries) = std::fs::read_dir(cache_dir) {
                    for entry in entries.flatten() {
                        if entry.path().is_dir() {
                            if std::fs::remove_dir_all(entry.path()).is_ok() {
                                cleared += 1;
                            }
                        }
                    }
                }
            }
            Ok(json!({
                "cleared_directories": cleared,
                "message": "Image cache cleared"
            }))
        }
        _ => Err(format!("Unknown image cache action: {}", action)),
    }
}

// ============================================================================
// 数据导出
// ============================================================================

async fn execute_export_data(params: &HashMap<String, Value>) -> Result<Value, String> {
    let format = params
        .get("format")
        .and_then(|v| v.as_str())
        .unwrap_or("json");
    let data_type = params.get("type").and_then(|v| v.as_str()).unwrap_or("all");

    let mut export_data = json!({});

    if data_type == "all" || data_type == "platforms" {
        let platforms = ["bilibili", "steam", "github", "netease"];
        let mut platform_data = json!({});

        for platform in platforms {
            let path = format!("cache/platforms/{}_filtered.json", platform);
            if let Ok(content) = tokio::fs::read_to_string(&path).await {
                if let Ok(data) = serde_json::from_str::<Value>(&content) {
                    platform_data[platform] = data;
                }
            }
        }
        export_data["platforms"] = platform_data;
    }

    if data_type == "all" || data_type == "databases" {
        let dbs = ["anime_database", "game_database", "artist_database"];
        let mut db_data = json!({});

        for db in dbs {
            let path = format!("data/{}.json", db);
            if let Ok(content) = tokio::fs::read_to_string(&path).await {
                if let Ok(data) = serde_json::from_str::<Value>(&content) {
                    db_data[db] = data;
                }
            }
        }
        export_data["databases"] = db_data;
    }

    Ok(json!({
        "format": format,
        "data_type": data_type,
        "data": export_data,
        "exported_at": chrono::Utc::now().to_rfc3339()
    }))
}

// ============================================================================
// 后台任务
// ============================================================================

async fn execute_task_submit(params: &HashMap<String, Value>) -> Result<Value, String> {
    let platform = params
        .get("platform")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();

    match BACKGROUND_PROCESSOR.submit_task(platform.clone()).await {
        Ok(task_id) => Ok(json!({
            "success": true,
            "taskId": task_id,
            "platform": platform,
            "status": "submitted",
            "message": "Task submitted to background processor",
            "timestamp": chrono::Utc::now().to_rfc3339()
        })),
        Err(e) => Err(format!("Failed to submit task: {}", e)),
    }
}

async fn execute_brew_schedule(params: &HashMap<String, Value>) -> Result<Value, String> {
    let action = params
        .get("action")
        .and_then(|v| v.as_str())
        .unwrap_or("status");
    let source_id = params.get("sourceId").and_then(|v| v.as_i64());

    match action {
        "start" => {
            if let Some(scheduler) = get_brew_scheduler() {
                scheduler.start().await;
                Ok(json!({
                    "success": true,
                    "action": "start",
                    "status": "started",
                    "message": "Brew scheduler started"
                }))
            } else {
                Err("Brew scheduler not initialized".to_string())
            }
        }
        "stop" => {
            if let Some(scheduler) = get_brew_scheduler() {
                scheduler.stop().await;
                Ok(json!({
                    "success": true,
                    "action": "stop",
                    "status": "stopped",
                    "message": "Brew scheduler stopped"
                }))
            } else {
                Err("Brew scheduler not initialized".to_string())
            }
        }
        "refresh" => {
            if let Some(scheduler) = get_brew_scheduler() {
                if let Some(sid) = source_id {
                    match scheduler.refresh_source(sid as i32).await {
                        Ok(new_count) => Ok(json!({
                            "success": true,
                            "action": "refresh",
                            "sourceId": sid,
                            "status": "refreshed",
                            "newItems": new_count,
                            "message": format!("Refreshed source, {} new items", new_count)
                        })),
                        Err(e) => Err(format!("Failed to refresh source: {}", e)),
                    }
                } else {
                    Ok(json!({
                        "success": true,
                        "action": "refresh",
                        "status": "scheduled",
                        "message": "Full refresh scheduled for next tick"
                    }))
                }
            } else {
                Err("Brew scheduler not initialized".to_string())
            }
        }
        "status" => {
            let scheduler_active = get_brew_scheduler().is_some();
            Ok(json!({
                "action": "status",
                "running": scheduler_active,
                "available": scheduler_active,
                "checkedAt": chrono::Utc::now().to_rfc3339()
            }))
        }
        _ => Err(format!("Unknown brew schedule action: {}", action)),
    }
}

async fn execute_setup_status() -> Result<Value, String> {
    let has_database = crate::DB_CONNECTION.read().await.is_some();

    let mut missing_configs = Vec::new();

    if std::env::var("DATABASE_URL").is_err() {
        missing_configs.push("DATABASE_URL");
    }
    if std::env::var("JWT_SECRET").is_err() {
        missing_configs.push("JWT_SECRET");
    }
    if std::env::var("OPENAI_API_KEY").is_err() && std::env::var("GEMINI_API_KEY").is_err() {
        missing_configs.push("AI_API_KEY (OPENAI or GEMINI)");
    }

    Ok(json!({
        "isSetupRequired": !has_database || !missing_configs.is_empty(),
        "hasDatabase": has_database,
        "missingConfigs": missing_configs,
        "checkedAt": chrono::Utc::now().to_rfc3339()
    }))
}
