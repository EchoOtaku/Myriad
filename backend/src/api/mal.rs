// MyAnimeList API routes
use axum::{
    extract::{Path, Query},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};

use crate::services::fetcher::PlatformFetcher;

#[derive(Debug, Deserialize)]
pub struct MalQuery {
    pub username: String,
    pub client_id: String,
}

#[derive(Debug, Deserialize)]
pub struct MalClientQuery {
    pub client_id: String,
}

#[derive(Debug, Serialize)]
pub struct MalUserResponse {
    pub user: serde_json::Value,
    pub anime_list: Vec<serde_json::Value>,
    pub manga_list: Vec<serde_json::Value>,
    pub total_anime: usize,
    pub total_manga: usize,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub message: String,
}

fn clean(input: &str) -> &str {
    input.trim()
}

/// 获取 MyAnimeList 用户完整信息（资料 + 动画/漫画列表）
pub async fn get_mal_user(
    Query(params): Query<MalQuery>,
) -> Result<Json<ApiResponse<MalUserResponse>>, StatusCode> {
    let username = clean(&params.username);
    let client_id = clean(&params.client_id);

    if username.is_empty() || client_id.is_empty() {
        return Ok(Json(ApiResponse {
            success: false,
            data: None,
            message: "username 和 client_id 均为必填".to_string(),
        }));
    }

    let fetcher = PlatformFetcher::new().await;
    match fetcher.fetch_mal_profile_bundle(username, client_id).await {
        Ok(bundle) => {
            let anime_list = bundle
                .get("anime_list")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let manga_list = bundle
                .get("manga_list")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let user = bundle.get("user").cloned().unwrap_or_default();
            let display = user
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(username)
                .to_string();

            Ok(Json(ApiResponse {
                success: true,
                data: Some(MalUserResponse {
                    total_anime: anime_list.len(),
                    total_manga: manga_list.len(),
                    anime_list,
                    manga_list,
                    user,
                }),
                message: format!(
                    "✓ MAL user '{}' verified ({})",
                    username, display
                ),
            }))
        }
        Err(e) => {
            tracing::error!("Failed to fetch MAL user {}: {}", username, e);
            Ok(Json(ApiResponse {
                success: false,
                data: None,
                message: format!("获取 MyAnimeList 用户失败: {}", e),
            }))
        }
    }
}

/// 仅验证用户名 + Client ID 是否有效
pub async fn get_mal_user_info(
    Path(username): Path<String>,
    Query(params): Query<MalClientQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    let username = clean(&username);
    let client_id = clean(&params.client_id);

    if username.is_empty() || client_id.is_empty() {
        return Ok(Json(ApiResponse {
            success: false,
            data: None,
            message: "username 和 client_id 均为必填".to_string(),
        }));
    }

    let fetcher = PlatformFetcher::new().await;
    match fetcher.fetch_mal_user(username, client_id).await {
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

/// 获取动画列表
pub async fn get_mal_anime_list(
    Path(username): Path<String>,
    Query(params): Query<MalClientQuery>,
) -> Result<Json<ApiResponse<Vec<serde_json::Value>>>, StatusCode> {
    let username = clean(&username);
    let client_id = clean(&params.client_id);

    if username.is_empty() || client_id.is_empty() {
        return Ok(Json(ApiResponse {
            success: false,
            data: None,
            message: "username 和 client_id 均为必填".to_string(),
        }));
    }

    let fetcher = PlatformFetcher::new().await;
    match fetcher.fetch_mal_anime_list(username, client_id).await {
        Ok(list) => {
            let count = list.len();
            Ok(Json(ApiResponse {
                success: true,
                data: Some(list),
                message: format!("获取成功，共 {} 部动画", count),
            }))
        }
        Err(e) => {
            tracing::error!("Failed to fetch MAL anime list for {}: {}", username, e);
            Ok(Json(ApiResponse {
                success: false,
                data: None,
                message: format!("获取失败: {}", e),
            }))
        }
    }
}

/// 获取漫画列表
pub async fn get_mal_manga_list(
    Path(username): Path<String>,
    Query(params): Query<MalClientQuery>,
) -> Result<Json<ApiResponse<Vec<serde_json::Value>>>, StatusCode> {
    let username = clean(&username);
    let client_id = clean(&params.client_id);

    if username.is_empty() || client_id.is_empty() {
        return Ok(Json(ApiResponse {
            success: false,
            data: None,
            message: "username 和 client_id 均为必填".to_string(),
        }));
    }

    let fetcher = PlatformFetcher::new().await;
    match fetcher.fetch_mal_manga_list(username, client_id).await {
        Ok(list) => {
            let count = list.len();
            Ok(Json(ApiResponse {
                success: true,
                data: Some(list),
                message: format!("获取成功，共 {} 部漫画", count),
            }))
        }
        Err(e) => {
            tracing::error!("Failed to fetch MAL manga list for {}: {}", username, e);
            Ok(Json(ApiResponse {
                success: false,
                data: None,
                message: format!("获取失败: {}", e),
            }))
        }
    }
}
