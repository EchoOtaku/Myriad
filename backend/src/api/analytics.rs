//! First-party site analytics (pageviews, engagement, custom events).
//!
//! - POST `/api/analytics/collect`  — batched, preferred (pageview / engagement / event)
//! - POST `/api/analytics/pageview` — legacy single pageview (still supported)
//! - GET  `/api/analytics/visitor`  — public visitor card (own ordinal + site totals)
//! - GET  `/api/analytics/summary`  — admin only
//! - GET  `/api/analytics/export`   — admin: full JSON backup
//! - POST `/api/analytics/import`   — admin: restore / merge backup
//!
//! Privacy: no raw IP/UA stored; visitor = hash(salt|vid) or hash(salt|ip|ua).
//! Proxy: client IP via `extract_client_ip` + `TRUST_PROXY_HEADERS`.

use axum::{
    extract::{ConnectInfo, Query, Request},
    http::{header, StatusCode},
    Json,
};
use chrono::{Duration, Local, NaiveDate, Utc};
use sea_orm::{
    ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement, TransactionTrait,
    Value as SeaValue,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration as StdDuration, Instant};
use tokio::sync::Mutex;

const SITE_PATH: &str = "__site__";
const MAX_PATH_LEN: usize = 128;
const MAX_EVENT_NAME_LEN: usize = 48;
const MAX_BATCH_ITEMS: usize = 20;
const MAX_ENGAGEMENT_MS: i64 = 30 * 60 * 1000; // 30 min cap per flush
const MIN_ENGAGEMENT_MS: i64 = 800; // align with client MIN_ENGAGEMENT_MS
const DEFAULT_SUMMARY_DAYS: i64 = 7;
const MAX_SUMMARY_DAYS: i64 = 90;
const VISITOR_RETENTION_DAYS: i64 = 90;
const DAILY_RETENTION_DAYS: i64 = 365;
/// Collect posts per client IP per minute (anti-spam; still above normal SPA use).
const RATE_LIMIT_PER_MINUTE: u32 = 36;
const VIEW_DEDUPE_WINDOW: StdDuration = StdDuration::from_secs(3);
const DEFAULT_ANALYTICS_SALT: &str = "myriad-analytics-v1";
const ANALYTICS_BACKUP_FORMAT: &str = "myriad-analytics-backup";
const ANALYTICS_BACKUP_VERSION: u32 = 1;
const MAX_IMPORT_PAGE_DAILY: usize = 50_000;
const MAX_IMPORT_VISITOR_SEEN: usize = 200_000;
const MAX_IMPORT_EVENT_DAILY: usize = 50_000;
const MAX_IMPORT_EVENT_VISITOR: usize = 200_000;
const MAX_IMPORT_REFERRER_DAILY: usize = 20_000;
const MAX_IMPORT_COUNTRY_DAILY: usize = 50_000;
const MAX_IMPORT_COUNTRY_VISITOR: usize = 200_000;
/// ISO / CDN header codes we treat as "unknown" (do not store as a country).
const UNKNOWN_COUNTRY_CODES: &[&str] = &["XX", "T1", "A1", "A2", "O1", ""];
const COUNTRY_CACHE_TTL: StdDuration = StdDuration::from_secs(6 * 60 * 60);
const COUNTRY_LOOKUP_TIMEOUT: StdDuration = StdDuration::from_millis(900);
const MAX_COUNTRY_CACHE: usize = 4096;

static RATE_LIMIT: once_cell::sync::Lazy<Arc<Mutex<HashMap<String, (Instant, u32)>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));
static VIEW_DEDUPE: once_cell::sync::Lazy<Arc<Mutex<HashMap<String, Instant>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));
/// Admin summary cache: days → (stored_at, body). Invalidated on write.
static SUMMARY_CACHE: once_cell::sync::Lazy<Arc<Mutex<HashMap<i64, (Instant, Value)>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));
const SUMMARY_CACHE_TTL: StdDuration = StdDuration::from_secs(45);
/// Public visitor-card aggregate (today / all-time / trend). The per-visitor
/// ordinal is **never** cached here — it is looked up per request.
static VISITOR_CARD_CACHE: once_cell::sync::Lazy<Arc<Mutex<Option<(Instant, Value)>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(None)));
/// IP → country (code, name) cache for analytics intake.
static COUNTRY_CACHE: once_cell::sync::Lazy<
    Arc<Mutex<HashMap<String, (Instant, CountryInfo)>>>,
> = once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(HashMap::new())));

#[derive(Debug, Clone)]
struct CountryInfo {
    code: String,
    name: String,
}

async fn invalidate_summary_cache() {
    *VISITOR_CARD_CACHE.lock().await = None;
    SUMMARY_CACHE.lock().await.clear();
}

// ── Request types ──────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct PageviewRequest {
    pub path: String,
    #[serde(default)]
    pub vid: Option<String>,
    #[serde(default)]
    pub referrer: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CollectRequest {
    #[serde(default)]
    pub vid: Option<String>,
    #[serde(default)]
    pub items: Vec<CollectItem>,
}

#[derive(Debug, Deserialize)]
pub struct CollectItem {
    /// `pageview` | `engagement` | `event`
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub referrer: Option<String>,
    /// Engagement duration in ms (capped server-side).
    #[serde(default)]
    pub ms: Option<i64>,
    /// Custom event name (allowlisted shape).
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SummaryQuery {
    pub days: Option<i64>,
}

// ── Helpers ────────────────────────────────────────────────────────────────

fn analytics_salt() -> String {
    static WARNED: std::sync::Once = std::sync::Once::new();
    match std::env::var("ANALYTICS_SALT")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        Some(s) => s,
        None => {
            WARNED.call_once(|| {
                tracing::warn!(
                    "ANALYTICS_SALT is unset; using built-in default. \
                     Set a random salt in production so visitor hashes are instance-unique."
                );
            });
            DEFAULT_ANALYTICS_SALT.to_string()
        }
    }
}

/// Calendar day for bucketing = **server process local date**.
///
/// No product-default offset (not +8 / +9 / hard-coded region). Whatever the
/// host or container clock reports via `chrono::Local` is used — typically
/// driven by the process `TZ` env if set, otherwise the OS default.
/// Operators should keep the server clock correct (`timedatectl` / container `TZ`).
fn analytics_today() -> NaiveDate {
    Local::now().date_naive()
}

/// Display label for the process local zone (env `TZ` name, or numeric UTC offset).
fn analytics_tz_label() -> String {
    std::env::var("TZ")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            let secs = Local::now().offset().local_minus_utc();
            let hours = secs / 3600;
            if hours == 0 {
                "local".to_string()
            } else {
                format!("UTC{hours:+}")
            }
        })
}

pub fn normalize_path(raw: &str) -> Option<String> {
    let mut path = raw.trim();
    if path.is_empty() {
        return None;
    }
    if let Some(idx) = path.find("://") {
        let rest = &path[idx + 3..];
        path = rest.find('/').map(|i| &rest[i..]).unwrap_or("/");
    }
    if let Some((p, _)) = path.split_once('?') {
        path = p;
    }
    if let Some((p, _)) = path.split_once('#') {
        path = p;
    }
    let path = path.trim();
    if !path.starts_with('/') {
        return None;
    }

    let collapsed: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if collapsed.is_empty() {
        return Some("/".to_string());
    }

    let mapped: Vec<String> = match collapsed[0].to_ascii_lowercase().as_str() {
        "library" => vec!["library".into()],
        "brew" => vec!["brew".into()],
        "reports" => vec!["reports".into()],
        "config" => vec!["config".into()],
        "login" => vec!["login".into()],
        "register" => vec!["register".into()],
        "setup" => vec!["setup".into()],
        "tapps" => {
            if collapsed.len() >= 2 {
                vec!["tapps".into(), ":id".into()]
            } else {
                vec!["tapps".into()]
            }
        }
        "tapp" => {
            if collapsed.len() >= 2 {
                vec!["tapp".into(), ":id".into()]
            } else {
                vec!["tapp".into()]
            }
        }
        other => {
            if other
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                && other.len() <= 48
            {
                vec![other.to_string()]
            } else {
                vec!["other".into()]
            }
        }
    };

    let mut out = format!("/{}", mapped.join("/"));
    if out.len() > MAX_PATH_LEN {
        out.truncate(MAX_PATH_LEN);
    }
    if !out
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '/' || c == '-' || c == '_' || c == ':')
    {
        return Some("/other".to_string());
    }
    Some(out)
}

pub fn is_valid_vid(raw: &str) -> bool {
    let s = raw.trim();
    let len = s.len();
    (16..=64).contains(&len)
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn sha16(material: &str) -> String {
    let digest = Sha256::digest(material.as_bytes());
    hex::encode(&digest[..16])
}

pub fn resolve_visitor_hash(
    vid: Option<&str>,
    ip: Option<std::net::IpAddr>,
    user_agent: &str,
) -> String {
    let salt = analytics_salt();
    if let Some(v) = vid.map(str::trim).filter(|s| is_valid_vid(s)) {
        return sha16(&format!("{salt}|vid1|{v}"));
    }
    let ip_s = ip
        .map(|i| i.to_string())
        .unwrap_or_else(|| "unknown".into());
    let ua: String = user_agent
        .chars()
        .take(180)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    sha16(&format!("{salt}|fp1|{ip_s}|{ua}"))
}

fn is_bot_ua(ua: &str) -> bool {
    let u = ua.to_ascii_lowercase();
    if u.is_empty() {
        return true;
    }
    const NEEDLES: &[&str] = &[
        "bot",
        "spider",
        "crawler",
        "slurp",
        "bingpreview",
        "facebookexternalhit",
        "embedly",
        "headless",
        "phantomjs",
        "selenium",
        "puppeteer",
        "playwright",
        "curl/",
        "wget/",
        "python-requests",
        "go-http-client",
        "scrapy",
        "ahrefs",
        "semrush",
        "yandex",
        "baiduspider",
        "applebot",
        "petalbot",
        "bytespider",
        "gptbot",
        "chatgpt",
        "claudebot",
        "anthropic",
        "ccbot",
    ];
    NEEDLES.iter().any(|n| u.contains(n))
}

/// Event names: lowercase snake / kebab, 2–48 chars, no free-form spam.
/// Reserved: names starting with `__` (internal markers).
pub fn normalize_event_name(raw: &str) -> Option<String> {
    let s = raw.trim().to_ascii_lowercase();
    if s.len() < 2 || s.len() > MAX_EVENT_NAME_LEN {
        return None;
    }
    if s.starts_with("__") {
        return None;
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return None;
    }
    if s.starts_with('-') || s.starts_with('_') {
        return None;
    }
    Some(s)
}

fn normalize_country_code(raw: &str) -> Option<String> {
    let s = raw.trim().to_ascii_uppercase();
    if s.len() != 2 || !s.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    if UNKNOWN_COUNTRY_CODES.iter().any(|u| *u == s) {
        return None;
    }
    Some(s)
}

fn normalize_country_name(raw: &str) -> String {
    raw.chars()
        .take(64)
        .collect::<String>()
        .trim()
        .to_string()
}

fn is_private_or_local_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_unspecified()
        }
        std::net::IpAddr::V6(v6) => {
            v6.is_loopback() || v6.is_unique_local() || v6.is_unicast_link_local() || v6.is_unspecified()
        }
    }
}

