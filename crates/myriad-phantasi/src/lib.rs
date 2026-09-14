//! Pure Phantasi domain rules.
//!
//! Path constants, source-type literals, and the one-shot brew→phantasi
//! rename catalog. No database, HTTP, or Axum.

pub mod legacy;

/// Module visibility / analytics / notification source key.
pub const MODULE_KEY: &str = "phantasi";

/// REST nest prefix.
pub const API_PREFIX: &str = "/api/phantasi";

/// AI-enhance nest prefix (was `/api/brewlia`).
pub const AI_API_PREFIX: &str = "/api/phantasiai";

/// SPA prefix.
pub const SPA_PREFIX: &str = "/phantasi";

/// Reading-sync websocket path under the API nest.
pub const WS_PATH: &str = "/api/phantasi/ws";

/// Public notes RSS.
pub const NOTES_RSS_PATH: &str = "/phantasi/notes.xml";

/// Platform config key for the notes RSS switch.
pub const NOTES_RSS_PREFERENCES_KEY: &str = "phantasi_notes_rss";

/// `source_type` for AI-enhanced subscriptions.
pub const SOURCE_TYPE_AI: &str = "phantasiai";

/// Subscription pack file extension without the dot.
pub const PIPACK_EXTENSION: &str = "pipack";

pub fn item_path(item_id: i32) -> String {
    format!("/phantasi/item/{item_id}")
}

pub fn article_federation_path(item_id: i32) -> String {
    format!("/phantasi/articles/{item_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_do_not_contain_brew() {
        assert!(!API_PREFIX.contains("brew"));
        assert!(!NOTES_RSS_PATH.contains("brew"));
        assert_eq!(item_path(12), "/phantasi/item/12");
        assert_eq!(SOURCE_TYPE_AI, "phantasiai");
    }
}
