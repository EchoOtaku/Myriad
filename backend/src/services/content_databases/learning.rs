#![allow(dead_code)]

use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tracing::{error, info};

lazy_static! {
    pub static ref UNKNOWN_STATS: Mutex<UnknownContentStats> =
        Mutex::new(UnknownContentStats::new());
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnknownContentStats {
    // Key: "Platform:Title" -> Count
    pub stats: HashMap<String, usize>,
    #[serde(skip)]
    dirty: bool,
}

impl UnknownContentStats {
    pub fn new() -> Self {
        let mut stats = Self {
            stats: HashMap::new(),
            dirty: false,
        };
        stats.load();
        stats
    }

    fn get_file_path() -> &'static Path {
        let path = Path::new("backend/data/unknown_content_stats.json");
        // Simple check to see if we are in root or backend dir
        if Path::new("backend").exists() {
            path
        } else {
            Path::new("data/unknown_content_stats.json")
        }
    }

    pub fn load(&mut self) {
        let path = Self::get_file_path();
        if path.exists() {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(data) = serde_json::from_str::<HashMap<String, usize>>(&content) {
                    self.stats = data;
                    info!("Loaded {} unknown content stats", self.stats.len());
                } else {
                    error!("Failed to parse unknown content stats JSON");
                }
            }
        }
    }

    pub fn save(&mut self) {
        if !self.dirty {
            return;
        }

        let path = Self::get_file_path();
        // Ensure directory exists
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        if let Ok(content) = serde_json::to_string_pretty(&self.stats) {
            if let Err(e) = fs::write(path, content) {
                error!("Failed to save unknown content stats: {}", e);
            } else {
                self.dirty = false;
            }
        }
    }

    pub fn record(&mut self, platform: &str, title: &str) {
        let key = format!("{}:{}", platform, title);
        *self.stats.entry(key).or_insert(0) += 1;
        self.dirty = true;
        // Don't save immediately to avoid lock contention and OS errors
    }

    pub fn remove(&mut self, platform: &str, title: &str) {
        let key = format!("{}:{}", platform, title);
        if self.stats.remove(&key).is_some() {
            self.dirty = true;
            // Don't save immediately
        }
    }

    /// Explicitly save stats to disk
    pub fn flush(&mut self) {
        self.save();
    }
}

/// Record an unknown content item to the statistics file
pub fn record_unknown(platform: &str, title: &str) {
    if let Ok(mut stats) = UNKNOWN_STATS.lock() {
        stats.record(platform, title);
    }
}

/// Remove an item from statistics (e.g. after learning)
pub fn remove_unknown(platform: &str, title: &str) {
    if let Ok(mut stats) = UNKNOWN_STATS.lock() {
        stats.remove(platform, title);
    }
}

/// Flush unknown content stats to disk
pub fn flush_unknown_stats() {
    if let Ok(mut stats) = UNKNOWN_STATS.lock() {
        stats.flush();
    }
}
