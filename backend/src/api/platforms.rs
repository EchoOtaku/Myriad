use axum::{extract::State, http::StatusCode, Json};
use sea_orm::{DatabaseConnection, EntityTrait, QueryOrder};
use serde_json::{json, Value};

use crate::models::entities::platforms;

/// 平台描述映射（数据库不存储描述，这里提供默认描述）
fn get_platform_description(name: &str) -> &'static str {
    match name {
        "github" => "Aggregate your repositories, stars, and contributions",
        "bilibili" => "Track your favorites, bangumi, and viewing history",
        "steam" => "Sync your game library and wishlist",
        "netease_music" => "Analyze your music taste and playlists",
        "bangumi" => "Sync your Bangumi collection, ratings, and watching status",
        _ => "Connect and sync your data",
    }
}

pub async fn list_platforms(State(db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    // 从数据库读取平台列表
    match platforms::Entity::find()
        .order_by_asc(platforms::Column::Id)
        .all(&db)
        .await
    {
        Ok(platform_list) => {
            let has_bangumi = platform_list.iter().any(|p| p.name == "bangumi");
            let fallback_bangumi_id =
                platform_list.iter().map(|p| p.id).max().unwrap_or_default() + 1;

            let mut platforms: Vec<Value> = platform_list
                .iter()
                .map(|p| {
                    json!({
                        "id": p.id,
                        "name": p.display_name,
                        "enabled": p.enabled.unwrap_or(false),
                        "icon": p.icon.as_ref().unwrap_or(&p.name),
                        "description": get_platform_description(&p.name),
                    })
                })
                .collect();

            if !has_bangumi {
                platforms.push(json!({
                    "id": fallback_bangumi_id,
                    "name": "Bangumi",
                    "enabled": false,
                    "icon": "bangumi",
                    "description": get_platform_description("bangumi"),
                }));
            }

            (StatusCode::OK, Json(json!({ "platforms": platforms })))
        }
        Err(e) => {
            tracing::error!("Failed to fetch platforms: {}", e);
            // 降级到硬编码数据
            let platforms = vec![
                json!({
                    "id": 1,
                    "name": "GitHub",
                    "enabled": true,
                    "icon": "github",
                    "description": "Aggregate your repositories, stars, and contributions",
                }),
                json!({
                    "id": 2,
                    "name": "Bilibili",
                    "enabled": false,
                    "icon": "bilibili",
                    "description": "Track your favorites, bangumi, and viewing history",
                }),
                json!({
                    "id": 3,
                    "name": "Steam",
                    "enabled": false,
                    "icon": "steam",
                    "description": "Sync your game library and wishlist",
                }),
                json!({
                    "id": 4,
                    "name": "Netease Music",
                    "enabled": false,
                    "icon": "netease",
                    "description": "Analyze your music taste and playlists",
                }),
                json!({
                    "id": 5,
                    "name": "Bangumi",
                    "enabled": false,
                    "icon": "bangumi",
                    "description": "Sync your Bangumi collection, ratings, and watching status",
                }),
            ];
            (StatusCode::OK, Json(json!({ "platforms": platforms })))
        }
    }
}

pub async fn get_profiles(State(_db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    // TODO: Fetch from database
    (
        StatusCode::OK,
        Json(json!({
            "profiles": [],
            "message": "No profiles fetched yet"
        })),
    )
}

pub async fn trigger_fetch(State(_db): State<DatabaseConnection>) -> (StatusCode, Json<Value>) {
    // TODO: Implement fetch logic
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "Fetch triggered successfully"
        })),
    )
}
