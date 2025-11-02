use axum::{extract::State, http::StatusCode, Json};
use sea_orm::DatabaseConnection;
use serde_json::{json, Value};

pub async fn list_platforms(
    State(_db): State<DatabaseConnection>,
) -> (StatusCode, Json<Value>) {
    // TODO: Fetch from database
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
            "enabled": true,
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
            "name": "X",
            "enabled": false,
            "icon": "twitter",
            "description": "Analyze your tweets and engagement metrics",
        }),
    ];

    (StatusCode::OK, Json(json!({ "platforms": platforms })))
}

pub async fn get_profiles(
    State(_db): State<DatabaseConnection>,
) -> (StatusCode, Json<Value>) {
    // TODO: Fetch from database
    (
        StatusCode::OK,
        Json(json!({
            "profiles": [],
            "message": "No profiles fetched yet"
        })),
    )
}

pub async fn trigger_fetch(
    State(_db): State<DatabaseConnection>,
) -> (StatusCode, Json<Value>) {
    // TODO: Implement fetch logic
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "message": "Fetch triggered successfully"
        })),
    )
}
