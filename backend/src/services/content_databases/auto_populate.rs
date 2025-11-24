#![allow(dead_code)]

use super::anime_database::{AnimeEntry, ContentCategory};
use super::artist_database::ArtistEntry;
use super::game_database::GameEntry;
use super::learning::UNKNOWN_STATS;
use super::remove_unknown;
use super::{AnimeDatabase, ArtistDatabase, GameDatabase};
use serde_json::Value;
use tracing::{info, warn};
use urlencoding::encode;

/// Threshold for auto-learning
const LEARN_THRESHOLD: usize = 10;

pub async fn auto_learn_from_unknown_content() {
    info!("Starting auto-learning process...");

    let mut items_to_learn = Vec::new();

    // 1. Identify high-frequency unknown content
    if let Ok(stats) = UNKNOWN_STATS.lock() {
        for (key, &count) in &stats.stats {
            if count >= LEARN_THRESHOLD {
                items_to_learn.push(key.clone());
            }
        }
    }

    if items_to_learn.is_empty() {
        info!(
            "No content meets the learning threshold ({}).",
            LEARN_THRESHOLD
        );
        return;
    }

    info!("Found {} items to learn.", items_to_learn.len());

    // 2. Process each item
    for key in items_to_learn {
        let parts: Vec<&str> = key.splitn(2, ':').collect();
        if parts.len() != 2 {
            continue;
        }
        let platform = parts[0];
        let title = parts[1];

        match platform {
            "Anime" => {
                if learn_anime(title).await.is_ok() {
                    remove_unknown(platform, title);
                }
            }
            "Game" => {
                if learn_game(title).await.is_ok() {
                    remove_unknown(platform, title);
                }
            }
            "Artist" => {
                if learn_artist(title).await.is_ok() {
                    remove_unknown(platform, title);
                }
            }
            _ => warn!("Unknown platform type: {}", platform),
        }
    }
}

async fn learn_anime(title: &str) -> Result<(), String> {
    info!("Attempting to learn anime: {}", title);
    let client = reqwest::Client::new();
    let encoded_title = encode(title);
    let url = format!(
        "https://api.bgm.tv/search/subject/{}?type=2&responseGroup=medium",
        encoded_title
    );

    let resp = client
        .get(&url)
        .header(
            "User-Agent",
            "Myriad/1.0 (https://github.com/mirai-mamori/Myriad)",
        )
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Bangumi API error: {}", resp.status()));
    }

    let data: Value = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(list) = data["list"].as_array() {
        if let Some(item) = list.first() {
            // Found a match
            let name_cn = item["name_cn"].as_str().unwrap_or("");
            let name = item["name"].as_str().unwrap_or("");
            let final_title = if !name_cn.is_empty() { name_cn } else { name };

            let rating = item["rating"]["score"].as_f64().unwrap_or(0.0) as f32;

            let mut entry = AnimeEntry {
                title: final_title.to_string(),
                category: ContentCategory::Anime,
                genre: vec![],
                rating,
                aliases: vec![name.to_string()],
            };

            // Try to fetch details for genres
            let subject_id = item["id"].as_u64().unwrap_or(0);
            if subject_id > 0 {
                let detail_url = format!("https://api.bgm.tv/v0/subjects/{}", subject_id);
                if let Ok(detail_resp) = client
                    .get(&detail_url)
                    .header("User-Agent", "Myriad/1.0")
                    .send()
                    .await
                {
                    if let Ok(detail_data) = detail_resp.json::<Value>().await {
                        if let Some(tags) = detail_data["tags"].as_array() {
                            entry.genre = tags
                                .iter()
                                .take(3)
                                .filter_map(|t| t["name"].as_str().map(|s| s.to_string()))
                                .collect();
                        }
                    }
                }
            }

            let mut db = AnimeDatabase::new();
            db.add_entry(entry);
            db.save().map_err(|e| e.to_string())?;
            info!("Learned anime: {}", final_title);
            return Ok(());
        }
    }

    Err("No results found".to_string())
}

async fn learn_game(name: &str) -> Result<(), String> {
    info!("Attempting to learn game: {}", name);
    let client = reqwest::Client::new();
    let encoded_name = encode(name);
    // Steam Store Search
    let search_url = format!(
        "https://store.steampowered.com/api/storesearch/?term={}&l=english&cc=US",
        encoded_name
    );

    let resp = client
        .get(&search_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let data: Value = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(items) = data["items"].as_array() {
        if let Some(item) = items.first() {
            let app_id = item["id"].as_u64().unwrap_or(0);
            let title = item["name"].as_str().unwrap_or(name).to_string();

            if app_id > 0 {
                // Fetch details
                let detail_url = format!(
                    "https://store.steampowered.com/api/appdetails?appids={}",
                    app_id
                );
                let detail_resp = client
                    .get(&detail_url)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;
                let detail_data: Value = detail_resp.json().await.map_err(|e| e.to_string())?;

                if let Some(success) = detail_data[app_id.to_string()]["success"].as_bool() {
                    if success {
                        let data = &detail_data[app_id.to_string()]["data"];

                        let genres: Vec<String> = data["genres"]
                            .as_array()
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|g| {
                                        g["description"].as_str().map(|s| s.to_string())
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();

                        let rating =
                            data["metacritic"]["score"].as_f64().unwrap_or(0.0) as f32 / 10.0;

                        let entry = GameEntry {
                            name: title.clone(),
                            genres: genres.clone(),
                            tags: genres,
                            rating: if rating > 0.0 { rating } else { 8.0 },
                        };

                        let mut db = GameDatabase::new();
                        db.add_entry(entry);
                        db.save().map_err(|e| e.to_string())?;
                        info!("Learned game: {}", title);
                        return Ok(());
                    }
                }
            }
        }
    }

    Err("No results found".to_string())
}

async fn learn_artist(name: &str) -> Result<(), String> {
    info!("Attempting to learn artist: {}", name);
    let client = reqwest::Client::new();
    let encoded_name = encode(name);
    let url = format!(
        "http://music.163.com/api/search/get/web?s={}&type=100&offset=0&total=true&limit=1",
        encoded_name
    );

    let resp = client
        .get(&url)
        .header("Referer", "http://music.163.com")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let data: Value = resp.json().await.map_err(|e| e.to_string())?;

    if let Some(artists) = data["result"]["artists"].as_array() {
        if let Some(artist) = artists.first() {
            let artist_name = artist["name"].as_str().unwrap_or(name).to_string();

            let entry = ArtistEntry {
                name: artist_name.clone(),
                genres: vec!["Pop".to_string()], // Default
                region: "Unknown".to_string(),
                style: vec![],
            };

            let mut db = ArtistDatabase::new();
            db.add_entry(entry);
            db.save().map_err(|e| e.to_string())?;
            info!("Learned artist: {}", artist_name);
            return Ok(());
        }
    }

    Err("No results found".to_string())
}
