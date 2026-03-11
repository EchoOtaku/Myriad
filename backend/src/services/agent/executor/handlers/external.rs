//! 外部集成能力处理器
//!
//! 处理 http.fetch, hitokoto.get, weather.get 等外部 API 集成类能力

use super::HandlerContext;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::IpAddr;

/// 验证 URL 安全性，防止 SSRF 攻击
///
/// 仅允许 http/https scheme，屏蔽私有/保留 IP 段
fn validate_url_for_fetch(url_str: &str) -> Result<(), String> {
    let url = url::Url::parse(url_str).map_err(|e| format!("URL 格式无效: {}", e))?;

    // 只允许 http/https
    match url.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("不允许的 URL scheme: {}", scheme)),
    }

    // 必须有 host
    let host = url.host_str().ok_or("URL 缺少 host")?;

    // 禁止 localhost 及其变体
    let host_lower = host.to_lowercase();
    if host_lower == "localhost" || host_lower == "ip6-localhost" {
        return Err("不允许访问 localhost".to_string());
    }

    // 如果 host 是 IP 地址，检查是否为私有/保留段
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_or_reserved_ip(ip) {
            return Err(format!("不允许访问私有/保留 IP: {}", ip));
        }
    }

    Ok(())
}

/// 检查 IP 是否属于私有或保留地址段
fn is_private_or_reserved_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let octets = v4.octets();
            // 127.x.x.x — loopback
            octets[0] == 127
            // 10.x.x.x — RFC1918
            || octets[0] == 10
            // 172.16-31.x.x — RFC1918
            || (octets[0] == 172 && (16..=31).contains(&octets[1]))
            // 192.168.x.x — RFC1918
            || (octets[0] == 192 && octets[1] == 168)
            // 169.254.x.x — link-local
            || (octets[0] == 169 && octets[1] == 254)
            // 0.0.0.0
            || octets[0] == 0
            // 100.64-127.x.x — shared address (RFC6598)
            || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        }
        IpAddr::V6(v6) => {
            // ::1 — loopback
            v6.is_loopback()
            // fc00::/7 — unique local
            || (v6.segments()[0] & 0xfe00) == 0xfc00
            // fe80::/10 — link-local
            || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

/// 执行外部集成能力
pub async fn execute(
    capability_id: &str,
    params: &HashMap<String, Value>,
    _ctx: &HandlerContext<'_>,
) -> Result<Value, String> {
    match capability_id {
        "http.fetch" => execute_http_fetch(params).await,
        "hitokoto.get" => execute_hitokoto_get(params).await,
        "notion.query" => execute_notion_query(params).await,
        "bilibili.user" => execute_bilibili_user(params).await,
        "bilibili.video" => execute_bilibili_video(params).await,
        "steam.user" => execute_steam_user(params).await,
        "steam.game" => execute_steam_game(params).await,
        "proxy.image" => execute_proxy_image(params).await,
        "weather.get" => execute_weather_get(params).await,
        "netease.song" => execute_netease_song(params).await,
        "netease.playlist.detail" => execute_netease_playlist_detail(params).await,
        _ => Err(format!("Unknown external capability: {}", capability_id)),
    }
}

// ============================================================================
// HTTP 通用
// ============================================================================

async fn execute_http_fetch(params: &HashMap<String, Value>) -> Result<Value, String> {
    let url = params
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or("Missing URL parameter")?;

    // SSRF 防护：验证 URL scheme 并屏蔽私有 IP
    validate_url_for_fetch(url)?;

    let method = params
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("GET");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;
    let response = match method {
        "POST" => {
            let body = params.get("body").cloned().unwrap_or(json!({}));
            client
                .post(url)
                .json(&body)
                .send()
                .await
                .map_err(|e| format!("HTTP request failed: {}", e))?
        }
        _ => client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("HTTP request failed: {}", e))?,
    };

    let status = response.status().as_u16();
    // 限制响应体大小，防止 OOM
    let body_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    if body_bytes.len() > 10 * 1024 * 1024 {
        return Err("Response body exceeds 10MB limit".to_string());
    }
    let body = String::from_utf8_lossy(&body_bytes).to_string();

    let data: Value = serde_json::from_str(&body).unwrap_or(json!(body));

    Ok(json!({
        "status": status,
        "data": data
    }))
}

// ============================================================================
// 一言
// ============================================================================

async fn execute_hitokoto_get(params: &HashMap<String, Value>) -> Result<Value, String> {
    let hitokoto_type = params.get("type").and_then(|v| v.as_str());

    let url = match hitokoto_type {
        Some(t) => {
            let encoded = urlencoding::encode(t);
            format!("https://v1.hitokoto.cn/?c={}", encoded)
        }
        None => "https://v1.hitokoto.cn/".to_string(),
    };

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch hitokoto: {}", e))?;

    let data: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse hitokoto response: {}", e))?;

    Ok(json!({
        "content": data.get("hitokoto").and_then(|v| v.as_str()).unwrap_or(""),
        "from": data.get("from").and_then(|v| v.as_str()).unwrap_or(""),
        "from_who": data.get("from_who"),
        "type": data.get("type").and_then(|v| v.as_str()).unwrap_or("")
    }))
}

