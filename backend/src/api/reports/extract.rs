//! Platform library/stats extractors and Discord guild-take helpers for reports.
use serde_json::{json, Value};
use crate::services::smart_filter::SmartFilteredData;

pub(crate) async fn extract_steam_library_items(metadata: &SmartFilteredData) -> Result<Vec<Value>, String> {
    use std::fs;
    use std::path::PathBuf;

    let mut library_items = Vec::new();

    if let crate::services::smart_filter::ContentAnalysis::Steam(analysis) =
        &metadata.content_analysis
    {
        println!("✅ Steam analysis found!");

        // 读取Steam原始数据以获取游戏封面信息
        let raw_cache_path = PathBuf::from("./cache/raw/steam.json");
        let mut game_map: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();

        if raw_cache_path.exists() {
            if let Ok(content) = fs::read_to_string(&raw_cache_path) {
                if let Ok(raw_json) = serde_json::from_str::<Value>(&content) {
                    // 提取 games 数据构建名称->封面映射
                    if let Some(games_array) = raw_json.get("games").and_then(|v| v.as_array()) {
                        for item in games_array {
                            if let (Some(name), Some(appid)) = (
                                item.get("name").and_then(|v| v.as_str()),
                                item.get("appid").and_then(|v| v.as_u64()),
                            ) {
                                // Steam 游戏封面；代理交给 card_visuals 出口 normalize
                                let cover = format!(
                                    "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/header.jpg",
                                    appid
                                );
                                game_map.insert(name.to_string(), cover);
                            }
                        }
                        println!("  - Loaded {} game covers from raw data", game_map.len());
                    }
                }
            }
        }

        // 从genre_analysis中提取代表性游戏
        for genre_category in &analysis.genre_analysis {
            for game in &genre_category.examples {
                let cover = game_map.get(game.as_str()).cloned().unwrap_or_default();

                library_items.push(json!({
                    "title": game,
                    "cover": cover,
                    "type": "game"
                }));

                if library_items.len() >= 10 {
                    break;
                }
            }
            if library_items.len() >= 10 {
                break;
            }
        }

        // 从recent_games中提取游戏信息
        for game_item in &analysis.recent_games {
            if library_items.len() >= 15 {
                break;
            }
            let cover = game_map
                .get(game_item.name.as_str())
                .cloned()
                .unwrap_or_default();

            library_items.push(json!({
                "title": &game_item.name,
                "cover": cover,
                "type": "game"
            }));
        }

        // 去重
        let mut seen_titles = std::collections::HashSet::new();
        library_items.retain(|item: &Value| {
            if let Some(title) = item.get("title").and_then(|v| v.as_str()) {
                seen_titles.insert(title.to_string())
            } else {
                false
            }
        });

        // 限制最多返回10个
        library_items.truncate(10);

        println!(
            "  - Final steam library_items count: {}",
            library_items.len()
        );
    } else {
        println!("❌ Not Steam analysis!");
    }

    Ok(library_items)
}

pub(crate) async fn extract_github_library_items(metadata: &SmartFilteredData) -> Result<Vec<Value>, String> {
    let mut library_items = Vec::new();

    if let crate::services::smart_filter::ContentAnalysis::GitHub(analysis) =
        &metadata.content_analysis
    {
        println!("✅ GitHub analysis found!");

        // 从recent_repos中提取仓库信息
        for repo_item in analysis.recent_repos.iter().take(10) {
            library_items.push(json!({
                "title": &repo_item.name,
                "language": repo_item.language.as_ref().unwrap_or(&"Unknown".to_string()),
                "type": "repo",
                "stars": repo_item.stars.unwrap_or(0),
                "forks": repo_item.forks.unwrap_or(0),
                "description": repo_item.description.as_ref().unwrap_or(&String::new())
            }));
        }

        println!(
            "  - Final github library_items count: {}",
            library_items.len()
        );
    } else {
        println!("❌ Not GitHub analysis!");
    }

    Ok(library_items)
}

