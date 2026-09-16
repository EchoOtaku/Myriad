//! 公开申请友联；工作台订阅审核通过后才写入 phantasi_sources。

use axum::{
    Json,
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use std::net::SocketAddr;
use chrono::{Duration, Utc};
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, DatabaseConnection, EntityTrait,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect,
};
use serde::Deserialize;
use serde_json::json;

use crate::error::HttpError;
use crate::middleware::client_ip::{client_ip_from_parts, trusted_proxy_headers_enabled};
use crate::models::entities::{
    phantasi_source_applications::{self, ApplicationResponse, CreateApplicationRequest},
    phantasi_sources,
};
use crate::services::phantasi_scheduler::get_phantasi_scheduler;
use myriad_error::AppError;

use super::helpers::{
    get_admin_user_id_from_headers, get_optional_user_and_admin_status, normalize_http_url,
    phantasi_http_err, phantasi_store_http, url_match_key,
};

const FRIEND_CATEGORY: &str = "友情链接";
const MAX_NAME: usize = 120;
const MAX_URL: usize = 2048;
const MAX_DESC: usize = 500;
const MAX_MESSAGE: usize = 1000;
const MAX_APPLICANT: usize = 80;
const MAX_EMAIL: usize = 200;
const MAX_NOTE: usize = 500;
const RATE_WINDOW: Duration = Duration::hours(1);
const RATE_MAX: u64 = 8;
const LIST_LIMIT: u64 = 300;

fn trim_opt(value: Option<String>, max: usize) -> Result<Option<String>, HttpError> {
    let Some(raw) = value else {
        return Ok(None);
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > max {
        return Err(phantasi_http_err(
            StatusCode::BAD_REQUEST,
            "Field is too long",
        ));
    }
    Ok(Some(trimmed.to_string()))
}

fn require_text(value: &str, max: usize, empty: &str) -> Result<String, HttpError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(phantasi_http_err(StatusCode::BAD_REQUEST, empty));
    }
    if trimmed.chars().count() > max {
        return Err(phantasi_http_err(
            StatusCode::BAD_REQUEST,
            "Field is too long",
        ));
    }
    Ok(trimmed.to_string())
}

fn parse_public_url(raw: &str) -> Result<String, HttpError> {
    if raw.trim().chars().count() > MAX_URL {
        return Err(phantasi_http_err(
            StatusCode::BAD_REQUEST,
            "URL is too long",
        ));
    }
    normalize_http_url(raw)
        .map(|url| url.to_string())
        .map_err(|error| phantasi_http_err(StatusCode::BAD_REQUEST, error))
}

fn looks_like_email(raw: &str) -> bool {
    let Some((user, host)) = raw.split_once('@') else {
        return false;
    };
    !user.is_empty()
        && host.contains('.')
        && !host.starts_with('.')
        && !host.ends_with('.')
        && !host.contains(' ')
}

fn source_matches_key(source: &phantasi_sources::Model, key: &str) -> bool {
    url_match_key(&source.url) == key
        || source
            .site_url
            .as_deref()
            .is_some_and(|site| url_match_key(site) == key)
}

async fn find_existing_source(
    db: &DatabaseConnection,
    keys: &[String],
) -> Result<Option<phantasi_sources::Model>, HttpError> {
    let sources = phantasi_sources::Entity::find()
        .all(db)
        .await
        .map_err(|error| phantasi_store_http("find existing source", error))?;
    Ok(sources
        .into_iter()
        .find(|source| keys.iter().any(|key| source_matches_key(source, key))))
}

async fn find_pending_for_keys(
    db: &DatabaseConnection,
    keys: &[String],
) -> Result<Option<phantasi_source_applications::Model>, HttpError> {
    let rows = phantasi_source_applications::Entity::find()
        .filter(phantasi_source_applications::Column::Status.eq("pending"))
        .all(db)
        .await
        .map_err(|error| phantasi_store_http("find pending application", error))?;
    Ok(rows.into_iter().find(|row| {
        keys.iter().any(|key| {
            url_match_key(&row.site_url) == *key
                || row
                    .feed_url
                    .as_deref()
                    .is_some_and(|feed| url_match_key(feed) == *key)
        })
    }))
}

