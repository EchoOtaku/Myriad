//! Fire-and-forget install/update beacons to the official Tapp store stats edge.
//!
//! Dual-path:
//! - Backend `source=store` success → HMAC hit with stable install key.
//! - Browser fallback → `/api/tapps/store/stats-report` (installed-only) → HMAC hit.
//!
//! Never blocks installation.

use crate::services::http_client::TAPP_HTTP_CLIENT;
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};
use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const DEFAULT_STATS_URL: &str = "https://stats.store.myriad.you";

static HMAC_DESYNC_LOGGED: AtomicBool = AtomicBool::new(false);

/// Spawn a non-blocking hit (generates a stable key when none provided).
pub fn spawn_store_stats_hit(app_id: &str, version: &str, event: &str) {
    let key = server_install_idempotency_key(app_id, version, event);
    spawn_store_stats_hit_with_key(app_id, version, event, Some(key));
}

pub fn spawn_store_stats_hit_with_key(
    app_id: &str,
    version: &str,
    event: &str,
    idempotency_key: Option<String>,
) {
    let app_id = app_id.to_string();
    let version = version.to_string();
    let event = event.to_string();
    tokio::spawn(async move {
        if let Err(err) = send_hit(&app_id, &version, &event, idempotency_key.as_deref()).await {
            tracing::debug!(
                target: "store_stats",
                error = %err,
                app_id = %app_id,
                event = %event,
                "store stats beacon failed (ignored)"
            );
        }
    });
}

/// One count per user / app / version / event / UTC day (report path).
pub fn daily_user_idempotency_key(
    user_id: i32,
    app_id: &str,
    version: &str,
    event: &str,
) -> String {
    let day = chrono::Utc::now().format("%Y-%m-%d");
    stable_key(&format!("u{user_id}|{app_id}|{version}|{event}|{day}"))
}

/// One count per site instance / app / version / event / UTC day (server install).
/// Stable across handler retries within the same day; avoids UUID double-count.
pub fn server_install_idempotency_key(app_id: &str, version: &str, event: &str) -> String {
    let day = chrono::Utc::now().format("%Y-%m-%d");
    let instance = instance_fingerprint();
    stable_key(&format!("s|{instance}|{app_id}|{version}|{event}|{day}"))
}

fn instance_fingerprint() -> String {
    // Prefer public site identity; fall back to a process-stable salt from JWT if set.
    if let Ok(base) = env::var("BASE_URL") {
        let t = base.trim().trim_end_matches('/');
        if !t.is_empty() {
            return stable_key(t)[..16].to_string();
        }
    }
    if let Ok(front) = env::var("FRONTEND_URL") {
        let t = front.trim().trim_end_matches('/');
        if !t.is_empty() {
            return stable_key(t)[..16].to_string();
        }
    }
    // Last resort: shared default (still better than random UUID per call).
    "default".to_string()
}

fn stable_key(material: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(material.as_bytes());
    let digest = hasher.finalize();
    // 32 hex chars — fits 8–128 idempotency regex
    digest
        .iter()
        .take(16)
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn stats_enabled() -> bool {
    match env::var("TAPP_STORE_STATS_ENABLED") {
        Ok(v) => {
            let t = v.trim().to_ascii_lowercase();
            !(t == "0" || t == "false" || t == "no" || t == "off")
        }
        Err(_) => true,
    }
}

fn stats_base_url() -> Option<String> {
    if !stats_enabled() {
        return None;
    }
    let raw = env::var("TAPP_STORE_STATS_URL")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_STATS_URL.to_string());
    if raw.is_empty() {
        return None;
    }
    Some(raw.trim_end_matches('/').to_string())
}

async fn send_hit(
    app_id: &str,
    version: &str,
    event: &str,
    idempotency_key: Option<&str>,
) -> Result<(), String> {
    let base = match stats_base_url() {
        Some(u) => u,
        None => return Ok(()),
    };

    let key = idempotency_key
        .map(|s| s.trim().to_string())
        .filter(|s| s.len() >= 8 && s.len() <= 128)
        .unwrap_or_else(|| server_install_idempotency_key(app_id, version, event));

    let body = serde_json::json!({
        "app_id": app_id,
        "version": version,
        "event": event,
        "idempotency_key": key,
        "client": "myriad-backend",
        "source": "official",
        "myriad_version": env!("CARGO_PKG_VERSION"),
    });

    let url = format!("{base}/v1/hit");
    let mut req = TAPP_HTTP_CLIENT
        .post(&url)
        .timeout(Duration::from_secs(2))
        .header("content-type", "application/json")
        .header("user-agent", "Myriad-Store-Stats/1.0")
        .json(&body);

    let hmac_secret = env::var("TAPP_STORE_STATS_HMAC")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if let Some(ref secret) = hmac_secret {
        let payload = format!("{app_id}\n{event}\n{key}\n{version}");
        let sig = hmac_sha256_hex(secret.as_bytes(), payload.as_bytes());
        req = req.header("X-Stats-Signature", format!("sha256={sig}"));
    }

    let res = req.send().await.map_err(|e| format!("request: {e}"))?;
    let status = res.status();
    if status.as_u16() == 401 {
        if !HMAC_DESYNC_LOGGED.swap(true, Ordering::Relaxed) {
            tracing::warn!(
                target: "store_stats",
                "store stats edge returned 401 — sync TAPP_STORE_STATS_HMAC with Worker INGEST_HMAC_SECRET"
            );
        }
        let text = res.text().await.unwrap_or_default();
        return Err(format!("HTTP 401 (HMAC desync?): {text}"));
    }
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("HTTP {status}: {text}"));
    }
    Ok(())
}

fn hmac_sha256_hex(secret: &[u8], message: &[u8]) -> String {
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(secret)
        .unwrap_or_else(|_| HmacSha256::new_from_slice(b"_").expect("hmac"));
    mac.update(message);
    let bytes = mac.finalize().into_bytes();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_url_is_custom_domain() {
        assert!(DEFAULT_STATS_URL.contains("stats.store.myriad.you"));
    }

    #[test]
    fn daily_key_is_stable() {
        let a = daily_user_idempotency_key(1, "com.a.b", "1.0.0", "install");
        let b = daily_user_idempotency_key(1, "com.a.b", "1.0.0", "install");
        assert_eq!(a, b);
        assert!(a.len() >= 8 && a.len() <= 128);
    }

    #[test]
    fn server_key_is_stable_within_day() {
        let a = server_install_idempotency_key("com.a.b", "1.0.0", "install");
        let b = server_install_idempotency_key("com.a.b", "1.0.0", "install");
        assert_eq!(a, b);
    }
}
