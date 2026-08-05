//! Fire-and-forget install/update beacons to the official Tapp store stats edge.
//!
//! Never blocks or fails installation. Dual-path rule:
//! - Backend `source=store` success → this module (`client=myriad-backend` + HMAC).
//! - Browser fallback → FE `POST /api/tapps/store/stats-report` → this module.
//! - Direct/file installs → no beacon.
//!
//! Accuracy: callers should pass a stable `idempotency_key` so retries never double-count.

use crate::services::http_client::TAPP_HTTP_CLIENT;
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};
use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use uuid::Uuid;

const DEFAULT_STATS_URL: &str = "https://stats.store.myriad.you";

static HMAC_DESYNC_LOGGED: AtomicBool = AtomicBool::new(false);

/// Spawn a non-blocking hit. Safe to call after commit/activate.
pub fn spawn_store_stats_hit(app_id: &str, version: &str, event: &str) {
    spawn_store_stats_hit_with_key(app_id, version, event, None);
}

/// Spawn with an explicit idempotency key (preferred for retries / report API).
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

/// Stable key for "one count per user per app version per event per day".
pub fn daily_user_idempotency_key(
    user_id: i32,
    app_id: &str,
    version: &str,
    event: &str,
) -> String {
    let day = chrono::Utc::now().format("%Y-%m-%d");
    let mut hasher = Sha256::new();
    hasher.update(format!("u{user_id}|{app_id}|{version}|{event}|{day}").as_bytes());
    let digest = hasher.finalize();
    format!(
        "u{}-{}",
        user_id,
        digest
            .iter()
            .take(16)
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    )
}

/// Stable key for server-side store install (one per install success path).
pub fn install_session_idempotency_key(app_id: &str, version: &str, event: &str) -> String {
    // Unique per call site success; UUID ensures no accidental merge across installs.
    // Retries of the *same* handler success should not re-call spawn.
    format!("be-{event}-{app_id}-{}-{}", version, Uuid::new_v4())
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
        .unwrap_or_else(|| install_session_idempotency_key(app_id, version, event));

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
                "store stats edge returned 401 — rotate/sync TAPP_STORE_STATS_HMAC with Worker INGEST_HMAC_SECRET (do not log secret values)"
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
    fn daily_key_is_stable_shape() {
        let a = daily_user_idempotency_key(1, "com.a.b", "1.0.0", "install");
        let b = daily_user_idempotency_key(1, "com.a.b", "1.0.0", "install");
        assert_eq!(a, b);
        assert!(a.len() >= 8 && a.len() <= 128);
    }
}
