#![allow(dead_code)]
/// 平台元数据过滤器 - 基于5W框架
///
/// 5W框架：
/// - Who: 用户主体信息（昵称、ID、简介等）
/// - What: 核心行为和内容（发布、收藏、游戏等）
/// - When: 时间信息（最近活动、时间范围等）
/// - Where: 地理或平台位置（平台名称、区域等）
/// - Why: 行为动机或目的（兴趣标签、分类等）
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// 5W元数据结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FiveWMetadata {
    /// Who: 用户主体
    pub who: WhoMetadata,
    /// What: 核心活动
    pub what: WhatMetadata,
    /// When: 时间维度
    pub when: WhenMetadata,
    /// Where: 位置维度
    pub r#where: WhereMetadata,
    /// Why: 动机维度
    pub why: WhyMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhoMetadata {
    pub username: Option<String>,
    pub user_id: Option<String>,
    pub bio: Option<String>,
    pub level: Option<String>,
    pub follower_count: Option<i64>,
    pub following_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhatMetadata {
    pub primary_activities: Vec<String>,
    pub content_count: HashMap<String, i64>,
    pub recent_items: Vec<ActivityItem>,
    pub total_interactions: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityItem {
    pub title: String,
    pub r#type: String,
    pub timestamp: Option<String>,
    pub interaction_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhenMetadata {
    pub account_created: Option<String>,
    pub last_active: Option<String>,
    pub time_range: Option<String>,
    pub activity_frequency: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhereMetadata {
    pub platform: String,
    pub region: Option<String>,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhyMetadata {
    pub interests: Vec<String>,
    pub categories: Vec<String>,
    pub tags: Vec<String>,
    pub motivation_keywords: Vec<String>,
}

/// 平台元数据过滤器
pub struct MetadataFilter;

impl MetadataFilter {
    /// 从原始平台数据提取5W元数据
    pub fn extract_metadata(platform: &str, raw_data: &Value) -> Result<FiveWMetadata, String> {
        match platform {
            "bilibili" => Self::extract_bilibili(raw_data),
            "steam" => Self::extract_steam(raw_data),
            "github" => Self::extract_github(raw_data),
            "netease" => Self::extract_netease(raw_data),
            _ => Err(format!("Unsupported platform: {}", platform)),
        }
    }

    /// Bilibili元数据提取
    fn extract_bilibili(data: &Value) -> Result<FiveWMetadata, String> {
        let user_info = data.get("user_info").ok_or("Missing user_info")?;
        let videos = data.get("videos").and_then(|v| v.as_array());
        let favorites = data.get("favorites").and_then(|v| v.as_array());

        let who = WhoMetadata {
            username: user_info
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            user_id: user_info
                .get("mid")
                .and_then(|v| v.as_i64())
                .map(|i| i.to_string()),
            bio: user_info
                .get("sign")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            level: user_info
                .get("level")
                .and_then(|v| v.as_i64())
                .map(|l| format!("Lv{}", l)),
            follower_count: user_info.get("follower").and_then(|v| v.as_i64()),
            following_count: user_info.get("following").and_then(|v| v.as_i64()),
        };

        let mut content_count = HashMap::new();
        let mut recent_items = Vec::new();

        if let Some(vids) = videos {
            content_count.insert("videos".to_string(), vids.len() as i64);
            // 提取最近5个视频
            for video in vids.iter().take(5) {
                if let Some(title) = video.get("title").and_then(|v| v.as_str()) {
                    recent_items.push(ActivityItem {
                        title: title.to_string(),
                        r#type: "video".to_string(),
                        timestamp: video
                            .get("created")
                            .and_then(|v| v.as_i64())
                            .map(|t| t.to_string()),
                        interaction_count: video
                            .get("stat")
                            .and_then(|s| s.get("view"))
                            .and_then(|v| v.as_i64()),
                    });
                }
            }
        }

        if let Some(favs) = favorites {
            content_count.insert("favorites".to_string(), favs.len() as i64);
        }

        let what = WhatMetadata {
            primary_activities: vec!["视频观看".to_string(), "内容收藏".to_string()],
            content_count,
            recent_items,
            total_interactions: None,
        };

        let when = WhenMetadata {
            account_created: None,
            last_active: None,
            time_range: Some("近期".to_string()),
            activity_frequency: Some("活跃".to_string()),
        };

        let r#where = WhereMetadata {
            platform: "Bilibili".to_string(),
            region: Some("中国".to_string()),
            language: Some("中文".to_string()),
        };

        // 从视频标签中提取兴趣
        let mut tags = Vec::new();
        if let Some(vids) = videos {
            for video in vids.iter().take(10) {
                if let Some(tag_list) = video.get("tag").and_then(|v| v.as_str()) {
                    for tag in tag_list.split(',').take(3) {
                        tags.push(tag.trim().to_string());
                    }
                }
            }
        }

        let why = WhyMetadata {
            interests: tags.clone(),
            categories: vec!["视频娱乐".to_string()],
            tags,
            motivation_keywords: vec!["学习".to_string(), "娱乐".to_string()],
        };

        Ok(FiveWMetadata {
            who,
            what,
            when,
            r#where,
            why,
        })
    }

    /// Steam元数据提取
    fn extract_steam(data: &Value) -> Result<FiveWMetadata, String> {
        let user_info = data.get("user_info");
        let owned_games = data
            .get("owned_games")
            .and_then(|v| v.get("games"))
            .and_then(|v| v.as_array());
        let recent_games = data
            .get("recently_played")
            .and_then(|v| v.get("games"))
            .and_then(|v| v.as_array());

        let who = WhoMetadata {
            username: user_info
                .and_then(|u| u.get("personaname"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            user_id: user_info
                .and_then(|u| u.get("steamid"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            bio: None,
            level: None,
            follower_count: None,
            following_count: None,
        };

        let mut content_count = HashMap::new();
        let mut recent_items = Vec::new();

        if let Some(games) = owned_games {
            content_count.insert("owned_games".to_string(), games.len() as i64);
        }

        if let Some(games) = recent_games {
            content_count.insert("recent_games".to_string(), games.len() as i64);
            // 提取最近玩的游戏
            for game in games.iter().take(5) {
                if let Some(name) = game.get("name").and_then(|v| v.as_str()) {
                    recent_items.push(ActivityItem {
                        title: name.to_string(),
                        r#type: "game".to_string(),
                        timestamp: None,
                        interaction_count: game.get("playtime_forever").and_then(|v| v.as_i64()),
                    });
                }
            }
        }

        let what = WhatMetadata {
            primary_activities: vec!["游戏".to_string()],
            content_count,
            recent_items,
            total_interactions: None,
        };

        let when = WhenMetadata {
            account_created: user_info
                .and_then(|u| u.get("timecreated"))
                .and_then(|v| v.as_i64())
                .map(|t| t.to_string()),
            last_active: user_info
                .and_then(|u| u.get("lastlogoff"))
                .and_then(|v| v.as_i64())
                .map(|t| t.to_string()),
            time_range: Some("全时段".to_string()),
            activity_frequency: Some("常规".to_string()),
        };

        let r#where = WhereMetadata {
            platform: "Steam".to_string(),
            region: user_info
                .and_then(|u| u.get("loccountrycode"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            language: Some("英语".to_string()),
        };

        let why = WhyMetadata {
            interests: vec!["游戏".to_string()],
            categories: vec!["电子游戏".to_string()],
            tags: vec![],
            motivation_keywords: vec!["娱乐".to_string(), "休闲".to_string()],
        };

        Ok(FiveWMetadata {
            who,
            what,
            when,
            r#where,
            why,
        })
    }

    /// GitHub元数据提取
    fn extract_github(data: &Value) -> Result<FiveWMetadata, String> {
        let user = data.get("user");
        let repos = data.get("repos").and_then(|v| v.as_array());

        let who = WhoMetadata {
            username: user
                .and_then(|u| u.get("login"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            user_id: user
                .and_then(|u| u.get("id"))
                .and_then(|v| v.as_i64())
                .map(|i| i.to_string()),
            bio: user
                .and_then(|u| u.get("bio"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            level: None,
            follower_count: user
                .and_then(|u| u.get("followers"))
                .and_then(|v| v.as_i64()),
            following_count: user
                .and_then(|u| u.get("following"))
                .and_then(|v| v.as_i64()),
        };

        let mut content_count = HashMap::new();
        let mut recent_items = Vec::new();
        let mut languages = Vec::new();

        if let Some(repos_list) = repos {
            content_count.insert("repositories".to_string(), repos_list.len() as i64);

            // 提取最近的仓库
            for repo in repos_list.iter().take(5) {
                if let Some(name) = repo.get("name").and_then(|v| v.as_str()) {
                    recent_items.push(ActivityItem {
                        title: name.to_string(),
                        r#type: "repository".to_string(),
                        timestamp: repo
                            .get("created_at")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        interaction_count: repo.get("stargazers_count").and_then(|v| v.as_i64()),
                    });
                }

                // 收集编程语言
                if let Some(lang) = repo.get("language").and_then(|v| v.as_str()) {
                    if !languages.contains(&lang.to_string()) {
                        languages.push(lang.to_string());
                    }
                }
            }
        }

        let what = WhatMetadata {
            primary_activities: vec!["代码编写".to_string(), "项目开发".to_string()],
            content_count,
            recent_items,
            total_interactions: user
                .and_then(|u| u.get("public_repos"))
                .and_then(|v| v.as_i64()),
        };

        let when = WhenMetadata {
            account_created: user
                .and_then(|u| u.get("created_at"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            last_active: user
                .and_then(|u| u.get("updated_at"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            time_range: Some("全时段".to_string()),
            activity_frequency: Some("活跃".to_string()),
        };

        let r#where = WhereMetadata {
            platform: "GitHub".to_string(),
            region: user
                .and_then(|u| u.get("location"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            language: Some("英语".to_string()),
        };

        let why = WhyMetadata {
            interests: languages.clone(),
            categories: vec!["编程".to_string(), "开源".to_string()],
            tags: languages,
            motivation_keywords: vec!["开发".to_string(), "学习".to_string()],
        };

        Ok(FiveWMetadata {
            who,
            what,
            when,
            r#where,
            why,
        })
    }

    /// 网易云音乐元数据提取
    fn extract_netease(data: &Value) -> Result<FiveWMetadata, String> {
        let profile = data.get("profile");
        let playlists = data.get("playlists").and_then(|v| v.as_array());

        let who = WhoMetadata {
            username: profile
                .and_then(|p| p.get("nickname"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            user_id: profile
                .and_then(|p| p.get("userId"))
                .and_then(|v| v.as_i64())
                .map(|i| i.to_string()),
            bio: profile
                .and_then(|p| p.get("signature"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            level: profile
                .and_then(|p| p.get("level"))
                .and_then(|v| v.as_i64())
                .map(|l| format!("Lv{}", l)),
            follower_count: profile
                .and_then(|p| p.get("followeds"))
                .and_then(|v| v.as_i64()),
            following_count: profile
                .and_then(|p| p.get("follows"))
                .and_then(|v| v.as_i64()),
        };

        let mut content_count = HashMap::new();
        let mut recent_items = Vec::new();

        if let Some(lists) = playlists {
            content_count.insert("playlists".to_string(), lists.len() as i64);

            // 提取歌单
            for playlist in lists.iter().take(5) {
                if let Some(name) = playlist.get("name").and_then(|v| v.as_str()) {
                    recent_items.push(ActivityItem {
                        title: name.to_string(),
                        r#type: "playlist".to_string(),
                        timestamp: playlist
                            .get("createTime")
                            .and_then(|v| v.as_i64())
                            .map(|t| t.to_string()),
                        interaction_count: playlist.get("trackCount").and_then(|v| v.as_i64()),
                    });
                }
            }
        }

        let what = WhatMetadata {
            primary_activities: vec!["音乐聆听".to_string(), "歌单管理".to_string()],
            content_count,
            recent_items,
            total_interactions: None,
        };

        let when = WhenMetadata {
            account_created: profile
                .and_then(|p| p.get("createTime"))
                .and_then(|v| v.as_i64())
                .map(|t| t.to_string()),
            last_active: None,
            time_range: Some("全时段".to_string()),
            activity_frequency: Some("活跃".to_string()),
        };

        let r#where = WhereMetadata {
            platform: "网易云音乐".to_string(),
            region: Some("中国".to_string()),
            language: Some("中文".to_string()),
        };

        let why = WhyMetadata {
            interests: vec!["音乐".to_string()],
            categories: vec!["音乐".to_string()],
            tags: vec![],
            motivation_keywords: vec!["娱乐".to_string(), "放松".to_string()],
        };

        Ok(FiveWMetadata {
            who,
            what,
            when,
            r#where,
            why,
        })
    }

    /// 计算元数据的Token估算大小（用于优化）
    pub fn estimate_token_size(metadata: &FiveWMetadata) -> usize {
        // 粗略估算：每个字符约0.5个token，JSON结构开销约20%
        let json_str = serde_json::to_string(metadata).unwrap_or_default();
        (json_str.len() as f64 * 0.5 * 1.2) as usize
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extract_bilibili() {
        let data = json!({
            "user_info": {
                "name": "测试用户",
                "mid": 123456,
                "sign": "这是个人简介",
                "level": 6,
                "follower": 1000,
                "following": 500
            },
            "videos": [
                {
                    "title": "测试视频1",
                    "created": 1234567890,
                    "stat": { "view": 10000 },
                    "tag": "科技,编程"
                }
            ]
        });

        let metadata = MetadataFilter::extract_bilibili(&data).unwrap();
        assert_eq!(metadata.who.username, Some("测试用户".to_string()));
        assert_eq!(metadata.r#where.platform, "Bilibili");
    }
}
