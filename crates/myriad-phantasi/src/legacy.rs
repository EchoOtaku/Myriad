//! One-shot brew → phantasi rename catalog.
//!
//! Temporary: delete this module after every deployed instance has upgraded.
//! Backend migrations execute the SQL; this crate only lists the mapping.

pub const OLD_MIGRATION_NAME: &str = "003_brew_system";
pub const NEW_MIGRATION_NAME: &str = "003_phantasi_system";
pub const OLD_SOURCES_TABLE: &str = "brew_sources";
pub const NEW_SOURCES_TABLE: &str = "phantasi_sources";

pub const TABLES: &[(&str, &str)] = &[
    ("brew_sources", "phantasi_sources"),
    ("brew_items", "phantasi_items"),
    ("brew_user_states", "phantasi_user_states"),
    ("brew_categories", "phantasi_categories"),
    ("brew_annotations", "phantasi_annotations"),
    ("brew_podcasts", "phantasi_podcasts"),
    ("brew_comments", "phantasi_comments"),
    ("brew_note_docs", "phantasi_note_docs"),
];

pub const INDEXES: &[(&str, &str)] = &[
    ("idx_brew_sources_user_id", "idx_phantasi_sources_user_id"),
    ("idx_brew_sources_user_url", "idx_phantasi_sources_user_url"),
    ("idx_brew_sources_category", "idx_phantasi_sources_category"),
    ("idx_brew_sources_schedule", "idx_phantasi_sources_schedule"),
    ("idx_brew_items_source_guid", "idx_phantasi_items_source_guid"),
    ("idx_brew_items_published", "idx_phantasi_items_published"),
    ("idx_brew_items_timeline", "idx_phantasi_items_timeline"),
    ("idx_brew_items_topic", "idx_phantasi_items_topic"),
    (
        "idx_brew_user_states_unique",
        "idx_phantasi_user_states_unique",
    ),
    (
        "idx_brew_user_states_unread",
        "idx_phantasi_user_states_unread",
    ),
    (
        "idx_brew_user_states_starred",
        "idx_phantasi_user_states_starred",
    ),
    (
        "idx_brew_categories_unique",
        "idx_phantasi_categories_unique",
    ),
    ("idx_brew_annotations_item", "idx_phantasi_annotations_item"),
    ("idx_brew_podcasts_item", "idx_phantasi_podcasts_item"),
    ("idx_brew_comments_item", "idx_phantasi_comments_item"),
    ("idx_brew_comments_user", "idx_phantasi_comments_user"),
    (
        "idx_brew_comments_item_user",
        "idx_phantasi_comments_item_user",
    ),
    ("idx_brew_note_docs_user", "idx_phantasi_note_docs_user"),
    ("idx_brew_note_docs_item", "idx_phantasi_note_docs_item"),
    (
        "idx_brew_note_docs_schedule",
        "idx_phantasi_note_docs_schedule",
    ),
];

pub const FOREIGN_KEYS: &[(&str, &str, &str)] = &[
    ("brew_items", "fk_brew_items_source", "fk_phantasi_items_source"),
    (
        "brew_user_states",
        "fk_brew_user_states_item",
        "fk_phantasi_user_states_item",
    ),
    (
        "brew_annotations",
        "fk_brew_annotations_item",
        "fk_phantasi_annotations_item",
    ),
    (
        "brew_podcasts",
        "fk_brew_podcasts_item",
        "fk_phantasi_podcasts_item",
    ),
    (
        "brew_comments",
        "fk_brew_comments_item",
        "fk_phantasi_comments_item",
    ),
];

pub const FUNCTIONS: &[(&str, &str)] = &[
    (
        "brew_advance_state_revision",
        "phantasi_advance_state_revision",
    ),
    (
        "brew_advance_content_revision",
        "phantasi_advance_content_revision",
    ),
];

/// `(table, old_trigger, new_trigger)`
pub const TRIGGERS: &[(&str, &str, &str)] = &[
    (
        "brew_user_states",
        "brew_state_revision",
        "phantasi_state_revision",
    ),
    (
        "brew_items",
        "brew_content_revision",
        "phantasi_content_revision",
    ),
];

/// Ordered text replacements for stored HTML / JSON / config blobs.
/// Longer / more specific prefixes first so `brewlia` is not eaten by `brew`.
pub const TEXT_REPLACEMENTS: &[(&str, &str)] = &[
    ("/api/brewlia/", "/api/phantasiai/"),
    ("/api/brew/", "/api/phantasi/"),
    ("/brew/articles/", "/phantasi/articles/"),
    ("/brew/item/", "/phantasi/item/"),
    ("/brew/notes.xml", "/phantasi/notes.xml"),
    ("brewlia-annotation", "phantasiai-annotation"),
    ("brew-embed-", "phantasi-embed-"),
    ("brew-article", "phantasi-article"),
    ("brew-recommend", "phantasi-recommend"),
    ("brew-source", "phantasi-source"),
    ("brew-topic", "phantasi-topic"),
    ("brew-featured", "phantasi-featured"),
    ("brew_item_id", "phantasi_item_id"),
    ("brew_new_items", "phantasi_new_items"),
    ("brew_source_error", "phantasi_source_error"),
    ("brew_open_source", "phantasi_open_source"),
    ("brew_open_item", "phantasi_open_item"),
    ("brew_notes_rss", "phantasi_notes_rss"),
    ("user_perm_brew_comment_write", "user_perm_phantasi_comment_write"),
    ("guest_perm_brew_comment_write", "guest_perm_phantasi_comment_write"),
    ("brew:commentWrite", "phantasi:commentWrite"),
    ("brew:manage", "phantasi:manage"),
    ("brew:write", "phantasi:write"),
    ("brew:read", "phantasi:read"),
    ("brew.new_items", "phantasi.new_items"),
    ("brew.source_error", "phantasi.source_error"),
    ("\"brewlia\"", "\"phantasiai\""),
    ("'brewlia'", "'phantasiai'"),
];

pub fn rewrite_stored_text(input: &str) -> String {
    let mut out = input.to_string();
    for (from, to) in TEXT_REPLACEMENTS {
        if out.contains(from) {
            out = out.replace(from, to);
        }
    }
    out
}

/// Rewrite a JSON object that uses `"brew"` as a map key (module visibility,
/// notification sources). Does not touch unrelated string values.
pub fn rename_json_brew_key(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(child) = map.remove("brew") {
                map.insert("phantasi".into(), child);
            }
            for child in map.values_mut() {
                rename_json_brew_key(child);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                rename_json_brew_key(item);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrite_orders_brewlia_before_brew() {
        let raw = r#"<img src="/api/brewlia/x"><img src="/api/brew/image-cache/a.png" class="brewlia-annotation brew-embed-card">"#;
        let out = rewrite_stored_text(raw);
        assert!(out.contains("/api/phantasiai/x"));
        assert!(out.contains("/api/phantasi/image-cache/a.png"));
        assert!(out.contains("phantasiai-annotation"));
        assert!(out.contains("phantasi-embed-card"));
        assert!(!out.contains("brew"));
    }

    #[test]
    fn json_key_rename_is_structural() {
        let mut value = serde_json::json!({
            "modules": { "brew": "all", "library": "all" },
            "title": "keep brew in values only if not a key"
        });
        rename_json_brew_key(&mut value);
        assert_eq!(value["modules"]["phantasi"], "all");
        assert!(value["modules"].get("brew").is_none());
    }

    #[test]
    fn retired_comment_permission_is_not_mapped() {
        let raw = "brew:comment";
        let out = rewrite_stored_text(raw);
        assert_eq!(out, "brew:comment");
    }
}