pub(crate) async fn extract_netease_library_items(metadata: &SmartFilteredData) -> Result<Vec<Value>, String> {
    use std::fs;

    let mut library_items = Vec::new();

    if let crate::services::smart_filter::ContentAnalysis::Netease(analysis) =
        &metadata.content_analysis
    {
        println!("✅ Netease analysis found!");

        // 读取原始网易云缓存文件以获取歌曲封面信息（CACHE_DIR 可配置）
        let raw_cache_path = crate::services::data_paths::paths()
            .cache_raw
            .join("netease.json");
        let mut song_map: std::collections::HashMap<String, (String, String)> =
            std::collections::HashMap::new();

        if raw_cache_path.exists() {
            if let Ok(content) = fs::read_to_string(&raw_cache_path) {
                if let Ok(raw_json) = serde_json::from_str::<Value>(&content) {
                    // 从 liked_songs 字段提取歌曲数据
                    let songs_array = raw_json.get("liked_songs").and_then(|v| v.as_array());

                    if let Some(songs_array) = songs_array {
                        for item in songs_array {
                            if let (Some(name), cover, artists) = (
                                item.get("name").and_then(|v| v.as_str()),
                                item.get("al")
                                    .and_then(|al| al.get("picUrl"))
                                    .and_then(|v| v.as_str())
                                    .or_else(|| item.get("picUrl").and_then(|v| v.as_str()))
                                    .unwrap_or(""),
                                item.get("ar")
                                    .and_then(|v| v.as_array())
                                    .and_then(|arr| {
                                        arr.first()
                                            .and_then(|a| a.get("name"))
                                            .and_then(|n| n.as_str())
                                    })
                                    .unwrap_or("未知艺术家"),
                            ) {
                                song_map.insert(
                                    name.to_string(),
                                    (cover.to_string(), artists.to_string()),
                                );
                            }
                        }
                        println!(
                            "  - 从 {} 加载了 {} 首歌曲",
                            raw_cache_path.display(),
                            song_map.len()
                        );

                        // 打印前3个song_map条目作为样本
                        let sample: Vec<_> = song_map.iter().take(3).collect();
                        if !sample.is_empty() {
                            println!("  - song_map样本(前3个):");
                            for (song_title, (_, artist)) in sample {
                                println!("    '{}'  by  '{}'", song_title, artist);
                            }
                        }
                    } else {
                        println!(
                            "  ⚠️ {} 中没有找到 liked_songs 字段",
                            raw_cache_path.display()
                        );
                    }
                } else {
                    println!("  ⚠️ 无法解析 {}", raw_cache_path.display());
                }
            } else {
                println!("  ⚠️ 无法读取 {}", raw_cache_path.display());
            }
        } else {
            println!("  ⚠️ {} 不存在", raw_cache_path.display());
        }

        // 从artist_analysis的favorite_artists中提取歌曲
        // 优化：限制每个艺术家最多2首歌，确保歌曲多样性
        const MAX_SONGS_PER_ARTIST: usize = 2;

        // 如果song_map为空(缓存文件不存在),从recent_songs构建基础map
        if song_map.is_empty() {
            println!("  ⚠️ song_map为空,从recent_songs构建基础map");
            for song in &analysis.recent_songs {
                song_map.insert(
                    song.title.clone(),
                    (String::new(), song.artist.clone()), // 封面为空
                );
            }
            println!("  - 从recent_songs构建了{}首歌曲的map", song_map.len());
        }

        println!(
            "  - 开始从 {} 位喜爱艺术家中筛选歌曲...",
            analysis.artist_analysis.favorite_artists.len()
        );
        println!("  - song_map大小: {}", song_map.len());
        println!(
            "  - 喜爱艺术家列表: {:?}",
            analysis.artist_analysis.favorite_artists
        );

        for artist_name in &analysis.artist_analysis.favorite_artists {
            let mut artist_song_count = 0;
            println!("  - 正在处理艺术家: '{}'", artist_name);

            // 在song_map中查找该艺术家的歌曲
            for (song_name, (cover, song_artist)) in &song_map {
                // 检查是否已经添加过这首歌
                let already_added = library_items.iter().any(|item: &Value| {
                    item.get("title")
                        .and_then(|v| v.as_str())
                        .map(|t| t == song_name)
                        .unwrap_or(false)
                });

                if already_added {
                    continue;
                }

                // 跳过未知艺术家
                if song_artist == "未知艺术家" {
                    continue;
                }

                // 使用包含关系匹配，因为艺术家名可能格式不完全一致
                // 例如："YOASOBI" vs "YOASOBI/幾田りら"
                let matches =
                    song_artist.contains(artist_name) || artist_name.contains(song_artist);

                if matches {
                    println!(
                        "    ✓ 匹配成功! '{}' (目标) vs '{}' (歌曲艺术家) -> 歌曲: {}",
                        artist_name, song_artist, song_name
                    );

                    library_items.push(json!({
                        "title": song_name,
                        "cover": cover,
                        "artist": song_artist,  // 使用原始艺术家名
                        "type": "music"
                    }));

                    artist_song_count += 1;

                    // 达到该艺术家的歌曲上限，切换到下一个艺术家
                    if artist_song_count >= MAX_SONGS_PER_ARTIST {
                        println!(
                            "    → {} 已达到上限({}/{}首)，切换下一位艺术家",
                            artist_name, artist_song_count, MAX_SONGS_PER_ARTIST
                        );
                        break;
                    }

                    // 达到总体上限
                    if library_items.len() >= 10 {
                        break;
                    }
                }
            }

            if library_items.len() >= 10 {
                break;
            }
        }

        println!("  - 从喜爱艺术家筛选完成: {}/10 首", library_items.len());

        // 如果favorite_artists提取的不够，从song_map中补充
        // 优化：也限制每个艺术家最多2首歌，确保补充阶段也保持多样性
        if library_items.len() < 10 {
            println!("  - 开始从所有歌曲中补充({}/10)...", library_items.len());
            use std::collections::HashMap;
            let mut artist_count_map: HashMap<String, usize> = HashMap::new();

            // 统计已添加歌曲的艺术家计数
            for item in &library_items {
                if let Some(artist_name) = item.get("artist").and_then(|v| v.as_str()) {
                    *artist_count_map.entry(artist_name.to_string()).or_insert(0) += 1;
                }
            }

            // 从song_map中补充，避免单个艺术家过多
            for (song_name, (cover, artist)) in song_map.iter() {
                if library_items.len() >= 10 {
                    break;
                }

                // 跳过未知艺术家
                if artist == "未知艺术家" {
                    continue;
                }

                // 检查是否已经添加过这首歌
                let already_added = library_items.iter().any(|item: &Value| {
                    item.get("title")
                        .and_then(|v| v.as_str())
                        .map(|t| t == song_name)
                        .unwrap_or(false)
                });

                if already_added {
                    continue;
                }

                // 检查该艺术家是否已达上限
                let current_count = artist_count_map.get(artist.as_str()).unwrap_or(&0);
                if *current_count >= MAX_SONGS_PER_ARTIST {
                    continue;
                }

                println!("    + 补充: {} - {}", artist, song_name);

                library_items.push(json!({
                    "title": song_name,
                    "cover": cover,
                    "artist": artist,
                    "type": "music"
                }));

                *artist_count_map.entry(artist.to_string()).or_insert(0) += 1;
            }

            println!("  - 补充完成: {}/10 首", library_items.len());
        }

        // 兜底：如果仍然没有收集到可展示的歌曲（例如原始缓存缺失或结构差异），
        // 使用智能过滤结果中的 recent_songs 构建基础的 library_items（无封面时前端会自动回退头像）。
        if library_items.is_empty() {
            for song in &analysis.recent_songs {
                library_items.push(json!({
                    "title": song.title,
                    "cover": "",
                    "artist": song.artist,
                    "type": "music"
                }));
                if library_items.len() >= 10 {
                    break;
                }
            }
        }

        // 去重（虽然上面已经检查过，但再确保一次）
        let mut seen_titles = std::collections::HashSet::new();
        library_items.retain(|item: &Value| {
            if let Some(title) = item.get("title").and_then(|v| v.as_str()) {
                seen_titles.insert(title.to_string())
            } else {
                false
            }
        });

        // 限制最多返回10个
        library_items.truncate(10);

        println!(
            "  - Final netease library_items count: {}",
            library_items.len()
        );
    } else {
        println!("❌ Not Netease analysis!");
    }

    Ok(library_items)
}

