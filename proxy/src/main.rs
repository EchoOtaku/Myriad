//! Myriad maintenance-aware reverse proxy.
//!
//! Behaviour:
//!  - Reads /state/maintenance.json (best-effort; missing/corrupt = inactive).
//!  - When `active=true`, all non-allowlisted requests are served the embedded maintenance page.
//!  - Otherwise, forwards to backend/frontend over plain HTTP via internal docker network DNS.
//!  - Response bodies are **streamed** (no full-buffer collect) to keep memory/TTFB low.
//!  - `/healthz` (proxy itself) always returns 200.
//!  - `/_updater/*` can forward to the updater service when explicitly enabled for rescue.
//!
//! Fail-open: if the state file disappears, requests are forwarded normally. The proxy
//! is the user's only rescue path, so it MUST NOT trap traffic by accident.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode, Uri};
use axum::response::{Html, IntoResponse, Json, Response};
use axum::routing::any;
use axum::Router;
use chrono::{DateTime, Utc};
use hyper_util::client::legacy::{connect::HttpConnector, Client};
use hyper_util::rt::TokioExecutor;
use serde::Deserialize;
use serde_json::json;
use tokio::sync::RwLock;
use tracing::{info, warn};

/// How long a successful maintenance.json read stays cached. Short enough that
/// updater phase transitions appear promptly; long enough to avoid a disk read
/// on every static-asset request.
const MAINT_CACHE_TTL: Duration = Duration::from_millis(250);

#[derive(Clone)]
struct AppState {
    state_path: PathBuf,
    backend_upstream: String,
    frontend_upstream: String,
    updater_upstream: String,
    /// When false, `/_updater/*` returns 404. The intended path is through the backend
    /// (`/api/admin/updater/*`) which uses admin session auth + holds UPDATE_TOKEN.
    /// Set `PROXY_ALLOW_DIRECT_UPDATER=true` to open the direct channel for rescue scenarios.
    allow_direct_updater: bool,
    client: Client<HttpConnector, Body>,
    maint_cache: Arc<RwLock<MaintCache>>,
}

#[derive(Default)]
struct MaintCache {
    loaded_at: Option<Instant>,
    value: MaintenanceFile,
}

const MAINTENANCE_HTML: &str = include_str!("maintenance.html");

#[derive(Debug, Clone, Deserialize, Default)]
struct MaintenanceFile {
    #[serde(default)]
    active: bool,
    #[serde(default)]
    phase: Option<String>,
    #[serde(default)]
    from_version: Option<String>,
    #[serde(default)]
    to_version: Option<String>,
    // `started_at` is part of the on-disk schema but not surfaced in maintenance HTML.
    // Keep it so deserialization stays forward-compatible.
    #[serde(default)]
    #[allow(dead_code)]
    started_at: Option<DateTime<Utc>>,
    #[serde(default)]
    updated_at: Option<DateTime<Utc>>,
    #[serde(default)]
    message_key: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let state_path = std::env::var("PROXY_STATE_FILE")
        .unwrap_or_else(|_| "/state/maintenance.json".into())
        .into();
    let backend_upstream =
        std::env::var("PROXY_BACKEND_UPSTREAM").unwrap_or_else(|_| "http://backend:1103".into());
    let frontend_upstream =
        std::env::var("PROXY_FRONTEND_UPSTREAM").unwrap_or_else(|_| "http://frontend:1102".into());
    let updater_upstream =
        std::env::var("PROXY_UPDATER_UPSTREAM").unwrap_or_else(|_| "http://updater:1101".into());
    let allow_direct_updater = std::env::var("PROXY_ALLOW_DIRECT_UPDATER")
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(false);
    let listen: SocketAddr = std::env::var("PROXY_LISTEN")
        .unwrap_or_else(|_| "0.0.0.0:80".into())
        .parse()?;

    let client = Client::builder(TokioExecutor::new())
        .pool_idle_timeout(Duration::from_secs(30))
        .build_http();

    info!(
        allow_direct_updater,
        "proxy startup: streaming forward; direct /_updater/* {}",
        if allow_direct_updater {
            "ENABLED"
        } else {
            "disabled"
        }
    );

    let state = AppState {
        state_path,
        backend_upstream,
        frontend_upstream,
        updater_upstream,
        allow_direct_updater,
        client,
        maint_cache: Arc::new(RwLock::new(MaintCache::default())),
    };

