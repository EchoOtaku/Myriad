// Platform data fetching service
use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};

pub struct PlatformFetcher {
    client: reqwest::Client,
}

// Bilibili 数据结构
#[derive(Debug, Serialize, Deserialize)]
pub struct BilibiliUserInfo {
    pub mid: i64,
    pub name: String,
    pub face: String,
    pub sign: String,
    pub level: i32,
    pub following: i64,
    pub follower: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BilibiliFavorite {
    pub id: i64,
    pub title: String,
    pub cover: String,
    pub intro: String,
    pub media_count: i32,
    pub fav_state: i32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BilibiliBangumi {
    pub season_id: i64,
    pub title: String,
    pub cover: String,
    pub season_type: i32, // 1: 动画, 2: 电影, 3: 纪录片, 4: 国创, 5: 电视剧
    pub progress: String,
    pub badge: String,
}

// Steam 数据结构
#[derive(Debug, Serialize, Deserialize)]
pub struct SteamUserInfo {
    pub steamid: String,
    pub personaname: String,
    pub profileurl: String,
    pub avatar: String,
    pub avatarfull: String,
    pub timecreated: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SteamGame {
    pub appid: i64,
    pub name: String,
    pub playtime_forever: i32, // 分钟
    pub playtime_2weeks: Option<i32>,
    pub img_icon_url: String,
    pub img_logo_url: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SteamWishlistItem {
    pub appid: i64,
    pub name: String,
    pub capsule: String,
    pub review_score: i32,
    pub review_desc: String,
    pub priority: i32,
}

impl PlatformFetcher {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap(),
        }
    }

    // ==================== Bilibili API ====================
    
    /// 获取 Bilibili 用户基本信息
    pub async fn fetch_bilibili_user(&self, uid: i64) -> Result<BilibiliUserInfo> {
        // 使用不需要WBI签名的旧API端点
        let url = format!("https://api.bilibili.com/x/space/acc/info?mid={}", uid);
        
        let response: serde_json::Value = self.client
            .get(&url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .header("Referer", "https://www.bilibili.com")
            .header("Accept", "application/json, text/plain, */*")
            .send()
            .await?
            .json()
            .await?;

        if response["code"].as_i64() != Some(0) {
            return Err(anyhow!("Bilibili API error: {}", response["message"]));
        }

        let data = &response["data"];
        Ok(BilibiliUserInfo {
            mid: data["mid"].as_i64().unwrap_or(0),
            name: data["name"].as_str().unwrap_or("").to_string(),
            face: data["face"].as_str().unwrap_or("").to_string(),
            sign: data["sign"].as_str().unwrap_or("").to_string(),
            level: data["level"].as_i64().unwrap_or(0) as i32,
            following: data["following"].as_i64().unwrap_or(0),
            follower: data["follower"].as_i64().unwrap_or(0),
        })
    }

    /// 获取 Bilibili 收藏夹列表
    pub async fn fetch_bilibili_favorites(&self, uid: i64) -> Result<Vec<BilibiliFavorite>> {
        let url = format!("https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid={}", uid);
        
        let response: serde_json::Value = self.client
            .get(&url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .send()
            .await?
            .json()
            .await?;

        if response["code"].as_i64() != Some(0) {
            return Err(anyhow!("Bilibili API error: {}", response["message"]));
        }

        let list = response["data"]["list"].as_array()
            .ok_or_else(|| anyhow!("Invalid response format"))?;

        let favorites: Vec<BilibiliFavorite> = list.iter()
            .filter_map(|item| {
                Some(BilibiliFavorite {
                    id: item["id"].as_i64()?,
                    title: item["title"].as_str()?.to_string(),
                    cover: item["cover"].as_str().unwrap_or("").to_string(),
                    intro: item["intro"].as_str().unwrap_or("").to_string(),
                    media_count: item["media_count"].as_i64().unwrap_or(0) as i32,
                    fav_state: item["fav_state"].as_i64().unwrap_or(0) as i32,
                })
            })
            .collect();

        Ok(favorites)
    }

    /// 获取 Bilibili 追番列表（动画）
    pub async fn fetch_bilibili_bangumi(&self, uid: i64, bangumi_type: i32) -> Result<Vec<BilibiliBangumi>> {
        // type: 1=番剧(动画), 2=电影, 3=纪录片, 4=国创, 5=电视剧, 7=综艺
        let url = format!(
            "https://api.bilibili.com/x/space/bangumi/follow/list?vmid={}&type={}&pn=1&ps=50",
            uid, bangumi_type
        );
        
        let response: serde_json::Value = self.client
            .get(&url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
            .send()
            .await?
            .json()
            .await?;

        if response["code"].as_i64() != Some(0) {
            return Err(anyhow!("Bilibili API error: {}", response["message"]));
        }

        let list = response["data"]["list"].as_array()
            .ok_or_else(|| anyhow!("Invalid response format"))?;

        let bangumi: Vec<BilibiliBangumi> = list.iter()
            .filter_map(|item| {
                Some(BilibiliBangumi {
                    season_id: item["season_id"].as_i64()?,
                    title: item["title"].as_str()?.to_string(),
                    cover: item["cover"].as_str().unwrap_or("").to_string(),
                    season_type: bangumi_type,
                    progress: item["progress"].as_str().unwrap_or("").to_string(),
                    badge: item["badge"].as_str().unwrap_or("").to_string(),
                })
            })
            .collect();

        Ok(bangumi)
    }

    /// 获取所有 Bilibili 追番/追剧数据
    pub async fn fetch_all_bilibili_bangumi(&self, uid: i64) -> Result<Vec<BilibiliBangumi>> {
        let mut all_bangumi = Vec::new();
        
        // 1: 番剧(动画), 2: 电影, 3: 纪录片, 4: 国创, 5: 电视剧
        for bangumi_type in [1, 2, 3, 4, 5] {
            match self.fetch_bilibili_bangumi(uid, bangumi_type).await {
                Ok(mut items) => all_bangumi.append(&mut items),
                Err(e) => tracing::warn!("Failed to fetch Bilibili bangumi type {}: {}", bangumi_type, e),
            }
            // 避免请求过快
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }

        Ok(all_bangumi)
    }

    // ==================== Steam API ====================
    
    /// 获取 Steam 用户信息
    pub async fn fetch_steam_user(&self, api_key: &str, steam_id: &str) -> Result<SteamUserInfo> {
        let url = format!(
            "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key={}&steamids={}",
            api_key, steam_id
        );
        
        let response: serde_json::Value = self.client
            .get(&url)
            .send()
            .await?
            .json()
            .await?;

        let players = response["response"]["players"].as_array()
            .ok_or_else(|| anyhow!("No player data found"))?;

        if players.is_empty() {
            return Err(anyhow!("Steam user not found"));
        }

        let player = &players[0];
        Ok(SteamUserInfo {
            steamid: player["steamid"].as_str().unwrap_or("").to_string(),
            personaname: player["personaname"].as_str().unwrap_or("").to_string(),
            profileurl: player["profileurl"].as_str().unwrap_or("").to_string(),
            avatar: player["avatar"].as_str().unwrap_or("").to_string(),
            avatarfull: player["avatarfull"].as_str().unwrap_or("").to_string(),
            timecreated: player["timecreated"].as_i64(),
        })
    }

    /// 获取 Steam 游戏库
    pub async fn fetch_steam_games(&self, api_key: &str, steam_id: &str) -> Result<Vec<SteamGame>> {
        let url = format!(
            "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={}&steamid={}&include_appinfo=1&include_played_free_games=1",
            api_key, steam_id
        );
        
        let response: serde_json::Value = self.client
            .get(&url)
            .send()
            .await?
            .json()
            .await?;

        let games = response["response"]["games"].as_array()
            .ok_or_else(|| anyhow!("No games data found"))?;

        let game_list: Vec<SteamGame> = games.iter()
            .filter_map(|game| {
                Some(SteamGame {
                    appid: game["appid"].as_i64()?,
                    name: game["name"].as_str()?.to_string(),
                    playtime_forever: game["playtime_forever"].as_i64().unwrap_or(0) as i32,
                    playtime_2weeks: game["playtime_2weeks"].as_i64().map(|v| v as i32),
                    img_icon_url: game["img_icon_url"].as_str().unwrap_or("").to_string(),
                    img_logo_url: game["img_logo_url"].as_str().unwrap_or("").to_string(),
                })
            })
            .collect();

        Ok(game_list)
    }

    /// 获取 Steam 愿望单
    pub async fn fetch_steam_wishlist(&self, steam_id: &str) -> Result<Vec<SteamWishlistItem>> {
        let url = format!("https://store.steampowered.com/wishlist/profiles/{}/wishlistdata/", steam_id);
        
        let response: serde_json::Value = self.client
            .get(&url)
            .send()
            .await?
            .json()
            .await?;

        let mut wishlist = Vec::new();
        
        if let Some(obj) = response.as_object() {
            for (appid_str, item) in obj {
                if let Ok(appid) = appid_str.parse::<i64>() {
                    wishlist.push(SteamWishlistItem {
                        appid,
                        name: item["name"].as_str().unwrap_or("").to_string(),
                        capsule: item["capsule"].as_str().unwrap_or("").to_string(),
                        review_score: item["review_score"].as_i64().unwrap_or(0) as i32,
                        review_desc: item["review_desc"].as_str().unwrap_or("").to_string(),
                        priority: item["priority"].as_i64().unwrap_or(0) as i32,
                    });
                }
            }
        }

        // 按优先级排序
        wishlist.sort_by(|a, b| a.priority.cmp(&b.priority));

        Ok(wishlist)
    }

    // ==================== GitHub API ====================
    
    /// 获取 GitHub 用户信息（包含粉丝数、仓库数等）
    pub async fn fetch_github_user(&self, username: &str, token: Option<&str>) -> Result<serde_json::Value> {
        let url = format!("https://api.github.com/users/{}", username);
        let mut request = self.client.get(&url)
            .header("User-Agent", "Myriad")
            .header("Accept", "application/vnd.github.v3+json");
        
        if let Some(token) = token {
            request = request.header("Authorization", format!("token {}", token));
        }
        
        let response = request.send().await?;
        
        if !response.status().is_success() {
            return Err(anyhow!("GitHub API error: {}", response.status()));
        }
        
        Ok(response.json().await?)
    }
    
    /// 获取 GitHub 用户的所有公开仓库
    pub async fn fetch_github_repos(&self, username: &str, token: Option<&str>) -> Result<Vec<serde_json::Value>> {
        let mut all_repos = Vec::new();
        let mut page = 1;
        
        loop {
            let url = format!("https://api.github.com/users/{}/repos?per_page=100&page={}&sort=updated", username, page);
            let mut request = self.client.get(&url)
                .header("User-Agent", "Myriad")
                .header("Accept", "application/vnd.github.v3+json");
            
            if let Some(token) = token {
                request = request.header("Authorization", format!("token {}", token));
            }
            
            let response = request.send().await?;
            
            if !response.status().is_success() {
                return Err(anyhow!("GitHub API error: {}", response.status()));
            }
            
            let repos: Vec<serde_json::Value> = response.json().await?;
            
            if repos.is_empty() {
                break;
            }
            
            all_repos.extend(repos);
            page += 1;
            
            // GitHub API 限流保护
            tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        }
        
        Ok(all_repos)
    }
    
    /// 计算 GitHub 用户的总 star 数
    pub async fn fetch_github_stats(&self, username: &str, token: Option<&str>) -> Result<serde_json::Value> {
        // 获取用户信息
        let user_info = self.fetch_github_user(username, token).await?;
        
        // 获取所有仓库
        let repos = self.fetch_github_repos(username, token).await?;
        
        // 计算总 star 数
        let total_stars: i64 = repos.iter()
            .filter_map(|repo| repo["stargazers_count"].as_i64())
            .sum();
        
        // 计算总 fork 数
        let total_forks: i64 = repos.iter()
            .filter_map(|repo| repo["forks_count"].as_i64())
            .sum();
        
        // 统计编程语言
        let mut languages: std::collections::HashMap<String, i32> = std::collections::HashMap::new();
        for repo in &repos {
            if let Some(lang) = repo["language"].as_str() {
                *languages.entry(lang.to_string()).or_insert(0) += 1;
            }
        }
        
        Ok(serde_json::json!({
            "username": user_info["login"],
            "name": user_info["name"],
            "bio": user_info["bio"],
            "avatar_url": user_info["avatar_url"],
            "followers": user_info["followers"],
            "following": user_info["following"],
            "public_repos": user_info["public_repos"],
            "total_stars": total_stars,
            "total_forks": total_forks,
            "top_languages": languages,
            "repos": repos,
        }))
    }
    
    // ==================== X (Twitter) API ====================
    
    /// 获取 X 用户信息
    pub async fn fetch_twitter_user(&self, username: &str, bearer_token: &str) -> Result<serde_json::Value> {
        let url = format!("https://api.twitter.com/2/users/by/username/{}?user.fields=created_at,description,public_metrics,profile_image_url", username);
        
        let response = self.client.get(&url)
            .header("Authorization", format!("Bearer {}", bearer_token))
            .send()
            .await?;
        
        if !response.status().is_success() {
            return Err(anyhow!("Twitter API error: {}", response.status()));
        }
        
        Ok(response.json().await?)
    }
    
    /// 获取 X 用户最近一年的推文数据
    pub async fn fetch_twitter_tweets(&self, user_id: &str, bearer_token: &str) -> Result<Vec<serde_json::Value>> {
        let mut all_tweets = Vec::new();
        let mut pagination_token: Option<String> = None;
        
        // 计算一年前的日期
        let one_year_ago = chrono::Utc::now() - chrono::Duration::days(365);
        let start_time = one_year_ago.format("%Y-%m-%dT%H:%M:%SZ").to_string();
        
        loop {
            let mut url = format!(
                "https://api.twitter.com/2/users/{}/tweets?max_results=100&tweet.fields=created_at,public_metrics,text&start_time={}",
                user_id, start_time
            );
            
            if let Some(token) = &pagination_token {
                url.push_str(&format!("&pagination_token={}", token));
            }
            
            let response = self.client.get(&url)
                .header("Authorization", format!("Bearer {}", bearer_token))
                .send()
                .await?;
            
            if !response.status().is_success() {
                return Err(anyhow!("Twitter API error: {}", response.status()));
            }
            
            let json: serde_json::Value = response.json().await?;
            
            if let Some(data) = json["data"].as_array() {
                all_tweets.extend(data.iter().cloned());
            }
            
            // 检查是否有下一页
            if let Some(next_token) = json["meta"]["next_token"].as_str() {
                pagination_token = Some(next_token.to_string());
                // API 限流保护
                tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;
            } else {
                break;
            }
        }
        
        Ok(all_tweets)
    }
    
    /// 获取 X 用户统计数据（包含一年内推文）
    pub async fn fetch_twitter_stats(&self, username: &str, bearer_token: &str) -> Result<serde_json::Value> {
        // 获取用户信息
        let user_info = self.fetch_twitter_user(username, bearer_token).await?;
        
        let user_id = user_info["data"]["id"].as_str()
            .ok_or_else(|| anyhow!("Failed to get user ID"))?;
        
        // 获取一年内的推文
        let tweets = self.fetch_twitter_tweets(user_id, bearer_token).await?;
        
        // 统计数据
        let total_likes: i64 = tweets.iter()
            .filter_map(|t| t["public_metrics"]["like_count"].as_i64())
            .sum();
        
        let total_retweets: i64 = tweets.iter()
            .filter_map(|t| t["public_metrics"]["retweet_count"].as_i64())
            .sum();
        
        let total_replies: i64 = tweets.iter()
            .filter_map(|t| t["public_metrics"]["reply_count"].as_i64())
            .sum();
        
        Ok(serde_json::json!({
            "user": user_info["data"],
            "tweets_count_year": tweets.len(),
            "total_likes_year": total_likes,
            "total_retweets_year": total_retweets,
            "total_replies_year": total_replies,
            "recent_tweets": tweets,
        }))
    }
}

impl Default for PlatformFetcher {
    fn default() -> Self {
        Self::new()
    }
}