/// Prefer edge CDN country headers (no network); codes are ISO 3166-1 alpha-2.
fn country_from_headers(headers: &axum::http::HeaderMap) -> Option<CountryInfo> {
    const KEYS: &[&str] = &[
        "cf-ipcountry",
        "cloudfront-viewer-country",
        "x-vercel-ip-country",
        "x-country-code",
        "x-appengine-country",
    ];
    for key in KEYS {
        if let Some(v) = headers.get(*key).and_then(|h| h.to_str().ok()) {
            if let Some(code) = normalize_country_code(v) {
                return Some(CountryInfo {
                    code: code.clone(),
                    name: code,
                });
            }
        }
    }
    None
}

async fn country_cache_get(ip_key: &str) -> Option<CountryInfo> {
    let mut map = COUNTRY_CACHE.lock().await;
    if let Some((at, info)) = map.get(ip_key) {
        if at.elapsed() < COUNTRY_CACHE_TTL {
            return Some(info.clone());
        }
        map.remove(ip_key);
    }
    None
}

async fn country_cache_put(ip_key: &str, info: CountryInfo) {
    let mut map = COUNTRY_CACHE.lock().await;
    if map.len() >= MAX_COUNTRY_CACHE {
        map.retain(|_, (at, _)| at.elapsed() < COUNTRY_CACHE_TTL);
        while map.len() >= MAX_COUNTRY_CACHE {
            let Some(oldest) = map
                .iter()
                .min_by_key(|(_, (at, _))| *at)
                .map(|(k, _)| k.clone())
            else {
                break;
            };
            map.remove(&oldest);
        }
    }
    map.insert(ip_key.to_string(), (Instant::now(), info));
}

/// Resolve visitor country: CDN header → cache → short-timeout IP lookup.
async fn resolve_country(
    ip: Option<std::net::IpAddr>,
    header_country: Option<CountryInfo>,
) -> Option<CountryInfo> {
    if let Some(c) = header_country {
        if let Some(ip) = ip {
            country_cache_put(&ip.to_string(), c.clone()).await;
        }
        return Some(c);
    }
    let ip = ip?;
    if is_private_or_local_ip(ip) {
        return None;
    }
    let ip_key = ip.to_string();
    if let Some(c) = country_cache_get(&ip_key).await {
        return Some(c);
    }

    // Free tier ip-api.com — short timeout so collect never hangs.
    let url = format!(
        "http://ip-api.com/json/{}?fields=status,country,countryCode",
        ip_key
    );
    let client = crate::services::http_client::get_global_client().await;
    let lookup = async {
        let resp = client.get(&url).send().await.ok()?;
        let data: Value = resp.json().await.ok()?;
        if data.get("status").and_then(|s| s.as_str()) != Some("success") {
            return None;
        }
        let code = data
            .get("countryCode")
            .and_then(|v| v.as_str())
            .and_then(normalize_country_code)?;
        let name = data
            .get("country")
            .and_then(|v| v.as_str())
            .map(normalize_country_name)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| code.clone());
        Some(CountryInfo { code, name })
    };

    match tokio::time::timeout(COUNTRY_LOOKUP_TIMEOUT, lookup).await {
        Ok(Some(info)) => {
            country_cache_put(&ip_key, info.clone()).await;
            Some(info)
        }
        _ => None,
    }
}

fn normalize_referrer_host(raw: &str) -> Option<String> {
    let s = raw.trim().to_ascii_lowercase();
    if s.is_empty() || s.len() > 128 {
        return None;
    }
    // Host-like only
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == ':')
    {
        return None;
    }
    // Strip port for aggregation
    let host = s.split(':').next().unwrap_or(&s);
    if host.is_empty() || host == "localhost" || host.ends_with(".local") {
        return None;
    }
    Some(host.to_string())
}

async fn rate_limited(ip_key: &str) -> bool {
    let mut map = RATE_LIMIT.lock().await;
    let now = Instant::now();
    if map.len() > 8000 {
        map.retain(|_, (t, _)| now.duration_since(*t) < StdDuration::from_secs(120));
    }
    let entry = map.entry(ip_key.to_string()).or_insert((now, 0));
    if now.duration_since(entry.0) >= StdDuration::from_secs(60) {
        *entry = (now, 1);
        return false;
    }
    entry.1 += 1;
    entry.1 > RATE_LIMIT_PER_MINUTE
}

async fn is_duplicate_view(visitor: &str, path: &str) -> bool {
    let key = format!("{visitor}|{path}");
    let mut map = VIEW_DEDUPE.lock().await;
    let now = Instant::now();
    if map.len() > 20000 {
        map.retain(|_, t| now.duration_since(*t) < VIEW_DEDUPE_WINDOW * 2);
    }
    if let Some(prev) = map.get(&key) {
        if now.duration_since(*prev) < VIEW_DEDUPE_WINDOW {
            return true;
        }
    }
    map.insert(key, now);
    false
}

// ── DB writes ──────────────────────────────────────────────────────────────

async fn mark_visitor_seen(
    db: &DatabaseConnection,
    day: NaiveDate,
    path: &str,
    visitor: &str,
) -> Result<bool, sea_orm::DbErr> {
    let insert = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
INSERT INTO analytics_visitor_seen (day, path, visitor_hash)
VALUES ($1, $2, $3)
ON CONFLICT (day, path, visitor_hash) DO NOTHING
"#,
            [
                SeaValue::from(day),
                SeaValue::from(path.to_string()),
                SeaValue::from(visitor.to_string()),
            ],
        ))
        .await?;
    Ok(insert.rows_affected() > 0)
}

async fn bump_pageview(
    db: &DatabaseConnection,
    day: NaiveDate,
    path: &str,
    visitor: &str,
    count_view: bool,
) -> Result<(), sea_orm::DbErr> {
    let is_new = mark_visitor_seen(db, day, path, visitor).await?;
    let unique_inc: i64 = if is_new { 1 } else { 0 };
    let view_inc: i64 = if count_view { 1 } else { 0 };
    if view_inc == 0 && unique_inc == 0 {
        return Ok(());
    }
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
INSERT INTO analytics_page_daily (day, path, views, unique_visitors, engagement_ms, engaged_views)
VALUES ($1, $2, $3, $4, 0, 0)
ON CONFLICT (day, path) DO UPDATE SET
  views = analytics_page_daily.views + EXCLUDED.views,
  unique_visitors = analytics_page_daily.unique_visitors + EXCLUDED.unique_visitors
"#,
        [
            SeaValue::from(day),
            SeaValue::from(path.to_string()),
            SeaValue::from(view_inc),
            SeaValue::from(unique_inc),
        ],
    ))
    .await?;
    Ok(())
}

/// Stored arrival ordinal for a visitor on `day` ("you are today's Nth visitor").
///
/// `0` means unknown — rows written before the column existed, or non-site paths
/// which never get an ordinal. Callers treat unknown as "no number to show"
/// rather than "visitor #0".
async fn read_visitor_ordinal(
    db: &DatabaseConnection,
    day: NaiveDate,
    visitor: &str,
) -> Result<Option<i64>, sea_orm::DbErr> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT ordinal FROM analytics_visitor_seen
WHERE day = $1 AND path = $2 AND visitor_hash = $3
"#,
            [
                SeaValue::from(day),
                SeaValue::from(SITE_PATH.to_string()),
                SeaValue::from(visitor.to_string()),
            ],
        ))
        .await?;
    Ok(row
        .and_then(|r| r.try_get::<i64>("", "ordinal").ok())
        .filter(|n| *n > 0))
}

/// Counts the visitor as a site-unique for `day` and returns their arrival
/// ordinal, or `None` when it cannot be determined.
///
/// The ordinal has to be **persisted**, not derived: the number a visitor is
/// shown must not move for the rest of the day, and any rank computed from the
/// hash set drifts upward as later visitors arrive. So the post-increment
/// `unique_visitors` value — which *is* the arrival position — is captured with
/// `RETURNING` and written onto the visitor's row. `RETURNING` on the single
/// counter row is atomic per statement, so concurrent first-visits can never
/// come away holding the same number.
async fn record_site_unique(
    db: &DatabaseConnection,
    day: NaiveDate,
    visitor: &str,
) -> Result<Option<i64>, sea_orm::DbErr> {
    let is_new = mark_visitor_seen(db, day, SITE_PATH, visitor).await?;
    if !is_new {
        return read_visitor_ordinal(db, day, visitor).await;
    }
    let ordinal = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
INSERT INTO analytics_page_daily (day, path, views, unique_visitors, engagement_ms, engaged_views)
VALUES ($1, $2, 0, 1, 0, 0)
ON CONFLICT (day, path) DO UPDATE SET
  unique_visitors = analytics_page_daily.unique_visitors + 1
RETURNING unique_visitors
"#,
            [
                SeaValue::from(day),
                SeaValue::from(SITE_PATH.to_string()),
            ],
        ))
        .await?
        .and_then(|r| r.try_get::<i64>("", "unique_visitors").ok())
        .filter(|n| *n > 0);

    if let Some(n) = ordinal {
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
UPDATE analytics_visitor_seen SET ordinal = $4
WHERE day = $1 AND path = $2 AND visitor_hash = $3
"#,
            [
                SeaValue::from(day),
                SeaValue::from(SITE_PATH.to_string()),
                SeaValue::from(visitor.to_string()),
                SeaValue::from(n),
            ],
        ))
        .await?;
    }
    Ok(ordinal)
}

/// Internal event name: marks "this visitor already contributed engaged_views
/// for path today". Not shown in public event list.
const ENGAGE_MARKER: &str = "__engage__";

