//! Fire-and-forget install stats to the official edge.
//!
//! Model B (default): **no shared secret required**.
//! Cap: **1 count per Myriad instance / app / event / UTC day**.
//! Browser never talks to edge; only this backend posts hits.
//!
//! Optional: set TAPP_STORE_STATS_HMAC if edge REQUIRE_HMAC=true.

use crate::services::http_client::TAPP_HTTP_CLIENT;
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};
use std::env;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const DEFAULT_STATS_URL: &str = "https://stats.store.myriad.you";

static HMAC_DESYNC_LOGGED: AtomicBool = AtomicBool::new(false);

/// Spawn install/update hit (instance-day cap enforced on edge via instance_hash).
pub fn spawn_store_stats_hit(app_id: &str, version: &str, event: &str) {
    spawn_store_stats_hit_with_key(app_id, version, event, None);
}

pub fn spawn_store_stats_hit_with_key(
    app_id: &str,
    version: &str,
    event: &str,
    _idempotency_key: Option<String>,
) {
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

/// Instance fingerprint for edge instance_hash (8–64 hex).
pub fn instance_hash() -> String {
    let material = instance_material();
    let full = stable_key(&material);
    // 32 hex chars
    full
}

/// One count per instance / app / event / UTC day (local key, edge recomputes too).
pub fn instance_day_idempotency_key(app_id: &str, event: &str) -> String {
    let day = chrono::Utc::now().format("%Y-%m-%d");
    let inst = instance_hash();
    stable_key(&format!("inst|{inst}|{app_id}|{event}|{day}"))
}

fn instance_material() -> String {
    if let Ok(base) = env::var("BASE_URL") {
        let t = base.trim().trim_end_matches('/');
        if !t.is_empty() {
            return t.to_string();
        }
    }
    if let Ok(front) = env::var("FRONTEND_URL") {
        let t = front.trim().trim_end_matches('/');
        if !t.is_empty() {
            return t.to_string();
        }
    }
    // Dev fallback — all local instances without BASE_URL share one bucket.
    "myriad-default-instance".to_string()
}

fn stable_key(material: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(material.as_bytes());
    let digest = hasher.finalize();
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

async fn send_hit(app_id: &str, version: &str, event: &str) -> Result<(), String> {
    let base = match stats_base_url() {
        Some(u) => u,
        None => return Ok(()),
    };

    let inst = instance_hash();
    let key = instance_day_idempotency_key(app_id, event);

    let body = serde_json::json!({
        "app_id": app_id,
        "version": version,
        "event": event,
        "idempotency_key": key,
        "instance_hash": inst,
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

    // Optional signature if operator enabled REQUIRE_HMAC on edge.
    if let Ok(secret) = env::var("TAPP_STORE_STATS_HMAC") {
        let secret = secret.trim();
        if !secret.is_empty() {
            let payload = format!("{app_id}\n{event}\n{key}\n{version}");
            let sig = hmac_sha256_hex(secret.as_bytes(), payload.as_bytes());
            req = req.header("X-Stats-Signature", format!("sha256={sig}"));
        }
    }

    let res = req.send().await.map_err(|e| format!("request: {e}"))?;
    let status = res.status();
    if status.as_u16() == 401 {
        if !HMAC_DESYNC_LOGGED.swap(true, Ordering::Relaxed) {
            tracing::warn!(
                target: "store_stats",
                "store stats 401 — edge may have REQUIRE_HMAC; set TAPP_STORE_STATS_HMAC or disable REQUIRE_HMAC"
            );
        }
        let text = res.text().await.unwrap_or_default();
        return Err(format!("HTTP 401: {text}"));
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
    fn instance_day_key_stable() {
        let a = instance_day_idempotency_key("com.a.b", "install");
        let b = instance_day_idempotency_key("com.a.b", "install");
        assert_eq!(a, b);
        assert!(a.len() >= 8 && a.len() <= 128);
    }

    #[test]
    fn instance_hash_is_hexish() {
        let h = instance_hash();
        assert!(h.len() >= 8);
    }
}
