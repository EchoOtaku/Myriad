// 网易云音乐统一服务层
// 提供歌单获取、用户信息查询等功能，被 proxy API 和平台数据获取共享

use anyhow::{anyhow, Result};
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use super::netease_utils::{
    convert_http_to_https, generate_device_id, get_random_china_ip, get_random_user_agent,
};

// 缓存结构
pub struct CacheEntry {
    pub data: Value,
    pub expires_at: Instant,
}

// 限流结构
pub struct RateLimiter {
    requests: HashMap<String, Vec<Instant>>,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            requests: HashMap::new(),
        }
    }

    /// 检查是否允许请求（宽松策略：每分钟60次，每小时1000次）
    pub fn check_rate_limit(&mut self, key: &str) -> bool {
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

// 全局缓存和限流器
pub static MUSIC_CACHE: Lazy<Arc<RwLock<HashMap<String, CacheEntry>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));
pub static RATE_LIMITER: Lazy<Arc<RwLock<RateLimiter>>> =
    Lazy::new(|| Arc::new(RwLock::new(RateLimiter::new())));

/// 网易云音乐服务
pub struct NeteaseService {
    client: reqwest::Client,
}

impl NeteaseService {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .cookie_store(true)
                .build()
                .unwrap(),
        }
    }

    /// 获取歌单详情（核心方法，带缓存、限流、防封）
    /// 支持大歌单（1000+首）、VIP检测、HTTP→HTTPS转换
    pub async fn fetch_playlist(&self, playlist_id: i64, use_cache: bool) -> Result<Value> {
        let cache_key = format!("playlist:{}", playlist_id);

        // 检查限流
        {
            let mut limiter = RATE_LIMITER.write().await;
            if !limiter.check_rate_limit(&cache_key) {
                return Err(anyhow!("Rate limit exceeded for playlist {}", playlist_id));
            }
        }

        // 检查缓存（歌单缓存7天）
        if use_cache {
            let cache = MUSIC_CACHE.read().await;
            if let Some(entry) = cache.get(&cache_key) {
                if entry.expires_at > Instant::now() {
                    tracing::debug!("✅ Cache hit for playlist: {}", playlist_id);
                    return Ok(entry.data.clone());
                }
            }
        }

        // 生成随机设备ID和时间戳
        let device_id = generate_device_id();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        let url = format!(
            "https://music.163.com/api/v6/playlist/detail?id={}&n=1000&s=0&t=0",
            playlist_id
        );

        // IP 伪装
        let client_ip = get_random_china_ip();
        let proxy_ip = get_random_china_ip();
        let forwarded_for = format!("{}, {}", client_ip, proxy_ip);

        let response = self
            .client
            .get(&url)
            .header("User-Agent", get_random_user_agent())
            .header("Referer", "https://music.163.com/")
            .header("Origin", "https://music.163.com")
            .header("Accept", "*/*")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7")
            .header("Connection", "keep-alive")
            .header(
                "Cookie",
                format!(
                    "osver=android; appver=8.7.01; os=android; deviceId={}; channel=netease; requestId={}_{:04}; __remember_me=true",
                    device_id,
                    timestamp,
                    rand::random::<u16>() % 10000
                ),
            )
            .header("X-Forwarded-For", forwarded_for.clone())
            .header("X-Real-IP", client_ip.clone())
            .send()
            .await?;

        let mut data: Value = response.json().await?;

        // 检查返回码
        if let Some(code) = data.get("code").and_then(|c| c.as_i64()) {
            if code != 200 {
                return Err(anyhow!("Netease API returned error code {}", code));
            }
        }

        // 转换 HTTP 链接为 HTTPS
        convert_http_to_https(&mut data);

        // 处理 VIP 标记和大歌单
        if let Some(playlist) = data.get_mut("playlist") {
            let track_count = playlist
                .get("trackCount")
                .and_then(|t| t.as_i64())
                .unwrap_or(0) as usize;

            let track_ids = playlist
                .get("trackIds")
                .and_then(|ids| ids.as_array())
                .cloned();

            if let Some(tracks) = playlist.get_mut("tracks") {
                if let Some(tracks_array) = tracks.as_array_mut() {
                    let loaded_tracks = tracks_array.len();
                    let mut vip_count = 0;

                    // 为已加载的歌曲添加 VIP 标记
                    for track in tracks_array.iter_mut() {
                        if let Some(fee) = track.get("fee").and_then(|f| f.as_i64()) {
                            let is_vip = fee == 1 || fee == 4;
                            track
                                .as_object_mut()
                                .unwrap()
                                .insert("isVip".to_string(), json!(is_vip));
                            if is_vip {
                                vip_count += 1;
                            }
                        } else {
                            track
                                .as_object_mut()
                                .unwrap()
                                .insert("isVip".to_string(), json!(false));
                        }
                    }

                    // 处理大歌单（超过1000首）- 使用并发批量获取
                    if track_count > loaded_tracks && loaded_tracks >= 1000 {
                        tracing::info!(
                            "🎵 Large playlist detected ({}/{}), fetching remaining songs with concurrent batches...",
                            loaded_tracks,
                            track_count
                        );

                        if let Some(track_ids_array) = track_ids {
                            let mut all_tracks = tracks_array.clone();
                            let batch_size = 200; // 增大批次大小减少请求次数
                            let remaining_count = track_ids_array.len() - loaded_tracks;

                            tracing::info!(
                                "📦 Need to fetch {} more songs in batches of {}",
                                remaining_count,
                                batch_size
                            );

                            // 准备所有批次的ID
                            let mut batches = Vec::new();
                            let mut offset = loaded_tracks;

                            while offset < track_ids_array.len() {
                                let end_idx =
                                    std::cmp::min(offset + batch_size, track_ids_array.len());
                                let batch_ids: Vec<i64> = track_ids_array[offset..end_idx]
                                    .iter()
                                    .filter_map(|id_obj| id_obj.get("id").and_then(|v| v.as_i64()))
                                    .collect();

                                if !batch_ids.is_empty() {
                                    batches.push((offset, batch_ids));
                                }
                                offset = end_idx;
                            }

                            // 并发获取批次（每次并发3个批次，避免过度并发触发反爬）
                            let concurrent_limit = 3;
                            let total_batches = batches.len();

                            for (batch_idx, batch_chunk) in
                                batches.chunks(concurrent_limit).enumerate()
                            {
                                let mut tasks = Vec::new();

                                for (_, batch_ids) in batch_chunk {
                                    let ids_str = batch_ids
                                        .iter()
                                        .map(|id| id.to_string())
                                        .collect::<Vec<_>>()
                                        .join(",");
                                    let client = self.client.clone();
                                    let device_id = device_id.clone();
                                    let ts = timestamp;
                                    let forwarded_for = forwarded_for.clone();
                                    let client_ip = client_ip.clone();

                                    // 添加随机延迟避免同时发送
                                    let delay =
                                        ((batch_idx * 100) as u64) + (rand::random::<u64>() % 100);

                                    let task = tokio::spawn(async move {
                                        tokio::time::sleep(Duration::from_millis(delay)).await;

                                        let track_url = format!(
                                            "https://music.163.com/api/song/detail?ids=[{}]",
                                            ids_str
                                        );

                                        // 添加超时控制
                                        let request = client
                                            .get(&track_url)
                                            .header("Referer", "https://music.163.com/")
                                            .header("Origin", "https://music.163.com")
                                            .header("Accept", "*/*")
                                            .header("Accept-Language", "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7")
                                            .header("Connection", "keep-alive")
                                            .header(
                                                "Cookie",
                                                format!(
                                                    "osver=android; appver=8.7.01; os=android; deviceId={}; channel=netease; requestId={}_{:04}; __remember_me=true",
                                                    device_id,
                                                    ts,
                                                    rand::random::<u16>() % 10000
                                                ),
                                            )
                                            .header("X-Forwarded-For", forwarded_for.clone())
                                            .header("X-Real-IP", client_ip.clone())
                                            .timeout(Duration::from_secs(10));

                                        match request.send().await {
                                            Ok(resp) => match resp.json::<Value>().await {
                                                Ok(batch_data) => Ok(batch_data),
                                                Err(e) => {
                                                    tracing::warn!(
                                                        "Failed to parse batch response: {}",
                                                        e
                                                    );
                                                    Err(())
                                                }
                                            },
                                            Err(e) => {
                                                tracing::warn!("Failed to fetch batch: {}", e);
                                                Err(())
                                            }
                                        }
                                    });

                                    tasks.push(task);
                                }

                                // 等待当前批次的所有任务完成
                                let results = futures::future::join_all(tasks).await;

                                // 处理结果
                                for result in results {
                                    if let Ok(Ok(batch_data)) = result {
                                        if let Some(code) =
                                            batch_data.get("code").and_then(|c| c.as_i64())
                                        {
                                            if code != 200 {
                                                tracing::warn!(
                                                    "⚠️ Batch request returned error code: {}",
                                                    code
                                                );
                                                continue;
                                            }
                                        }

                                        if let Some(songs) =
                                            batch_data.get("songs").and_then(|s| s.as_array())
                                        {
                                            for mut song in songs.clone() {
                                                if let Some(fee) =
                                                    song.get("fee").and_then(|f| f.as_i64())
                                                {
                                                    let is_vip = fee == 1 || fee == 4;
                                                    song.as_object_mut()
                                                        .unwrap()
                                                        .insert("isVip".to_string(), json!(is_vip));
                                                    if is_vip {
                                                        vip_count += 1;
                                                    }
                                                } else {
                                                    song.as_object_mut()
                                                        .unwrap()
                                                        .insert("isVip".to_string(), json!(false));
                                                }
                                                all_tracks.push(song);
                                            }
                                        }
                                    }
                                }

                                // 批次完成日志
                                let progress = (batch_idx + 1) * concurrent_limit;
                                tracing::info!(
                                    "✓ Completed batch group {}/{} - Total songs collected: {}/{}",
                                    std::cmp::min(progress, total_batches),
                                    total_batches,
                                    all_tracks.len(),
                                    track_ids_array.len()
                                );
                            }

                            *tracks_array = all_tracks;
                            tracing::info!(
                                "✅ Playlist {} 完整加载: {} 首歌曲，{} 首VIP",
                                playlist_id,
                                tracks_array.len(),
                                vip_count
                            );
                        }
                    } else {
                        tracing::info!(
                            "✅ Playlist {} 解析完成: {} 首歌曲，{} 首VIP",
                            playlist_id,
                            tracks_array.len(),
                            vip_count
                        );
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
                    expires_at: Instant::now() + Duration::from_secs(604800), // 7天
                },
            );
        }

        Ok(data)
    }

    /// 获取用户"我喜欢的音乐"歌单ID
    pub async fn get_user_liked_playlist_id(&self, user_id: i64) -> Result<i64> {
        // 使用正确的API端点获取用户歌单列表
        let url = format!(
            "https://music.163.com/api/user/playlist?uid={}&limit=1&offset=0",
            user_id
        );

        let device_id = generate_device_id();
        let client_ip = get_random_china_ip();
        let forwarded_for = format!("{}, {}", client_ip, get_random_china_ip());

        let response: Value = self
            .client
            .get(&url)
            .header("User-Agent", get_random_user_agent())
            .header("Referer", "https://music.163.com/")
            .header("Origin", "https://music.163.com")
            .header("Accept", "*/*")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7")
            .header("Connection", "keep-alive")
            .header(
                "Cookie",
                format!(
                    "osver=android; appver=8.7.01; os=android; deviceId={}; channel=netease; __remember_me=true",
                    device_id
                ),
            )
            .header("X-Forwarded-For", forwarded_for.clone())
            .header("X-Real-IP", client_ip.clone())
            .send()
            .await?
            .json()
            .await?;

        // 网易云API返回code=200表示成功
        if response["code"].as_i64() != Some(200) {
            return Err(anyhow!(
                "Failed to fetch user playlists (code: {}): {}",
                response["code"],
                response["message"].as_str().unwrap_or("unknown error")
            ));
        }

        // 歌单列表在 playlist 字段中
        let playlists = response["playlist"]
            .as_array()
            .ok_or_else(|| anyhow!("Invalid response: no playlist field"))?;

        if playlists.is_empty() {
            return Err(anyhow!("User has no playlists"));
        }

        // 第一个歌单就是"我喜欢的音乐"
        playlists[0]["id"]
            .as_i64()
            .ok_or_else(|| anyhow!("Failed to get playlist ID"))
    }

    /// 获取用户喜欢的歌曲列表（平台数据专用）
    pub async fn fetch_user_liked_songs(&self, user_id: i64) -> Result<Vec<Value>> {
        // 1. 获取用户的第一个歌单 ID（"我喜欢的音乐"）
        let playlist_id = self.get_user_liked_playlist_id(user_id).await?;

        // 2. 获取歌单详情（复用完整的防封逻辑）
        let data = self.fetch_playlist(playlist_id, true).await?;

        // 3. 提取歌曲列表
        let tracks = data["playlist"]["tracks"]
            .as_array()
            .ok_or_else(|| anyhow!("Invalid playlist response: no tracks field"))?;

        Ok(tracks.clone())
    }

    /// 获取用户基本信息（用于验证）
    pub async fn fetch_user_info(&self, user_id: i64) -> Result<Value> {
        let url = format!("https://music.163.com/api/v1/user/detail/{}", user_id);

        let client_ip = get_random_china_ip();

        let response: Value = self
            .client
            .get(&url)
            .header("User-Agent", get_random_user_agent())
            .header("Referer", "https://music.163.com/")
            .header("X-Forwarded-For", client_ip)
            .send()
            .await?
            .json()
            .await?;

        if response["code"].as_i64() != Some(200) {
            return Err(anyhow!("Failed to fetch user info: Invalid user ID"));
        }

        Ok(response)
    }

    /// 获取歌词
    pub async fn fetch_lyrics(&self, song_id: i64) -> Result<Value> {
        let cache_key = format!("lyrics:{}", song_id);

        // 检查限流
        {
            let mut limiter = RATE_LIMITER.write().await;
            if !limiter.check_rate_limit(&cache_key) {
                return Err(anyhow!("Rate limit exceeded for lyrics {}", song_id));
            }
        }

        // 检查缓存
        {
            let cache = MUSIC_CACHE.read().await;
            if let Some(entry) = cache.get(&cache_key) {
                if entry.expires_at > Instant::now() {
                    return Ok(entry.data.clone());
                }
            }
        }

        let device_id = generate_device_id();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        let url = format!(
            "https://music.163.com/api/song/lyric?id={}&os=linux&lv=-1&kv=-1&tv=-1",
            song_id
        );

        let client_ip = get_random_china_ip();
        let proxy_ip = get_random_china_ip();
        let forwarded_for = format!("{}, {}", client_ip, proxy_ip);

        let response = self
            .client
            .get(&url)
            .header("Referer", "https://music.163.com/")
            .header("Accept", "*/*")
            .header("User-Agent", get_random_user_agent())
            .header(
                "Cookie",
                format!(
                    "osver=android; appver=8.7.01; os=android; deviceId={}; channel=netease; requestId={}_{}",
                    device_id,
                    timestamp,
                    rand::random::<u16>() % 10000
                ),
            )
            .header("X-Forwarded-For", forwarded_for)
            .header("X-Real-IP", client_ip)
            .send()
            .await?;

        let mut data: Value = response.json().await?;
        convert_http_to_https(&mut data);

        // 存入缓存（24小时）
        {
            let mut cache = MUSIC_CACHE.write().await;
            cache.insert(
                cache_key,
                CacheEntry {
                    data: data.clone(),
                    expires_at: Instant::now() + Duration::from_secs(86400),
                },
            );
        }

        Ok(data)
    }

    /// 获取音频流 URL
    pub async fn fetch_audio_url(&self, song_id: i64) -> Result<String> {
        let device_id = generate_device_id();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();

        let url = format!(
            "https://music.163.com/api/song/enhance/player/url?ids=[{}]&br=320000",
            song_id
        );

        let client_ip = get_random_china_ip();
        let proxy_ip = get_random_china_ip();
        let forwarded_for = format!("{}, {}", client_ip, proxy_ip);

        let response = self
            .client
            .get(&url)
            .header("Referer", "https://music.163.com/")
            .header("Origin", "https://music.163.com")
            .header("Accept", "*/*")
            .header("User-Agent", get_random_user_agent())
            .header(
                "Cookie",
                format!(
                    "osver=android; appver=8.7.01; os=android; deviceId={}; channel=netease; requestId={}_{:04}; __remember_me=true",
                    device_id,
                    timestamp,
                    rand::random::<u16>() % 10000
                ),
            )
            .header("X-Forwarded-For", forwarded_for)
            .header("X-Real-IP", client_ip)
            .send()
            .await?;

        let data: Value = response.json().await?;

        let audio_url = data["data"]
            .get(0)
            .and_then(|item| {
                if let Some(uf_url) = item.get("uf").and_then(|uf| uf["url"].as_str()) {
                    Some(uf_url)
                } else {
                    item["url"].as_str()
                }
            })
            .ok_or_else(|| anyhow!("No audio URL found"))?;

        if audio_url.is_empty() || audio_url == "null" {
            return Err(anyhow!(
                "Audio not available (copyright or geo-restriction)"
            ));
        }

        Ok(audio_url.to_string())
    }
}

impl Default for NeteaseService {
    fn default() -> Self {
        Self::new()
    }
}
