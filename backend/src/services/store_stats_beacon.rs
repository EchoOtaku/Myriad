//! Fire-and-forget install/update beacons to the official Tapp store stats edge.
//!
//! Never blocks or fails installation. Dual-path rule:
//! - Backend `source=store` success → this module (`client=myriad-backend` + HMAC).
//! - Browser fallback install → FE calls Myriad `POST /api/tapps/store/stats-report`
//!   which uses this module (never hits edge anonymously when ALLOW_ANONYMOUS_HITS=false).
//! - Direct/file installs → no beacon.

use crate::services::http_client::TAPP_HTTP_CLIENT;
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;
use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use uuid::Uuid;

const DEFAULT_STATS_URL: &str = "https://stats.store.myriad.you";

static HMAC_DESYNC_LOGGED: AtomicBool = AtomicBool::new(false);

/// Spawn a non-blocking hit. Safe to call after commit/activate.
pub fn spawn_store_stats_hit(app_id: &str, version: &str, event: &str) {
    let app_id = app_id.to_string();
    let version = version.to_string();
    let event = event.to_string();
    tokio::spawn(async move {
        if let Err(err) = send_hit(&app_id, &version, &event).await {
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

/// Synchronous send for the authenticated FE report endpoint (still short timeout).
pub async fn report_store_stats_hit(
    app_id: &str,
    version: &str,
    event: &str,
) -> Result<(), String> {
    send_hit(app_id, version, event).await
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

async fn send_hit(app_id: &str, version: &str, event: &str) -> Result<(), String> {
    let base = match stats_base_url() {
        Some(u) => u,
        None => return Ok(()),
    };

    let idempotency_key = format!("be-{event}-{app_id}-{}", Uuid::new_v4());

    let body = serde_json::json!({
        "app_id": app_id,
        "version": version,
        "event": event,
        "idempotency_key": idempotency_key,
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
        let payload = format!("{app_id}\n{event}\n{idempotency_key}\n{version}");
        let sig = hmac_sha256_hex(secret.as_bytes(), payload.as_bytes());
        req = req.header("X-Stats-Signature", format!("sha256={sig}"));
    }

    let res = req.send().await.map_err(|e| format!("request: {e}"))?;
    let status = res.status();
    if status.as_u16() == 401 {
        if !HMAC_DESYNC_LOGGED.swap(true, Ordering::Relaxed) {
            tracing::warn!(
                target: "store_stats",
                "store stats edge returned 401 — check TAPP_STORE_STATS_HMAC matches Worker INGEST_HMAC_SECRET"
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
}