async fn bump_engagement(
    db: &DatabaseConnection,
    day: NaiveDate,
    path: &str,
    visitor: &str,
    ms: i64,
) -> Result<(), sea_orm::DbErr> {
    let ms = ms.clamp(0, MAX_ENGAGEMENT_MS);
    if ms < MIN_ENGAGEMENT_MS {
        return Ok(());
    }
    // First engagement report for (day, path, visitor) → +1 engaged_views.
    // Later soft-flushes only add ms (otherwise avg time and bounce break).
    let insert = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
INSERT INTO analytics_event_visitor (day, event_name, path, visitor_hash)
VALUES ($1, $2, $3, $4)
ON CONFLICT (day, event_name, path, visitor_hash) DO NOTHING
"#,
            [
                SeaValue::from(day),
                SeaValue::from(ENGAGE_MARKER.to_string()),
                SeaValue::from(path.to_string()),
                SeaValue::from(visitor.to_string()),
            ],
        ))
        .await?;
    let engaged_inc: i64 = if insert.rows_affected() > 0 { 1 } else { 0 };

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
INSERT INTO analytics_page_daily (day, path, views, unique_visitors, engagement_ms, engaged_views)
VALUES ($1, $2, 0, 0, $3, $4)
ON CONFLICT (day, path) DO UPDATE SET
  engagement_ms = analytics_page_daily.engagement_ms + EXCLUDED.engagement_ms,
  engaged_views = analytics_page_daily.engaged_views + EXCLUDED.engaged_views
"#,
        [
            SeaValue::from(day),
            SeaValue::from(path.to_string()),
            SeaValue::from(ms),
            SeaValue::from(engaged_inc),
        ],
    ))
    .await?;
    Ok(())
}

async fn bump_event(
    db: &DatabaseConnection,
    day: NaiveDate,
    name: &str,
    path: &str,
    visitor: &str,
) -> Result<(), sea_orm::DbErr> {
    let insert = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
INSERT INTO analytics_event_visitor (day, event_name, path, visitor_hash)
VALUES ($1, $2, $3, $4)
ON CONFLICT (day, event_name, path, visitor_hash) DO NOTHING
"#,
            [
                SeaValue::from(day),
                SeaValue::from(name.to_string()),
                SeaValue::from(path.to_string()),
                SeaValue::from(visitor.to_string()),
            ],
        ))
        .await?;
    let unique_inc: i64 = if insert.rows_affected() > 0 { 1 } else { 0 };
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
INSERT INTO analytics_event_daily (day, event_name, path, count, unique_visitors)
VALUES ($1, $2, $3, 1, $4)
ON CONFLICT (day, event_name, path) DO UPDATE SET
  count = analytics_event_daily.count + 1,
  unique_visitors = analytics_event_daily.unique_visitors + EXCLUDED.unique_visitors
"#,
        [
            SeaValue::from(day),
            SeaValue::from(name.to_string()),
            SeaValue::from(path.to_string()),
            SeaValue::from(unique_inc),
        ],
    ))
    .await?;
    Ok(())
}

async fn bump_referrer(
    db: &DatabaseConnection,
    day: NaiveDate,
    host: &str,
) -> Result<(), sea_orm::DbErr> {
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
INSERT INTO analytics_referrer_daily (day, host, count)
VALUES ($1, $2, 1)
ON CONFLICT (day, host) DO UPDATE SET
  count = analytics_referrer_daily.count + 1
"#,
        [SeaValue::from(day), SeaValue::from(host.to_string())],
    ))
    .await?;
    Ok(())
}

async fn bump_country(
    db: &DatabaseConnection,
    day: NaiveDate,
    country: &CountryInfo,
    visitor: &str,
    count_view: bool,
) -> Result<(), sea_orm::DbErr> {
    let view_inc: i64 = if count_view { 1 } else { 0 };

    // First (day, country, visitor) → +1 unique_visitors
    let insert = db
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
INSERT INTO analytics_country_visitor (day, country_code, visitor_hash)
VALUES ($1, $2, $3)
ON CONFLICT (day, country_code, visitor_hash) DO NOTHING
"#,
            [
                SeaValue::from(day),
                SeaValue::from(country.code.clone()),
                SeaValue::from(visitor.to_string()),
            ],
        ))
        .await?;
    let unique_inc: i64 = if insert.rows_affected() > 0 { 1 } else { 0 };
    if view_inc == 0 && unique_inc == 0 {
        return Ok(());
    }

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
INSERT INTO analytics_country_daily (day, country_code, country_name, views, unique_visitors)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (day, country_code) DO UPDATE SET
  views = analytics_country_daily.views + EXCLUDED.views,
  unique_visitors = analytics_country_daily.unique_visitors + EXCLUDED.unique_visitors,
  country_name = CASE
    WHEN EXCLUDED.country_name <> '' THEN EXCLUDED.country_name
    ELSE analytics_country_daily.country_name
  END
"#,
        [
            SeaValue::from(day),
            SeaValue::from(country.code.clone()),
            SeaValue::from(country.name.clone()),
            SeaValue::from(view_inc),
            SeaValue::from(unique_inc),
        ],
    ))
    .await?;
    Ok(())
}

async fn maybe_prune(db: &DatabaseConnection) {
    if (Utc::now().timestamp_subsec_nanos() % 100) != 0 {
        return;
    }
    let today = analytics_today();
    let visitor_cutoff = today - Duration::days(VISITOR_RETENTION_DAYS);
    let daily_cutoff = today - Duration::days(DAILY_RETENTION_DAYS);
    for sql in [
        "DELETE FROM analytics_visitor_seen WHERE day < $1",
        "DELETE FROM analytics_event_visitor WHERE day < $1",
        "DELETE FROM analytics_country_visitor WHERE day < $1",
        "DELETE FROM analytics_page_daily WHERE day < $1",
        "DELETE FROM analytics_event_daily WHERE day < $1",
        "DELETE FROM analytics_referrer_daily WHERE day < $1",
        "DELETE FROM analytics_country_daily WHERE day < $1",
    ] {
        let cutoff = if sql.contains("visitor") {
            visitor_cutoff
        } else {
            daily_cutoff
        };
        let _ = db
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                [SeaValue::from(cutoff)],
            ))
            .await;
    }
}

// ── Shared intake ──────────────────────────────────────────────────────────

struct IntakeCtx {
    db: DatabaseConnection,
    visitor: String,
    day: NaiveDate,
    country: Option<CountryInfo>,
}

async fn process_items(ctx: &IntakeCtx, items: &[CollectItem]) -> usize {
    let mut accepted = 0usize;
    for item in items.iter().take(MAX_BATCH_ITEMS) {
        let kind = item.kind.trim().to_ascii_lowercase();
        match kind.as_str() {
            "pageview" => {
                let Some(path) = item
                    .path
                    .as_deref()
                    .and_then(normalize_path)
                else {
                    continue;
                };
                let _ = record_site_unique(&ctx.db, ctx.day, &ctx.visitor).await;
                let dup = is_duplicate_view(&ctx.visitor, &path).await;
                if bump_pageview(&ctx.db, ctx.day, &path, &ctx.visitor, !dup)
                    .await
                    .is_ok()
                {
                    accepted += 1;
                    if let Some(ref country) = ctx.country {
                        let _ = bump_country(
                            &ctx.db,
                            ctx.day,
                            country,
                            &ctx.visitor,
                            !dup,
                        )
                        .await;
                    }
                }
                if let Some(host) = item
                    .referrer
                    .as_deref()
                    .and_then(normalize_referrer_host)
                {
                    let _ = bump_referrer(&ctx.db, ctx.day, &host).await;
                }
            }
            "engagement" => {
                let Some(path) = item
                    .path
                    .as_deref()
                    .and_then(normalize_path)
                else {
                    continue;
                };
                let ms = item.ms.unwrap_or(0);
                if bump_engagement(&ctx.db, ctx.day, &path, &ctx.visitor, ms)
                    .await
                    .is_ok()
                {
                    accepted += 1;
                }
            }
            "event" => {
                let Some(name) = item.name.as_deref().and_then(normalize_event_name) else {
                    continue;
                };
                let path = item
                    .path
                    .as_deref()
                    .and_then(normalize_path)
                    .unwrap_or_else(|| "/".to_string());
                if bump_event(&ctx.db, ctx.day, &name, &path, &ctx.visitor)
                    .await
                    .is_ok()
                {
                    accepted += 1;
                }
            }
            _ => {}
        }
    }
    accepted
}

async fn parse_json_body<T: for<'de> Deserialize<'de>>(
    request: Request,
) -> Result<(Option<std::net::IpAddr>, String, bool, T), (StatusCode, Json<Value>)> {
    // Admin JWT (cookie/header) → drop self-traffic even if client flag is spoofed.
    let is_admin = crate::middleware::auth::extract_optional_claims(request.headers())
        .map(|c| c.is_admin)
        .unwrap_or(false);
    let ip = crate::middleware::client_ip::extract_client_ip(&request);
    let ua = request
        .headers()
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = axum::body::to_bytes(request.into_body(), 32 * 1024)
        .await
        .map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(json!({ "success": false, "error": "invalid_body" })),
            )
        })?;
    let body: T = serde_json::from_slice(&bytes).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "error": "invalid_json" })),
        )
    })?;
    Ok((ip, ua, is_admin, body))
}

// ── Handlers ───────────────────────────────────────────────────────────────

/// Whether first-party visitor collection is enabled (default true).
async fn analytics_collection_enabled() -> bool {
    crate::GLOBAL_DYNAMIC_CONFIG
        .read()
        .await
        .analytics_enabled
}

/// POST /api/analytics/collect — preferred batch endpoint.
pub async fn collect(
    crate::extract::Db(db): crate::extract::Db,
    ConnectInfo(_peer): ConnectInfo<SocketAddr>,
    request: Request,
) -> (StatusCode, Json<Value>) {
    let header_country = country_from_headers(request.headers());
    let (ip, ua, is_admin, body) = match parse_json_body::<CollectRequest>(request).await {
        Ok(v) => v,
        Err(e) => return e,
    };

    if !analytics_collection_enabled().await {
        return (
            StatusCode::OK,
            Json(json!({ "success": true, "skipped": "disabled", "accepted": 0 })),
        );
    }

    if is_admin {
        return (
            StatusCode::OK,
            Json(json!({ "success": true, "skipped": "admin", "accepted": 0 })),
        );
    }

    if is_bot_ua(&ua) {
        return (
            StatusCode::OK,
            Json(json!({ "success": true, "skipped": "bot", "accepted": 0 })),
        );
    }

    let ip_key = ip
        .map(|i| i.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    if rate_limited(&ip_key).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "success": false, "error": "rate_limited" })),
        );
    }

    if body.items.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "error": "empty" })),
        );
    }

    let visitor = resolve_visitor_hash(body.vid.as_deref(), ip, &ua);
    let day = analytics_today();
    let country = resolve_country(ip, header_country).await;
    let ctx = IntakeCtx {
        db: db.clone(),
        visitor,
        day,
        country,
    };
    let accepted = process_items(&ctx, &body.items).await;
    if accepted > 0 {
        invalidate_summary_cache().await;
    }
    maybe_prune(&db).await;

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "accepted": accepted,
        })),
    )
}

