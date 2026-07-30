//! YouTube Data API v3 routes (API key only — public channel data).
//!
//! No OAuth / `mine=true` / private playlists. Use settings config + profile
//! fetch for the full cache pipeline; these routes are for manual exercise.

use axum::{extract::Query, http::StatusCode, Json};
use serde::{Deserialize, Serialize};

use crate::services::fetcher::PlatformFetcher;

#[derive(Debug, Deserialize)]
pub struct YouTubeChannelQuery {
    pub api_key: String,
    /// UC… id, `@handle`, or bare handle
    pub channel_id: String,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub message: String,
}

/// GET /api/youtube/channel?api_key=…&channel_id=…
///
/// Resolve a public channel (snippet + statistics + contentDetails).
pub async fn get_youtube_channel(
    Query(params): Query<YouTubeChannelQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    let fetcher = PlatformFetcher::new().await;
    match fetcher
        .fetch_youtube_channel(&params.api_key, &params.channel_id)
        .await
    {
        Ok(channel) => Ok(Json(ApiResponse {
            success: true,
            data: Some(channel),
            message: "ok".to_string(),
        })),
        Err(e) => Ok(Json(ApiResponse {
            success: false,
            data: None,
            message: format!("{e}"),
        })),
    }
}

/// GET /api/youtube/bundle?api_key=…&channel_id=…
///
/// Full public bundle: channel + recent uploads (playlistItems) + video stats.
pub async fn get_youtube_bundle(
    Query(params): Query<YouTubeChannelQuery>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    let fetcher = PlatformFetcher::new().await;
    match fetcher
        .fetch_youtube_channel_bundle(&params.api_key, &params.channel_id)
        .await
    {
        Ok(bundle) => {
            let n = bundle
                .get("videos")
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            Ok(Json(ApiResponse {
                success: true,
                data: Some(bundle),
                message: format!("ok, {n} sample videos"),
            }))
        }
        Err(e) => Ok(Json(ApiResponse {
            success: false,
            data: None,
            message: format!("{e}"),
        })),
    }
}