async fn create_friend_source(
    db: &DatabaseConnection,
    admin_id: i32,
    app: &phantasi_source_applications::Model,
) -> Result<phantasi_sources::Model, HttpError> {
    let now = Utc::now();
    let has_feed = app
        .feed_url
        .as_deref()
        .is_some_and(|url| !url.trim().is_empty());
    let source_type = if has_feed {
        phantasi_sources::SourceType::Rss
    } else {
        phantasi_sources::SourceType::Link
    };
    let url = if has_feed {
        app.feed_url.clone().unwrap_or_else(|| app.site_url.clone())
    } else {
        app.site_url.clone()
    };
    let new_source = phantasi_sources::ActiveModel {
        user_id: Set(admin_id),
        name: Set(app.site_name.clone()),
        url: Set(url),
        feed_type: Set(phantasi_sources::FeedType::Rss),
        source_type: Set(source_type.clone()),
        category: Set(Some(FRIEND_CATEGORY.to_string())),
        description: Set(app.description.clone()),
        site_url: Set(Some(app.site_url.clone())),
        update_interval: Set(if has_feed { 30 } else { 0 }),
        enabled: Set(true),
        error_count: Set(0),
        item_count: Set(0),
        unread_count: Set(0),
        admin_only: Set(false),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
        ..Default::default()
    };
    let source = new_source
        .insert(db)
        .await
        .map_err(|error| phantasi_store_http("save source", error))?;
    if source_type.is_fetchable() {
        if let Some(scheduler) = get_phantasi_scheduler() {
            let _ = scheduler.refresh_source(source.id).await;
        }
    }
    Ok(source)
}

/// 公开申请友联。可匿名；登录则记下申请人。
pub(crate) async fn create_application(
    State(db): State<DatabaseConnection>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<CreateApplicationRequest>,
) -> Result<Json<serde_json::Value>, HttpError> {
    let (user_id, _) = get_optional_user_and_admin_status(&headers, &db).await?;
    let site_name = require_text(&req.site_name, MAX_NAME, "Site name is required")?;
    let site_url = parse_public_url(&req.site_url)?;
    let feed_url = match trim_opt(req.feed_url, MAX_URL)? {
        Some(raw) => Some(parse_public_url(&raw)?),
        None => None,
    };
    let description = trim_opt(req.description, MAX_DESC)?;
    let message = trim_opt(req.message, MAX_MESSAGE)?;
    let applicant_name = trim_opt(req.applicant_name, MAX_APPLICANT)?;
    let applicant_email = match trim_opt(req.applicant_email, MAX_EMAIL)? {
        Some(email) if looks_like_email(&email) => Some(email),
        Some(_) => {
            return Err(phantasi_http_err(
                StatusCode::BAD_REQUEST,
                "Email looks invalid",
            ));
        }
        None => None,
    };

    let mut keys = vec![url_match_key(&site_url)];
    if let Some(feed) = feed_url.as_deref() {
        let key = url_match_key(feed);
        if !keys.contains(&key) {
            keys.push(key);
        }
    }

    if find_existing_source(&db, &keys).await?.is_some() {
        return Err(HttpError::from((
            StatusCode::CONFLICT,
            Json(AppError::fail_json("This site is already listed")),
        )));
    }
    if find_pending_for_keys(&db, &keys).await?.is_some() {
        return Err(HttpError::from((
            StatusCode::CONFLICT,
            Json(AppError::fail_json("An application is already pending")),
        )));
    }

    // 与 rate_limit 的 extract_client_ip 同一套：TCP peer + 可信代理头。
    // peer 不能是 None，否则 should_trust_proxy_headers 直接失败，限流和审计都空。
    let applicant_ip = client_ip_from_parts(
        &headers,
        Some(peer.ip()),
        trusted_proxy_headers_enabled(),
    )
    .map(|ip| ip.to_string());
    if let Some(ip) = applicant_ip.as_deref() {
        let since = Utc::now() - RATE_WINDOW;
        let recent = phantasi_source_applications::Entity::find()
            .filter(phantasi_source_applications::Column::ApplicantIp.eq(ip))
            .filter(phantasi_source_applications::Column::CreatedAt.gt(since))
            .count(&db)
            .await
            .map_err(|error| phantasi_store_http("count applications", error))?;
        if recent >= RATE_MAX {
            return Err(phantasi_http_err(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many applications. Try again later.",
            ));
        }
    }

    let now = Utc::now();
    let row = phantasi_source_applications::ActiveModel {
        kind: Set("friend".into()),
        status: Set("pending".into()),
        site_name: Set(site_name),
        site_url: Set(site_url),
        feed_url: Set(feed_url),
        description: Set(description),
        message: Set(message),
        applicant_name: Set(applicant_name),
        applicant_email: Set(applicant_email),
        applicant_user_id: Set(user_id),
        applicant_ip: Set(applicant_ip),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
        ..Default::default()
    }
    .insert(&db)
    .await
    .map_err(|error| phantasi_store_http("save application", error))?;

    let public = ApplicationResponse::from_model(row, false);
    Ok(Json(json!({
        "success": true,
        "application": {
            "id": public.id,
            "status": public.status,
        }
    })))
}