    let app = Router::new()
        .route("/healthz", axum::routing::get(|| async { "ok" }))
        .route("/_proxy/status", axum::routing::get(proxy_status))
        .fallback(any(handle))
        .with_state(Arc::new(state));

    let listener = tokio::net::TcpListener::bind(listen).await?;
    info!(addr = %listen, "proxy listening");
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await?;
    Ok(())
}

async fn handle(
    State(state): State<Arc<AppState>>,
    ConnectInfo(client_addr): ConnectInfo<SocketAddr>,
    req: Request,
) -> Result<Response, Infallible> {
    let path = req.uri().path().to_string();

    // Updater API direct channel: off by default. The backend at /api/admin/updater/*
    // is the recommended path (admin session + server-held UPDATE_TOKEN). The direct path
    // is kept for rescue scenarios (backend itself down) — operators enable it via
    // PROXY_ALLOW_DIRECT_UPDATER=true. See docs/updater-spec.md §15.
    if path.starts_with("/_updater/") {
        if !state.allow_direct_updater {
            return Ok((
                StatusCode::NOT_FOUND,
                "direct updater channel disabled; use /api/admin/updater/*",
            )
                .into_response());
        }
        let upstream_path = updater_path_with_query(req.uri());
        return Ok(forward(
            &state,
            &state.updater_upstream,
            &upstream_path,
            req,
            client_addr,
        )
        .await
        .unwrap_or_else(bad_gateway));
    }

    let maint = read_maintenance_cached(&state).await;
    if maint.active {
        return Ok(maintenance_response(&maint));
    }

    // Route business traffic.
    let upstream = if path.starts_with("/api/") || path == "/health" {
        &state.backend_upstream
    } else {
        &state.frontend_upstream
    };
    Ok(forward(
        &state,
        upstream,
        &path_with_query(req.uri()),
        req,
        client_addr,
    )
    .await
    .unwrap_or_else(bad_gateway))
}

fn bad_gateway(err: anyhow::Error) -> Response {
    warn!(error = %err, "upstream proxy error");
    (StatusCode::BAD_GATEWAY, format!("bad gateway: {err}")).into_response()
}

fn path_with_query(uri: &Uri) -> String {
    match uri.path_and_query() {
        Some(pq) => pq.to_string(),
        None => uri.path().to_string(),
    }
}

fn updater_path_with_query(uri: &Uri) -> String {
    let full = path_with_query(uri);
    match full.strip_prefix("/_updater/") {
        Some(rest) => format!("/{rest}"),
        None => full,
    }
}

async fn forward(
    state: &AppState,
    upstream_base: &str,
    path_q: &str,
    req: Request,
    client_addr: SocketAddr,
) -> anyhow::Result<Response> {
    let (parts, body) = req.into_parts();
    let url = format!("{}{}", upstream_base, path_q);
    let mut builder = hyper::Request::builder().method(parts.method).uri(&url);
    for (k, v) in parts.headers.iter() {
        // Skip hop-by-hop headers.
        if is_hop_by_hop(k.as_str()) || is_proxy_managed_forwarded_header(k.as_str()) {
            continue;
        }
        builder = builder.header(k, v);
    }
    let client_ip = client_addr.ip().to_string();
    builder = builder
        .header("x-forwarded-for", forwarded_for(&parts.headers, &client_ip))
        .header("x-real-ip", client_ip)
        .header(
            "x-forwarded-proto",
            forwarded_proto(&parts.headers).unwrap_or_else(|| HeaderValue::from_static("http")),
        );
    if let Some(host) = forwarded_host(&parts.headers) {
        builder = builder.header("x-forwarded-host", host);
    }
    let upstream_req = builder.body(body)?;
    let resp = state.client.request(upstream_req).await?;
    let (parts, body) = resp.into_parts();
    // Stream the upstream body through — do not buffer into memory.
    let mut out = Response::builder().status(parts.status);
    for (k, v) in parts.headers.iter() {
        if is_hop_by_hop(k.as_str()) {
            continue;
        }
        out = out.header(k, v);
    }
    Ok(out.body(Body::new(body))?)
}

fn is_hop_by_hop(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailers"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn is_proxy_managed_forwarded_header(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "x-forwarded-for" | "x-real-ip" | "x-forwarded-host" | "x-forwarded-proto"
    )
}

fn forwarded_for(headers: &HeaderMap, client_ip: &str) -> String {
    let _ = headers;
    // This proxy is the trust boundary. Never preserve a client-supplied XFF
    // chain; the backend should receive only the peer address we observed.
    client_ip.to_string()
}

