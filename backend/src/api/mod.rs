use axum::{http::StatusCode, Json};
use serde_json::{json, Value};

pub mod analysis;
pub mod bilibili;
pub mod config;
pub mod platforms;
pub mod profile;
pub mod prompt;
pub mod steam;

pub async fn health() -> (StatusCode, Json<Value>) {
    (
        StatusCode::OK,
        Json(json!({
            "status": "ok",
            "service": "myriad-backend",
            "version": env!("CARGO_PKG_VERSION"),
        })),
    )
}
