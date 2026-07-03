//! Myriad maintenance-aware reverse proxy.
//!
//! Behaviour:
//!  - Reads /state/maintenance.json (best-effort; missing/corrupt = inactive).
//!  - When `active=true`, all non-allowlisted requests are served the embedded maintenance page.
//!  - Otherwise, forwards to backend/frontend over plain HTTP via internal docker network DNS.
//!  - `/healthz` (proxy itself) always returns 200.
//!  - `/_updater/*` can forward to the updater service when explicitly enabled for rescue.
//!
//! Fail-open: if the state file disappears, requests are forwarded normally. The proxy
//! is the user's only rescue path, so it MUST NOT trap traffic by accident.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::response::{Html, IntoResponse, Json, Response};
use axum::routing::any;
use axum::Router;
use chrono::{DateTime, Utc};
use http_body_util::BodyExt;
use hyper_util::client::legacy::{connect::HttpConnector, Client};
use hyper_util::rt::TokioExecutor;
use serde::Deserialize;
use serde_json::json;
use tracing::{info, warn};

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
}

const MAINTENANCE_HTML: &str = include_str!("maintenance.html");

#[derive(Debug, Deserialize, Default)]
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
        std::env::var("PROXY_BACKEND_UPSTREAM").unwrap_or_else(|_| "http://backend:3000".into());
    let frontend_upstream =
        std::env::var("PROXY_FRONTEND_UPSTREAM").unwrap_or_else(|_| "http://frontend:4321".into());
    let updater_upstream =
        std::env::var("PROXY_UPDATER_UPSTREAM").unwrap_or_else(|_| "http://updater:9090".into());
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
        "proxy startup: direct /_updater/* {} (backend /api/admin/updater/* is the recommended path)",
        if allow_direct_updater { "ENABLED" } else { "disabled" }
    );

    let state = AppState {
        state_path,
        backend_upstream,
        frontend_upstream,
        updater_upstream,
        allow_direct_updater,
        client,
    };

    let app = Router::new()
        .route("/healthz", axum::routing::get(|| async { "ok" }))
        .route("/_proxy/status", axum::routing::get(proxy_status))
        .fallback(any(handle))
        .with_state(Arc::new(state));

    let listener = tokio::net::TcpListener::bind(listen).await?;
    info!(addr = %listen, "proxy listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}

async fn handle(State(state): State<Arc<AppState>>, req: Request) -> Result<Response, Infallible> {
    let path = req.uri().path().to_string();

    // Health / proxy-status routes handled by axum directly above; this path is the fallback.

    // Updater API direct channel: off by default. The backend at /api/admin/updater/*
    // is the recommended path (admin session + server-held UPDATE_TOKEN). The direct path
    // is kept for rescue scenarios (backend itself down) — operators enable it via
    // PROXY_ALLOW_DIRECT_UPDATER=true. See docs/updater-spec.md §15.
    if let Some(rest) = path.strip_prefix("/_updater/") {
        if !state.allow_direct_updater {
            return Ok((
                StatusCode::NOT_FOUND,
                "direct updater channel disabled; use /api/admin/updater/*",
            )
                .into_response());
        }
        return Ok(
            forward(&state, &state.updater_upstream, &format!("/{rest}"), req)
                .await
                .unwrap_or_else(bad_gateway),
        );
    }

    let maint = read_maintenance(&state.state_path).await;
    if maint.active {
        return Ok(maintenance_response(&maint));
    }

    // Route business traffic.
    let upstream = if path.starts_with("/api/") || path == "/health" {
        &state.backend_upstream
    } else {
        &state.frontend_upstream
    };
    Ok(forward(&state, upstream, &path_with_query(req.uri()), req)
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

async fn forward(
    state: &AppState,
    upstream_base: &str,
    path_q: &str,
    req: Request,
) -> anyhow::Result<Response> {
    let (parts, body) = req.into_parts();
    let url = format!("{}{}", upstream_base, path_q);
    let mut builder = hyper::Request::builder().method(parts.method).uri(&url);
    for (k, v) in parts.headers.iter() {
        // Skip hop-by-hop headers.
        if is_hop_by_hop(k.as_str()) {
            continue;
        }
        builder = builder.header(k, v);
    }
    let upstream_req = builder.body(body)?;
    let resp = state.client.request(upstream_req).await?;
    let (parts, body) = resp.into_parts();
    let body_bytes = body.collect().await?.to_bytes();
    let mut out = Response::builder().status(parts.status);
    for (k, v) in parts.headers.iter() {
        if is_hop_by_hop(k.as_str()) {
            continue;
        }
        out = out.header(k, v);
    }
    Ok(out.body(Body::from(body_bytes))?)
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

async fn read_maintenance(path: &PathBuf) -> MaintenanceFile {
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
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    headers.insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert("Retry-After", HeaderValue::from_static("30"));
    (StatusCode::SERVICE_UNAVAILABLE, headers, Html(body)).into_response()
}

async fn proxy_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let m = read_maintenance(&state.state_path).await;
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

#[allow(dead_code)]
fn _silence_unused() {
    let _ = Method::GET;
}
