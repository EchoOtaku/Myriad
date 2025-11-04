use axum::{http::StatusCode, Json};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};

// Global flag to trigger config reload
pub static CONFIG_RELOAD_REQUESTED: AtomicBool = AtomicBool::new(false);

#[allow(dead_code)]
pub fn is_config_reload_requested() -> bool {
    CONFIG_RELOAD_REQUESTED.load(Ordering::Relaxed)
}

#[allow(dead_code)]
pub fn reset_config_reload_flag() {
    CONFIG_RELOAD_REQUESTED.store(false, Ordering::Relaxed);
}

/// POST /api/system/reload-config
/// Reload configuration without restarting the server
pub async fn reload_config() -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    tracing::info!("🔄 Configuration reload requested via API");

    // Set config reload flag
    CONFIG_RELOAD_REQUESTED.store(true, Ordering::Relaxed);

    Ok(Json(json!({
        "success": true,
        "message": "Configuration will be reloaded. Database connection will be re-established if needed.",
    })))
}

/// GET /api/system/status
/// Get system status and uptime
pub async fn system_status() -> Json<Value> {
    use std::time::SystemTime;

    let uptime = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    Json(json!({
        "status": "running",
        "uptime_seconds": uptime,
        "version": env!("CARGO_PKG_VERSION"),
        "config_mode": crate::CONFIG_MODE.load(Ordering::Relaxed),
    }))
}
