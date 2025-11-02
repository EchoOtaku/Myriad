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
        }),
        json!({
            "id": 2,
            "name": "Twitter",
            "enabled": false,
            "icon": "twitter",
        }),
        json!({
            "id": 3,
            "name": "LinkedIn",
            "enabled": false,
            "icon": "linkedin",
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