/// POST /api/analytics/pageview — single pageview (compat).
pub async fn record_pageview(
    crate::extract::Db(db): crate::extract::Db,
    ConnectInfo(_peer): ConnectInfo<SocketAddr>,
    request: Request,
) -> (StatusCode, Json<Value>) {
    let header_country = country_from_headers(request.headers());
    let (ip, ua, is_admin, body) = match parse_json_body::<PageviewRequest>(request).await {
        Ok(v) => v,
        Err(e) => return e,
    };

    if !analytics_collection_enabled().await {
        return (
            StatusCode::OK,
            Json(json!({ "success": true, "skipped": "disabled" })),
        );
    }

    if is_admin {
        return (
            StatusCode::OK,
            Json(json!({ "success": true, "skipped": "admin" })),
        );
    }

    if is_bot_ua(&ua) {
        return (
            StatusCode::OK,
            Json(json!({ "success": true, "skipped": "bot" })),
        );
    }

    let ip_key = ip
        .map(|i| i.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    if rate_limited(&ip_key).await {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "success": false, "error": "rate_limited" })),
        );
    }

    let Some(path) = normalize_path(&body.path) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "error": "invalid_path" })),
        );
    };

    let visitor = resolve_visitor_hash(body.vid.as_deref(), ip, &ua);
    let day = analytics_today();
    let country = resolve_country(ip, header_country).await;
    let items = vec![CollectItem {
        kind: "pageview".into(),
        path: Some(path.clone()),
        referrer: body.referrer,
        ms: None,
        name: None,
    }];
    let ctx = IntakeCtx {
        db: db.clone(),
        visitor,
        day,
        country,
    };
    let accepted = process_items(&ctx, &items).await;
    if accepted > 0 {
        invalidate_summary_cache().await;
    }
    maybe_prune(&db).await;

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "path": path,
            "accepted": accepted,
        })),
    )
}

async fn count_distinct_site(
    db: &DatabaseConnection,
    from: NaiveDate,
    to: NaiveDate,
) -> i64 {
    db.query_one(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
SELECT COUNT(DISTINCT visitor_hash)::bigint AS n
FROM analytics_visitor_seen
WHERE day >= $1 AND day <= $2 AND path = $3
"#,
        [
            SeaValue::from(from),
            SeaValue::from(to),
            SeaValue::from(SITE_PATH.to_string()),
        ],
    ))
    .await
    .ok()
    .flatten()
    .and_then(|r| r.try_get::<i64>("", "n").ok())
    .unwrap_or(0)
}

/// GET /api/analytics/summary?days=7
pub async fn get_summary(
    crate::extract::Db(db): crate::extract::Db,
    Query(q): Query<SummaryQuery>,
) -> (StatusCode, Json<Value>) {
    let days = q
        .days
        .unwrap_or(DEFAULT_SUMMARY_DAYS)
        .clamp(1, MAX_SUMMARY_DAYS);

    // Short TTL cache — admin UI refresh shouldn't re-scan every open.
    {
        let cache = SUMMARY_CACHE.lock().await;
        if let Some((at, body)) = cache.get(&days) {
            if at.elapsed() < SUMMARY_CACHE_TTL {
                return (StatusCode::OK, Json(body.clone()));
            }
        }
    }

    let today = analytics_today();
    let from = today - Duration::days(days - 1);
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).unwrap_or(from);
    let tz_label = analytics_tz_label();

    let daily_rows = match db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT day::text AS day,
       COALESCE(SUM(CASE WHEN path <> $3 THEN views ELSE 0 END), 0)::bigint AS views,
       COALESCE(MAX(CASE WHEN path = $3 THEN unique_visitors ELSE 0 END), 0)::bigint AS unique_visitors,
       COALESCE(SUM(CASE WHEN path <> $3 THEN engagement_ms ELSE 0 END), 0)::bigint AS engagement_ms,
       COALESCE(SUM(CASE WHEN path <> $3 THEN engaged_views ELSE 0 END), 0)::bigint AS engaged_views
FROM analytics_page_daily
WHERE day >= $1 AND day <= $2
GROUP BY day
ORDER BY day ASC
"#,
            [
                SeaValue::from(from),
                SeaValue::from(today),
                SeaValue::from(SITE_PATH.to_string()),
            ],
        ))
        .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!("analytics summary daily failed: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": "db_error" })),
            );
        }
    };

    let mut daily = Vec::new();
    let mut range_views: i64 = 0;
    let mut range_engagement_ms: i64 = 0;
    let mut range_engaged_views: i64 = 0;
    for row in &daily_rows {
        let day: String = row.try_get("", "day").unwrap_or_default();
        let views: i64 = row.try_get("", "views").unwrap_or(0);
        let uv: i64 = row.try_get("", "unique_visitors").unwrap_or(0);
        let eng: i64 = row.try_get("", "engagement_ms").unwrap_or(0);
        let eng_v: i64 = row.try_get("", "engaged_views").unwrap_or(0);
        range_views += views;
        range_engagement_ms += eng;
        range_engaged_views += eng_v;
        daily.push(json!({
            "day": day,
            "views": views,
            "unique_visitors": uv,
            "engagement_ms": eng,
        }));
    }

    let mut filled = Vec::new();
    let mut cursor = from;
    let by_day: HashMap<String, &Value> = daily
        .iter()
        .filter_map(|v| v.get("day").and_then(|d| d.as_str()).map(|d| (d.to_string(), v)))
        .collect();
    while cursor <= today {
        let key = cursor.format("%Y-%m-%d").to_string();
        if let Some(v) = by_day.get(&key) {
            filled.push((*v).clone());
        } else {
            filled.push(json!({
                "day": key,
                "views": 0,
                "unique_visitors": 0,
                "engagement_ms": 0,
            }));
        }
        cursor += Duration::days(1);
    }

    let today_views = filled
        .last()
        .and_then(|v| v.get("views").and_then(|x| x.as_i64()))
        .unwrap_or(0);
    let today_uv = filled
        .last()
        .and_then(|v| v.get("unique_visitors").and_then(|x| x.as_i64()))
        .unwrap_or(0);

    let range_uv = count_distinct_site(&db, from, today).await;
    // Avg dwell among visits that reported engagement (engaged_views = unique
    // visitor×path×day with ≥1 engagement flush, not per soft-flush).
    let avg_engagement_ms = if range_engaged_views > 0 {
        range_engagement_ms / range_engaged_views
    } else {
        0
    };
    // Shallow-visit approx: pageviews with no engagement credit yet.
    // engaged_views can exceed views slightly under race; clamp.
    let short_engage = if range_views > 0 {
        let unengaged = (range_views - range_engaged_views.min(range_views)).max(0);
        (unengaged as f64 / range_views as f64 * 1000.0).round() as i64
    } else {
        0
    };

    let page_view_rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT path,
       COALESCE(SUM(views), 0)::bigint AS views,
       COALESCE(SUM(engagement_ms), 0)::bigint AS engagement_ms,
       COALESCE(SUM(engaged_views), 0)::bigint AS engaged_views
FROM analytics_page_daily
WHERE day >= $1 AND day <= $2 AND path <> $3
GROUP BY path
ORDER BY views DESC, path ASC
LIMIT 50
"#,
            [
                SeaValue::from(from),
                SeaValue::from(today),
                SeaValue::from(SITE_PATH.to_string()),
            ],
        ))
        .await
        .unwrap_or_default();

    let page_uv_rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT path, COUNT(DISTINCT visitor_hash)::bigint AS unique_visitors
FROM analytics_visitor_seen
WHERE day >= $1 AND day <= $2 AND path <> $3
GROUP BY path
"#,
            [
                SeaValue::from(from),
                SeaValue::from(today),
                SeaValue::from(SITE_PATH.to_string()),
            ],
        ))
        .await
        .unwrap_or_default();

    let mut uv_by_path: HashMap<String, i64> = HashMap::new();
    for row in &page_uv_rows {
        let p: String = row.try_get("", "path").unwrap_or_default();
        let n: i64 = row.try_get("", "unique_visitors").unwrap_or(0);
        uv_by_path.insert(p, n);
    }

    let pages: Vec<Value> = page_view_rows
        .iter()
        .map(|row| {
            let path: String = row.try_get("", "path").unwrap_or_default();
            let views: i64 = row.try_get("", "views").unwrap_or(0);
            let eng: i64 = row.try_get("", "engagement_ms").unwrap_or(0);
            let eng_v: i64 = row.try_get("", "engaged_views").unwrap_or(0);
            let avg = if eng_v > 0 { eng / eng_v } else { 0 };
            json!({
                "path": path,
                "views": views,
                "unique_visitors": uv_by_path.get(&path).copied().unwrap_or(0),
                "avg_engagement_ms": avg,
            })
        })
        .collect();

    // Events (aggregate name across paths for cleaner UI)
    let event_rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT event_name,
       COALESCE(SUM(count), 0)::bigint AS count
FROM analytics_event_daily
WHERE day >= $1 AND day <= $2 AND event_name <> $3
GROUP BY event_name
ORDER BY count DESC, event_name ASC
LIMIT 30
"#,
            [
                SeaValue::from(from),
                SeaValue::from(today),
                SeaValue::from(ENGAGE_MARKER.to_string()),
            ],
        ))
        .await
        .unwrap_or_default();

    let event_uv_rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT event_name, COUNT(DISTINCT visitor_hash)::bigint AS unique_visitors