pub(crate) async fn extract_bangumi_library_items(metadata: &SmartFilteredData) -> Result<Vec<Value>, String> {
    let mut library_items = Vec::new();

    if let crate::services::smart_filter::ContentAnalysis::Bangumi(analysis) =
        &metadata.content_analysis
    {
        let mut candidates = analysis
            .top_rated_subjects
            .iter()
            .filter(|item| item.rate >= 8)
            .cloned()
            .collect::<Vec<_>>();

        if candidates.len() < 10 {
            for item in &analysis.watching_subjects {
                if !candidates
                    .iter()
                    .any(|candidate| candidate.subject_id == item.subject_id)
                {
                    candidates.push(item.clone());
                }
                if candidates.len() >= 10 {
                    break;
                }
            }
        }

        if candidates.len() < 10 {
            for item in &analysis.recent_updates {
                if !candidates
                    .iter()
                    .any(|candidate| candidate.subject_id == item.subject_id)
                {
                    candidates.push(item.clone());
                }
                if candidates.len() >= 10 {
                    break;
                }
            }
        }

        for item in candidates.into_iter().take(10) {
            library_items.push(json!({
                "title": item.title,
                "cover": item.cover.unwrap_or_default(),
                "type": match item.subject_type.as_str() {
                    "book" => "book",
                    "anime" => "anime",
                    "game" => "game",
                    "music" => "music",
                    "real" => "tv_series",
                    _ => "video",
                },
                "platform": "bangumi",
                "rate": item.rate,
                "url": format!("https://bgm.tv/subject/{}", item.subject_id)
            }));
        }
    }

    Ok(library_items)
}

