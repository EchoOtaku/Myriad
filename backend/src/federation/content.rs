//! 联邦内容发布模块（Phase 2 — Layer 4）
//!
//! 将本地内容（Report / Brew / Library）发布为 AP Activity，
//! 自动推送给所有关注者。

use axum::{http::StatusCode, Json};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::federation::types::*;

// ==================== 请求/响应类型 ====================

/// 发布内容请求
#[derive(Debug, Deserialize)]
pub struct PublishRequest {
    /// 内容类型: report, brew-article, library
    pub content_type: String,
    /// 内容 ID（本地数据库 ID 或标识符）
    pub content_id: String,
    /// 可见性: public, followers, direct
    pub visibility: Option<String>,
}

/// 发布响应
#[derive(Debug, Serialize)]
pub struct PublishResponse {
    pub success: bool,
    pub activity_id: String,
    pub content_type: String,
    pub content_id: String,
    pub visibility: String,
}

/// 已发布内容列表项
#[derive(Debug, Serialize)]
pub struct PublishedItem {
    pub id: i32,
    pub content_type: String,
    pub content_id: String,
    pub activity_id: String,
    pub visibility: String,
    pub published_at: String,
}

// ==================== 核心发布功能 ====================

/// 发布本地内容到联邦网络
///
/// 1. 拉取本地内容详情
/// 2. 转换为 AP Note/Article 对象
/// 3. 创建 Create Activity
/// 4. 存入 federation_published_content
/// 5. 推送给所有 followers
pub async fn publish_content(
    user_id: i32,
    username: &str,
    db: &DatabaseConnection,
    req: &PublishRequest,
) -> Result<PublishResponse, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let visibility = req.visibility.as_deref().unwrap_or("public");

    // 检查是否已发布
    let existing = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT id FROM federation_published_content WHERE content_type = $1 AND content_id = $2",
            [req.content_type.clone().into(), req.content_id.clone().into()],
        ))
        .await
        .map_err(db_err)?;

    if existing.is_some() {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({"error": "Content already published"})),
        ));
    }

    // 获取内容为 AP 对象
    let ap_object = build_ap_object(
        db,
        user_id,
        username,
        &base_url,
        &req.content_type,
        &req.content_id,
        visibility,
    )
    .await?;

    // 生成 Activity
    let activity_id = generate_activity_id(&base_url);
    let local_actor = actor_url(&base_url, username);

    let (to, cc) = resolve_audience(visibility, &base_url, username);

    let activity_json = json!({
        "@context": build_ap_context(),
        "type": "Create",
        "id": &activity_id,
        "actor": &local_actor,
        "published": now_iso8601(),
        "to": to,
        "cc": cc,
        "object": ap_object,
    });

    // 存入 federation_activities
    let act_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_activities
                   (activity_id, user_id, activity_type, object_type, object_json, is_local, published_at)
               VALUES ($1, $2, 'Create', $3, $4, true, NOW())
               RETURNING id"#,
            [
                activity_id.clone().into(),
                user_id.into(),
                req.content_type.clone().into(),
                activity_json.clone().into(),
            ],
        ))
        .await
        .map_err(db_err)?;

    let act_db_id: i32 = act_row
        .map(|r| r.try_get("", "id").unwrap_or(0))
        .unwrap_or(0);

    // 存入 federation_published_content
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_published_content
               (user_id, content_type, content_id, activity_id, visibility, published_at)
           VALUES ($1, $2, $3, $4, $5, NOW())"#,
        [
            user_id.into(),
            req.content_type.clone().into(),
            req.content_id.clone().into(),
            activity_id.clone().into(),
            visibility.into(),
        ],
    ))
    .await
    .map_err(db_err)?;

    // 推送给所有 followers
    fan_out_to_followers(db, user_id, act_db_id, &activity_json).await?;

    tracing::info!(
        "📢 Published {} #{} as {} ({})",
        req.content_type,
        req.content_id,
        activity_id,
        visibility
    );

    Ok(PublishResponse {
        success: true,
        activity_id,
        content_type: req.content_type.clone(),
        content_id: req.content_id.clone(),
        visibility: visibility.to_string(),
    })
}