FROM analytics_event_visitor
WHERE day >= $1 AND day <= $2 AND event_name <> $3
GROUP BY event_name
"#,
            [
                SeaValue::from(from),
                SeaValue::from(today),
                SeaValue::from(ENGAGE_MARKER.to_string()),
            ],
        ))
        .await
        .unwrap_or_default();
    let mut event_uv: HashMap<String, i64> = HashMap::new();
    for row in &event_uv_rows {
        let n: String = row.try_get("", "event_name").unwrap_or_default();
        let c: i64 = row.try_get("", "unique_visitors").unwrap_or(0);
        event_uv.insert(n, c);
    }
    let events: Vec<Value> = event_rows
        .iter()
        .map(|row| {
            let name: String = row.try_get("", "event_name").unwrap_or_default();
            json!({
                "name": name,
                "count": row.try_get::<i64>("", "count").unwrap_or(0),
                "unique_visitors": event_uv.get(&name).copied().unwrap_or(0),
            })
        })
        .collect();

    let referrer_rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT host, COALESCE(SUM(count), 0)::bigint AS count
FROM analytics_referrer_daily
WHERE day >= $1 AND day <= $2
GROUP BY host
ORDER BY count DESC, host ASC
LIMIT 20
"#,
            [SeaValue::from(from), SeaValue::from(today)],
        ))
        .await
        .unwrap_or_default();
    let referrers: Vec<Value> = referrer_rows
        .iter()
        .map(|row| {
            json!({
                "host": row.try_get::<String>("", "host").unwrap_or_default(),
                "count": row.try_get::<i64>("", "count").unwrap_or(0),
            })
        })
        .collect();

    // Top countries by unique visitors in range (fallback views)
    let country_rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT country_code,
       MAX(country_name) AS country_name,
       COALESCE(SUM(views), 0)::bigint AS views,
       COALESCE(SUM(unique_visitors), 0)::bigint AS unique_visitors
FROM analytics_country_daily
WHERE day >= $1 AND day <= $2
GROUP BY country_code
ORDER BY unique_visitors DESC, views DESC, country_code ASC
LIMIT 12
"#,
            [SeaValue::from(from), SeaValue::from(today)],
        ))
        .await
        .unwrap_or_default();
    // Prefer true distinct UV over sum-of-daily when multi-day window.
    let country_uv_rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT country_code, COUNT(DISTINCT visitor_hash)::bigint AS unique_visitors
FROM analytics_country_visitor
WHERE day >= $1 AND day <= $2
GROUP BY country_code
"#,
            [SeaValue::from(from), SeaValue::from(today)],
        ))
        .await
        .unwrap_or_default();
    let mut country_uv: HashMap<String, i64> = HashMap::new();
    for row in &country_uv_rows {
        let code: String = row.try_get("", "country_code").unwrap_or_default();
        let n: i64 = row.try_get("", "unique_visitors").unwrap_or(0);
        country_uv.insert(code, n);
    }
    let mut countries: Vec<Value> = country_rows
        .iter()
        .map(|row| {
            let code: String = row.try_get("", "country_code").unwrap_or_default();
            let name: String = row.try_get("", "country_name").unwrap_or_default();
            let views: i64 = row.try_get("", "views").unwrap_or(0);
            let uv = country_uv
                .get(&code)
                .copied()
                .unwrap_or_else(|| row.try_get::<i64>("", "unique_visitors").unwrap_or(0));
            json!({
                "code": code,
                "name": if name.is_empty() { code.clone() } else { name },
                "views": views,
                "unique_visitors": uv,
            })
        })
        .collect();
    countries.sort_by(|a, b| {
        let ua = a.get("unique_visitors").and_then(|v| v.as_i64()).unwrap_or(0);
        let ub = b.get("unique_visitors").and_then(|v| v.as_i64()).unwrap_or(0);
        let va = a.get("views").and_then(|v| v.as_i64()).unwrap_or(0);
        let vb = b.get("views").and_then(|v| v.as_i64()).unwrap_or(0);
        ub.cmp(&ua)
            .then(vb.cmp(&va))
            .then(
                a.get("code")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .cmp(b.get("code").and_then(|v| v.as_str()).unwrap_or("")),
            )
    });
    if countries.len() > 12 {
        countries.truncate(12);
    }

    let all_time_views = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT COALESCE(SUM(views), 0)::bigint AS views
FROM analytics_page_daily WHERE path <> $1
"#,
            [SeaValue::from(SITE_PATH.to_string())],
        ))
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<i64>("", "views").ok())
        .unwrap_or(0);
    let all_time_uv = count_distinct_site(&db, epoch, today).await;

    let body = json!({
        "success": true,
        "days": days,
        "from": from.format("%Y-%m-%d").to_string(),
        "to": today.format("%Y-%m-%d").to_string(),
        "timezone": tz_label,
        "retention": {
            "visitor_days": VISITOR_RETENTION_DAYS,
            "daily_days": DAILY_RETENTION_DAYS,
        },
        "definitions": {
            "unique_visitors": "distinct_visitor_hash",
            "range_unique": "true_distinct_over_range",
            "daily_unique": "per_server_local_calendar_day",
            "avg_engagement_ms": "sum(engagement_ms) / engaged_visitor_path_days",
            "approx_bounce_permille": "pageviews_without_engagement_credit / pageviews * 1000 (approx, not session bounce)",
            "staff_excluded": "is_admin JWT sessions are not recorded",
        },
        "today": {
            "views": today_views,
            "unique_visitors": today_uv,
        },
        "range": {
            "views": range_views,
            "unique_visitors": range_uv,
            "engagement_ms": range_engagement_ms,
            "engaged_views": range_engaged_views,
            "avg_engagement_ms": avg_engagement_ms,
            "approx_bounce_permille": short_engage,
        },
        "all_time": {
            "views": all_time_views,
            "unique_visitors": all_time_uv,
            "unique_visitors_note": "bounded_by_visitor_seen_retention",
        },
        "daily": filled,
        "pages": pages,
        "events": events,
        "referrers": referrers,
        "countries": countries,
    });

    {
        let mut cache = SUMMARY_CACHE.lock().await;
        cache.insert(days, (Instant::now(), body.clone()));
        // Keep map small (only a few day windows are ever queried)
        if cache.len() > 8 {
            cache.retain(|_, (at, _)| at.elapsed() < SUMMARY_CACHE_TTL * 2);
        }
    }

    (StatusCode::OK, Json(body))
}

// ── Public visitor card ────────────────────────────────────────────────────

/// Trend window on the public card (kept small — it is a widget, not a report).
const VISITOR_CARD_DAYS: i64 = 5;

/// `vid` out of the raw query string.
///
/// A valid vid is `[A-Za-z0-9_-]{16,64}` (see [`is_valid_vid`]), so there is
/// nothing to percent-decode; anything that needed decoding would fail
/// validation anyway and fall through to the ip+ua fingerprint.
fn vid_from_query(uri: &axum::http::Uri) -> Option<String> {
    uri.query()?.split('&').find_map(|kv| {
        let (k, v) = kv.split_once('=')?;
        (k == "vid").then(|| v.to_string())
    })
}

/// Today / all-time / trend, shared by every visitor and cached briefly.
async fn visitor_card_aggregate(db: &DatabaseConnection) -> Value {
    {
        let cache = VISITOR_CARD_CACHE.lock().await;
        if let Some((at, body)) = cache.as_ref() {
            if at.elapsed() < SUMMARY_CACHE_TTL {
                return body.clone();
            }
        }
    }

    let today = analytics_today();
    let from = today - Duration::days(VISITOR_CARD_DAYS - 1);
    let epoch = NaiveDate::from_ymd_opt(1970, 1, 1).unwrap_or(from);

    let daily_rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT day::text AS day,
       COALESCE(SUM(CASE WHEN path <> $3 THEN views ELSE 0 END), 0)::bigint AS views,
       COALESCE(MAX(CASE WHEN path = $3 THEN unique_visitors ELSE 0 END), 0)::bigint AS unique_visitors
FROM analytics_page_daily
WHERE day >= $1 AND day <= $2
GROUP BY day
ORDER BY day ASC
"#,
            [
                SeaValue::from(from),
                SeaValue::from(today),
                SeaValue::from(SITE_PATH.to_string()),
            ],
        ))
        .await
        .unwrap_or_default();

    let mut by_day: HashMap<String, (i64, i64)> = HashMap::new();
    for row in &daily_rows {
        let day: String = row.try_get("", "day").unwrap_or_default();
        let views: i64 = row.try_get("", "views").unwrap_or(0);
        let uv: i64 = row.try_get("", "unique_visitors").unwrap_or(0);
        by_day.insert(day, (views, uv));
    }

    // Gap-fill so the sparkline always has one column per day in the window.
    let mut daily = Vec::new();
    let mut cursor = from;
    while cursor <= today {
        let key = cursor.format("%Y-%m-%d").to_string();
        let (views, uv) = by_day.get(&key).copied().unwrap_or((0, 0));
        daily.push(json!({ "day": key, "views": views, "unique_visitors": uv }));
        cursor += Duration::days(1);
    }

    let (today_views, today_uv) = by_day
        .get(&today.format("%Y-%m-%d").to_string())
        .copied()
        .unwrap_or((0, 0));

    let all_time_views = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"
SELECT COALESCE(SUM(views), 0)::bigint AS views
FROM analytics_page_daily WHERE path <> $1
"#,
            [SeaValue::from(SITE_PATH.to_string())],
        ))
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<i64>("", "views").ok())
        .unwrap_or(0);
    let all_time_uv = count_distinct_site(db, epoch, today).await;

    let body = json!({
        "days": VISITOR_CARD_DAYS,
        "from": from.format("%Y-%m-%d").to_string(),
        "to": today.format("%Y-%m-%d").to_string(),
        "timezone": analytics_tz_label(),
        "today": { "views": today_views, "unique_visitors": today_uv },
        "all_time": {
            "views": all_time_views,
            "unique_visitors": all_time_uv,
            "unique_visitors_note": "bounded_by_visitor_seen_retention",
        },
        "daily": daily,
    });

    *VISITOR_CARD_CACHE.lock().await = Some((Instant::now(), body.clone()));
    body
}