pub(crate) async fn extract_mal_library_items(metadata: &SmartFilteredData) -> Result<Vec<Value>, String> {
    let mut library_items = Vec::new();

    if let crate::services::smart_filter::ContentAnalysis::Mal(analysis) =
        &metadata.content_analysis
    {
        let mut candidates = analysis
            .top_rated_subjects
            .iter()
            .filter(|item| item.rate >= 8)
            .cloned()
            .collect::<Vec<_>>();

        if candidates.len() < 10 {
            for item in &analysis.watching_subjects {
                if !candidates
                    .iter()
                    .any(|candidate| candidate.subject_id == item.subject_id)
                {
                    candidates.push(item.clone());
                }
                if candidates.len() >= 10 {
                    break;
                }
            }
        }

        if candidates.len() < 10 {
            for item in &analysis.recent_updates {
                if !candidates
                    .iter()
                    .any(|candidate| candidate.subject_id == item.subject_id)
                {
                    candidates.push(item.clone());
                }
                if candidates.len() >= 10 {
                    break;
                }
            }
        }

        for item in candidates.into_iter().take(10) {
            let path_kind = if item.subject_type == "manga" {
                "manga"
            } else {
                "anime"
            };
            library_items.push(json!({
                "title": item.title,
                "cover": item.cover.unwrap_or_default(),
                "type": match item.subject_type.as_str() {
                    "manga" => "book",
                    "anime" => "anime",
                    _ => "video",
                },
                "platform": "mal",
                "rate": item.rate,
                "url": format!("https://myanimelist.net/{}/{}", path_kind, item.subject_id)
            }));
        }
    }

    Ok(library_items)
}

