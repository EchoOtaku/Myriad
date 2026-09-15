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

/// User-visible SPA prefix. Internal module key stays `phantasi`.
pub const SPA_PREFIX: &str = "/journal";

/// ActivityPub object prefix. Changing article IDs under this path breaks federation.
pub const ARTICLE_OBJECT_PREFIX: &str = "/phantasi";

/// Reading-sync websocket path under the API nest.
pub const WS_PATH: &str = "/api/phantasi/ws";

/// Public notes RSS.
pub const NOTES_RSS_PATH: &str = "/journal/notes.xml";

/// Platform config key for the notes RSS switch.
pub const NOTES_RSS_PREFERENCES_KEY: &str = "phantasi_notes_rss";

/// `source_type` for AI-enhanced subscriptions.
pub const SOURCE_TYPE_AI: &str = "phantasiai";

/// Subscription pack file extension without the dot.
pub const PIPACK_EXTENSION: &str = "pipack";

pub fn item_path(item_id: i32) -> String {
    format!("{SPA_PREFIX}/articles/{item_id}")
}

/// ActivityPub object ID. Changing this breaks federation.
pub fn article_federation_path(item_id: i32) -> String {
    format!("{ARTICLE_OBJECT_PREFIX}/articles/{item_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_do_not_contain_brew() {
        assert!(!API_PREFIX.contains("brew"));
        assert!(!NOTES_RSS_PATH.contains("brew"));
        assert_eq!(item_path(12), "/journal/articles/12");
        assert_eq!(article_federation_path(12), "/phantasi/articles/12");
        assert_eq!(SPA_PREFIX, "/journal");
        assert_eq!(NOTES_RSS_PATH, "/journal/notes.xml");
        assert_eq!(SOURCE_TYPE_AI, "phantasiai");
    }
}