// ============================================================================
// Notion
// ============================================================================

async fn execute_notion_query(params: &HashMap<String, Value>) -> Result<Value, String> {
    let database_id = params.get("database_id").and_then(|v| v.as_str());
    let filter = params.get("filter").cloned();

    Ok(json!({
        "database_id": database_id,
        "filter": filter,
        "message": "Notion query requires API key configuration",
        "hint": "Configure NOTION_API_KEY in environment"
    }))
}

// ============================================================================
// Bilibili
// ============================================================================

async fn execute_bilibili_user(params: &HashMap<String, Value>) -> Result<Value, String> {
    let uid = params
        .get("uid")
        .and_then(|v| v.as_str())
        .ok_or("Missing uid parameter")?;

    let url = format!("https://api.bilibili.com/x/space/acc/info?mid={}", uid);
    let client = reqwest::Client::new();

    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Bilibili user: {}", e))?;

    let data: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if data.get("code").and_then(|v| v.as_i64()) == Some(0) {
        let user_data = data.get("data").cloned().unwrap_or(json!({}));
        Ok(json!({
            "uid": uid,
            "name": user_data.get("name"),
            "face": user_data.get("face"),
            "sign": user_data.get("sign"),
            "level": user_data.get("level"),
            "follower": user_data.get("follower"),
            "following": user_data.get("following")
        }))
    } else {
        Err(format!("Bilibili API error: {:?}", data.get("message")))
    }
}

async fn execute_bilibili_video(params: &HashMap<String, Value>) -> Result<Value, String> {
    let bvid = params.get("bvid").and_then(|v| v.as_str());
    let aid = params.get("aid").and_then(|v| v.as_i64());

    let url = if let Some(bvid) = bvid {
        format!("https://api.bilibili.com/x/web-interface/view?bvid={}", bvid)
    } else if let Some(aid) = aid {
        format!("https://api.bilibili.com/x/web-interface/view?aid={}", aid)
    } else {
        return Err("Missing bvid or aid parameter".to_string());
    };

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch Bilibili video: {}", e))?;

    let data: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if data.get("code").and_then(|v| v.as_i64()) == Some(0) {
        let video = data.get("data").cloned().unwrap_or(json!({}));
        Ok(json!({
            "bvid": video.get("bvid"),
            "aid": video.get("aid"),
            "title": video.get("title"),
            "desc": video.get("desc"),
            "pic": video.get("pic"),
            "owner": video.get("owner"),
            "stat": video.get("stat"),
            "duration": video.get("duration")
        }))
    } else {
        Err(format!("Bilibili API error: {:?}", data.get("message")))
    }
}

// ============================================================================
// Steam
// ============================================================================

async fn execute_steam_user(params: &HashMap<String, Value>) -> Result<Value, String> {
    let steam_id = params
        .get("steam_id")
        .and_then(|v| v.as_str())
        .ok_or("Missing steam_id parameter")?;

    // 尝试从缓存获取
    if let Ok(content) = tokio::fs::read_to_string("cache/platforms/steam_filtered.json").await {
        if let Ok(data) = serde_json::from_str::<Value>(&content) {
            return Ok(json!({
                "steam_id": steam_id,
                "cached_data": data,
                "source": "cache"
            }));
        }
    }

    Ok(json!({
        "steam_id": steam_id,
        "message": "Steam user query requires API key configuration",
        "hint": "Configure STEAM_API_KEY in environment"
    }))
}

// ============================================================================
// 图片代理
// ============================================================================

async fn execute_proxy_image(params: &HashMap<String, Value>) -> Result<Value, String> {
    let url = params
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or("Missing url parameter")?;
    let platform = params
        .get("platform")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    let encoded_url = urlencoding::encode(url);
    let proxy_url = format!("/api/proxy/image?url={}", encoded_url);

    Ok(json!({
        "originalUrl": url,
        "proxyUrl": proxy_url,
        "platform": platform,
        "message": "Use proxyUrl to fetch the image through our proxy"
    }))
}

// ============================================================================
// 天气
// ============================================================================

