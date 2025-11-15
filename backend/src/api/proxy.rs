// 图片代理服务 - 用于处理Bilibili等平台的防盗链图片
use axum::{
    extract::{Path, Query},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rand::Rng;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

// 缓存结构
struct CacheEntry {
    data: Value,
    expires_at: Instant,
}

// 限流结构
struct RateLimiter {
    requests: HashMap<String, Vec<Instant>>,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            requests: HashMap::new(),
        }
    }

    // 检查是否允许请求（宽松策略：每分钟60次，每小时1000次）
    fn check_rate_limit(&mut self, key: &str) -> bool {
        let now = Instant::now();
        let one_minute_ago = now - Duration::from_secs(60);
        let one_hour_ago = now - Duration::from_secs(3600);

        // 清理过期的请求记录
        let times = self.requests.entry(key.to_string()).or_default();
        times.retain(|&t| t > one_hour_ago);

        // 检查限制
        let recent_count = times.iter().filter(|&&t| t > one_minute_ago).count();
        let hourly_count = times.len();

        if recent_count >= 60 || hourly_count >= 1000 {
            return false;
        }

        // 记录本次请求
        times.push(now);
        true
    }
}

// 全局缓存和限流器（使用 lazy_static 或 once_cell）
use once_cell::sync::Lazy;
static MUSIC_CACHE: Lazy<Arc<RwLock<HashMap<String, CacheEntry>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));
static RATE_LIMITER: Lazy<Arc<RwLock<RateLimiter>>> =
    Lazy::new(|| Arc::new(RwLock::new(RateLimiter::new())));

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

/// 代理网易云音乐歌单请求 - 参考Meting API的v6实现
pub async fn proxy_netease_playlist(Path(playlist_id): Path<String>) -> Response {
    let cache_key = format!("playlist:{}", playlist_id);

    // 检查限流
    {
        let mut limiter = RATE_LIMITER.write().await;
        if !limiter.check_rate_limit(&cache_key) {
            tracing::warn!("Rate limit exceeded for playlist: {}", playlist_id);
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(serde_json::json!({
                    "error": "Too many requests",
                    "message": "请求过于频繁，请稍后再试"
                })),
            )
                .into_response();
        }
    }

    // 检查缓存（歌单缓存1小时）
    {
        let cache = MUSIC_CACHE.read().await;
        if let Some(entry) = cache.get(&cache_key) {
            if entry.expires_at > Instant::now() {
                tracing::debug!("Cache hit for playlist: {}", playlist_id);
                return (
                    StatusCode::OK,
                    [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
                    Json(entry.data.clone()),
                )
                    .into_response();
            }
        }
    }

    // 生成随机设备ID (模拟Android设备)
    let device_id = generate_device_id();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();

    let client = reqwest::Client::builder()
        .user_agent(get_random_user_agent())
        .cookie_store(true)
        .build()
        .unwrap();

    let url = format!(
        "http://music.163.com/api/v6/playlist/detail?id={}&n=100000&s=0&t=0",
        playlist_id
    );

    // 优化的 IP 伪装：使用代理链格式
    let client_ip = get_random_china_ip();
    let proxy_ip = get_random_china_ip();
    let forwarded_for = format!("{}, {}", client_ip, proxy_ip);

    match client.get(&url)
        .header("Referer", "https://music.163.com/")
        .header("Origin", "https://music.163.com")
        .header("Accept", "*/*")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Connection", "keep-alive")
        .header("Cookie", format!("osver=android; appver=8.7.01; os=android; deviceId={}; channel=netease; requestId={}_{:04}; __remember_me=true", 
            device_id, timestamp, rand::random::<u16>() % 10000))
        // 优化的代理链伪装
        .header("X-Forwarded-For", forwarded_for)
        .header("X-Real-IP", client_ip)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            match resp.json::<Value>().await {
                Ok(data) => {
                    if let Some(code) = data.get("code").and_then(|c| c.as_i64()) {
                        if code != 200 {
                            tracing::warn!("Netease API returned error code {}: {:?}", code, data);
                        }
                    }

                    // 存入缓存
                    {
                        let mut cache = MUSIC_CACHE.write().await;
                        cache.insert(cache_key, CacheEntry {
                            data: data.clone(),
                            expires_at: Instant::now() + Duration::from_secs(3600), // 1小时
                        });
                    }

                    (
                        StatusCode::OK,
                        [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
                        Json(data)
                    ).into_response()
                },
                Err(e) => {
                    tracing::error!("Failed to parse Netease playlist (HTTP {}): {}", status, e);
                    (StatusCode::BAD_GATEWAY, "Failed to parse response").into_response()
                }
            }
        },
        Err(e) => {
            tracing::error!("Failed to fetch Netease playlist: {}", e);
            (StatusCode::BAD_GATEWAY, "Failed to fetch playlist").into_response()
        }
    }
}

