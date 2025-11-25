/// 缓存管理 API
///
/// 提供缓存状态查询、清除等功能
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub struct CacheInfo {
    pub platform: String,
    pub exists: bool,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<String>,
    pub path: String,
}

#[derive(Debug, Deserialize)]
pub struct ClearCacheRequest {
    pub platforms: Option<Vec<String>>,
}

/// 获取所有平台缓存状态
///
/// GET /api/cache/status
pub async fn get_cache_status(State(_db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    let platforms = vec!["netease", "bilibili", "github", "steam"];
    let mut cache_info = Vec::new();

    for platform in platforms {
        let info = get_platform_cache_info(platform);
        cache_info.push(info);
    }

    // 计算总大小
    let total_size: u64 = cache_info.iter().filter_map(|info| info.size_bytes).sum();

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "caches": cache_info,
            "total_size_bytes": total_size,
            "total_size_mb": format!("{:.2}", total_size as f64 / 1024.0 / 1024.0),
        })),
    )
}

/// 获取单个平台缓存状态
///
/// GET /api/cache/status/{platform}
pub async fn get_platform_cache_status(
    State(_db): State<DatabaseConnection>,
    Path(platform): Path<String>,
) -> (StatusCode, Json<Value>) {
    let info = get_platform_cache_info(&platform);

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "cache": info
        })),
    )
}

/// 清除指定平台的缓存
///
/// DELETE /api/cache/{platform}
pub async fn clear_platform_cache(
    State(_db): State<DatabaseConnection>,
    Path(platform): Path<String>,
) -> (StatusCode, Json<Value>) {
    let cache_path = PathBuf::from(format!("./cache/platforms/{}_filtered.json", platform));

    if !cache_path.exists() {
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "message": format!("Cache for {} does not exist", platform)
            })),
        );
    }

    match fs::remove_file(&cache_path) {
        Ok(_) => {
            tracing::info!("✓ Cleared cache for {}", platform);
            (
                StatusCode::OK,
                Json(json!({
                    "success": true,
                    "message": format!("Successfully cleared cache for {}", platform)
                })),
            )
        }
        Err(e) => {
            tracing::error!("❌ Failed to clear cache for {}: {}", platform, e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "error": format!("Failed to clear cache: {}", e)
                })),
            )
        }
    }
}

/// 批量清除缓存
///
/// POST /api/cache/clear
/// Body: { "platforms": ["netease", "bilibili"] } 或 {} 清除所有
pub async fn clear_caches(
    State(_db): State<DatabaseConnection>,
    Json(payload): Json<ClearCacheRequest>,
) -> (StatusCode, Json<Value>) {
    let platforms = match payload.platforms {
        Some(p) => p,
        None => vec![
            "netease".to_string(),
            "bilibili".to_string(),
            "github".to_string(),
            "steam".to_string(),
        ],
    };

    let mut cleared = Vec::new();
    let mut errors = Vec::new();

    for platform in platforms {
        let cache_path = PathBuf::from(format!("./cache/platforms/{}_filtered.json", platform));

        if !cache_path.exists() {
            continue;
        }

        match fs::remove_file(&cache_path) {
            Ok(_) => {
                tracing::info!("✓ Cleared cache for {}", platform);
                cleared.push(platform);
            }
            Err(e) => {
                tracing::error!("❌ Failed to clear cache for {}: {}", platform, e);
                errors.push(json!({
                    "platform": platform,
                    "error": e.to_string()
                }));
            }
        }
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": errors.is_empty(),
            "cleared": cleared,
            "errors": errors,
            "message": format!("Cleared {} cache(s)", cleared.len())
        })),
    )
}

/// 清除所有缓存（包括原始数据）
///
/// DELETE /api/cache/all
pub async fn clear_all_caches(State(_db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    let cache_dir = PathBuf::from("./cache/platforms");
    let mut removed_files = Vec::new();
    let mut errors = Vec::new();

    if !cache_dir.exists() {
        return (
            StatusCode::OK,
            Json(json!({
                "success": true,
                "message": "Cache directory does not exist",
                "removed": []
            })),
        );
    }

    // 读取缓存目录
    match fs::read_dir(&cache_dir) {
        Ok(entries) => {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let file_name = path.file_name().unwrap().to_string_lossy().to_string();

                    // 只删除 JSON 缓存文件
                    if file_name.ends_with(".json") {
                        match fs::remove_file(&path) {
                            Ok(_) => {
                                tracing::info!("✓ Removed cache file: {}", file_name);
                                removed_files.push(file_name);
                            }
                            Err(e) => {
                                tracing::error!("❌ Failed to remove {}: {}", file_name, e);
                                errors.push(json!({
                                    "file": file_name,
                                    "error": e.to_string()
                                }));
                            }
                        }
                    }
                }
            }
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({
                    "success": false,
                    "error": format!("Failed to read cache directory: {}", e)
                })),
            );
        }
    }

    (
        StatusCode::OK,
        Json(json!({
            "success": errors.is_empty(),
            "removed": removed_files,
            "errors": errors,
            "message": format!("Removed {} cache file(s)", removed_files.len())
        })),
    )
}

/// 辅助函数：获取平台缓存信息
fn get_platform_cache_info(platform: &str) -> CacheInfo {
    let cache_path = PathBuf::from(format!("./cache/platforms/{}_filtered.json", platform));

    let (exists, size_bytes, modified_at) = if cache_path.exists() {
        match fs::metadata(&cache_path) {
            Ok(metadata) => {
                let size = metadata.len();
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|duration| {
                        chrono::DateTime::from_timestamp(duration.as_secs() as i64, 0)
                            .map(|dt| dt.to_rfc3339())
                            .unwrap_or_default()
                    });
                (true, Some(size), modified)
            }
            Err(_) => (true, None, None),
        }
    } else {
        (false, None, None)
    };

    CacheInfo {
        platform: platform.to_string(),
        exists,
        size_bytes,
        modified_at,
        path: cache_path.to_string_lossy().to_string(),
    }
}
