// 图片代理服务 - 用于处理Bilibili等平台的防盗链图片
use axum::{
    extract::{Path, Query},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use rand::Rng;
use serde::Deserialize;
use serde_json::{json, Value};
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
/// ⚠️ P2: This endpoint is public but has domain whitelist protection
/// Consider adding authentication if abuse is detected
pub async fn proxy_image(Query(params): Query<ImageProxyQuery>) -> Response {
    let url = params.url;

    // ✅ P2 安全增强：检查 URL 长度，防止恶意超长 URL
    if url.len() > 2048 {
        tracing::warn!("🚨 Rejected proxy request: URL too long ({})", url.len());
        return (StatusCode::BAD_REQUEST, "URL too long").into_response();
    }

    // ✅ 检查URL是否来自支持的域名（白名单保护）
    if !is_allowed_domain(&url) {
        tracing::warn!(
            "🚨 Rejected proxy request: Domain not whitelisted - {}",
            url
        );
        return (
            StatusCode::FORBIDDEN,
            "Only images from supported platforms are allowed",
        )
            .into_response();
    }

    // 创建HTTP客户端
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(10)) // ✅ 添加超时保护
        .build()
        .unwrap();

    // 根据域名设置适当的Referer
    let referer = get_referer_for_url(&url);

    // 发起请求
    let response = match client.get(&url).header("Referer", referer).send().await {
        Ok(resp) => resp,
        Err(e) => {
            tracing::error!("🚨 Image proxy failed - URL: {}, Error: {:?}", url, e);
            // 区分不同类型的错误
            if e.is_timeout() {
                tracing::error!("   ⏱️  Timeout: Image request exceeded 10s limit");
                return (StatusCode::GATEWAY_TIMEOUT, "Image request timeout").into_response();
            } else if e.is_connect() {
                tracing::error!("   🔌 Connection failed: Cannot reach image server");
                return (StatusCode::BAD_GATEWAY, "Cannot connect to image server").into_response();
            } else {
                tracing::error!("   ❌ Unknown error: {:?}", e);
                return (StatusCode::BAD_GATEWAY, "Failed to fetch image").into_response();
            }
        }
    };

    // 获取内容类型
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    // ✅ P2 安全增强：验证是否为图片类型
    if !content_type.starts_with("image/") {
        tracing::warn!("🚨 Rejected proxy request: Not an image ({})", content_type);
        return (StatusCode::BAD_REQUEST, "Only image content is allowed").into_response();
    }

    // 获取图片数据，限制大小为 10MB
    let image_data = match response.bytes().await {
        Ok(data) => {
            // ✅ P2 安全增强：限制图片大小，防止内存耗尽
            if data.len() > 10 * 1024 * 1024 {
                tracing::warn!(
                    "🚨 Rejected proxy request: Image too large ({} bytes)",
                    data.len()
                );
                return (
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "Image size exceeds 10MB limit",
                )
                    .into_response();
            }
            data
        }
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

/// 将音乐数据中的 HTTP 图片 URL 转换为 HTTPS
/// 递归处理 JSON 对象和数组，避免 Mixed Content 警告
fn convert_http_to_https(value: &mut Value) {
    match value {
        Value::String(s) => {
            // 将网易云音乐 CDN 的 HTTP 链接替换为 HTTPS
            if s.starts_with("http://")
                && (s.contains("music.126.net") || s.contains("music.163.com"))
            {
                *s = s.replace("http://", "https://");
            }
        }
        Value::Array(arr) => {
            for item in arr {
                convert_http_to_https(item);
            }
        }
        Value::Object(obj) => {
            for (_, v) in obj.iter_mut() {
                convert_http_to_https(v);
            }
        }
        _ => {}
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

    // 检查缓存（歌单缓存7天）
    {
        let cache = MUSIC_CACHE.read().await;
        if let Some(entry) = cache.get(&cache_key) {
            if entry.expires_at > Instant::now() {
                tracing::debug!("✅ Cache hit for playlist: {}", playlist_id);
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

    // 使用trackIds参数可以获取所有歌曲ID，即使超过1000首
    let url = format!(
        "https://music.163.com/api/v6/playlist/detail?id={}&n=1000&s=0&t=0",
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
        .header("X-Forwarded-For", forwarded_for.clone())
        .header("X-Real-IP", client_ip.clone())
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            match resp.json::<Value>().await {
                Ok(mut data) => {
                    if let Some(code) = data.get("code").and_then(|c| c.as_i64()) {
                        if code != 200 {
                            tracing::warn!("Netease API returned error code {}: {:?}", code, data);
                        }
                    }

                    // 将所有 HTTP 图片链接转换为 HTTPS，避免 Mixed Content 警告
                    convert_http_to_https(&mut data);

                    // 为每首歌添加VIP标记
                    if let Some(playlist) = data.get_mut("playlist") {
                        // 获取歌曲总数
                        let track_count = playlist.get("trackCount").and_then(|t| t.as_i64()).unwrap_or(0) as usize;

                        // 提前克隆trackIds以避免后续借用冲突
                        let track_ids = playlist.get("trackIds").and_then(|ids| ids.as_array()).cloned();

                        if let Some(tracks) = playlist.get_mut("tracks") {
                            if let Some(tracks_array) = tracks.as_array_mut() {
                                let loaded_tracks = tracks_array.len();
                                let mut vip_count = 0;
                                for track in tracks_array.iter_mut() {
                                    if let Some(fee) = track.get("fee").and_then(|f| f.as_i64()) {
                                        // fee字段说明：
                                        // 0 - 免费歌曲（完全免费）
                                        // 1 - VIP歌曲（必须会员才能播放）⚠️
                                        // 4 - 付费专辑（必须购买才能播放）⚠️
                                        // 8 - 非会员可播放低品质版本（可完整听，但音质受限）
                                        // 只有 fee=1 和 fee=4 才算真正的VIP歌曲（无法完整播放）
                                        let is_vip = fee == 1 || fee == 4;
                                        track.as_object_mut().unwrap().insert(
                                            "isVip".to_string(),
                                            json!(is_vip)
                                        );
                                        if is_vip {
                                            vip_count += 1;
                                        }
                                    } else {
                                        track.as_object_mut().unwrap().insert(
                                            "isVip".to_string(),
                                            json!(false)
                                        );
                                    }
                                }

                                // 🎵 突破1000首限制：如果歌单总数超过已加载数量，使用trackIds继续获取
                                if track_count > loaded_tracks && loaded_tracks >= 1000 {
                                    tracing::info!("🎵 歌单超过1000首 ({}/{}), 使用trackIds方式获取剩余歌曲...", loaded_tracks, track_count);

                                    // 使用之前克隆的trackIds
                                    if let Some(track_ids_array) = track_ids {
                                        tracing::info!("📋 trackIds总数: {}", track_ids_array.len());

                                        let mut all_tracks = tracks_array.clone();
                                        let batch_size = 200; // song/detail API单次限制约200首
                                        let mut offset = loaded_tracks; // 从已加载的位置继续

                                        while all_tracks.len() < track_ids_array.len() {
                                            let start_idx = offset;
                                            let end_idx = std::cmp::min(start_idx + batch_size, track_ids_array.len());

                                            if start_idx >= track_ids_array.len() {
                                                break;
                                            }

                                            let batch_num = (offset - loaded_tracks) / batch_size + 1;

                                            // 提取当前批次的ID列表
                                            let batch_ids: Vec<String> = track_ids_array[start_idx..end_idx]
                                                .iter()
                                                .filter_map(|id_obj| id_obj.get("id").and_then(|v| v.as_i64()).map(|n| n.to_string()))
                                                .collect();

                                            if batch_ids.is_empty() {
                                                tracing::warn!("⚠️ 批次 {} 没有有效的歌曲ID", batch_num);
                                                break;
                                            }

                                            tracing::debug!("📥 获取批次 {} ({}-{}/{} 首)", batch_num, start_idx, end_idx, track_ids_array.len());

                                            // 使用song/detail API批量获取歌曲信息
                                            let ids_str = batch_ids.join(",");
                                            let track_url = format!(
                                                "https://music.163.com/api/song/detail?ids=[{}]",
                                                ids_str
                                            );

                                            tracing::debug!("📦 请求URL: {}", &track_url[..std::cmp::min(150, track_url.len())]);

                                            // 添加小延迟避免请求过快
                                            tokio::time::sleep(Duration::from_millis(300)).await;

                                            match client.get(&track_url)
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
                                                Ok(resp) => match resp.json::<Value>().await {
                                                    Ok(batch_data) => {
                                                        if let Some(code) = batch_data.get("code").and_then(|c| c.as_i64()) {
                                                            if code != 200 {
                                                                tracing::error!("❌ 获取歌曲批次失败，错误码: {}, 响应: {:?}", code, batch_data);
                                                                break;
                                                            }
                                                        }

                                                        if let Some(songs) = batch_data.get("songs").and_then(|s| s.as_array()) {
                                                            // 为新获取的歌曲添加VIP标记
                                                            for mut song in songs.clone() {
                                                                if let Some(fee) = song.get("fee").and_then(|f| f.as_i64()) {
                                                                    let is_vip = fee == 1 || fee == 4;
                                                                    song.as_object_mut().unwrap().insert(
                                                                        "isVip".to_string(),
                                                                        json!(is_vip)
                                                                    );
                                                                    if is_vip {
                                                                        vip_count += 1;
                                                                    }
                                                                } else {
                                                                    song.as_object_mut().unwrap().insert(
                                                                        "isVip".to_string(),
                                                                        json!(false)
                                                                    );
                                                                }
                                                                all_tracks.push(song);
                                                            }

                                                            tracing::debug!("✅ 已累计获取 {} 首歌曲 (当前批次: {})", all_tracks.len(), songs.len());
                                                        } else {
                                                            tracing::warn!("⚠️ 响应中没有找到songs字段");
                                                            break;
                                                        }
                                                    },
                                                    Err(e) => {
                                                        tracing::error!("❌ 解析歌曲批次失败: {}", e);
                                                        break;
                                                    }
                                                },
                                                Err(e) => {
                                                    tracing::error!("❌ 请求歌曲批次失败: {}", e);
                                                    break;
                                                }
                                            }

                                            offset += batch_size;
                                        }

                                        // 更新歌曲列表
                                        *tracks_array = all_tracks;
                                        tracing::info!("✅ Playlist {} 完整加载: {} 首歌曲，{} 首VIP",
                                            playlist_id, tracks_array.len(), vip_count);
                                    } else {
                                        tracing::warn!("⚠️ 歌单中没有找到trackIds字段，无法突破1000首限制");
                                        tracing::info!("✅ Playlist {} 部分加载: {} 首歌曲 (总计{}首)，{} 首VIP",
                                            playlist_id, tracks_array.len(), track_count, vip_count);
                                    }
                                } else {
                                    tracing::info!("✅ Playlist {} 解析完成: {} 首歌曲，{} 首VIP",
                                        playlist_id, tracks_array.len(), vip_count);
                                }
                            }
                        }
                    }

                    // 存入缓存
                    {
                        let mut cache = MUSIC_CACHE.write().await;
                        cache.insert(cache_key, CacheEntry {
                            data: data.clone(),
                            expires_at: Instant::now() + Duration::from_secs(604800), // 7天 (7*24*3600)
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
/// 代理QQ音乐歌单请求（带缓存）
pub async fn proxy_qq_playlist(Path(playlist_id): Path<String>) -> Response {
    let cache_key = format!("qq_playlist:{}", playlist_id);

    // 检查限流
    {
        let mut limiter = RATE_LIMITER.write().await;
        if !limiter.check_rate_limit(&cache_key) {
            tracing::warn!("Rate limit exceeded for QQ playlist: {}", playlist_id);
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
    // ⚠️ 临时禁用缓存以确保包含新的isVip字段
    let use_cache = false;
    if use_cache {
        let cache = MUSIC_CACHE.read().await;
        if let Some(entry) = cache.get(&cache_key) {
            if entry.expires_at > Instant::now() {
                tracing::debug!("Cache hit for QQ playlist: {}", playlist_id);
                return (
                    StatusCode::OK,
                    [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
                    Json(entry.data.clone()),
                )
                    .into_response();
            }
        }
    }

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
            Ok(mut data) => {
                // 为QQ音乐歌曲添加VIP标记（QQ音乐通常不区分VIP，都可播放）
                if let Some(cdlist) = data.get_mut("cdlist") {
                    if let Some(cdlist_array) = cdlist.as_array_mut() {
                        for cd in cdlist_array.iter_mut() {
                            if let Some(songlist) = cd.get_mut("songlist") {
                                if let Some(songlist_array) = songlist.as_array_mut() {
                                    for song in songlist_array.iter_mut() {
                                        // QQ音乐大部分歌曲免费，标记为非VIP
                                        song.as_object_mut()
                                            .unwrap()
                                            .insert("isVip".to_string(), json!(false));
                                    }
                                }
                            }
                        }
                    }
                }

                // 存入缓存
                {
                    let mut cache = MUSIC_CACHE.write().await;
                    cache.insert(
                        cache_key,
                        CacheEntry {
                            data: data.clone(),
                            expires_at: Instant::now() + Duration::from_secs(604800), // 7天 (7*24*3600)
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
        "https://music.163.com/api/song/lyric?id={}&os=linux&lv=-1&kv=-1&tv=-1",
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
            Ok(mut data) => {
                // 将所有 HTTP 图片链接转换为 HTTPS
                convert_http_to_https(&mut data);

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

/// 获取客户端真实 IP 地理位置信息
/// GET /api/proxy/client-geo
///
/// 这个端点会自动处理以下情况：
/// 1. 从请求头中提取客户端真实IP（支持反向代理）
/// 2. 如果是本地/内网IP，则查询服务器的公网IP位置
/// 3. 使用可靠的地理位置API获取坐标信息
pub async fn get_client_geo(
    headers: axum::http::HeaderMap,
    axum::extract::ConnectInfo(addr): axum::extract::ConnectInfo<std::net::SocketAddr>,
) -> Response {
    // 优先从请求头获取真实IP（处理反向代理的情况）
    let client_ip = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(',').next())
        .map(|s| s.trim().to_string())
        .or_else(|| {
            headers
                .get("x-real-ip")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| addr.ip().to_string());

    tracing::info!(
        "Client IP detection: original={}, socket={}",
        client_ip,
        addr.ip()
    );

    // 检查是否为本地IP/内网IP
    let is_local_ip = client_ip == "127.0.0.1"
        || client_ip == "::1"
        || client_ip.starts_with("192.168.")
        || client_ip.starts_with("10.")
        || client_ip.starts_with("172.16.")
        || client_ip.starts_with("172.17.")
        || client_ip.starts_with("172.18.")
        || client_ip.starts_with("172.19.")
        || client_ip.starts_with("172.20.")
        || client_ip.starts_with("172.21.")
        || client_ip.starts_with("172.22.")
        || client_ip.starts_with("172.23.")
        || client_ip.starts_with("172.24.")
        || client_ip.starts_with("172.25.")
        || client_ip.starts_with("172.26.")
        || client_ip.starts_with("172.27.")
        || client_ip.starts_with("172.28.")
        || client_ip.starts_with("172.29.")
        || client_ip.starts_with("172.30.")
        || client_ip.starts_with("172.31.");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .unwrap();

    // 如果是本地IP，需要获取服务器的公网IP，然后查询位置
    let target_ip = if is_local_ip {
        tracing::info!(
            "Detected local/private IP: {}, fetching server public IP",
            client_ip
        );

        // 方案1: 使用 ipify.org 获取服务器公网IP
        if let Ok(resp) = client.get("https://api.ipify.org?format=json").send().await {
            if let Ok(data) = resp.json::<Value>().await {
                if let Some(ip) = data.get("ip").and_then(|v| v.as_str()) {
                    tracing::info!("Server public IP from ipify: {}", ip);
                    ip.to_string()
                } else {
                    client_ip.clone()
                }
            } else {
                client_ip.clone()
            }
        } else {
            // 方案2: 使用 icanhazip.com
            if let Ok(resp) = client.get("https://icanhazip.com").send().await {
                if let Ok(text) = resp.text().await {
                    let ip = text.trim().to_string();
                    tracing::info!("Server public IP from icanhazip: {}", ip);
                    ip
                } else {
                    client_ip.clone()
                }
            } else {
                client_ip.clone()
            }
        }
    } else {
        client_ip.clone()
    };

    tracing::info!("Querying geolocation for IP: {}", target_ip);

    // 尝试多个地理位置服务，提高成功率

    // 方案1: ip-api.com (免费，稳定，无需key)
    let url1 = format!(
        "http://ip-api.com/json/{}?fields=status,lat,lon,city,country,regionName",
        target_ip
    );

    if let Ok(resp) = client.get(&url1).send().await {
        if let Ok(data) = resp.json::<Value>().await {
            if data.get("status").and_then(|s| s.as_str()) == Some("success") {
                tracing::info!(
                    "Geolocation success via ip-api.com for IP {}: city={}, region={}, country={}",
                    target_ip,
                    data.get("city")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown"),
                    data.get("regionName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown"),
                    data.get("country")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                );
                return (
                    StatusCode::OK,
                    [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
                    Json(data),
                )
                    .into_response();
            }
        }
    }

    // 方案2: ipapi.co (备用)
    let url2 = format!("https://ipapi.co/{}/json/", target_ip);

    if let Ok(resp) = client.get(&url2).send().await {
        if let Ok(data) = resp.json::<Value>().await {
            if let (Some(lat), Some(lon)) = (
                data.get("latitude").and_then(|v| v.as_f64()),
                data.get("longitude").and_then(|v| v.as_f64()),
            ) {
                // 转换为统一格式
                let unified_data = json!({
                    "status": "success",
                    "lat": lat,
                    "lon": lon,
                    "city": data.get("city").and_then(|v| v.as_str()).unwrap_or(""),
                    "country": data.get("country_name").and_then(|v| v.as_str()).unwrap_or(""),
                    "regionName": data.get("region").and_then(|v| v.as_str()).unwrap_or("")
                });

                tracing::info!(
                    "Geolocation success via ipapi.co for IP {}: city={}, country={}",
                    target_ip,
                    data.get("city")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown"),
                    data.get("country_name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                );

                return (
                    StatusCode::OK,
                    [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
                    Json(unified_data),
                )
                    .into_response();
            }
        }
    }

    // 方案3: geojs.io (第三备用)
    let url3 = format!("https://get.geojs.io/v1/ip/geo/{}.json", target_ip);

    if let Ok(resp) = client.get(&url3).send().await {
        if let Ok(data) = resp.json::<Value>().await {
            if let (Some(lat_str), Some(lon_str)) = (
                data.get("latitude").and_then(|v| v.as_str()),
                data.get("longitude").and_then(|v| v.as_str()),
            ) {
                if let (Ok(lat), Ok(lon)) = (lat_str.parse::<f64>(), lon_str.parse::<f64>()) {
                    // 转换为统一格式
                    let unified_data = json!({
                        "status": "success",
                        "lat": lat,
                        "lon": lon,
                        "city": data.get("city").and_then(|v| v.as_str()).unwrap_or(""),
                        "country": data.get("country").and_then(|v| v.as_str()).unwrap_or(""),
                        "regionName": data.get("region").and_then(|v| v.as_str()).unwrap_or("")
                    });

                    tracing::info!(
                        "Geolocation success via geojs.io for IP {}: city={}, country={}",
                        target_ip,
                        data.get("city")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown"),
                        data.get("country")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown")
                    );

                    return (
                        StatusCode::OK,
                        [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
                        Json(unified_data),
                    )
                        .into_response();
                }
            }
        }
    }

    // 所有方案都失败，返回错误
    tracing::error!("All geolocation services failed for IP: {}", target_ip);
    (
        StatusCode::SERVICE_UNAVAILABLE,
        "All geolocation services failed",
    )
        .into_response()
}

/// 代理QQ音乐歌词请求（带缓存）
pub async fn proxy_qq_lyrics(Path(song_mid): Path<String>) -> Response {
    let cache_key = format!("qq_lyrics:{}", song_mid);

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
                tracing::debug!("Cache hit for QQ lyrics: {}", song_mid);
                return (
                    StatusCode::OK,
                    [(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")],
                    Json(entry.data.clone()),
                )
                    .into_response();
            }
        }
    }

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
        "https://music.163.com/api/song/enhance/player/url?ids=[{}]&br=320000",
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