/// 生成随机设备ID (模拟Android设备)
fn generate_device_id() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let bytes: Vec<u8> = (0..16).map(|_| rng.gen()).collect();
    bytes.iter().map(|b| format!("{:02X}", b)).collect()
}

/// 生成随机的中国大陆 IP 地址
/// 使用真实的中国电信/联通/移动的 IP 段，增强真实性
fn get_random_china_ip() -> String {
    let mut rng = rand::thread_rng();

    // 中国大陆主流运营商的真实 IP 段（部分示例）
    let china_ip_ranges = [
        // 中国电信
        ("58.20", 0..255, 0..255),
        ("58.21", 0..255, 0..255),
        ("58.22", 0..255, 0..255),
        ("59.41", 0..255, 0..255),
        ("60.12", 0..255, 0..255),
        ("60.13", 0..255, 0..255),
        ("61.128", 0..255, 0..255),
        ("61.129", 0..255, 0..255),
        ("116.21", 0..255, 0..255),
        ("116.22", 0..255, 0..255),
        ("116.23", 0..255, 0..255),
        ("218.4", 0..255, 0..255),
        ("218.5", 0..255, 0..255),
        ("218.6", 0..255, 0..255),
        // 中国联通
        ("112.24", 0..255, 0..255),
        ("112.25", 0..255, 0..255),
        ("112.26", 0..255, 0..255),
        ("112.27", 0..255, 0..255),
        ("113.12", 0..255, 0..255),
        ("113.13", 0..255, 0..255),
        ("124.160", 0..255, 0..255),
        ("124.161", 0..255, 0..255),
        ("221.192", 0..255, 0..255),
        ("221.193", 0..255, 0..255),
        // 中国移动
        ("111.13", 0..255, 0..255),
        ("111.19", 0..255, 0..255),
        ("111.20", 0..255, 0..255),
        ("111.40", 0..255, 0..255),
        ("117.131", 0..255, 0..255),
        ("117.132", 0..255, 0..255),
        ("117.136", 0..255, 0..255),
        ("223.64", 0..255, 0..255),
        ("223.72", 0..255, 0..255),
        ("223.73", 0..255, 0..255),
    ];

    let (prefix, range2, range3) = &china_ip_ranges[rng.gen_range(0..china_ip_ranges.len())];
    let third = rng.gen_range(range2.clone());
    let fourth = rng.gen_range(range3.clone());

    format!("{}.{}.{}", prefix, third, fourth)
}

/// 获取随机 User-Agent（模拟不同设备和浏览器）
/// 降低被识别为爬虫的风险
fn get_random_user_agent() -> &'static str {
    let mut rng = rand::thread_rng();
    let user_agents = [
        // Android + Chrome
        "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
        "Mozilla/5.0 (Linux; Android 11; M2007J3SC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36",
        // iOS + Safari
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
        // 网易云音乐官方客户端
        "Mozilla/5.0 (Linux; Android 11; M2007J3SC Build/RKQ1.200826.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/77.0.3865.120 MQQBrowser/6.2 TBS/045714 Mobile Safari/537.36 NeteaseMusic/8.7.01",
        "Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SD1A.210817.036; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0.4472.120 Mobile Safari/537.36 NeteaseMusic/8.8.50",
    ];

    user_agents[rng.gen_range(0..user_agents.len())]
}
/// 代理QQ音乐歌单请求
pub async fn proxy_qq_playlist(Path(playlist_id): Path<String>) -> Response {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .unwrap();

    let url = format!(
        "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid={}&g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0",
        playlist_id
    );

    match client
        .get(&url)
        .header("Referer", "https://y.qq.com/")
        .send()
        .await
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => (
                StatusCode::OK,
                [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
                Json(data),
            )
                .into_response(),
            Err(e) => {
                tracing::error!("Failed to parse QQ playlist: {}", e);
                (StatusCode::BAD_GATEWAY, "Failed to parse response").into_response()
            }
        },
        Err(e) => {
            tracing::error!("Failed to fetch QQ playlist: {}", e);
            (StatusCode::BAD_GATEWAY, "Failed to fetch playlist").into_response()
        }
    }
}