fn forwarded_proto(headers: &HeaderMap) -> Option<HeaderValue> {
    headers.get("x-forwarded-proto").cloned()
}

fn forwarded_host(headers: &HeaderMap) -> Option<HeaderValue> {
    headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .cloned()
}

async fn read_maintenance_cached(state: &AppState) -> MaintenanceFile {
    {
        let cache = state.maint_cache.read().await;
        if let Some(loaded_at) = cache.loaded_at {
            if loaded_at.elapsed() < MAINT_CACHE_TTL {
                return cache.value.clone();
            }
        }
    }

    let value = read_maintenance_from_disk(&state.state_path).await;
    let mut cache = state.maint_cache.write().await;
    // Another task may have refreshed while we waited for the write lock; still fine to overwrite.
    cache.loaded_at = Some(Instant::now());
    cache.value = value.clone();
    value
}

async fn read_maintenance_from_disk(path: &PathBuf) -> MaintenanceFile {
    match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => MaintenanceFile::default(),
    }
}

fn maintenance_response(m: &MaintenanceFile) -> Response {
    let now = Utc::now();
    let stale = m
        .updated_at
        .map(|t| now.signed_duration_since(t).num_seconds() > 600)
        .unwrap_or(false);
    let very_stale = m
        .updated_at
        .map(|t| now.signed_duration_since(t).num_seconds() > 1800)
        .unwrap_or(false);
    let body = MAINTENANCE_HTML
        .replace("{{PHASE}}", m.phase.as_deref().unwrap_or("unknown"))
        .replace(
            "{{MESSAGE_KEY}}",
            m.message_key.as_deref().unwrap_or("updater.phase.unknown"),
        )
        .replace("{{FROM}}", m.from_version.as_deref().unwrap_or("-"))
        .replace("{{TO}}", m.to_version.as_deref().unwrap_or("-"))
        .replace(
            "{{UPDATED_AT}}",
            &m.updated_at.map(|t| t.to_rfc3339()).unwrap_or_default(),
        )
        .replace(
            "{{STALE_CLASS}}",
            if very_stale {
                "very-stale"
            } else if stale {
                "stale"
            } else {
                ""
            },
        );
    let mut headers = HeaderMap::new();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert("Retry-After", HeaderValue::from_static("30"));
    (StatusCode::SERVICE_UNAVAILABLE, headers, Html(body)).into_response()
}

async fn proxy_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let m = read_maintenance_cached(&state).await;
    Json(json!({
        "schema_version": 1,
        "maintenance": {
            "active": m.active,
            "phase": m.phase,
            "from": m.from_version,
            "to": m.to_version,
            "updated_at": m.updated_at,
            "message_key": m.message_key,
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_with_query_preserves_query() {
        let uri: Uri = "/api/setup/status?mode=config".parse().unwrap();

        assert_eq!(path_with_query(&uri), "/api/setup/status?mode=config");
    }

    #[test]
    fn updater_path_with_query_strips_prefix_and_preserves_query() {
        let uri: Uri = "/_updater/status?detail=1".parse().unwrap();

        assert_eq!(updater_path_with_query(&uri), "/status?detail=1");
    }

    #[test]
    fn updater_path_with_query_handles_nested_paths() {
        let uri: Uri = "/_updater/rescue/exit-maintenance?force=true"
            .parse()
            .unwrap();

        assert_eq!(
            updater_path_with_query(&uri),
            "/rescue/exit-maintenance?force=true"
        );
    }

    #[test]
    fn forwarded_for_sets_client_ip_when_missing() {
        let headers = HeaderMap::new();

        assert_eq!(forwarded_for(&headers, "192.0.2.10"), "192.0.2.10");
    }

    #[test]
    fn forwarded_for_replaces_client_supplied_chain() {
        let mut headers = HeaderMap::new();
        headers.insert("x-forwarded-for", HeaderValue::from_static("203.0.113.9"));

        assert_eq!(forwarded_for(&headers, "192.0.2.10"), "192.0.2.10");
    }

    #[test]
    fn forwarded_host_falls_back_to_host() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::HOST,
            HeaderValue::from_static("example.myriad.local"),
        );

        assert_eq!(
            forwarded_host(&headers).unwrap(),
            HeaderValue::from_static("example.myriad.local")
        );
    }
}
