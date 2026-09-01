//! Pure federation feed merge and row projection helpers.
//!
//! SQL loaders and interaction enrichment stay in the API/federation layer.
//! Domain owns personal∪public dedupe, time ordering, and item JSON shape.

use serde_json::{json, Value};

pub use myriad_tapp_rules::{
    dedupe_federation_feed, federation_feed_includes_personal, merge_federation_feed,
    merge_federation_feed_with_limit, FEDERATION_FEED_LIMIT,
};

/// Flat activity row fields required to project a feed item (DB-loader agnostic).
#[derive(Debug, Clone)]
pub struct FederationFeedRowView<'a> {
    pub activity_id: &'a str,
    pub activity_type: &'a str,
    pub object_type: Option<&'a str>,
    pub content_preview: Option<&'a str>,
    pub content_json: Option<&'a Value>,
    pub object_id: Option<&'a str>,
    pub received_at_rfc3339: &'a str,
    pub scope: &'a str,
    pub actor_url: Option<&'a str>,
    pub username: Option<&'a str>,
    pub domain: Option<&'a str>,
    pub display_name: Option<&'a str>,
    pub avatar_url: Option<&'a str>,
    pub is_local: bool,
}

/// Project one activity row into the federation feed JSON contract.
pub fn federation_feed_item(row: FederationFeedRowView<'_>) -> Value {
    let timestamp = row.received_at_rfc3339;
    json!({
        "activity_id": row.activity_id,
        "activity_type": row.activity_type,
        "object_type": row.object_type,
        "content_preview": row.content_preview,
        "content_json": row.content_json,
        "object_id": row.object_id,
        "is_read": false,
        "created_at": timestamp,
        "received_at": timestamp,
        "scope": row.scope,
        "actor": {
            "actor_url": row.actor_url,
            "username": row.username,
            "domain": row.domain,
            "display_name": row.display_name,
            "avatar_url": row.avatar_url,
            "is_local": row.is_local,
        },
    })
}



#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, received_at: &str) -> Value {
        json!({
            "activity_id": id,
            "received_at": received_at,
        })
    }

    #[test]
    fn merge_dedupes_and_orders_newest_first() {
        let personal = vec![
            item("a", "2026-01-01T00:00:00Z"),
            item("b", "2026-01-03T00:00:00Z"),
        ];
        let public = vec![
            item("b", "2026-01-03T00:00:00Z"), // duplicate of personal
            item("c", "2026-01-02T00:00:00Z"),
        ];
        let merged = merge_federation_feed(personal, public);
        let ids: Vec<&str> = merged
            .iter()
            .filter_map(|v| v.get("activity_id").and_then(Value::as_str))
            .collect();
        assert_eq!(ids, vec!["b", "c", "a"]);
    }

    #[test]
    fn merge_truncates_to_limit() {
        let personal: Vec<Value> = (0..5)
            .map(|i| item(&format!("p{i}"), &format!("2026-01-0{i}T00:00:00Z")))
            .collect();
        let public: Vec<Value> = (0..5)
            .map(|i| item(&format!("u{i}"), &format!("2026-02-0{i}T00:00:00Z")))
            .collect();
        let merged = merge_federation_feed_with_limit(personal, public, 3);
        assert_eq!(merged.len(), 3);
    }

    #[test]
    fn feed_item_projection_and_guest_gate() {
        let row = FederationFeedRowView {
            activity_id: "act-1",
            activity_type: "Create",
            object_type: Some("Note"),
            content_preview: Some("hello"),
            content_json: None,
            object_id: Some("obj-1"),
            received_at_rfc3339: "2026-01-01T00:00:00+00:00",
            scope: "public",
            actor_url: Some("https://ex/@ada"),
            username: Some("ada"),
            domain: Some("ex"),
            display_name: Some("Ada"),
            avatar_url: None,
            is_local: true,
        };
        let v = federation_feed_item(row);
        assert_eq!(v["activity_id"], "act-1");
        assert_eq!(v["object_id"], "obj-1");
        assert_eq!(v["is_read"], false);
        assert_eq!(v["actor"]["username"], "ada");
        assert_eq!(v["actor"]["is_local"], true);
        assert_eq!(v["created_at"], v["received_at"]);

        assert!(federation_feed_includes_personal(1));
        assert!(!federation_feed_includes_personal(-1));
        assert_eq!(FEDERATION_FEED_LIMIT, 100);
    }

    fn post(activity_id: &str, activity_type: &str, object_id: &str) -> Value {
        json!({
            "activity_id": activity_id,
            "activity_type": activity_type,
            "object_id": object_id,
        })
    }

    #[test]
    fn dedupe_keeps_first_copy_of_a_repeated_object() {
        let deduped = dedupe_federation_feed(vec![
            post("act-new", "Create", "note-1"),
            post("act-old", "Create", "note-1"),
            post("act-2", "Create", "note-2"),
        ]);
        let ids: Vec<&str> = deduped
            .iter()
            .filter_map(|v| v.get("activity_id").and_then(Value::as_str))
            .collect();
        assert_eq!(ids, vec!["act-new", "act-2"]);
    }

    #[test]
    fn dedupe_treats_announce_as_a_distinct_post() {
        // A repost of a note is its own feed entry — collapsing it into the
        // original would silently drop the reposter from Home.
        let deduped = dedupe_federation_feed(vec![
            post("act-1", "Create", "note-1"),
            post("act-2", "Announce", "note-1"),
        ]);
        assert_eq!(deduped.len(), 2);
    }

    #[test]
    fn dedupe_keeps_items_without_an_object_id() {
        let deduped = dedupe_federation_feed(vec![
            json!({"activity_id": "a", "activity_type": "Create"}),
            json!({"activity_id": "b", "activity_type": "Create", "object_id": ""}),
        ]);
        assert_eq!(deduped.len(), 2);
    }
}