/// GET `/api/analytics/visitor?vid=…` — **public** visitor card.
///
/// Deliberately narrower than the admin summary: site-wide totals, a 7-day
/// trend, and the caller's own arrival ordinal. Per-page, per-referrer,
/// per-country and engagement breakdowns stay admin-only.
///
/// Read-only — it never creates a visitor row, so polling this endpoint cannot
/// inflate the counters. `your_ordinal_today` is therefore null until the
/// visitor's own pageview beacon has landed.
pub async fn get_visitor_card(
    crate::extract::Db(db): crate::extract::Db,
    ConnectInfo(_peer): ConnectInfo<SocketAddr>,
    request: Request,
) -> (StatusCode, Json<Value>) {
    if !analytics_collection_enabled().await {
        return (
            StatusCode::OK,
            Json(json!({ "success": true, "enabled": false })),
        );
    }

    // Admin sessions are never recorded (see `collect`), so the site owner has
    // no ordinal of their own. Report that rather than showing a blank slot.
    let is_admin = crate::middleware::auth::extract_optional_claims(request.headers())
        .map(|c| c.is_admin)
        .unwrap_or(false);
    let ip = crate::middleware::client_ip::extract_client_ip(&request);
    let ua = request
        .headers()
        .get(header::USER_AGENT)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let vid = vid_from_query(request.uri());

    let mut body = visitor_card_aggregate(&db).await;

    let ordinal = if is_admin {
        None
    } else {
        let visitor = resolve_visitor_hash(vid.as_deref(), ip, &ua);
        read_visitor_ordinal(&db, analytics_today(), &visitor)
            .await
            .unwrap_or(None)
    };

    if let Some(obj) = body.as_object_mut() {
        obj.insert("success".into(), json!(true));
        obj.insert("enabled".into(), json!(true));
        obj.insert("your_ordinal_today".into(), json!(ordinal));
        obj.insert("counted".into(), json!(!is_admin));
    }
    (StatusCode::OK, Json(body))
}

// ── Export / import (admin backup) ─────────────────────────────────────────

fn parse_day_str(raw: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d").ok()
}

fn valid_visitor_hash(raw: &str) -> bool {
    let s = raw.trim();
    let len = s.len();
    (8..=64).contains(&len) && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn i64_nonneg(v: Option<&Value>) -> Option<i64> {
    let n = v.and_then(|x| x.as_i64()).or_else(|| {
        v.and_then(|x| x.as_u64())
            .and_then(|u| i64::try_from(u).ok())
    })?;
    if n < 0 {
        None
    } else {
        Some(n)
    }
}

/// GET /api/analytics/export — full first-party analytics backup (admin).
pub async fn export_analytics(
    crate::extract::Db(db): crate::extract::Db,
) -> (StatusCode, Json<Value>) {
    let page_daily = match db
        .query_all(Statement::from_string(
            DatabaseBackend::Postgres,
            r#"
SELECT day::text AS day, path, views, unique_visitors, engagement_ms, engaged_views
FROM analytics_page_daily
ORDER BY day ASC, path ASC
"#
            .to_string(),
        ))
        .await
    {
        Ok(rows) => rows
            .iter()
            .map(|row| {
                json!({
                    "day": row.try_get::<String>("", "day").unwrap_or_default(),
                    "path": row.try_get::<String>("", "path").unwrap_or_default(),
                    "views": row.try_get::<i64>("", "views").unwrap_or(0),
                    "unique_visitors": row.try_get::<i64>("", "unique_visitors").unwrap_or(0),
                    "engagement_ms": row.try_get::<i64>("", "engagement_ms").unwrap_or(0),
                    "engaged_views": row.try_get::<i64>("", "engaged_views").unwrap_or(0),
                })
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::warn!("analytics export page_daily failed: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": "db_error" })),
            );
        }
    };

    let visitor_seen = match db
        .query_all(Statement::from_string(
            DatabaseBackend::Postgres,
            r#"
SELECT day::text AS day, path, visitor_hash, ordinal
FROM analytics_visitor_seen
ORDER BY day ASC, path ASC, visitor_hash ASC
"#
            .to_string(),
        ))
        .await
    {
        Ok(rows) => rows
            .iter()
            .map(|row| {
                json!({
                    "day": row.try_get::<String>("", "day").unwrap_or_default(),
                    "path": row.try_get::<String>("", "path").unwrap_or_default(),
                    "visitor_hash": row.try_get::<String>("", "visitor_hash").unwrap_or_default(),
                    "ordinal": row.try_get::<i64>("", "ordinal").unwrap_or(0),
                })
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::warn!("analytics export visitor_seen failed: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": "db_error" })),
            );
        }
    };

    let event_daily = match db
        .query_all(Statement::from_string(
            DatabaseBackend::Postgres,
            r#"
SELECT day::text AS day, event_name, path, count, unique_visitors
FROM analytics_event_daily
ORDER BY day ASC, event_name ASC, path ASC
"#
            .to_string(),
        ))
        .await
    {
        Ok(rows) => rows
            .iter()
            .map(|row| {
                json!({
                    "day": row.try_get::<String>("", "day").unwrap_or_default(),
                    "event_name": row.try_get::<String>("", "event_name").unwrap_or_default(),
                    "path": row.try_get::<String>("", "path").unwrap_or_default(),
                    "count": row.try_get::<i64>("", "count").unwrap_or(0),
                    "unique_visitors": row.try_get::<i64>("", "unique_visitors").unwrap_or(0),
                })
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::warn!("analytics export event_daily failed: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": "db_error" })),
            );
        }
    };

    let event_visitor = match db
        .query_all(Statement::from_string(
            DatabaseBackend::Postgres,
            r#"
SELECT day::text AS day, event_name, path, visitor_hash
FROM analytics_event_visitor
ORDER BY day ASC, event_name ASC, path ASC, visitor_hash ASC
"#
            .to_string(),
        ))
        .await
    {
        Ok(rows) => rows
            .iter()
            .map(|row| {
                json!({
                    "day": row.try_get::<String>("", "day").unwrap_or_default(),
                    "event_name": row.try_get::<String>("", "event_name").unwrap_or_default(),
                    "path": row.try_get::<String>("", "path").unwrap_or_default(),
                    "visitor_hash": row.try_get::<String>("", "visitor_hash").unwrap_or_default(),
                })
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::warn!("analytics export event_visitor failed: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": "db_error" })),
            );
        }
    };

    let referrer_daily = match db
        .query_all(Statement::from_string(
            DatabaseBackend::Postgres,
            r#"
SELECT day::text AS day, host, count
FROM analytics_referrer_daily
ORDER BY day ASC, host ASC
"#
            .to_string(),
        ))
        .await
    {
        Ok(rows) => rows
            .iter()
            .map(|row| {
                json!({
                    "day": row.try_get::<String>("", "day").unwrap_or_default(),
                    "host": row.try_get::<String>("", "host").unwrap_or_default(),
                    "count": row.try_get::<i64>("", "count").unwrap_or(0),
                })
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::warn!("analytics export referrer_daily failed: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": "db_error" })),
            );
        }
    };

    let country_daily = match db
        .query_all(Statement::from_string(
            DatabaseBackend::Postgres,
            r#"
SELECT day::text AS day, country_code, country_name, views, unique_visitors
FROM analytics_country_daily
ORDER BY day ASC, country_code ASC
"#
            .to_string(),
        ))
        .await
    {
        Ok(rows) => rows
            .iter()
            .map(|row| {
                json!({
                    "day": row.try_get::<String>("", "day").unwrap_or_default(),
                    "country_code": row.try_get::<String>("", "country_code").unwrap_or_default(),
                    "country_name": row.try_get::<String>("", "country_name").unwrap_or_default(),
                    "views": row.try_get::<i64>("", "views").unwrap_or(0),
                    "unique_visitors": row.try_get::<i64>("", "unique_visitors").unwrap_or(0),
                })
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::warn!("analytics export country_daily failed: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": "db_error" })),
            );
        }
    };

    let country_visitor = match db
        .query_all(Statement::from_string(
            DatabaseBackend::Postgres,
            r#"
SELECT day::text AS day, country_code, visitor_hash
FROM analytics_country_visitor
ORDER BY day ASC, country_code ASC, visitor_hash ASC
"#
            .to_string(),
        ))
        .await
    {
        Ok(rows) => rows
            .iter()
            .map(|row| {
                json!({
                    "day": row.try_get::<String>("", "day").unwrap_or_default(),
                    "country_code": row.try_get::<String>("", "country_code").unwrap_or_default(),
                    "visitor_hash": row.try_get::<String>("", "visitor_hash").unwrap_or_default(),
                })
            })
            .collect::<Vec<_>>(),
        Err(e) => {
            tracing::warn!("analytics export country_visitor failed: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": "db_error" })),
            );
        }
    };

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "format": ANALYTICS_BACKUP_FORMAT,
            "version": ANALYTICS_BACKUP_VERSION,
            "exported_at": Utc::now().to_rfc3339(),
            "timezone": analytics_tz_label(),
            "counts": {
                "page_daily": page_daily.len(),
                "visitor_seen": visitor_seen.len(),
                "event_daily": event_daily.len(),
                "event_visitor": event_visitor.len(),
                "referrer_daily": referrer_daily.len(),
                "country_daily": country_daily.len(),
                "country_visitor": country_visitor.len(),
            },
            "page_daily": page_daily,
            "visitor_seen": visitor_seen,
            "event_daily": event_daily,
            "event_visitor": event_visitor,
            "referrer_daily": referrer_daily,
            "country_daily": country_daily,
            "country_visitor": country_visitor,
        })),
    )
}

#[derive(Debug, Deserialize)]
pub struct AnalyticsImportBody {
    pub format: Option<String>,
    pub version: Option<u32>,
    /// `replace` (default): truncate then insert. `merge`: upsert / add.
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub page_daily: Vec<Value>,
    #[serde(default)]
    pub visitor_seen: Vec<Value>,
    #[serde(default)]
    pub event_daily: Vec<Value>,
    #[serde(default)]
    pub event_visitor: Vec<Value>,
    #[serde(default)]
    pub referrer_daily: Vec<Value>,
    #[serde(default)]
    pub country_daily: Vec<Value>,
    #[serde(default)]
    pub country_visitor: Vec<Value>,
}

/// After import, unique_visitors / engaged_views come from detail tables so
/// merge never double-counts UV by summing aggregate fields.
async fn recompute_unique_metrics(
    conn: &impl ConnectionTrait,
) -> Result<(), sea_orm::DbErr> {
    conn.execute(Statement::from_string(
        DatabaseBackend::Postgres,
        r#"
UPDATE analytics_page_daily p
SET unique_visitors = COALESCE((
  SELECT COUNT(*)::bigint
  FROM analytics_visitor_seen v
  WHERE v.day = p.day AND v.path = p.path
), 0)
"#
        .to_string(),
    ))
    .await?;

    conn.execute(Statement::from_string(
        DatabaseBackend::Postgres,
        r#"
UPDATE analytics_page_daily p
SET engaged_views = COALESCE((
  SELECT COUNT(*)::bigint
  FROM analytics_event_visitor e
  WHERE e.day = p.day
    AND e.path = p.path
    AND e.event_name = '__engage__'
), 0)
"#
        .to_string(),
    ))
    .await?;

    conn.execute(Statement::from_string(
        DatabaseBackend::Postgres,
        r#"
UPDATE analytics_event_daily e
SET unique_visitors = COALESCE((
  SELECT COUNT(*)::bigint
  FROM analytics_event_visitor v
  WHERE v.day = e.day
    AND v.event_name = e.event_name
    AND v.path = e.path
), 0)
"#
        .to_string(),
    ))
    .await?;

    conn.execute(Statement::from_string(
        DatabaseBackend::Postgres,
        r#"
UPDATE analytics_country_daily c
SET unique_visitors = COALESCE((
  SELECT COUNT(*)::bigint
  FROM analytics_country_visitor v
  WHERE v.day = c.day AND v.country_code = c.country_code
), 0)
"#
        .to_string(),
    ))
    .await?;

    Ok(())
}