// 哔哩哔哩用户统计数据结构
pub(crate) struct BilibiliUserStats {
    pub(crate) level: Value,
    pub(crate) follower_count: Value,
    pub(crate) following_count: Value,
}

// 网易云音乐用户统计数据结构
pub(crate) struct NeteaseUserStats {
    pub(crate) follower_count: Value,
    pub(crate) playlist_count: Value,
    // level 字段移除，改由 AI 生成
}

/// 提取哔哩哔哩用户统计数据
pub(crate) async fn extract_bilibili_user_stats(
    _metadata: &SmartFilteredData,
) -> Result<BilibiliUserStats, String> {
    use std::fs;
    use std::path::PathBuf;

    // 先尝试从原始B站缓存文件中读取
    let raw_cache_path = PathBuf::from("./cache/raw/bilibili.json");

    if !raw_cache_path.exists() {
        return Err("Bilibili raw cache not found".to_string());
    }

    let content = fs::read_to_string(&raw_cache_path)
        .map_err(|e| format!("Failed to read bilibili cache: {}", e))?;

    let raw_json: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse bilibili cache: {}", e))?;

    // 从 user_info 获取用户信息
    let user_info = raw_json.get("user_info");

    if let Some(user_info) = user_info {
        // 提取统计数据
        let level = user_info.get("level").cloned().unwrap_or(json!(0));
        let follower_count = user_info.get("follower").cloned().unwrap_or(json!(0));
        let following_count = user_info.get("following").cloned().unwrap_or(json!(0));

        Ok(BilibiliUserStats {
            level,
            follower_count,
            following_count,
        })
    } else {
        Err("Bilibili user_info not found in raw cache".to_string())
    }
}

/// 提取网易云音乐用户统计数据
///
/// Prefer `metadata.user_summary.stats` (smart_filter already filled followeds /
/// playlistCount). Fill gaps from `paths().cache_raw/netease.json` profile.
pub(crate) async fn extract_netease_user_stats(
    metadata: &SmartFilteredData,
) -> Result<NeteaseUserStats, String> {
    use std::fs;

    let summary_followers = metadata.user_summary.stats.follower_count;
    let summary_playlists = metadata.user_summary.stats.total_content;

    let mut follower_count = summary_followers.map(|n| json!(n));
    let mut playlist_count = if summary_playlists > 0 {
        Some(json!(summary_playlists as i64))
    } else {
        None
    };

    // Fill missing fields from raw profile when available
    if follower_count.is_none() || playlist_count.is_none() {
        let raw_cache_path = crate::services::data_paths::paths()
            .cache_raw
            .join("netease.json");
        if raw_cache_path.exists() {
            if let Ok(content) = fs::read_to_string(&raw_cache_path) {
                if let Ok(raw_json) = serde_json::from_str::<Value>(&content) {
                    if let Some(profile) = raw_json.get("profile") {
                        if follower_count.is_none() {
                            follower_count = profile.get("followeds").cloned();
                        }
                        if playlist_count.is_none() {
                            playlist_count = profile.get("playlistCount").cloned();
                        }
                    }
                }
            }
        }
    }

    if follower_count.is_none() && playlist_count.is_none() {
        return Err(
            "Netease stats missing: no user_summary.stats and no cache/raw profile".into(),
        );
    }

    Ok(NeteaseUserStats {
        follower_count: follower_count.unwrap_or(json!(0)),
        playlist_count: playlist_count.unwrap_or(json!(0)),
    })
}