/// 代理网易云音乐歌词请求 - 参考Meting API的lyric实现
pub async fn proxy_netease_lyrics(Path(song_id): Path<String>) -> Response {
    let cache_key = format!("lyrics:{}", song_id);

    // 检查限流
    {
        let mut limiter = RATE_LIMITER.write().await;
        if !limiter.check_rate_limit(&cache_key) {
            return (
                StatusCode::TOO_MANY_REQUESTS,
                Json(serde_json::json!({"error": "Too many requests"})),
            )
                .into_response();
        }
    }

    // 检查缓存（歌词缓存24小时）
    {
        let cache = MUSIC_CACHE.read().await;
        if let Some(entry) = cache.get(&cache_key) {
            if entry.expires_at > Instant::now() {
                tracing::debug!("Cache hit for lyrics: {}", song_id);
                return (
                    StatusCode::OK,
                    [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
                    Json(entry.data.clone()),
                )
                    .into_response();
            }
        }
    }

    let device_id = generate_device_id();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let request_id = format!(
        "{}_{:04}",
        timestamp,
        rand::thread_rng().gen_range(0..10000)
    );

    let client = reqwest::Client::builder()
        .user_agent(get_random_user_agent())
        .build()
        .unwrap();

    let url = format!(
        "http://music.163.com/api/song/lyric?id={}&os=linux&lv=-1&kv=-1&tv=-1",
        song_id
    );

    // 优化的代理链伪装
    let client_ip = get_random_china_ip();
    let proxy_ip = get_random_china_ip();
    let forwarded_for = format!("{}, {}", client_ip, proxy_ip);

    match client
        .get(&url)
        .header("Referer", "https://music.163.com/")
        .header("Accept", "*/*")
        .header(
            "Cookie",
            format!(
            "osver=android; appver=8.7.01; os=android; deviceId={}; channel=netease; requestId={}",
            device_id, request_id
        ),
        )
        .header("X-Forwarded-For", forwarded_for)
        .header("X-Real-IP", client_ip)
        .send()
        .await
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => {
                // 存入缓存
                {
                    let mut cache = MUSIC_CACHE.write().await;
                    cache.insert(
                        cache_key,
                        CacheEntry {
                            data: data.clone(),
                            expires_at: Instant::now() + Duration::from_secs(86400), // 24小时
                        },
                    );
                }

                (
                    StatusCode::OK,
                    [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
                    Json(data),
                )
                    .into_response()
            }
            Err(e) => {
                tracing::error!("Failed to parse Netease lyrics for song {}: {}", song_id, e);
                (StatusCode::BAD_GATEWAY, "Failed to parse response").into_response()
            }
        },
        Err(e) => {
            tracing::error!("Failed to fetch Netease lyrics for song {}: {}", song_id, e);
            (StatusCode::BAD_GATEWAY, "Failed to fetch lyrics").into_response()
        }
    }
}