/// 取消发布（Delete Activity）
pub async fn unpublish_content(
    user_id: i32,
    username: &str,
    db: &DatabaseConnection,
    content_type: &str,
    content_id: &str,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;

    // 查找已发布记录
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT id, activity_id FROM federation_published_content WHERE user_id = $1 AND content_type = $2 AND content_id = $3",
            [user_id.into(), content_type.into(), content_id.into()],
        ))
        .await
        .map_err(db_err)?;

    let row = row.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Content not published"})),
        )
    })?;

    let pub_id: i32 = row.try_get("", "id").unwrap_or(0);
    let original_activity_id: String = row.try_get("", "activity_id").unwrap_or_default();

    // 创建 Delete Activity
    let delete_activity_id = generate_activity_id(&base_url);
    let local_actor = actor_url(&base_url, username);

    let delete_json = json!({
        "@context": build_ap_context(),
        "type": "Delete",
        "id": &delete_activity_id,
        "actor": &local_actor,
        "published": now_iso8601(),
        "to": [AP_PUBLIC],
        "object": &original_activity_id,
    });

    // 存 Delete Activity
    let del_row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_activities
                   (activity_id, user_id, activity_type, object_type, object_json, is_local, published_at)
               VALUES ($1, $2, 'Delete', $3, $4, true, NOW())
               RETURNING id"#,
            [
                delete_activity_id.clone().into(),
                user_id.into(),
                content_type.into(),
                delete_json.clone().into(),
            ],
        ))
        .await
        .map_err(db_err)?;

    let del_db_id: i32 = del_row
        .map(|r| r.try_get("", "id").unwrap_or(0))
        .unwrap_or(0);

    // 删除 published_content 记录
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "DELETE FROM federation_published_content WHERE id = $1",
        [pub_id.into()],
    ))
    .await
    .map_err(db_err)?;

    // 推送 Delete 给所有 followers
    fan_out_to_followers(db, user_id, del_db_id, &delete_json).await?;

    tracing::info!(
        "🗑️ Unpublished {} #{} (Delete: {})",
        content_type,
        content_id,
        delete_activity_id,
    );

    Ok(json!({
        "success": true,
        "delete_activity_id": delete_activity_id,
    }))
}

/// 获取用户已发布的内容列表
pub async fn list_published(
    user_id: i32,
    db: &DatabaseConnection,
) -> Result<Vec<PublishedItem>, (StatusCode, Json<serde_json::Value>)> {
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT id, content_type, content_id, activity_id, visibility, published_at
               FROM federation_published_content
               WHERE user_id = $1
               ORDER BY published_at DESC
               LIMIT 200"#,
            [user_id.into()],
        ))
        .await
        .map_err(db_err)?;

    let items = rows
        .iter()
        .map(|r| PublishedItem {
            id: r.try_get("", "id").unwrap_or(0),
            content_type: r.try_get("", "content_type").unwrap_or_default(),
            content_id: r.try_get("", "content_id").unwrap_or_default(),
            activity_id: r.try_get("", "activity_id").unwrap_or_default(),
            visibility: r.try_get("", "visibility").unwrap_or_default(),
            published_at: r
                .try_get::<chrono::DateTime<chrono::Utc>>("", "published_at")
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default(),
        })
        .collect();

    Ok(items)
}

// ==================== 内容 → AP 对象转换 ====================

/// 根据内容类型构建对应的 AP 对象
async fn build_ap_object(
    db: &DatabaseConnection,
    user_id: i32,
    username: &str,
    base_url: &str,
    content_type: &str,
    content_id: &str,
    visibility: &str,
) -> Result<serde_json::Value, (StatusCode, Json<serde_json::Value>)> {
    let local_actor = actor_url(base_url, username);
    let (to, cc) = resolve_audience(visibility, base_url, username);

    match content_type {
        "report" => {
            // 综合报告 → AP Article
            let report_id: i32 = content_id.parse().unwrap_or(0);
            let row = db
                .query_one(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    r#"SELECT id, platform, report, report_title, created_at
                       FROM platform_reports
                       WHERE id = $1 AND user_id = $2"#,
                    [report_id.into(), user_id.into()],
                ))
                .await
                .map_err(db_err)?
                .ok_or_else(|| not_found("Report not found"))?;

            let platform: String = row.try_get("", "platform").unwrap_or_default();
            let report_json: serde_json::Value = row.try_get("", "report").unwrap_or_default();
            let title: Option<String> = row.try_get("", "report_title").ok();

            let summary = if platform == "all" {
                title.unwrap_or_else(|| "综合分析报告".to_string())
            } else {
                format!("{} 平台报告", platform)
            };

            // 提取报告摘要作为 content
            let content_text = extract_report_summary(&report_json);

            Ok(json!({
                "type": "Article",
                "id": format!("{}/reports/{}", base_url, report_id),
                "attributedTo": &local_actor,
                "name": &summary,
                "content": &content_text,
                "mediaType": "text/html",
                "published": now_iso8601(),
                "to": to,
                "cc": cc,
                "mfp:contentType": "report",
                "mfp:contentId": content_id,
                "mfp:platform": &platform,
            }))
        }
        "brew-article" => {
            // Brew 文章 → AP Article
            let item_id: i32 = content_id.parse().unwrap_or(0);
            let row = db
                .query_one(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    r#"SELECT bi.id, bi.title, bi.content, bi.link, bi.author,
                              bs.name AS source_name
                       FROM brew_items bi
                       LEFT JOIN brew_sources bs ON bs.id = bi.source_id
                       WHERE bi.id = $1 AND bs.user_id = $2"#,
                    [item_id.into(), user_id.into()],
                ))
                .await
                .map_err(db_err)?
                .ok_or_else(|| not_found("Brew article not found"))?;

            let title: String = row.try_get("", "title").unwrap_or_default();
            let content_text: Option<String> = row.try_get("", "content").ok();
            let url: Option<String> = row.try_get("", "link").ok();
            let author: Option<String> = row.try_get("", "author").ok();
            let source_name: Option<String> = row.try_get("", "source_name").ok();

            let summary_text = content_text
                .as_deref()
                .unwrap_or("")
                .chars()
                .take(500)
                .collect::<String>();

            Ok(json!({
                "type": "Article",
                "id": format!("{}/brew/articles/{}", base_url, item_id),
                "attributedTo": &local_actor,
                "name": &title,
                "content": format!("<p>{}</p>", &summary_text),
                "mediaType": "text/html",
                "url": url,
                "published": now_iso8601(),
                "to": to,
                "cc": cc,
                "mfp:contentType": "brew-article",
                "mfp:contentId": content_id,
                "mfp:source": source_name,
                "mfp:author": author,
            }))
        }
        "library" => {
            // Library 条目 — library_items 表尚未创建，返回明确错误
            Err((
                StatusCode::NOT_IMPLEMENTED,
                Json(
                    json!({"error": "Library content publishing is not yet supported (library_items table not available)"}),
                ),
            ))
        }
        _ => Err((
            StatusCode::BAD_REQUEST,
            Json(json!({"error": format!("Unsupported content type: {}", content_type)})),
        )),
    }
}

