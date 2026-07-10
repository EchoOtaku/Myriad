//! Token authentication + simple in-process rate limiting for failed attempts.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use once_cell::sync::Lazy;

use crate::api::ApiState;

const MAX_FAILED_PER_MIN: u32 = 5;
const BLOCK_DURATION: Duration = Duration::from_secs(600);

#[derive(Default)]
struct Limiter {
    /// Source key (here just "global" — token-auth is single-tenant) → (failure timestamps, blocked_until)
    counters: HashMap<String, (Vec<Instant>, Option<Instant>)>,
}

static LIMITER: Lazy<Mutex<Limiter>> = Lazy::new(|| Mutex::new(Limiter::default()));

pub fn record_failure(key: &str) -> bool {
    let mut l = LIMITER.lock().unwrap();
    let entry = l.counters.entry(key.to_string()).or_default();
    let now = Instant::now();
    entry
        .0
        .retain(|t| now.duration_since(*t) < Duration::from_secs(60));
    entry.0.push(now);
    if entry.0.len() as u32 > MAX_FAILED_PER_MIN {
        entry.1 = Some(now + BLOCK_DURATION);
        true
    } else {
        false
    }
}

pub fn is_blocked(key: &str) -> bool {
    let mut l = LIMITER.lock().unwrap();
    let now = Instant::now();
    if let Some(entry) = l.counters.get_mut(key) {
        if let Some(until) = entry.1 {
            if now < until {
                return true;
            }
            entry.1 = None;
            entry.0.clear();
        }
    }
    false
}

pub fn extract_token(headers: &HeaderMap) -> Option<String> {
    let h = headers.get("X-Update-Token")?.to_str().ok()?;
    Some(h.trim().to_string())
}

pub async fn token_required(
    State(state): State<ApiState>,
    req: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let key = "global";
    if is_blocked(key) {
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }
    let provided = match extract_token(req.headers()) {
        Some(t) => t,
        None => {
            record_failure(key);
            return Err(StatusCode::UNAUTHORIZED);
        }
    };
    if !constant_time_eq(
        provided.as_bytes(),
        state.config.update_token.expose().as_bytes(),
    ) {
        record_failure(key);
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(next.run(req).await)
}

pub async fn token_and_manual_required(
    State(state): State<ApiState>,
    req: Request,
    next: Next,
) -> Result<Response, Response> {
    if !state.state.manual_override_enabled() {
        // Explicit body so UIs don't confuse this with CSRF / admin 403.
        return Err((
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({
                "error": "manual override required",
                "message": "touch state/manual-override on the host (dev: .dev-updater/state/manual-override) before calling rescue endpoints"
            })),
        )
            .into_response());
    }
    token_required(State(state), req, next)
        .await
        .map_err(|status| status.into_response())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
