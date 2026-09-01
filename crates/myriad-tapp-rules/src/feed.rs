//! Federation feed merge. Row projection lands in a later slice.

use serde_json::Value;

/// Max items returned by the Tapp federation feed endpoint.
pub const FEDERATION_FEED_LIMIT: usize = 100;

/// Merge personal + public feed items: personal first, dedupe by `activity_id`,
/// newest `received_at` first, truncate to [`FEDERATION_FEED_LIMIT`].
pub fn merge_federation_feed(personal: Vec<Value>, public: Vec<Value>) -> Vec<Value> {
    merge_federation_feed_with_limit(personal, public, FEDERATION_FEED_LIMIT)
}

/// Same as [`merge_federation_feed`] with an explicit limit (testable).
pub fn merge_federation_feed_with_limit(
    mut personal: Vec<Value>,
    public: Vec<Value>,
    limit: usize,
) -> Vec<Value> {
    use std::collections::HashSet;

    let mut seen = HashSet::new();
    personal.retain(|item| {
        item.get("activity_id")
            .and_then(Value::as_str)
            .is_some_and(|id| seen.insert(id.to_string()))
    });
    for item in public {
        let Some(id) = item.get("activity_id").and_then(Value::as_str) else {
            continue;
        };
        if seen.insert(id.to_string()) {
            personal.push(item);
        }
    }
    personal.sort_by(|left, right| {
        let left_time = left
            .get("received_at")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let right_time = right
            .get("received_at")
            .and_then(Value::as_str)
            .unwrap_or_default();
        right_time.cmp(left_time)
    });
    personal.truncate(limit);
    personal
}

/// Drop repeats of the same underlying object, keeping the first (newest) item.
///
/// `DISTINCT ON (activity_id)` in SQL only collapses one activity's duplicate
/// rows. The rooms feed can hold two *different* activity ids describing one
/// post — the author's instance re-delivers a Create under a fresh id, or the
/// same note reaches us both directly and via a peer that mirrored it. Callers
/// must pass an already-sorted list; order is preserved.
///
/// Items without an `object_id` are kept as-is: no id, nothing to compare.
pub fn dedupe_federation_feed(items: Vec<Value>) -> Vec<Value> {
    use std::collections::HashSet;

    let mut seen: HashSet<String> = HashSet::new();
    items
        .into_iter()
        .filter(|item| {
            let Some(object_id) = item
                .get("object_id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
            else {
                return true;
            };
            // Announce and Create of one object are different posts — key on both.
            let activity_type = item
                .get("activity_type")
                .and_then(Value::as_str)
                .unwrap_or_default();
            seen.insert(format!("{activity_type}\u{1f}{object_id}"))
        })
        .collect()
}

/// Guests only see public activities; authenticated subjects merge personal+public.
pub fn federation_feed_includes_personal(subject_id: i32) -> bool {
    subject_id >= 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
            item("b", "2026-01-03T00:00:00Z"),
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
        assert_eq!(FEDERATION_FEED_LIMIT, 100);
        assert!(federation_feed_includes_personal(1));
        assert!(!federation_feed_includes_personal(-1));
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