pub(crate) fn discord_fallback_guild_take(g: &crate::services::smart_filter::DiscordGuildItem) -> String {
    let members = g.member_count.unwrap_or(0);
    let size = if members >= 100_000 {
        Some("万人广场")
    } else if members >= 10_000 {
        Some("万人级")
    } else if members >= 1_000 {
        Some("千人圈")
    } else if members > 0 {
        Some("小圈子")
    } else {
        None
    };

    let is_admin = g.permissions_highlight.iter().any(|p| p == "ADMINISTRATOR");
    let is_mod = g.permissions_highlight.iter().any(|p| p == "MANAGE_GUILD");
    let is_partnered = g.feature_highlight.iter().any(|f| f == "PARTNERED");
    let is_verified = g.feature_highlight.iter().any(|f| f == "VERIFIED");
    let is_community = g.feature_highlight.iter().any(|f| f == "COMMUNITY");

    let take = if g.owner {
        match size {
            Some(s) => format!("自建·{}", s),
            None => "自建领地".to_string(),
        }
    } else if is_admin {
        match size {
            Some(s) => format!("掌舵·{}", s),
            None => "管理席位".to_string(),
        }
    } else if is_mod {
        match size {
            Some(s) => format!("协管·{}", s),
            None => "协管席位".to_string(),
        }
    } else if is_partnered {
        "官方合作服".to_string()
    } else if is_verified {
        "认证大服".to_string()
    } else if is_community {
        match size {
            Some(s) => format!("常驻·{}", s),
            None => "社区服常驻".to_string(),
        }
    } else if let Some(s) = size {
        format!("常驻·{}", s)
    } else {
        "社区成员".to_string()
    };

    take.chars().take(16).collect()
}