#[derive(Deserialize, Default)]
pub(crate) struct AdminApplicationsQuery {
    q: Option<String>,
    status: Option<String>,
}

/// 工作台订阅审核列表。仅站长。
pub(crate) async fn list_applications(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Query(query): Query<AdminApplicationsQuery>,
) -> Result<Json<serde_json::Value>, HttpError> {
    get_admin_user_id_from_headers(&headers, &db).await?;
    let mut rows = phantasi_source_applications::Entity::find()
        .order_by_desc(phantasi_source_applications::Column::CreatedAt)
        .limit(LIST_LIMIT)
        .all(&db)
        .await
        .map_err(|error| phantasi_store_http("list applications", error))?;

    if let Some(status) = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "all")
    {
        rows.retain(|row| row.status == status);
    }
    if let Some(needle) = query
        .q
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_ascii_lowercase())
    {
        rows.retain(|row| {
            [
                row.site_name.as_str(),
                row.site_url.as_str(),
                row.feed_url.as_deref().unwrap_or(""),
                row.description.as_deref().unwrap_or(""),
                row.message.as_deref().unwrap_or(""),
                row.applicant_name.as_deref().unwrap_or(""),
                row.applicant_email.as_deref().unwrap_or(""),
            ]
            .iter()
            .any(|field| field.to_ascii_lowercase().contains(&needle))
        });
    }

    rows.sort_by(|a, b| {
        status_rank(&a.status)
            .cmp(&status_rank(&b.status))
            .then(b.created_at.cmp(&a.created_at))
    });

    let applications: Vec<ApplicationResponse> = rows
        .into_iter()
        .map(|row| ApplicationResponse::from_model(row, true))
        .collect();
    Ok(Json(
        json!({ "success": true, "applications": applications }),
    ))
}

fn status_rank(status: &str) -> u8 {
    match status {
        "pending" => 0,
        "rejected" => 1,
        _ => 2,
    }
}

async fn load_application(
    db: &DatabaseConnection,
    id: i32,
) -> Result<phantasi_source_applications::Model, HttpError> {
    phantasi_source_applications::Entity::find_by_id(id)
        .one(db)
        .await
        .map_err(|error| phantasi_store_http("find application", error))?
        .ok_or_else(|| {
            HttpError::from((
                StatusCode::NOT_FOUND,
                Json(AppError::fail_json("Application not found")),
            ))
        })
}

/// 通过申请：有 RSS 建订阅，没有建入口型，分类都是友情链接。
pub(crate) async fn approve_application(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(id): Path<i32>,
    Json(req): Json<phantasi_source_applications::ReviewApplicationRequest>,
) -> Result<Json<serde_json::Value>, HttpError> {
    let admin_id = get_admin_user_id_from_headers(&headers, &db).await?;
    let app = load_application(&db, id).await?;
    if app.status != "pending" {
        return Err(phantasi_http_err(
            StatusCode::CONFLICT,
            "Application is not pending",
        ));
    }
    let review_note = trim_opt(req.review_note, MAX_NOTE)?;
    let mut keys = vec![url_match_key(&app.site_url)];
    if let Some(feed) = app.feed_url.as_deref() {
        let key = url_match_key(feed);
        if !keys.contains(&key) {
            keys.push(key);
        }
    }
    let source = match find_existing_source(&db, &keys).await? {
        Some(existing) => existing,
        None => create_friend_source(&db, admin_id, &app).await?,
    };
    let now = Utc::now();
    let mut active: phantasi_source_applications::ActiveModel = app.into();
    active.status = Set("approved".into());
    active.result_source_id = Set(Some(source.id));
    active.review_note = Set(review_note);
    active.reviewed_by = Set(Some(admin_id));
    active.reviewed_at = Set(Some(now.into()));
    active.updated_at = Set(now.into());
    let updated = active
        .update(&db)
        .await
        .map_err(|error| phantasi_store_http("approve application", error))?;
    let response: phantasi_sources::SourceResponse = source.into();
    Ok(Json(json!({
        "success": true,
        "application": ApplicationResponse::from_model(updated, true),
        "source": response,
    })))
}

