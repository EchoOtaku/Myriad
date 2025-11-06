// 图片代理服务 - 用于处理Bilibili等平台的防盗链图片
use axum::{
    extract::Query,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct ImageProxyQuery {
    url: String,
}

/// 代理图片请求，添加必要的Referer头
pub async fn proxy_image(Query(params): Query<ImageProxyQuery>) -> Response {
    let url = params.url;

    // 检查URL是否来自支持的域名
    if !is_allowed_domain(&url) {
        return (
            StatusCode::FORBIDDEN,
            "Only images from supported platforms are allowed",
        )
            .into_response();
    }

    // 创建HTTP客户端
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .unwrap();

    // 根据域名设置适当的Referer
    let referer = get_referer_for_url(&url);

    // 发起请求
    let response = match client.get(&url).header("Referer", referer).send().await {
        Ok(resp) => resp,
        Err(e) => {
            tracing::error!("Failed to fetch image: {}", e);
            return (StatusCode::BAD_GATEWAY, "Failed to fetch image").into_response();
        }
    };

    // 获取内容类型
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    // 获取图片数据
    let image_data = match response.bytes().await {
        Ok(data) => data,
        Err(e) => {
            tracing::error!("Failed to read image data: {}", e);
            return (StatusCode::BAD_GATEWAY, "Failed to read image data").into_response();
        }
    };

    // 返回图片
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "public, max-age=86400".to_string()),
            (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
        ],
        image_data,
    )
        .into_response()
}

/// 检查URL是否来自允许的域名
fn is_allowed_domain(url: &str) -> bool {
    let allowed_domains = [
        "hdslb.com",                  // Bilibili CDN
        "bilibili.com",               // Bilibili
        "steamstatic.com",            // Steam CDN
        "cloudflare.steamstatic.com", // Steam Cloudflare CDN
        "music.126.net",              // 网易云音乐 CDN
    ];

    allowed_domains.iter().any(|domain| url.contains(domain))
}

/// 根据URL获取适当的Referer
fn get_referer_for_url(url: &str) -> &'static str {
    if url.contains("hdslb.com") || url.contains("bilibili.com") {
        "https://www.bilibili.com/"
    } else if url.contains("steamstatic.com") {
        "https://store.steampowered.com/"
    } else if url.contains("music.126.net") {
        "https://music.163.com/"
    } else {
        "https://www.google.com/"
    }
}
