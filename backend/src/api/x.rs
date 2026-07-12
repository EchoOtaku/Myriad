// X (Twitter) API routes — 读数据 + Intent 分享（不走 OAuth / 不代发帖）
use axum::{extract::Query, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::services::fetcher::{
    build_x_intent_url, compose_x_share_text, PlatformFetcher, X_SHARE_DEFAULT_MAX_LEN,
};

#[derive(Debug, Deserialize)]
pub struct XQuery {
    pub username: String,
    pub bearer_token: String,
}

#[derive(Debug, Serialize)]
pub struct XUserResponse {
    pub user: serde_json::Value,
    pub tweets: Vec<serde_json::Value>,
    pub total_tweets: usize,
    pub following: Vec<serde_json::Value>,
    pub total_following: usize,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub message: String,
}

/// 获取 X 用户完整信息（资料 + 时间线）
pub async fn get_x_user(
    Query(params): Query<XQuery>,
) -> Result<Json<ApiResponse<XUserResponse>>, StatusCode> {
    let username = params.username.trim().trim_start_matches('@');
    let bearer_token = params.bearer_token.trim();

    if username.is_empty() || bearer_token.is_empty() {
        return Ok(Json(ApiResponse {
            success: false,
            data: None,
            message: "username 和 bearer_token 均为必填".to_string(),
        }));
    }

    let fetcher = PlatformFetcher::new().await;
    match fetcher.fetch_x_profile_bundle(username, bearer_token).await {
        Ok(bundle) => {
            let tweets = bundle
                .get("tweets")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let following = bundle
                .get("following")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let user = bundle.get("user").cloned().unwrap_or_default();
            let display = user
                .get("name")
                .and_then(|v| v.as_str())
                .or_else(|| user.get("username").and_then(|v| v.as_str()))
                .unwrap_or(username)
                .to_string();

            Ok(Json(ApiResponse {
                success: true,
                data: Some(XUserResponse {
                    total_tweets: tweets.len(),
                    tweets,
                    total_following: following.len(),
                    following,
                    user,
                }),
                message: format!("✓ X user @{} verified ({})", username, display),
            }))
        }
        Err(e) => {
            tracing::error!("Failed to fetch X user @{}: {}", username, e);
            Ok(Json(ApiResponse {
                success: false,
                data: None,
                message: format!("获取 X 用户失败: {}", e),
            }))
        }
    }
}

/// 仅验证用户名 + Bearer Token 是否有效
pub async fn get_x_user_info(
    Query(params): Query<XQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    let username = params.username.trim().trim_start_matches('@');
    let bearer_token = params.bearer_token.trim();

    if username.is_empty() || bearer_token.is_empty() {
        return Ok(Json(ApiResponse {
            success: false,
            data: None,
            message: "username 和 bearer_token 均为必填".to_string(),
        }));
    }

    let fetcher = PlatformFetcher::new().await;
    match fetcher
        .fetch_x_user_by_username(username, bearer_token)
        .await
    {
        Ok(user) => Ok(Json(ApiResponse {
            success: true,
            data: Some(user),
            message: "ok".to_string(),
        })),
        Err(e) => Ok(Json(ApiResponse {
            success: false,
            data: None,
            message: format!("验证失败: {}", e),
        })),
    }
}

// ==================== 分享到 X（仅 Intent，无 OAuth / 无代发帖） ====================

/// POST /api/x/share
///
/// 组装分享文案并返回 X Web Intent 链接。
/// 用户在浏览器打开链接后，用自己的 X 账号完成发布——站点不代发、不存用户 OAuth。
#[derive(Debug, Deserialize)]
pub struct ShareToXRequest {
    /// 直接指定正文（优先）
    pub text: Option<String>,
    /// 无 text 时：标题
    pub title: Option<String>,
    /// 无 text 时：摘要
    pub summary: Option<String>,
    /// 附带链接（会拼进正文，并用于 Intent url 参数）
    pub url: Option<String>,
    /// 话题标签（可不带 #）
    pub hashtags: Option<Vec<String>>,
    /// 正文最大长度，默认 280
    pub max_length: Option<usize>,
}

/// GET /api/x/share/status
pub async fn share_status() -> (StatusCode, Json<Value>) {
    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "mode": "intent",
            "can_intent": true,
            "can_post": false,
            "hint": "Share uses X Web Intent only. POST /api/x/share with text/title/summary/url; open intent_url in browser. No OAuth, no server-side posting.",
        })),
    )
}

/// POST /api/x/share — 生成 Intent 分享链接
pub async fn share_to_x(Json(req): Json<ShareToXRequest>) -> (StatusCode, Json<Value>) {
    let max_len = req.max_length.unwrap_or(X_SHARE_DEFAULT_MAX_LEN);
    let hashtags = req.hashtags.unwrap_or_default();
    let url = req
        .url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);

    let composed = compose_x_share_text(
        req.text.as_deref(),
        req.title.as_deref(),
        req.summary.as_deref(),
        url.as_deref(),
        &hashtags,
        max_len,
    );

    if composed.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "success": false,
                "message": "分享内容为空：请提供 text，或 title/summary",
            })),
        );
    }

    let intent_url = build_x_intent_url(&composed, url.as_deref());

    (
        StatusCode::OK,
        Json(json!({
            "success": true,
            "mode": "intent",
            "text": composed,
            "char_count": composed.chars().count(),
            "max_length": max_len,
            "intent_url": intent_url,
            "message": "已生成 X 分享链接，请在浏览器打开 intent_url 完成发布",
        })),
    )
}
