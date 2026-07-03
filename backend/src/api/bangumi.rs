// Bangumi API routes
use axum::{
    extract::{Path, Query},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::services::fetcher::PlatformFetcher;

#[derive(Debug, Deserialize)]
pub struct BangumiQuery {
    pub username: Option<String>,
    pub access_token: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BangumiCollectionsQuery {
    pub access_token: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct BangumiUserResponse {
    pub user_info: serde_json::Value,
    pub collections: Vec<serde_json::Value>,
    pub total_collections: usize,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub message: String,
}

fn clean_optional(input: Option<String>) -> Option<String> {
    input
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn value_username(value: &serde_json::Value) -> Option<String> {
    value
        .get("username")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

/// 获取 Bangumi 用户完整信息。
///
/// `username` 可选；缺省时需要 `access_token`，并通过 `/v0/me` 解析用户名。
pub async fn get_bangumi_user(
    Query(params): Query<BangumiQuery>,
) -> Result<Json<ApiResponse<BangumiUserResponse>>, StatusCode> {
    let fetcher = PlatformFetcher::new().await;
    let username = clean_optional(params.username);
    let access_token = clean_optional(params.access_token);
    let user_agent = clean_optional(params.user_agent);

    let user_result = if let Some(username) = username.as_deref() {
        fetcher
            .fetch_bangumi_user(username, access_token.as_deref(), user_agent.as_deref())
            .await
    } else if let Some(access_token) = access_token.as_deref() {
        fetcher
            .fetch_bangumi_me(access_token, user_agent.as_deref())
            .await
    } else {
        return Ok(Json(ApiResponse {
            success: false,
            data: None,
            message: "username 或 access_token 至少需要提供一个".to_string(),
        }));
    };

    let user_info = match user_result {
        Ok(info) => info,
        Err(e) => {
            tracing::error!("Failed to fetch Bangumi user: {}", e);
            return Ok(Json(ApiResponse {
                success: false,
                data: None,
                message: format!("获取用户信息失败: {}", e),
            }));
        }
    };

    let resolved_username = value_username(&user_info).or(username);
    let collections = if let Some(username) = resolved_username.as_deref() {
        match fetcher
            .fetch_bangumi_collections(username, access_token.as_deref(), user_agent.as_deref())
            .await
        {
            Ok(items) => items,
            Err(e) => {
                tracing::warn!(
                    "Failed to fetch Bangumi collections for {}: {}",
                    username,
                    e
                );
                Vec::new()
            }
        }
    } else {
        tracing::warn!("Bangumi user response did not include username; collections skipped");
        Vec::new()
    };

    let total_collections = collections.len();
    Ok(Json(ApiResponse {
        success: true,
        data: Some(BangumiUserResponse {
            user_info,
            collections,
            total_collections,
        }),
        message: format!("获取成功，共 {} 个收藏", total_collections),
    }))
}

/// 获取 Bangumi 用户基本信息
pub async fn get_bangumi_user_info(
    Path(username): Path<String>,
    Query(params): Query<BangumiCollectionsQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    let fetcher = PlatformFetcher::new().await;
    let access_token = clean_optional(params.access_token);
    let user_agent = clean_optional(params.user_agent);

    match fetcher
        .fetch_bangumi_user(&username, access_token.as_deref(), user_agent.as_deref())
        .await
    {
        Ok(info) => Ok(Json(ApiResponse {
            success: true,
            data: Some(info),
            message: "获取成功".to_string(),
        })),
        Err(e) => {
            tracing::error!("Failed to fetch Bangumi user {}: {}", username, e);
            Ok(Json(ApiResponse {
                success: false,
                data: None,
                message: format!("获取失败: {}", e),
            }))
        }
    }
}

/// 使用 access token 获取当前 Bangumi 用户信息
pub async fn get_bangumi_me(
    Query(params): Query<BangumiCollectionsQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    let fetcher = PlatformFetcher::new().await;
    let access_token = match clean_optional(params.access_token) {
        Some(token) => token,
        None => {
            return Ok(Json(ApiResponse {
                success: false,
                data: None,
                message: "access_token 是必填项".to_string(),
            }));
        }
    };
    let user_agent = clean_optional(params.user_agent);

    match fetcher
        .fetch_bangumi_me(&access_token, user_agent.as_deref())
        .await
    {
        Ok(info) => Ok(Json(ApiResponse {
            success: true,
            data: Some(info),
            message: "获取成功".to_string(),
        })),
        Err(e) => {
            tracing::error!("Failed to fetch Bangumi /me: {}", e);
            Ok(Json(ApiResponse {
                success: false,
                data: None,
                message: format!("获取失败: {}", e),
            }))
        }
    }
}

/// 获取 Bangumi 收藏列表
pub async fn get_bangumi_collections(
    Path(username): Path<String>,
    Query(params): Query<BangumiCollectionsQuery>,
) -> Result<Json<ApiResponse<Vec<serde_json::Value>>>, StatusCode> {
    let fetcher = PlatformFetcher::new().await;
    let access_token = clean_optional(params.access_token);
    let user_agent = clean_optional(params.user_agent);

    match fetcher
        .fetch_bangumi_collections(&username, access_token.as_deref(), user_agent.as_deref())
        .await
    {
        Ok(collections) => {
            let count = collections.len();
            Ok(Json(ApiResponse {
                success: true,
                data: Some(collections),
                message: format!("获取成功，共 {} 个收藏", count),
            }))
        }
        Err(e) => {
            tracing::error!(
                "Failed to fetch Bangumi collections for {}: {}",
                username,
                e
            );
            Ok(Json(ApiResponse {
                success: false,
                data: None,
                message: format!("获取失败: {}", e),
            }))
        }
    }
}