pub(crate) async fn reject_application(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(id): Path<i32>,
    Json(req): Json<phantasi_source_applications::ReviewApplicationRequest>,
) -> Result<Json<serde_json::Value>, HttpError> {
    let admin_id = get_admin_user_id_from_headers(&headers, &db).await?;
    let app = load_application(&db, id).await?;
    if app.status != "pending" {
        return Err(phantasi_http_err(
            StatusCode::CONFLICT,
            "Application is not pending",
        ));
    }
    let review_note = trim_opt(req.review_note, MAX_NOTE)?;
    let now = Utc::now();
    let mut active: phantasi_source_applications::ActiveModel = app.into();
    active.status = Set("rejected".into());
    active.review_note = Set(review_note);
    active.reviewed_by = Set(Some(admin_id));
    active.reviewed_at = Set(Some(now.into()));
    active.updated_at = Set(now.into());
    let updated = active
        .update(&db)
        .await
        .map_err(|error| phantasi_store_http("reject application", error))?;
    Ok(Json(json!({
        "success": true,
        "application": ApplicationResponse::from_model(updated, true),
    })))
}

pub(crate) async fn delete_application(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, HttpError> {
    get_admin_user_id_from_headers(&headers, &db).await?;
    let result = phantasi_source_applications::Entity::delete_by_id(id)
        .exec(&db)
        .await
        .map_err(|error| phantasi_store_http("delete application", error))?;
    if result.rows_affected == 0 {
        return Err(HttpError::from((
            StatusCode::NOT_FOUND,
            Json(AppError::fail_json("Application not found")),
        )));
    }
    Ok(Json(json!({ "success": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_needs_user_and_host() {
        assert!(looks_like_email("hi@example.com"));
        assert!(!looks_like_email("nope"));
        assert!(!looks_like_email("@example.com"));
        assert!(!looks_like_email("hi@localhost"));
    }

    #[test]
    fn public_url_rejects_schemes_and_secrets() {
        assert!(parse_public_url("https://ok.example/blog").is_ok());
        assert!(parse_public_url("ok.example").is_ok());
        assert!(parse_public_url("javascript:alert(1)").is_err());
        assert!(parse_public_url("https://user:pass@ok.example").is_err());
    }

    #[test]
    fn review_routes_are_registered() {
        let src = include_str!("routes.rs");
        assert!(src.contains("/applications"));
        assert!(src.contains("/applications/{id}/approve"));
        assert!(src.contains("/applications/{id}/reject"));
        assert!(src.contains("applications::create_application"));
        assert!(src.contains("applications::list_applications"));
    }

    #[test]
    fn create_application_binds_tcp_peer() {
        let src = include_str!("applications.rs");
        let handler = src.split("#[cfg(test)]").next().expect("handler");
        assert!(handler.contains("ConnectInfo(peer)"));
        assert!(handler.contains("Some(peer.ip())"));
        assert!(!handler.contains(", None, trusted_proxy_headers_enabled()"));
    }

    #[test]
    fn rate_limit_needs_tcp_peer() {
        use crate::middleware::client_ip::client_ip_from_parts_with_allowlist;
        let headers = HeaderMap::new();
        assert_eq!(
            client_ip_from_parts_with_allowlist(&headers, None, true, &[]),
            None
        );
        let peer = "203.0.113.9".parse().unwrap();
        assert_eq!(
            client_ip_from_parts_with_allowlist(&headers, Some(peer), false, &[]),
            Some(peer)
        );
    }
}