async fn execute_weather_get(params: &HashMap<String, Value>) -> Result<Value, String> {
    let city = params
        .get("city")
        .and_then(|v| v.as_str())
        .unwrap_or("北京");

    let url = format!("https://wttr.in/{}?format=j1", urlencoding::encode(city));
    let client = reqwest::Client::new();

    let response = client
        .get(&url)
        .header("User-Agent", "curl/7.68.0")
        .send()
        .await
        .map_err(|e| format!("Weather API error: {}", e))?;

    let data: Value = response
        .json()
        .await
        .map_err(|_| "Failed to parse weather data".to_string())?;

    let current = data
        .get("current_condition")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .ok_or("No current weather data")?;

    Ok(json!({
        "city": city,
        "temperature": current.get("temp_C").and_then(|v| v.as_str()),
        "feelsLike": current.get("FeelsLikeC").and_then(|v| v.as_str()),
        "humidity": current.get("humidity").and_then(|v| v.as_str()),
        "weather": current.get("weatherDesc")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.first())
            .and_then(|v| v.get("value"))
            .and_then(|v| v.as_str()),
        "windSpeed": current.get("windspeedKmph").and_then(|v| v.as_str()),
        "visibility": current.get("visibility").and_then(|v| v.as_str())
    }))
}

// ============================================================================
// 网易云音乐
// ============================================================================

async fn execute_netease_song(params: &HashMap<String, Value>) -> Result<Value, String> {
    let song_id = params
        .get("songId")
        .and_then(|v| v.as_i64())
        .ok_or("Missing songId")?;
    let include_lyrics = params
        .get("includeLyrics")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let url = format!("https://music.163.com/api/song/detail?ids=[{}]", song_id);
    let client = reqwest::Client::new();

    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0")
        .header("Referer", "https://music.163.com")
        .send()
        .await
        .map_err(|e| format!("Netease API error: {}", e))?;

    let data: Value = response
        .json()
        .await
        .map_err(|_| "Failed to fetch song details".to_string())?;

    let song = data
        .get("songs")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .cloned()
        .unwrap_or(json!({}));

    let mut result = json!({
        "songId": song_id,
        "song": song
    });

    if include_lyrics {
        let lyrics_url = format!("https://music.163.com/api/song/lyric?id={}&lv=1", song_id);
        if let Ok(lyrics_resp) = client.get(&lyrics_url).send().await {
            if let Ok(lyrics_data) = lyrics_resp.json::<Value>().await {
                result["lyrics"] = lyrics_data
                    .get("lrc")
                    .and_then(|v| v.get("lyric"))
                    .cloned()
                    .unwrap_or(json!(""));
            }
        }
    }

    Ok(result)
}

async fn execute_netease_playlist_detail(params: &HashMap<String, Value>) -> Result<Value, String> {
    let playlist_id = params
        .get("playlistId")
        .and_then(|v| v.as_i64())
        .ok_or("Missing playlistId")?;

    let url = format!(
        "https://music.163.com/api/playlist/detail?id={}",
        playlist_id
    );
    let client = reqwest::Client::new();

    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0")
        .header("Referer", "https://music.163.com")
        .send()
        .await
        .map_err(|e| format!("Netease API error: {}", e))?;

    let data: Value = response
        .json()
        .await
        .map_err(|_| "Failed to fetch playlist details".to_string())?;

    let result = data.get("result").cloned().unwrap_or(json!({}));

    Ok(json!({
        "playlistId": playlist_id,
        "name": result.get("name"),
        "description": result.get("description"),
        "coverUrl": result.get("coverImgUrl"),
        "trackCount": result.get("trackCount"),
        "playCount": result.get("playCount"),
        "creator": result.get("creator").and_then(|c| c.get("nickname")),
        "tracks": result.get("tracks")
    }))
}

// ============================================================================
// Steam 游戏详情
// ============================================================================

/// Steam 游戏详情查询
async fn execute_steam_game(params: &HashMap<String, Value>) -> Result<Value, String> {
    let app_id = params
        .get("appId")
        .and_then(|v| v.as_i64())
        .ok_or("Missing appId")?;

    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}",
        app_id
    );
    let client = reqwest::Client::new();

    match client.get(&url).send().await {
        Ok(response) => {
            if let Ok(data) = response.json::<Value>().await {
                let app_data = data
                    .get(app_id.to_string())
                    .and_then(|v| v.get("data"))
                    .cloned()
                    .unwrap_or(json!({}));

                return Ok(json!({
                    "appId": app_id,
                    "name": app_data.get("name"),
                    "description": app_data.get("short_description"),
                    "developers": app_data.get("developers"),
                    "publishers": app_data.get("publishers"),
                    "genres": app_data.get("genres"),
                    "categories": app_data.get("categories"),
                    "headerImage": app_data.get("header_image"),
                    "price": app_data.get("price_overview"),
                    "releaseDate": app_data.get("release_date"),
                    "platforms": app_data.get("platforms"),
                    "metacritic": app_data.get("metacritic")
                }));
            }
            Err("Failed to fetch game details".to_string())
        }
        Err(e) => Err(format!("Steam API error: {}", e)),
    }
}