// ==================== Fan-out 投递 ====================

/// 将 Activity 推送给所有关注者（fan-out on send）
async fn fan_out_to_followers(
    db: &DatabaseConnection,
    user_id: i32,
    activity_db_id: i32,
    _activity_json: &serde_json::Value,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    // 查询所有 incoming followers 的远程 inbox
    let followers = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT ra.inbox_url, ra.domain
               FROM federation_follows f
               JOIN federation_remote_actors ra ON ra.id = f.remote_actor_id
               WHERE f.user_id = $1 AND f.direction = 'incoming' AND f.status = 'accepted'"#,
            [user_id.into()],
        ))
        .await
        .map_err(db_err)?;

    for row in followers {
        let inbox: String = row.try_get("", "inbox_url").unwrap_or_default();
        let domain: String = row.try_get("", "domain").unwrap_or_default();

        if inbox.is_empty() {
            continue;
        }

        // 加入投递队列
        let _ = db
            .execute(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"INSERT INTO federation_delivery_queue
                       (activity_id, target_inbox, target_domain, status, created_at)
                   VALUES ($1, $2, $3, 'pending', NOW())"#,
                [activity_db_id.into(), inbox.into(), domain.into()],
            ))
            .await;
    }

    Ok(())
}

// ==================== 辅助函数 ====================

/// 解析观众列表
fn resolve_audience(
    visibility: &str,
    base_url: &str,
    username: &str,
) -> (Vec<String>, Vec<String>) {
    match visibility {
        "public" => (
            vec![AP_PUBLIC.to_string()],
            vec![followers_url(base_url, username)],
        ),
        "followers" => (vec![followers_url(base_url, username)], vec![]),
        _ => (vec![], vec![]),
    }
}

/// 从报告 JSON 中提取摘要
fn extract_report_summary(report_json: &serde_json::Value) -> String {
    // 尝试从综合分析中提取
    if let Some(analysis) = report_json.get("综合分析") {
        if let Some(profile) = analysis.get("总体画像").and_then(|v| v.as_str()) {
            return format!("<p>{}</p>", profile);
        }
        if let Some(content) = analysis.get("content") {
            if let Some(profile) = content.get("总体画像").and_then(|v| v.as_str()) {
                return format!("<p>{}</p>", profile);
            }
        }
    }
    // 尝试从单平台报告提取 summary
    if let Some(summary) = report_json.get("summary").and_then(|v| v.as_str()) {
        return format!("<p>{}</p>", summary);
    }
    // 回退
    "<p>数据分析报告</p>".to_string()
}

async fn get_base_url() -> String {
    let config = crate::GLOBAL_CONFIG.read().await;
    config
        .base_url
        .clone()
        .unwrap_or_else(|| format!("http://{}:{}", config.server_host, config.server_port))
}

fn not_found(msg: &str) -> (StatusCode, Json<serde_json::Value>) {
    (StatusCode::NOT_FOUND, Json(json!({"error": msg})))
}
