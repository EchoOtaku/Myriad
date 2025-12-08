use axum::{http::StatusCode, Json};
use serde_json::{json, Value};

pub mod ai_recommend; // ✅ AI图标推荐 API
pub mod analysis;
pub mod auth;
pub mod auth_local;
pub mod bilibili;
pub mod cache; // ✅ 缓存管理 API
pub mod config;
pub mod metrics; // ✅ 系统监控指标 API (P2优化)
pub mod platforms;
pub mod profile;
pub mod prompt;
pub mod proxy;
pub mod reports; // ✅ 双层报告系统API
pub mod setup;
pub mod steam;
pub mod system;
pub mod tapp; // ✅ Tapp 第三方应用 API (旧)
pub mod tapp_scheduler; // ✅ Tapp 定时任务调度 API
pub mod tapps; // ✅ Tapp 应用管理 API (新)
pub mod tasks; // ✅ 后台任务管理 API

pub async fn health() -> (StatusCode, Json<Value>) {
    use std::sync::atomic::Ordering;

    // Check if we're in config mode by accessing the global static from main
    let config_mode = crate::CONFIG_MODE.load(Ordering::Relaxed);

    (
        StatusCode::OK,
        Json(json!({
            "status": "ok",
            "service": "myriad-backend",
            "version": env!("CARGO_PKG_VERSION"),
            "mode": if config_mode { "configuration" } else { "full" },
            "database_connected": !config_mode,
        })),
    )
}