/// 归一化 AI / 兜底的 guild_takes：只保留真实服务器、补 id、截断 take、最多 8 条
pub(crate) fn normalize_discord_guild_takes(
    obj: &mut serde_json::Map<String, Value>,
    guilds: &[crate::services::smart_filter::DiscordGuildItem],
) {
    let known_by_name: std::collections::HashMap<
        &str,
        &crate::services::smart_filter::DiscordGuildItem,
    > = guilds.iter().map(|g| (g.name.as_str(), g)).collect();
    let known_by_id: std::collections::HashMap<
        &str,
        &crate::services::smart_filter::DiscordGuildItem,
    > = guilds.iter().map(|g| (g.id.as_str(), g)).collect();

    let raw = obj
        .get("guild_takes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut normalized: Vec<Value> = Vec::new();
    let mut seen_names = std::collections::HashSet::new();

    for entry in raw {
        let Some(map) = entry.as_object() else {
            continue;
        };
        let name = map
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let id = map
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let take_raw = map
            .get("take")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if take_raw.is_empty() {
            continue;
        }

        // 必须能对应真实服务器（按 id 或 name）
        let guild = if !id.is_empty() {
            known_by_id.get(id.as_str()).copied()
        } else if !name.is_empty() {
            known_by_name.get(name.as_str()).copied()
        } else {
            None
        };
        let Some(g) = guild else {
            continue;
        };
        if !seen_names.insert(g.name.as_str()) {
            continue;
        }

        let take: String = take_raw.chars().take(20).collect();
        normalized.push(json!({
            "name": g.name,
            "id": g.id,
            "take": take,
        }));
        if normalized.len() >= 8 {
            break;
        }
    }

    // AI 漏生成或全被过滤时：模板兜底
    if normalized.is_empty() {
        for g in guilds.iter().take(8) {
            normalized.push(json!({
                "name": g.name,
                "id": g.id,
                "take": discord_fallback_guild_take(g),
            }));
        }
    }

    obj.insert("guild_takes".to_string(), json!(normalized));
}


pub(crate) async fn extract_bilibili_library_items(
    metadata: &SmartFilteredData,
) -> Result<Vec<Value>, String> {
    use std::fs;
    use std::path::PathBuf;

    let mut library_items = Vec::new();

    if let crate::services::smart_filter::ContentAnalysis::Bilibili(analysis) =
        &metadata.content_analysis
    {
        println!("✅ Bilibili analysis found!");

        // 读取B站原始数据：封面 + 追番进度（progress / season_id）
        let raw_cache_path = PathBuf::from("./cache/raw/bilibili.json");
        // title → (cover, progress, season_id)
        let mut bangumi_map: std::collections::HashMap<String, (String, Option<String>, Option<String>)> =
            std::collections::HashMap::new();

        if raw_cache_path.exists() {
            if let Ok(content) = fs::read_to_string(&raw_cache_path) {
                if let Ok(raw_json) = serde_json::from_str::<Value>(&content) {
                    // 提取 bangumi：封面 + 进度字段
                    if let Some(bangumi_array) = raw_json.get("bangumi").and_then(|v| v.as_array())
                    {
                        for item in bangumi_array {
                            let title = item.get("title").and_then(|v| v.as_str());
                            let cover = item
                                .get("cover")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            if let Some(title) = title {
                                let progress = item
                                    .get("progress")
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.trim().to_string())
                                    .filter(|s| !s.is_empty());
                                // Some scrapers use new_ep / total_count style fields
                                let progress = progress.or_else(|| {
                                    let ep = item
                                        .get("new_ep")
                                        .and_then(|v| v.as_object())
                                        .and_then(|o| o.get("title").or_else(|| o.get("index_show")))
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.trim().to_string())
                                        .filter(|s| !s.is_empty());
                                    ep
                                });
                                let season_id = item.get("season_id").map(|v| match v {
                                    Value::String(s) => s.trim().to_string(),
                                    Value::Number(n) => n.to_string(),
                                    _ => String::new(),
                                }).filter(|s| !s.is_empty());
                                bangumi_map.insert(
                                    title.to_string(),
                                    (cover, progress, season_id),
                                );
                            }
                        }
                        println!(
                            "  - Loaded {} bangumi covers from raw data",
                            bangumi_map.len()
                        );
                    }
                }
            }
        }

        // 从anime_analysis中提取examples（代表性作品）
        for anime_category in &analysis.anime_analysis {
            for example_title in &anime_category.examples {
                let (cover, progress, season_id) = bangumi_map
                    .get(example_title.as_str())
                    .map(|(c, p, s)| {
                        println!("  - Anime '{}': {}", example_title, c);
                        (c.clone(), p.clone(), s.clone())
                    })
                    .unwrap_or_else(|| {
                        println!("  - Anime '{}': No cover found", example_title);
                        (String::new(), None, None)
                    });

                let mut item = json!({
                    "title": example_title,
                    "cover": cover,
                    "type": "anime"
                });
                if let Some(obj) = item.as_object_mut() {
                    if let Some(p) = progress {
                        obj.insert("progress".to_string(), json!(p));
                    }
                    if let Some(sid) = season_id {
                        obj.insert("season_id".to_string(), json!(sid));
                    }
                }
                library_items.push(item);

                if library_items.len() >= 10 {
                    break;
                }
            }
            if library_items.len() >= 10 {
                break;
            }
        }

        // 从原始数据中提取视频封面信息（从收藏夹中读取）
        let mut video_map: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        if raw_cache_path.exists() {
            if let Ok(content) = fs::read_to_string(&raw_cache_path) {
                if let Ok(raw_json) = serde_json::from_str::<Value>(&content) {
                    // 从收藏夹中提取视频信息
                    if let Some(favorites) = raw_json.get("favorites").and_then(|f| f.as_array()) {
                        println!("  - Found {} favorite folders", favorites.len());
                        for fav_folder in favorites {
                            if let Some(videos) =
                                fav_folder.get("videos").and_then(|v| v.as_array())
                            {
                                for video in videos {
                                    if let (Some(title), Some(cover)) = (
                                        video.get("title").and_then(|t| t.as_str()),
                                        video.get("cover").and_then(|c| c.as_str()),
                                    ) {
                                        video_map.insert(title.to_string(), cover.to_string());
                                    }
                                }
                            }
                        }
                        println!("  - Loaded {} video covers from favorites", video_map.len());
                    } else {
                        println!("  - ⚠️  No favorites found");
                    }
                }
            }
        }

        // 从recent_videos中提取视频信息
        println!(
            "  - Searching covers for {} videos",
            analysis.recent_videos.len()
        );
        for video in &analysis.recent_videos {
            if library_items.len() >= 15 {
                break;
            }

            println!("  - Looking for video: '{}'", video.title);
            let cover = video_map
                .get(&video.title)
                .map(|url| {
                    println!("    ✓ Found cover: {}", url);
                    url.clone()
                })
                .unwrap_or_else(|| {
                    println!("    ✗ No cover found in video_map");
                    // 尝试模糊匹配
                    for (map_title, _) in video_map.iter().take(3) {
                        println!("      Available: '{}'", map_title);
                    }
                    String::new()
                });

            library_items.push(json!({
                "title": &video.title,
                "cover": cover,
                "type": "video"
            }));
        }

        // 去重
        let mut seen_titles = std::collections::HashSet::new();
        library_items.retain(|item: &Value| {
            if let Some(title) = item.get("title").and_then(|v| v.as_str()) {
                seen_titles.insert(title.to_string())
            } else {
                false
            }
        });

        // 限制最多返回10个
        library_items.truncate(10);

        println!("  - Final library_items count: {}", library_items.len());
    } else {
        println!("❌ Not Bilibili analysis!");
    }

    Ok(library_items)
}