/// 代理QQ音乐歌词请求
pub async fn proxy_qq_lyrics(Path(song_mid): Path<String>) -> Response {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .unwrap();

    let url = format!(
        "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid={}&g_tk=5381&format=json&inCharset=utf8&outCharset=utf-8&nobase64=1",
        song_mid
    );

    match client
        .get(&url)
        .header("Referer", "https://y.qq.com/")
        .send()
        .await
    {
        Ok(resp) => match resp.json::<Value>().await {
            Ok(data) => (
                StatusCode::OK,
                [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
                Json(data),
            )
                .into_response(),
            Err(e) => {
                tracing::error!("Failed to parse QQ lyrics: {}", e);
                (StatusCode::BAD_GATEWAY, "Failed to parse response").into_response()
            }
        },
        Err(e) => {
            tracing::error!("Failed to fetch QQ lyrics: {}", e);
            (StatusCode::BAD_GATEWAY, "Failed to fetch lyrics").into_response()
        }
    }
}

/// 代理网易云音乐音频流 - 参考Meting API的enhance player url实现
pub async fn proxy_netease_audio(Path(song_id): Path<String>) -> Response {
    let cache_key = format!("audio:{}", song_id);

    // 检查限流（音频流限制更宽松）
    {
        let mut limiter = RATE_LIMITER.write().await;
        if !limiter.check_rate_limit(&cache_key) {
            return (StatusCode::TOO_MANY_REQUESTS, "Too many requests").into_response();
        }
    }

    let device_id = generate_device_id();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();

    let client = reqwest::Client::builder()
        .user_agent(get_random_user_agent())
        .cookie_store(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .unwrap();

    let url = format!(
        "http://music.163.com/api/song/enhance/player/url?ids=[{}]&br=320000",
        song_id
    );

    // 优化的代理链伪装
    let client_ip = get_random_china_ip();
    let proxy_ip = get_random_china_ip();
    let forwarded_for = format!("{}, {}", client_ip, proxy_ip);

    match client.get(&url)
        .header("Referer", "https://music.163.com/")
        .header("Origin", "https://music.163.com")
        .header("Accept", "*/*")
        .header("Accept-Language", "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7")
        .header("Connection", "keep-alive")
        .header("Cookie", format!("osver=android; appver=8.7.01; os=android; deviceId={}; channel=netease; requestId={}_{:04}; __remember_me=true", 
            device_id, timestamp, rand::random::<u16>() % 10000))
        .header("X-Forwarded-For", forwarded_for.clone())
        .header("X-Real-IP", client_ip.clone())
        .send()
        .await
    {
        Ok(resp) => {
            match resp.json::<Value>().await {
                Ok(data) => {
                    // 解析返回的音频URL
                    // 参考Meting API的urlDecode逻辑
                    let audio_url = data["data"].get(0)
                        .and_then(|item| {
                            // 优先使用uf.url字段(新格式)
                            if let Some(uf_url) = item.get("uf").and_then(|uf| uf["url"].as_str()) {
                                Some(uf_url)
                            } else {
                                // 回退到url字段(旧格式)
                                item["url"].as_str()
                            }
                        });

                    if let Some(audio_url) = audio_url {
                        if !audio_url.is_empty() && audio_url != "null" {
                            // 获取实际音频流（复用前面的IP伪装）
                            match client.get(audio_url)
                                .header("Referer", "https://music.163.com/")
                                .header("Range", "bytes=0-") // 支持断点续传
                                .header("X-Forwarded-For", forwarded_for)
                                .header("X-Real-IP", client_ip)
                                .send()
                                .await
                            {
                                Ok(audio_resp) => {
                                    let content_type = audio_resp
                                        .headers()
                                        .get(reqwest::header::CONTENT_TYPE)
                                        .and_then(|v| v.to_str().ok())
                                        .unwrap_or("audio/mpeg")
                                        .to_string();

                                    match audio_resp.bytes().await {
                                        Ok(audio_data) => (
                                            StatusCode::OK,
                                            [
                                                (header::CONTENT_TYPE, content_type),
                                                (header::CACHE_CONTROL, "public, max-age=3600".to_string()),
                                                (header::ACCESS_CONTROL_ALLOW_ORIGIN, "*".to_string()),
                                                (header::ACCEPT_RANGES, "bytes".to_string()),
                                            ],
                                            audio_data,
                                        ).into_response(),
                                        Err(e) => {
                                            tracing::error!("Failed to read audio data for song {}: {}", song_id, e);
                                            (StatusCode::BAD_GATEWAY, "Failed to read audio data").into_response()
                                        }
                                    }
                                },
                                Err(e) => {
                                    tracing::error!("Failed to fetch audio stream for song {}: {}", song_id, e);
                                    (StatusCode::BAD_GATEWAY, "Failed to fetch audio stream").into_response()
                                }
                            }
                        } else {
                            tracing::warn!("Empty or null audio URL for song {} (可能因版权或地理限制无法播放)", song_id);
                            (StatusCode::NOT_FOUND, "Audio not available (copyright or geo-restriction)").into_response()
                        }
                    } else {
                        tracing::warn!("No audio URL found for song {} (可能因版权或地理限制无法播放)", song_id);
                        (StatusCode::NOT_FOUND, "Audio not available (copyright or geo-restriction)").into_response()
                    }
                },
                Err(e) => {
                    tracing::error!("Failed to parse audio URL response for song {}: {}", song_id, e);
                    (StatusCode::BAD_GATEWAY, "Failed to parse response").into_response()
                }
            }
        },
        Err(e) => {
            tracing::error!("Failed to fetch audio URL for song {}: {}", song_id, e);
            (StatusCode::BAD_GATEWAY, "Failed to fetch audio URL").into_response()
        }
    }
}
