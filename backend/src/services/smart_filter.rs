//! 智能内容过滤器
//!
//! 新的过滤策略：
//! 1. 保留完整内容列表（不只是最近5个）
//! 2. 使用预置数据库进行初步分类
//! 3. 将同类内容合并为判断 + 代表性例子
//! 4. 未知内容保留完整信息

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;

use super::content_databases::{AnimeDatabase, ArtistDatabase, GameDatabase};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFilteredData {
    pub platform: String,
    pub user_summary: UserSummary,
    pub content_analysis: ContentAnalysis,
    pub raw_unknown_content: Vec<UnknownContent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSummary {
    pub username: String,
    pub user_id: String,
    pub level: Option<String>,
    pub stats: UserStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserStats {
    pub follower_count: Option<i64>,
    pub following_count: Option<i64>,
    pub total_content: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ContentAnalysis {
    Bilibili(BilibiliAnalysis),
    Steam(SteamAnalysis),
    GitHub(GitHubAnalysis),
    Netease(NeteaseAnalysis),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BilibiliAnalysis {
    pub video_summary: String,
    pub anime_analysis: Vec<super::content_databases::anime_database::CategoryAnalysis>,
    pub recent_videos: Vec<VideoItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoItem {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamAnalysis {
    pub game_summary: String,
    pub genre_analysis: Vec<super::content_databases::game_database::GameGenreAnalysis>,
    pub recent_games: Vec<GameItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameItem {
    pub name: String,
    pub playtime: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitHubAnalysis {
    pub repo_summary: String,
    pub language_distribution: std::collections::HashMap<String, usize>,
    pub recent_repos: Vec<RepoItem>,
    pub contribution_calendar: Option<Vec<ContributionDay>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContributionDay {
    pub date: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoItem {
    pub name: String,
    pub language: Option<String>,
    pub stars: Option<i64>,
    pub forks: Option<i64>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NeteaseAnalysis {
    pub music_summary: String,
    pub artist_analysis: super::content_databases::artist_database::MusicAnalysis,
    pub recent_songs: Vec<SongItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongItem {
    pub title: String,
    pub artist: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnknownContent {
    pub content_type: String,
    pub title: String,
    #[serde(skip_serializing_if = "std::collections::HashMap::is_empty")]
    #[serde(default)]
    pub metadata: std::collections::HashMap<String, String>,
}

pub struct SmartFilter;

impl SmartFilter {
    /// 处理所有平台数据并保存到缓存文件
    pub fn process_and_save_all(all_data: &Value) -> Result<(), Box<dyn std::error::Error>> {
        let mut all_filtered_data = std::collections::HashMap::new();

        // 1. Process Bilibili
        if let Some(bilibili_data) = all_data.get("bilibili") {
            let mut process_data = bilibili_data.clone();

            // 适配数据结构: user -> user_info
            if let Some(user) = bilibili_data.get("user") {
                if let Some(obj) = process_data.as_object_mut() {
                    obj.insert("user_info".to_string(), user.clone());
                }
            }

            // 适配数据结构: favorites -> videos (提取所有视频)
            if let Some(favorites) = bilibili_data.get("favorites").and_then(|v| v.as_array()) {
                let mut all_videos = Vec::new();
                for fav in favorites {
                    if let Some(vids) = fav.get("videos").and_then(|v| v.as_array()) {
                        for v in vids {
                            all_videos.push(v.clone());
                        }
                    }
                }
                if let Some(obj) = process_data.as_object_mut() {
                    obj.insert("videos".to_string(), Value::Array(all_videos));
                }
            }

            match SmartFilter::filter("bilibili", &process_data) {
                Ok(result) => {
                    all_filtered_data.insert("bilibili".to_string(), result);
                }
                Err(e) => tracing::warn!("Bilibili filter failed: {}", e),
            }
        }

        // 2. Process Steam
        if let Some(steam_data) = all_data.get("steam") {
            let mut process_data = steam_data.clone();

            // 适配数据结构: user -> user_info
            if let Some(user) = steam_data.get("user") {
                if let Some(obj) = process_data.as_object_mut() {
                    obj.insert("user_info".to_string(), user.clone());
                }
            }

            // 适配数据结构: games -> owned_games.games
            if let Some(games) = steam_data.get("games") {
                if let Some(obj) = process_data.as_object_mut() {
                    obj.insert(
                        "owned_games".to_string(),
                        serde_json::json!({ "games": games }),
                    );
                    // 同时也作为最近游玩的游戏（因为我们只获取了活跃游戏）
                    obj.insert(
                        "recently_played".to_string(),
                        serde_json::json!({ "games": games }),
                    );
                }
            }

            match SmartFilter::filter("steam", &process_data) {
                Ok(result) => {
                    all_filtered_data.insert("steam".to_string(), result);
                }
                Err(e) => tracing::warn!("Steam filter failed: {}", e),
            }
        }

        // 3. Process Netease
        if let Some(netease_data) = all_data.get("netease") {
            let mut process_data = netease_data.clone();

            // 适配数据结构: liked_songs -> playlists[0].tracks 和 songs（用于资料库提取）
            if let Some(liked_songs) = netease_data.get("liked_songs") {
                if let Some(obj) = process_data.as_object_mut() {
                    // 为过滤器创建 playlists 结构
                    obj.insert(
                        "playlists".to_string(),
                        serde_json::json!([
                            { "tracks": liked_songs }
                        ]),
                    );
                    // 同时保留 songs 字段用于资料库提取（封面、艺术家等）
                    obj.insert("songs".to_string(), liked_songs.clone());
                }
            }

            // 适配数据结构: profile 字段已经在 fetcher 中正确设置，无需额外处理

            match SmartFilter::filter("netease", &process_data) {
                Ok(result) => {
                    all_filtered_data.insert("netease".to_string(), result);
                }
                Err(e) => {
                    tracing::warn!("Netease filter failed: {}", e);
                    // 打印更详细的错误信息用于调试
                    tracing::debug!("Netease data structure: {:?}", process_data);
                }
            }
        }

        // 4. Process GitHub
        if let Some(github_data) = all_data.get("github") {
            // GitHub 结构基本一致 (user, repos)
            match SmartFilter::filter("github", github_data) {
                Ok(result) => {
                    all_filtered_data.insert("github".to_string(), result);
                }
                Err(e) => tracing::warn!("GitHub filter failed: {}", e),
            }
        }

        // 🚀 优化：使用流式写入和临时文件，避免内存峰值和写入中断
        let output_path = Path::new("cache/smart_filtered_data.json");
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // 使用临时文件写入，然后原子性重命名
        let temp_path = output_path.with_extension("json.tmp");

        {
            let file = fs::File::create(&temp_path)?;
            let writer = std::io::BufWriter::with_capacity(262144, file); // 256KB buffer
            serde_json::to_writer_pretty(writer, &all_filtered_data)?;
        }

        // 原子性重命名
        fs::rename(&temp_path, output_path).or_else(|_| {
            // 如果重命名失败（跨设备），尝试复制
            fs::copy(&temp_path, output_path)?;
            fs::remove_file(&temp_path)
        })?;

        // Flush unknown content stats to disk
        super::content_databases::learning::flush_unknown_stats();

        tracing::info!("✓ Smart filtered data saved to {:?}", output_path);
        Ok(())
    }

    /// 智能过滤平台数据
    pub fn filter(platform: &str, raw_data: &Value) -> Result<SmartFilteredData, String> {
        match platform {
            "bilibili" => Self::filter_bilibili(raw_data),
            "steam" => Self::filter_steam(raw_data),
            "github" => Self::filter_github(raw_data),
            "netease" => Self::filter_netease(raw_data),
            _ => Err(format!("Unsupported platform: {}", platform)),
        }
    }

    /// Bilibili 智能过滤
    fn filter_bilibili(data: &Value) -> Result<SmartFilteredData, String> {
        // 如果缺少用户信息，使用默认值而不是报错
        let default_user_info = serde_json::json!({
            "name": "未知用户",
            "mid": 0,
            "level": 0,
            "follower": 0,
            "following": 0
        });
        let user_info = data.get("user_info").unwrap_or(&default_user_info);

        // 1. 用户摘要
        let user_summary = UserSummary {
            username: user_info
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("未知用户")
                .to_string(),
            user_id: user_info
                .get("mid")
                .and_then(|v| v.as_i64())
                .map(|i| i.to_string())
                .unwrap_or_default(),
            level: user_info
                .get("level")
                .and_then(|v| v.as_i64())
                .map(|l| format!("Lv{}", l)),
            stats: UserStats {
                follower_count: user_info.get("follower").and_then(|v| v.as_i64()),
                following_count: user_info.get("following").and_then(|v| v.as_i64()),
                total_content: 0, // 后续计算
            },
        };

        // 2. 收集所有视频信息
        let videos = data.get("videos").and_then(|v| v.as_array());
        let mut recent_videos = Vec::new();

        if let Some(vids) = videos {
            // 保留所有视频
            for video in vids {
                if let Some(title) = video.get("title").and_then(|v| v.as_str()) {
                    recent_videos.push(VideoItem {
                        title: title.to_string(),
                    });
                }
            }
        }

        // 3. 使用动画数据库分析番剧/电视剧/电影
        let bangumi = data.get("bangumi").and_then(|v| v.as_array());
        let mut watch_list = Vec::new();

        if let Some(items) = bangumi {
            for item in items {
                if let Some(title) = item.get("title").and_then(|v| v.as_str()) {
                    let author = item
                        .get("author")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    watch_list.push((title.to_string(), author));
                }
            }
        }

        let anime_db = AnimeDatabase::new();
        let anime_analysis = anime_db.analyze(watch_list.clone());

        // 找出未知的番剧内容
        let mut raw_unknown_content = Vec::new();
        for (title, _author) in watch_list.iter() {
            if anime_db.find(title).is_none() {
                let metadata = std::collections::HashMap::new();
                // metadata.insert("author".to_string(), author.clone()); // 不需要具体的metadata
                raw_unknown_content.push(UnknownContent {
                    content_type: "Bangumi".to_string(),
                    title: title.clone(),
                    metadata,
                });
            }
        }
        tracing::info!(
            "Bilibili: watch_list size: {}, unknown size: {}",
            watch_list.len(),
            raw_unknown_content.len()
        );

        let video_summary = format!(
            "基于收藏的 {} 个视频和追番的 {} 部作品分析",
            videos.map(|v| v.len()).unwrap_or(0),
            bangumi.map(|b| b.len()).unwrap_or(0)
        );

        let content_analysis = ContentAnalysis::Bilibili(BilibiliAnalysis {
            video_summary,
            anime_analysis,
            recent_videos,
        });

        Ok(SmartFilteredData {
            platform: "bilibili".to_string(),
            user_summary,
            content_analysis,
            raw_unknown_content,
        })
    }

    /// Steam 智能过滤
    fn filter_steam(data: &Value) -> Result<SmartFilteredData, String> {
        let user_info = data.get("user_info");

        // 1. 用户摘要
        let user_summary = UserSummary {
            username: user_info
                .and_then(|u| u.get("personaname"))
                .and_then(|v| v.as_str())
                .unwrap_or("未知用户")
                .to_string(),
            user_id: user_info
                .and_then(|u| u.get("steamid"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            level: None,
            stats: UserStats {
                follower_count: None,
                following_count: None,
                total_content: 0,
            },
        };

        // 2. 收集所有游戏信息
        let owned_games = data
            .get("owned_games")
            .and_then(|v| v.get("games"))
            .and_then(|v| v.as_array());
        let recently_played = data
            .get("recently_played")
            .and_then(|v| v.get("games"))
            .and_then(|v| v.as_array());

        let mut game_list = Vec::new();
        let mut recent_games = Vec::new();

        // 收集所有拥有的游戏
        if let Some(games) = owned_games {
            for game in games {
                if let Some(name) = game.get("name").and_then(|v| v.as_str()) {
                    let playtime = game
                        .get("playtime_forever")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    game_list.push((name.to_string(), playtime));
                }
            }
        }

        // 收集最近玩的游戏
        if let Some(games) = recently_played {
            for game in games {
                if let Some(name) = game.get("name").and_then(|v| v.as_str()) {
                    let playtime = game
                        .get("playtime_forever")
                        .and_then(|v| v.as_i64())
                        .unwrap_or(0);
                    recent_games.push(GameItem {
                        name: name.to_string(),
                        playtime,
                    });
                }
            }
        }

        // 3. 使用游戏数据库分析
        let game_db = GameDatabase::new();
        let game_analysis = game_db.analyze(game_list);

        // 收集未知的游戏内容
        let mut raw_unknown_content = Vec::new();
        for (name, playtime) in game_analysis.unknown_games {
            let mut metadata = std::collections::HashMap::new();
            metadata.insert("playtime".to_string(), playtime.to_string());
            raw_unknown_content.push(UnknownContent {
                content_type: "Game".to_string(),
                title: name,
                metadata,
            });
        }

        let content_analysis = ContentAnalysis::Steam(SteamAnalysis {
            game_summary: game_analysis.summary.clone(),
            genre_analysis: game_analysis.genre_analysis,
            recent_games,
        });

        Ok(SmartFilteredData {
            platform: "steam".to_string(),
            user_summary,
            content_analysis,
            raw_unknown_content,
        })
    }

    /// GitHub 智能过滤
    fn filter_github(data: &Value) -> Result<SmartFilteredData, String> {
        let user = data.get("user");

        // 1. 用户摘要
        let user_summary = UserSummary {
            username: user
                .and_then(|u| u.get("login"))
                .and_then(|v| v.as_str())
                .unwrap_or("未知用户")
                .to_string(),
            user_id: user
                .and_then(|u| u.get("id"))
                .and_then(|v| v.as_i64())
                .map(|i| i.to_string())
                .unwrap_or_default(),
            level: None,
            stats: UserStats {
                follower_count: user
                    .and_then(|u| u.get("followers"))
                    .and_then(|v| v.as_i64()),
                following_count: user
                    .and_then(|u| u.get("following"))
                    .and_then(|v| v.as_i64()),
                total_content: 0,
            },
        };

        // 2. 收集所有仓库信息
        let repos = data.get("repos").and_then(|v| v.as_array());
        let mut recent_repos = Vec::new();
        let mut language_distribution = std::collections::HashMap::new();

        if let Some(repo_list) = repos {
            // 保留所有仓库
            for repo in repo_list {
                if let Some(name) = repo.get("name").and_then(|v| v.as_str()) {
                    let language = repo
                        .get("language")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    let stars = repo.get("stargazers_count").and_then(|v| v.as_i64());
                    let forks = repo.get("forks_count").and_then(|v| v.as_i64());
                    let description = repo
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());

                    recent_repos.push(RepoItem {
                        name: name.to_string(),
                        language: language.clone(),
                        stars,
                        forks,
                        description,
                    });

                    // 统计编程语言
                    if let Some(lang) = language {
                        *language_distribution.entry(lang).or_insert(0) += 1;
                    }
                }
            }

            // 统计所有仓库的语言分布 (Wait, I was iterating twice before, now I can just do it once if I remove the limit)
            // Actually, the previous code iterated `take(10)` for `recent_repos` and then iterated ALL for `language_distribution`.
            // Now I iterate ALL for `recent_repos`, so I can do language distribution in the same loop.
            // But wait, the previous code had a second loop:
            // for repo in repo_list { ... }
            // If I merge them, I need to be careful.
            // Let's just remove the limit in the first loop and remove the second loop if it's redundant.
            // The first loop now iterates all repos.
            // So `language_distribution` is populated for all repos in the first loop.
            // The second loop is now redundant.
        }

        let repo_summary = format!(
            "拥有 {} 个仓库，主要使用 {}",
            repos.map(|r| r.len()).unwrap_or(0),
            language_distribution
                .iter()
                .map(|(k, v)| format!("{} ({})", k, v))
                .collect::<Vec<_>>()
                .join("、")
        );

        // 3. 提取贡献历史（直接从原始数据中获取）
        let contribution_calendar = data
            .get("contribution_calendar")
            .and_then(|v| v.as_array())
            .map(|calendar| {
                let contributions: Vec<ContributionDay> = calendar
                    .iter()
                    .filter_map(|day| {
                        let date = day.get("date").and_then(|v| v.as_str())?;
                        let count = day.get("count").and_then(|v| v.as_i64())?;
                        Some(ContributionDay {
                            date: date.to_string(),
                            count,
                        })
                    })
                    .collect();
                tracing::info!(
                    "📊 Extracted {} contribution days from GitHub data",
                    contributions.len()
                );
                contributions
            });

        let content_analysis = ContentAnalysis::GitHub(GitHubAnalysis {
            repo_summary,
            language_distribution,
            recent_repos,
            contribution_calendar,
        });

        Ok(SmartFilteredData {
            platform: "github".to_string(),
            user_summary,
            content_analysis,
            raw_unknown_content: vec![],
        })
    }

    /// 网易云音乐智能过滤
    fn filter_netease(data: &Value) -> Result<SmartFilteredData, String> {
        tracing::debug!("🎵 Processing Netease data...");

        let profile = data.get("profile");

        // 1. 用户摘要（使用更宽松的默认值）
        let user_summary = UserSummary {
            username: profile
                .and_then(|p| p.get("nickname"))
                .and_then(|v| v.as_str())
                .or_else(|| {
                    // 如果profile中没有nickname，尝试从其他可能的位置获取
                    data.get("user")
                        .and_then(|u| u.get("nickname"))
                        .and_then(|v| v.as_str())
                })
                .unwrap_or("网易云音乐用户")
                .to_string(),
            user_id: profile
                .and_then(|p| p.get("userId"))
                .and_then(|v| v.as_i64())
                .or_else(|| {
                    data.get("user")
                        .and_then(|u| u.get("userId"))
                        .and_then(|v| v.as_i64())
                })
                .map(|i| i.to_string())
                .unwrap_or_default(),
            level: profile
                .and_then(|p| p.get("level"))
                .and_then(|v| v.as_i64())
                .or_else(|| {
                    data.get("user")
                        .and_then(|u| u.get("level"))
                        .and_then(|v| v.as_i64())
                })
                .map(|l| format!("Lv{}", l)),
            stats: UserStats {
                follower_count: profile
                    .and_then(|p| p.get("followeds"))
                    .and_then(|v| v.as_i64()),
                following_count: profile
                    .and_then(|p| p.get("follows"))
                    .and_then(|v| v.as_i64()),
                total_content: 0,
            },
        };

        // 2. 收集所有歌曲信息（支持多种数据结构）
        let playlists = data.get("playlists").and_then(|v| v.as_array());
        let mut song_list = Vec::new();
        let mut recent_songs = Vec::new();

        if let Some(lists) = playlists {
            tracing::debug!("  - Found {} playlists", lists.len());
            for playlist in lists {
                if let Some(tracks) = playlist.get("tracks").and_then(|v| v.as_array()) {
                    tracing::debug!("  - Processing playlist with {} tracks", tracks.len());
                    for track in tracks {
                        if let Some(name) = track.get("name").and_then(|v| v.as_str()) {
                            // 尝试多种方式获取艺术家名称
                            let artist = track
                                .get("ar") // 标准字段
                                .and_then(|v| v.as_array())
                                .and_then(|arr| arr.first())
                                .and_then(|a| a.get("name"))
                                .and_then(|v| v.as_str())
                                .or_else(|| {
                                    // 备用字段：artists
                                    track
                                        .get("artists")
                                        .and_then(|v| v.as_array())
                                        .and_then(|arr| arr.first())
                                        .and_then(|a| a.get("name"))
                                        .and_then(|v| v.as_str())
                                })
                                .unwrap_or("未知艺术家");

                            song_list.push((name.to_string(), artist.to_string()));

                            // 保留所有歌曲
                            recent_songs.push(SongItem {
                                title: name.to_string(),
                                artist: artist.to_string(),
                            });
                        }
                    }
                }
            }
        } else {
            tracing::warn!("  ⚠️ No playlists found in Netease data");
        }

        if song_list.is_empty() {
            tracing::warn!("  ⚠️ No songs collected from Netease data");
        } else {
            tracing::info!("  ✓ Collected {} songs from Netease", song_list.len());
        }

        // 3. 使用歌手数据库分析
        let artist_db = ArtistDatabase::new();
        let music_analysis = artist_db.analyze(song_list);

        let content_analysis = ContentAnalysis::Netease(NeteaseAnalysis {
            music_summary: music_analysis.summary.clone(),
            artist_analysis: music_analysis,
            recent_songs,
        });

        Ok(SmartFilteredData {
            platform: "netease".to_string(),
            user_summary,
            content_analysis,
            raw_unknown_content: vec![],
        })
    }

    /// 估算过滤后数据的 Token 大小
    pub fn estimate_token_size(filtered_data: &SmartFilteredData) -> usize {
        let json_str = serde_json::to_string(filtered_data).unwrap_or_default();
        // 粗略估算: 每4个字符 ≈ 1 token
        json_str.len() / 4
    }

    /// 处理单个平台数据并保存到独立缓存文件
    /// 优势：
    /// - 只处理需要的平台
    /// - 独立文件缓存，避免大文件读写
    /// - 支持并发处理不同平台
    pub fn process_and_save_single(
        platform: &str,
        platform_data: &Value,
    ) -> Result<SmartFilteredData, Box<dyn std::error::Error>> {
        tracing::info!("🔄 Processing single platform: {}", platform);

        // 预处理数据（根据平台适配数据结构）
        let process_data = Self::preprocess_platform_data(platform, platform_data)?;

        // 过滤数据
        let filtered_data = Self::filter(platform, &process_data)?;

        // 保存到独立缓存文件
        Self::save_platform_cache(platform, &filtered_data)?;

        tracing::info!("✓ Processed and cached {}", platform);
        Ok(filtered_data)
    }

    /// 预处理平台数据（适配数据结构）
    fn preprocess_platform_data(
        platform: &str,
        data: &Value,
    ) -> Result<Value, Box<dyn std::error::Error>> {
        let mut processed = data.clone();

        match platform {
            "bilibili" => {
                // 适配: user -> user_info
                if let Some(user) = data.get("user") {
                    if let Some(obj) = processed.as_object_mut() {
                        obj.insert("user_info".to_string(), user.clone());
                    }
                }

                // 适配: favorites -> videos (提取所有视频)
                if let Some(favorites) = data.get("favorites").and_then(|v| v.as_array()) {
                    let mut all_videos = Vec::new();
                    for fav in favorites {
                        if let Some(vids) = fav.get("videos").and_then(|v| v.as_array()) {
                            all_videos.extend_from_slice(vids);
                        }
                    }
                    if let Some(obj) = processed.as_object_mut() {
                        obj.insert("videos".to_string(), Value::Array(all_videos));
                    }
                }
            }
            "steam" => {
                // 适配: user -> user_info
                if let Some(user) = data.get("user") {
                    if let Some(obj) = processed.as_object_mut() {
                        obj.insert("user_info".to_string(), user.clone());
                    }
                }

                // 适配: games -> owned_games.games
                if let Some(games) = data.get("games") {
                    if let Some(obj) = processed.as_object_mut() {
                        obj.insert(
                            "owned_games".to_string(),
                            serde_json::json!({ "games": games }),
                        );
                        obj.insert(
                            "recently_played".to_string(),
                            serde_json::json!({ "games": games }),
                        );
                    }
                }
            }
            "netease" => {
                // 适配: liked_songs -> playlists[0].tracks 和 songs
                if let Some(liked_songs) = data.get("liked_songs") {
                    if let Some(obj) = processed.as_object_mut() {
                        obj.insert(
                            "playlists".to_string(),
                            serde_json::json!([{ "tracks": liked_songs }]),
                        );
                        obj.insert("songs".to_string(), liked_songs.clone());
                    }
                }
            }
            "github" => {
                // GitHub 数据通常不需要特殊预处理
            }
            _ => {}
        }

        Ok(processed)
    }

    /// 保存平台缓存到独立文件
    fn save_platform_cache(
        platform: &str,
        data: &SmartFilteredData,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let cache_dir = Path::new("./cache/platforms");
        fs::create_dir_all(cache_dir)?;

        let cache_file = cache_dir.join(format!("{}_filtered.json", platform));
        let json_str = serde_json::to_string_pretty(data)?;
        fs::write(&cache_file, json_str)?;

        tracing::debug!("Saved {} cache to {:?}", platform, cache_file);
        Ok(())
    }

    /// 从独立缓存文件加载平台数据
    pub fn load_platform_cache(
        platform: &str,
    ) -> Result<SmartFilteredData, Box<dyn std::error::Error>> {
        let cache_file = Path::new("./cache/platforms").join(format!("{}_filtered.json", platform));

        if !cache_file.exists() {
            return Err(format!("Cache file not found for platform: {}", platform).into());
        }

        let content = fs::read_to_string(&cache_file)?;
        let data: SmartFilteredData = serde_json::from_str(&content)?;

        tracing::debug!("Loaded {} from cache", platform);
        Ok(data)
    }

    /// 检查平台缓存是否存在
    pub fn has_platform_cache(platform: &str) -> bool {
        let cache_file = Path::new("./cache/platforms").join(format!("{}_filtered.json", platform));
        cache_file.exists()
    }

    /// 清除平台缓存
    pub fn clear_platform_cache(platform: &str) -> Result<(), Box<dyn std::error::Error>> {
        let cache_file = Path::new("./cache/platforms").join(format!("{}_filtered.json", platform));
        if cache_file.exists() {
            fs::remove_file(&cache_file)?;
            tracing::info!("Cleared cache for {}", platform);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;

    #[test]
    fn test_smart_filter_integration() {
        // Read from the new split raw data files
        let raw_dir = Path::new("cache/raw");
        if !raw_dir.exists() {
            println!(
                "Skipping test: cache/raw directory not found at {:?}",
                raw_dir
            );
            return;
        }

        let mut all_data = serde_json::Map::new();

        // Load all platform files
        if let Ok(entries) = fs::read_dir(raw_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Some(platform_name) = path.file_stem().and_then(|s| s.to_str()) {
                        if let Ok(content) = fs::read_to_string(&path) {
                            if let Ok(json) = serde_json::from_str(&content) {
                                all_data.insert(platform_name.to_string(), json);
                            }
                        }
                    }
                }
            }
        }

        if all_data.is_empty() {
            println!("Skipping test: No platform data files found in cache/raw");
            return;
        }

        let data = Value::Object(all_data);

        let mut all_filtered_data = std::collections::HashMap::new();

        // 1. Process Bilibili
        if let Some(bilibili_data) = data.get("bilibili") {
            println!("Processing Bilibili data...");
            let mut test_data = bilibili_data.clone();

            // Patch user_info if missing
            if test_data.get("user_info").is_none() {
                if let Some(obj) = test_data.as_object_mut() {
                    obj.insert(
                        "user_info".to_string(),
                        serde_json::json!({
                            "name": "TestUser",
                            "mid": 123456,
                            "level": 6,
                            "follower": 100,
                            "following": 20
                        }),
                    );
                }
            }

            // Patch videos from favorites if missing
            if test_data.get("videos").is_none() {
                if let Some(favs) = test_data.get("favorites").and_then(|v| v.as_array()) {
                    let mut all_videos = Vec::new();
                    for fav in favs {
                        if let Some(vids) = fav.get("videos").and_then(|v| v.as_array()) {
                            for v in vids {
                                all_videos.push(v.clone());
                            }
                        }
                    }
                    if let Some(obj) = test_data.as_object_mut() {
                        obj.insert("videos".to_string(), Value::Array(all_videos));
                    }
                }
            }

            match SmartFilter::filter("bilibili", &test_data) {
                Ok(result) => {
                    all_filtered_data.insert("bilibili".to_string(), result);
                }
                Err(e) => println!("Bilibili filter failed: {}", e),
            }
        }

        // 2. Process Steam
        if let Some(steam_data) = data.get("steam") {
            println!("Processing Steam data...");
            let mut test_data = steam_data.clone();
            if test_data.get("user_info").is_none() {
                if let Some(obj) = test_data.as_object_mut() {
                    obj.insert(
                        "user_info".to_string(),
                        serde_json::json!({
                            "personaname": "SteamUser",
                            "steamid": "123456789"
                        }),
                    );
                }
            }

            match SmartFilter::filter("steam", &test_data) {
                Ok(result) => {
                    all_filtered_data.insert("steam".to_string(), result);
                }
                Err(e) => println!("Steam filter failed: {}", e),
            }
        }

        // 3. Process Netease
        if let Some(netease_data) = data.get("netease") {
            println!("Processing Netease data...");
            let mut test_data = netease_data.clone();
            if test_data.get("profile").is_none() {
                if let Some(obj) = test_data.as_object_mut() {
                    obj.insert(
                        "profile".to_string(),
                        serde_json::json!({
                            "nickname": "MusicUser",
                            "userId": 1001,
                            "level": 8
                        }),
                    );
                }
            }

            if test_data.get("playlists").is_none() {
                let liked_songs = test_data.get("liked_songs").cloned();
                if let Some(liked) = liked_songs {
                    if let Some(obj) = test_data.as_object_mut() {
                        obj.insert(
                            "playlists".to_string(),
                            serde_json::json!([
                                { "tracks": liked }
                            ]),
                        );
                    }
                }
            }

            match SmartFilter::filter("netease", &test_data) {
                Ok(result) => {
                    all_filtered_data.insert("netease".to_string(), result);
                }
                Err(e) => println!("Netease filter failed: {}", e),
            }
        }

        // 4. Process GitHub
        if let Some(github_data) = data.get("github") {
            println!("Processing GitHub data...");
            match SmartFilter::filter("github", github_data) {
                Ok(result) => {
                    all_filtered_data.insert("github".to_string(), result);
                }
                Err(e) => println!("GitHub filter failed: {}", e),
            }
        }

        // Save complete filtered data to file
        let output_path = Path::new("cache/smart_filtered_data.json");
        let json_output =
            serde_json::to_string_pretty(&all_filtered_data).expect("Failed to serialize output");
        fs::write(output_path, json_output).expect("Failed to write output file");
        println!("Successfully generated filtered data at {:?}", output_path);
    }
}