fn normalize_import_path(path_raw: &str) -> Option<String> {
    if path_raw == SITE_PATH {
        Some(SITE_PATH.to_string())
    } else {
        normalize_path(path_raw)
    }
}

fn normalize_import_event_name(name_raw: &str) -> Option<String> {
    if name_raw == ENGAGE_MARKER {
        Some(ENGAGE_MARKER.to_string())
    } else {
        normalize_event_name(name_raw)
    }
}

fn normalize_import_event_path(path_raw: &str) -> Option<String> {
    if path_raw.is_empty() {
        Some(String::new())
    } else {
        normalize_path(path_raw)
    }
}

/// POST /api/analytics/import — restore or merge a backup (admin).
///
/// Entire import runs in one DB transaction (truncate + inserts + UV recompute).
/// On any database error the transaction is rolled back so replace never leaves
/// a half-wiped table set.
pub async fn import_analytics(
    crate::extract::Db(db): crate::extract::Db,
    Json(body): Json<AnalyticsImportBody>,
) -> (StatusCode, Json<Value>) {
    let format = body.format.as_deref().unwrap_or("").trim();
    if format != ANALYTICS_BACKUP_FORMAT {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "error": "invalid_format" })),
        );
    }
    let version = body.version.unwrap_or(0);
    if version == 0 || version > ANALYTICS_BACKUP_VERSION {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "error": "unsupported_version" })),
        );
    }

    if body.page_daily.len() > MAX_IMPORT_PAGE_DAILY
        || body.visitor_seen.len() > MAX_IMPORT_VISITOR_SEEN
        || body.event_daily.len() > MAX_IMPORT_EVENT_DAILY
        || body.event_visitor.len() > MAX_IMPORT_EVENT_VISITOR
        || body.referrer_daily.len() > MAX_IMPORT_REFERRER_DAILY
        || body.country_daily.len() > MAX_IMPORT_COUNTRY_DAILY
        || body.country_visitor.len() > MAX_IMPORT_COUNTRY_VISITOR
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "success": false, "error": "too_many_rows" })),
        );
    }

    let mode = body
        .mode
        .as_deref()
        .unwrap_or("replace")
        .trim()
        .to_ascii_lowercase();
    let replace = match mode.as_str() {
        "replace" => true,
        "merge" => false,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "success": false, "error": "invalid_mode" })),
            );
        }
    };

    let txn = match db.begin().await {
        Ok(t) => t,
        Err(e) => {
            tracing::warn!("analytics import begin failed: {}", e);
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": "db_error" })),
            );
        }
    };

    macro_rules! import_db_err {
        ($txn:expr, $e:expr) => {{
            tracing::warn!("analytics import failed: {}", $e);
            let _ = $txn.rollback().await;
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "success": false, "error": "db_error" })),
            );
        }};
    }

    if replace {
        if let Err(e) = txn
            .execute_unprepared(
                r#"
TRUNCATE analytics_page_daily,
         analytics_visitor_seen,
         analytics_event_daily,
         analytics_event_visitor,
         analytics_referrer_daily,
         analytics_country_daily,
         analytics_country_visitor
"#,
            )
            .await
        {
            import_db_err!(txn, e);
        }
    }

    let mut inserted = json!({
        "page_daily": 0u64,
        "visitor_seen": 0u64,
        "event_daily": 0u64,
        "event_visitor": 0u64,
        "referrer_daily": 0u64,
        "country_daily": 0u64,
        "country_visitor": 0u64,
    });
    let mut skipped: u64 = 0;

    for row in &body.page_daily {
        let Some(day) = row
            .get("day")
            .and_then(|v| v.as_str())
            .and_then(parse_day_str)
        else {
            skipped += 1;
            continue;
        };
        let path_raw = row.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let Some(path) = normalize_import_path(path_raw) else {
            skipped += 1;
            continue;
        };
        let Some(views) = i64_nonneg(row.get("views")) else {
            skipped += 1;
            continue;
        };
        // UV / engaged_views are recomputed after detail rows land; accept any
        // non-negative placeholder (including 0) from the backup file.
        let uv = i64_nonneg(row.get("unique_visitors")).unwrap_or(0);
        let eng = i64_nonneg(row.get("engagement_ms")).unwrap_or(0);
        let eng_v = i64_nonneg(row.get("engaged_views")).unwrap_or(0);

        // replace: write aggregates as given (UV fixed by recompute).
        // merge: only add views + engagement_ms — never sum UV / engaged_views.
        let sql = if replace {
            r#"
INSERT INTO analytics_page_daily (day, path, views, unique_visitors, engagement_ms, engaged_views)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (day, path) DO UPDATE SET
  views = EXCLUDED.views,
  unique_visitors = EXCLUDED.unique_visitors,
  engagement_ms = EXCLUDED.engagement_ms,
  engaged_views = EXCLUDED.engaged_views
"#
        } else {
            r#"
INSERT INTO analytics_page_daily (day, path, views, unique_visitors, engagement_ms, engaged_views)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (day, path) DO UPDATE SET
  views = analytics_page_daily.views + EXCLUDED.views,
  engagement_ms = analytics_page_daily.engagement_ms + EXCLUDED.engagement_ms
"#
        };
        match txn
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                [
                    SeaValue::from(day),
                    SeaValue::from(path),
                    SeaValue::from(views),
                    SeaValue::from(uv),
                    SeaValue::from(eng),
                    SeaValue::from(eng_v),
                ],
            ))
            .await
        {
            Ok(_) => {
                if let Some(n) = inserted.get_mut("page_daily") {
                    *n = json!(n.as_u64().unwrap_or(0) + 1);
                }
            }
            Err(e) => import_db_err!(txn, e),
        }
    }

    for row in &body.visitor_seen {
        let Some(day) = row
            .get("day")
            .and_then(|v| v.as_str())
            .and_then(parse_day_str)
        else {
            skipped += 1;
            continue;
        };
        let path_raw = row.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let Some(path) = normalize_import_path(path_raw) else {
            skipped += 1;
            continue;
        };
        let hash = row
            .get("visitor_hash")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !valid_visitor_hash(hash) {
            skipped += 1;
            continue;
        }
        match txn
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
INSERT INTO analytics_visitor_seen (day, path, visitor_hash, ordinal)
VALUES ($1, $2, $3, $4)
ON CONFLICT (day, path, visitor_hash) DO NOTHING
"#,
                [
                    SeaValue::from(day),
                    SeaValue::from(path),
                    SeaValue::from(hash.to_string()),
                    // 老备份没有 ordinal 字段 → 0（序号未知），不影响其余统计
                    SeaValue::from(i64_nonneg(row.get("ordinal")).unwrap_or(0)),
                ],
            ))
            .await
        {
            Ok(res) => {
                if res.rows_affected() > 0 {
                    if let Some(n) = inserted.get_mut("visitor_seen") {
                        *n = json!(n.as_u64().unwrap_or(0) + 1);
                    }
                }
            }
            Err(e) => import_db_err!(txn, e),
        }
    }

    for row in &body.event_daily {
        let Some(day) = row
            .get("day")
            .and_then(|v| v.as_str())
            .and_then(parse_day_str)
        else {
            skipped += 1;
            continue;
        };
        let name_raw = row.get("event_name").and_then(|v| v.as_str()).unwrap_or("");
        let Some(name) = normalize_import_event_name(name_raw) else {
            skipped += 1;
            continue;
        };
        let path_raw = row.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let Some(path) = normalize_import_event_path(path_raw) else {
            skipped += 1;
            continue;
        };
        let Some(count) = i64_nonneg(row.get("count")) else {
            skipped += 1;
            continue;
        };
        let uv = i64_nonneg(row.get("unique_visitors")).unwrap_or(0);
        let sql = if replace {
            r#"
INSERT INTO analytics_event_daily (day, event_name, path, count, unique_visitors)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (day, event_name, path) DO UPDATE SET
  count = EXCLUDED.count,
  unique_visitors = EXCLUDED.unique_visitors
"#
        } else {
            r#"
INSERT INTO analytics_event_daily (day, event_name, path, count, unique_visitors)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (day, event_name, path) DO UPDATE SET
  count = analytics_event_daily.count + EXCLUDED.count
"#
        };
        match txn
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                [
                    SeaValue::from(day),
                    SeaValue::from(name),
                    SeaValue::from(path),
                    SeaValue::from(count),
                    SeaValue::from(uv),
                ],
            ))
            .await
        {
            Ok(_) => {
                if let Some(n) = inserted.get_mut("event_daily") {
                    *n = json!(n.as_u64().unwrap_or(0) + 1);
                }
            }
            Err(e) => import_db_err!(txn, e),
        }
    }

    for row in &body.event_visitor {
        let Some(day) = row
            .get("day")
            .and_then(|v| v.as_str())
            .and_then(parse_day_str)
        else {
            skipped += 1;
            continue;
        };
        let name_raw = row.get("event_name").and_then(|v| v.as_str()).unwrap_or("");
        let Some(name) = normalize_import_event_name(name_raw) else {
            skipped += 1;
            continue;
        };
        let path_raw = row.get("path").and_then(|v| v.as_str()).unwrap_or("");
        let Some(path) = normalize_import_event_path(path_raw) else {
            skipped += 1;
            continue;
        };
        let hash = row
            .get("visitor_hash")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !valid_visitor_hash(hash) {
            skipped += 1;
            continue;
        }
        match txn
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
INSERT INTO analytics_event_visitor (day, event_name, path, visitor_hash)
VALUES ($1, $2, $3, $4)
ON CONFLICT (day, event_name, path, visitor_hash) DO NOTHING
"#,
                [
                    SeaValue::from(day),
                    SeaValue::from(name),
                    SeaValue::from(path),
                    SeaValue::from(hash.to_string()),
                ],
            ))
            .await
        {
            Ok(res) => {
                if res.rows_affected() > 0 {
                    if let Some(n) = inserted.get_mut("event_visitor") {
                        *n = json!(n.as_u64().unwrap_or(0) + 1);
                    }
                }
            }
            Err(e) => import_db_err!(txn, e),
        }
    }

    for row in &body.referrer_daily {
        let Some(day) = row
            .get("day")
            .and_then(|v| v.as_str())
            .and_then(parse_day_str)
        else {
            skipped += 1;
            continue;
        };
        let host_raw = row.get("host").and_then(|v| v.as_str()).unwrap_or("");
        let Some(host) = normalize_referrer_host(host_raw) else {
            skipped += 1;
            continue;
        };
        let Some(count) = i64_nonneg(row.get("count")) else {
            skipped += 1;
            continue;
        };
        let sql = if replace {
            r#"
INSERT INTO analytics_referrer_daily (day, host, count)
VALUES ($1, $2, $3)
ON CONFLICT (day, host) DO UPDATE SET count = EXCLUDED.count
"#
        } else {
            r#"
INSERT INTO analytics_referrer_daily (day, host, count)
VALUES ($1, $2, $3)
ON CONFLICT (day, host) DO UPDATE SET
  count = analytics_referrer_daily.count + EXCLUDED.count
"#
        };
        match txn
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                [
                    SeaValue::from(day),
                    SeaValue::from(host),
                    SeaValue::from(count),
                ],
            ))
            .await
        {
            Ok(_) => {
                if let Some(n) = inserted.get_mut("referrer_daily") {
                    *n = json!(n.as_u64().unwrap_or(0) + 1);
                }
            }
            Err(e) => import_db_err!(txn, e),
        }
    }

    for row in &body.country_daily {
        let Some(day) = row
            .get("day")
            .and_then(|v| v.as_str())
            .and_then(parse_day_str)
        else {
            skipped += 1;
            continue;
        };
        let code_raw = row
            .get("country_code")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let Some(code) = normalize_country_code(code_raw) else {
            skipped += 1;
            continue;
        };
        let name = row
            .get("country_name")
            .and_then(|v| v.as_str())
            .map(normalize_country_name)
            .unwrap_or_default();
        let Some(views) = i64_nonneg(row.get("views")) else {
            skipped += 1;
            continue;
        };
        // unique_visitors will be recomputed from country_visitor
        let sql = if replace {
            r#"
INSERT INTO analytics_country_daily (day, country_code, country_name, views, unique_visitors)
VALUES ($1, $2, $3, $4, 0)
ON CONFLICT (day, country_code) DO UPDATE SET
  views = EXCLUDED.views,
  country_name = CASE
    WHEN EXCLUDED.country_name <> '' THEN EXCLUDED.country_name
    ELSE analytics_country_daily.country_name
  END
"#
        } else {
            r#"
INSERT INTO analytics_country_daily (day, country_code, country_name, views, unique_visitors)
VALUES ($1, $2, $3, $4, 0)
ON CONFLICT (day, country_code) DO UPDATE SET
  views = analytics_country_daily.views + EXCLUDED.views,
  country_name = CASE
    WHEN EXCLUDED.country_name <> '' THEN EXCLUDED.country_name
    ELSE analytics_country_daily.country_name
  END
"#
        };
        match txn
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                sql,
                [
                    SeaValue::from(day),
                    SeaValue::from(code),
                    SeaValue::from(name),
                    SeaValue::from(views),
                ],
            ))
            .await
        {
            Ok(_) => {
                if let Some(n) = inserted.get_mut("country_daily") {
                    *n = json!(n.as_u64().unwrap_or(0) + 1);
                }
            }
            Err(e) => import_db_err!(txn, e),
        }
    }

    for row in &body.country_visitor {
        let Some(day) = row
            .get("day")
            .and_then(|v| v.as_str())
            .and_then(parse_day_str)
        else {
            skipped += 1;
            continue;
        };
        let code_raw = row
            .get("country_code")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let Some(code) = normalize_country_code(code_raw) else {
            skipped += 1;
            continue;
        };
        let hash = row
            .get("visitor_hash")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if !valid_visitor_hash(hash) {
            skipped += 1;
            continue;
        }
        match txn
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"
INSERT INTO analytics_country_visitor (day, country_code, visitor_hash)
VALUES ($1, $2, $3)
ON CONFLICT (day, country_code, visitor_hash) DO NOTHING
"#,
                [
                    SeaValue::from(day),
                    SeaValue::from(code),
                    SeaValue::from(hash.to_string()),
                ],
            ))
            .await
        {
            Ok(res) => {
                if res.rows_affected() > 0 {
                    if let Some(n) = inserted.get_mut("country_visitor") {
                        *n = json!(n.as_u64().unwrap_or(0) + 1);
                    }
                }
            }
            Err(e) => import_db_err!(txn, e),
        }
    }

    if let Err(e) = recompute_unique_metrics(&txn).await {
        import_db_err!(txn, e);
    }

    if let Err(e) = txn.commit().await {
        tracing::warn!("analytics import commit failed: {}", e);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "success": false, "error": "db_error" })),
        );
    }

    invalidate_summary_cache().await;

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "mode": if replace { "replace" } else { "merge" },
            "inserted": inserted,
            "skipped": skipped,
            "unique_recomputed": true,
        })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_root_and_known() {
        assert_eq!(normalize_path("/").as_deref(), Some("/"));
        assert_eq!(normalize_path("/library").as_deref(), Some("/library"));
        assert_eq!(
            normalize_path("/tapp/abc123?x=1").as_deref(),
            Some("/tapp/:id")
        );
    }

    #[test]
    fn rejects_empty() {
        assert!(normalize_path("").is_none());
    }

    #[test]
    fn vid_and_event() {
        assert!(is_valid_vid("0123456789abcdef"));
        assert!(!is_valid_vid("x"));
        assert_eq!(
            normalize_event_name("Login_Success").as_deref(),
            Some("login_success")
        );
        assert!(normalize_event_name("!!!").is_none());
        assert!(normalize_event_name("a").is_none());
        assert!(
            normalize_event_name("__engage__").is_none(),
            "reserved internal names rejected"
        );
        assert!(normalize_event_name("__custom").is_none());
    }

    #[test]
    fn parses_vid_from_query() {
        let uri = |s: &str| s.parse::<axum::http::Uri>().unwrap();
        assert_eq!(
            vid_from_query(&uri("/api/analytics/visitor?vid=0123456789abcdef")).as_deref(),
            Some("0123456789abcdef")
        );
        // 位置无关，且不会被前缀相同的键骗到
        assert_eq!(
            vid_from_query(&uri("/x?days=7&vid=abcdefghijklmnop&z=1")).as_deref(),
            Some("abcdefghijklmnop")
        );
        assert_eq!(vid_from_query(&uri("/x?myvid=nope")), None);
        assert_eq!(vid_from_query(&uri("/x")), None);
        assert_eq!(vid_from_query(&uri("/x?vid")), None);
        // 取到的值仍要过 is_valid_vid，垃圾输入会退回 ip+ua 指纹
        assert!(
            !is_valid_vid(&vid_from_query(&uri("/x?vid=short")).unwrap()),
            "too-short vid must not pass validation"
        );
    }

    #[test]
    fn visitor_hash_prefers_vid() {
        let a = resolve_visitor_hash(Some("0123456789abcdef01"), None, "Mozilla");
        let b = resolve_visitor_hash(
            Some("0123456789abcdef01"),
            Some("1.2.3.4".parse().unwrap()),
            "Other",
        );
        assert_eq!(a, b);
    }

    #[test]
    fn bots_detected() {
        assert!(is_bot_ua("Googlebot/2.1"));
        assert!(!is_bot_ua(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        ));
    }

    #[test]
    fn parse_day_str_accepts_iso_and_trims() {
        assert_eq!(
            parse_day_str("2026-07-30"),
            Some(NaiveDate::from_ymd_opt(2026, 7, 30).unwrap())
        );
        assert_eq!(
            parse_day_str("  2026-01-01  "),
            Some(NaiveDate::from_ymd_opt(2026, 1, 1).unwrap())
        );
        assert!(parse_day_str("").is_none());
        assert!(parse_day_str("2026/07/30").is_none());
        assert!(parse_day_str("not-a-date").is_none());
        assert!(parse_day_str("2026-13-01").is_none());
    }

    #[test]
    fn valid_visitor_hash_is_hex_length_bounded() {
        assert!(valid_visitor_hash("0123456789abcdef")); // 16 hex
        assert!(valid_visitor_hash(&"ab".repeat(16))); // 32 hex (sha16 style)
        assert!(!valid_visitor_hash("short"));
        assert!(!valid_visitor_hash("not-hex-zzzzzzzz"));
        assert!(!valid_visitor_hash(""));
        assert!(!valid_visitor_hash(&"a".repeat(65)));
    }

    #[test]
    fn i64_nonneg_accepts_json_numbers() {
        assert_eq!(i64_nonneg(Some(&json!(0))), Some(0));
        assert_eq!(i64_nonneg(Some(&json!(42))), Some(42));
        assert_eq!(i64_nonneg(Some(&json!(u64::MAX))), None); // doesn't fit i64
        assert!(i64_nonneg(Some(&json!(-1))).is_none());
        assert!(i64_nonneg(Some(&json!("1"))).is_none());
        assert!(i64_nonneg(None).is_none());
    }

    #[test]
    fn import_path_and_event_helpers() {
        assert_eq!(
            normalize_import_path(SITE_PATH).as_deref(),
            Some(SITE_PATH)
        );
        assert_eq!(
            normalize_import_path("/library").as_deref(),
            Some("/library")
        );
        assert!(normalize_import_path("relative").is_none());

        assert_eq!(
            normalize_import_event_name(ENGAGE_MARKER).as_deref(),
            Some(ENGAGE_MARKER)
        );
        assert_eq!(
            normalize_import_event_name("Login_OK").as_deref(),
            Some("login_ok")
        );
        assert!(normalize_import_event_name("!!").is_none());

        assert_eq!(normalize_import_event_path("").as_deref(), Some(""));
        assert_eq!(
            normalize_import_event_path("/tapp/xyz").as_deref(),
            Some("/tapp/:id")
        );
    }

    #[test]
    fn backup_format_constants_stable() {
        assert_eq!(ANALYTICS_BACKUP_FORMAT, "myriad-analytics-backup");
        assert_eq!(ANALYTICS_BACKUP_VERSION, 1);
    }
}