#[cfg(test)]
mod discord_guild_takes_tests {
    use super::*;
    use crate::services::smart_filter::DiscordGuildItem;

    fn sample_guild(
        id: &str,
        name: &str,
        owner: bool,
        perms: &[&str],
        members: Option<u64>,
        features: &[&str],
    ) -> DiscordGuildItem {
        DiscordGuildItem {
            id: id.to_string(),
            name: name.to_string(),
            icon_url: None,
            owner,
            permissions_highlight: perms.iter().map(|s| s.to_string()).collect(),
            member_count: members,
            presence_count: None,
            feature_highlight: features.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn fallback_take_reflects_owner_and_size() {
        let g = sample_guild("1", "My Server", true, &[], Some(12_000), &[]);
        let take = discord_fallback_guild_take(&g);
        assert!(take.contains("自建"), "got: {}", take);
        assert!(take.chars().count() <= 16, "too long: {}", take);
    }

    #[test]
    fn normalize_fills_fallback_when_missing() {
        let guilds = vec![
            sample_guild("1", "Alpha", true, &[], Some(100), &[]),
            sample_guild(
                "2",
                "Beta",
                false,
                &["ADMINISTRATOR"],
                Some(50_000),
                &["COMMUNITY"],
            ),
        ];
        let mut obj = serde_json::Map::new();
        normalize_discord_guild_takes(&mut obj, &guilds);
        let takes = obj.get("guild_takes").and_then(|v| v.as_array()).unwrap();
        assert_eq!(takes.len(), 2);
        assert_eq!(takes[0]["name"], "Alpha");
        assert_eq!(takes[0]["id"], "1");
        assert!(!takes[0]["take"].as_str().unwrap_or("").is_empty());
        assert_eq!(takes[1]["name"], "Beta");
    }

    #[test]
    fn normalize_keeps_ai_takes_for_real_guilds_only() {
        let guilds = vec![sample_guild("1", "Real Guild", false, &[], Some(2000), &[])];
        let mut obj = serde_json::Map::new();
        obj.insert(
            "guild_takes".to_string(),
            json!([
                { "name": "Real Guild", "take": "千人圈里摸鱼" },
                { "name": "Invented Server", "take": "幻觉服" },
                { "name": "Real Guild", "take": "重复应被去重" },
            ]),
        );
        normalize_discord_guild_takes(&mut obj, &guilds);
        let takes = obj.get("guild_takes").and_then(|v| v.as_array()).unwrap();
        assert_eq!(takes.len(), 1);
        assert_eq!(takes[0]["name"], "Real Guild");
        assert_eq!(takes[0]["id"], "1");
        assert_eq!(takes[0]["take"], "千人圈里摸鱼");
    }
}
