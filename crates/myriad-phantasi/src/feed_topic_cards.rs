//! 订阅墙主题聚合卡：工作台勾选哪些已有主题，像「最新」一样出混排卡。
//!
//! 只解析 `configurations` 里的名单。名单里的名字必须已经在文章主题里出现过。

use std::collections::HashSet;

use serde_json::Value;

/// Platform config key for enabled feed topic cards.
pub const FEED_TOPIC_CARDS_KEY: &str = "phantasi_feed_topic_cards";

/// 认 JSON 字符串数组，或 `{"cards": [...]}`。空、脏值都当没开。
pub fn feed_topic_cards_from_value(value: &Value) -> Vec<String> {
    let list = match value {
        Value::Array(items) => items.as_slice(),
        Value::Object(map) => match map.get("cards") {
            Some(Value::Array(items)) => items.as_slice(),
            _ => return Vec::new(),
        },
        _ => return Vec::new(),
    };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for item in list {
        let Some(name) = item.as_str().map(str::trim).filter(|name| !name.is_empty()) else {
            continue;
        };
        if seen.insert(name.to_string()) {
            out.push(name.to_string());
        }
    }
    out
}

/// 只留现有主题名，去重，保顺序。
pub fn sanitize_feed_topic_cards(raw: &[String], existing: &[String]) -> Vec<String> {
    let have: HashSet<&str> = existing.iter().map(String::as_str).collect();
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for name in raw {
        let name = name.trim();
        if name.is_empty() || !have.contains(name) || !seen.insert(name) {
            continue;
        }
        out.push(name.to_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_array_or_cards_object() {
        assert_eq!(
            feed_topic_cards_from_value(&json!(["Rust", " AI ", "Rust", ""])),
            vec!["Rust", "AI"]
        );
        assert_eq!(
            feed_topic_cards_from_value(&json!({ "cards": ["Rust", 1, "AI"] })),
            vec!["Rust", "AI"]
        );
        assert!(feed_topic_cards_from_value(&json!(true)).is_empty());
        assert!(feed_topic_cards_from_value(&json!(null)).is_empty());
    }

    #[test]
    fn drops_unknown_and_keeps_order() {
        assert_eq!(
            sanitize_feed_topic_cards(
                &["AI".into(), "gone".into(), "AI".into(), "Rust".into()],
                &["Rust".into(), "AI".into()],
            ),
            vec!["AI", "Rust"]
        );
    }
}
