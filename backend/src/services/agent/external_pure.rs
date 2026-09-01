//! Pure helpers for agent external (HTTP / MCP / scrape) handlers.
//!
//! Handlers keep outbound HTTP. Domain owns:
//! - optional string param projection
//! - MCP capability id + argument filtering
//! - HTTP method / body size gates
//! - scrape length clamp and text compression
//! - simple HTML title extraction

use serde_json::{json, Value};
use std::collections::HashMap;

pub use myriad_agent_rules::{
    compress_and_truncate_text, hitokoto_type, http_body_exceeds_limit, http_body_size_error,
    http_content_length_error, http_fetch_method, mcp_arguments, optional_string_param,
    parse_http_body_value, parse_mcp_capability_id, scrape_html_too_large, scrape_max_length,
    scrape_selector, scrape_should_skip_tag, HTTP_FETCH_MAX_BODY_BYTES, SCRAPE_SKIP_TAGS,
    WEB_SCRAPE_DEFAULT_MAX_LENGTH, WEB_SCRAPE_MAX_HTML_BYTES,
};

/// Keep timeout / HTTP status / a short API phrase; drop reqwest and serde dumps.
pub fn classify_outbound_fetch(label: &str, detail: &str) -> String {
    if let Some(status) = http_status_from_text(detail) {
        return format!("{label} (HTTP {status})");
    }
    let lower = detail.to_ascii_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") {
        return format!("{label}: timed out");
    }
    if lower.contains("could not connect")
        || lower.contains("connection refused")
        || lower.contains("error trying to connect")
    {
        return format!("{label}: could not connect");
    }
    if is_internal_outbound_dump(detail) {
        return label.to_string();
    }
    let rest = detail.trim();
    if rest.is_empty() || rest.len() > 120 || rest.starts_with('{') {
        return label.to_string();
    }
    format!("{label}: {rest}")
}

fn http_status_from_text(text: &str) -> Option<u16> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 2 < bytes.len() {
        if bytes[i].is_ascii_digit()
            && bytes[i + 1].is_ascii_digit()
            && bytes[i + 2].is_ascii_digit()
            && (i == 0 || !bytes[i - 1].is_ascii_digit())
            && (i + 3 >= bytes.len() || !bytes[i + 3].is_ascii_digit())
        {
            let code = (bytes[i] - b'0') as u16 * 100
                + (bytes[i + 1] - b'0') as u16 * 10
                + (bytes[i + 2] - b'0') as u16;
            if (400..=599).contains(&code) {
                return Some(code);
            }
        }
        i += 1;
    }
    None
}

fn is_internal_outbound_dump(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    lower.contains("error sending request")
        || lower.contains("builder error")
        || lower.contains("os error")
        || lower.contains("for url (")
        || lower.contains("missing field")
        || lower.contains("at line ")
        || lower.contains("expected value")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn optional_string_and_http_helpers() {
        let mut params = HashMap::new();
        params.insert("username".into(), json!("  ada  "));
        params.insert("empty".into(), json!("  "));
        assert_eq!(
            optional_string_param(&params, "username").as_deref(),
            Some("ada")
        );
        assert!(optional_string_param(&params, "empty").is_none());

        params.insert("method".into(), json!("POST"));
        assert_eq!(http_fetch_method(&params), "POST");
        assert_eq!(http_fetch_method(&HashMap::new()), "GET");

        assert!(!http_body_exceeds_limit(100));
        assert!(http_body_exceeds_limit(HTTP_FETCH_MAX_BODY_BYTES + 1));
        assert!(http_content_length_error(99).contains("99"));
        assert_eq!(parse_http_body_value(r#"{"a":1}"#)["a"], 1);
        assert_eq!(parse_http_body_value("not-json"), json!("not-json"));
    }

    #[test]
    fn mcp_capability_and_arguments() {
        assert_eq!(
            parse_mcp_capability_id("mcp.github.search").unwrap(),
            ("github", "search")
        );
        assert!(parse_mcp_capability_id("github.search").is_err());
        assert!(parse_mcp_capability_id("mcp.only").is_err());

        let params = HashMap::from([
            ("query".to_string(), json!("myriad")),
            ("__directive".to_string(), json!("internal")),
            ("__user_request".to_string(), json!("private")),
            ("__steering".to_string(), json!("new direction")),
        ]);
        assert_eq!(mcp_arguments(&params), json!({ "query": "myriad" }));
    }

    #[test]
    fn scrape_helpers() {
        let mut params = HashMap::new();
        params.insert("selector".into(), json!("article"));
        params.insert("max_length".into(), json!(10));
        assert_eq!(scrape_selector(&params), "article");
        assert_eq!(scrape_max_length(&params), 10);
        assert_eq!(scrape_selector(&HashMap::new()), "body");
        assert_eq!(
            scrape_max_length(&HashMap::new()),
            WEB_SCRAPE_DEFAULT_MAX_LENGTH
        );

        assert!(!scrape_html_too_large(100));
        assert!(scrape_html_too_large(WEB_SCRAPE_MAX_HTML_BYTES + 1));

        let (text, truncated) = compress_and_truncate_text("  a   b  c  d  e  ", 5);
        assert!(truncated);
        assert_eq!(text.chars().count(), 5);
        assert!(scrape_should_skip_tag("script"));
        assert!(!scrape_should_skip_tag("p"));
    }

    #[test]
    fn outbound_fetch_keeps_status_and_drops_reqwest() {
        assert_eq!(
            classify_outbound_fetch(
                "Failed to fetch Bangumi user",
                "Bangumi API error: 404 Not Found"
            ),
            "Failed to fetch Bangumi user (HTTP 404)"
        );
        assert_eq!(
            classify_outbound_fetch(
                "Failed to fetch Bilibili user",
                "error sending request for url (https://api.bilibili.com/x/space/acc/info)"
            ),
            "Failed to fetch Bilibili user"
        );
        assert_eq!(
            classify_outbound_fetch("Failed to fetch weather", "timed out"),
            "Failed to fetch weather: timed out"
        );
        assert_eq!(
            classify_outbound_fetch("Failed to fetch Bilibili user", "用户不存在"),
            "Failed to fetch Bilibili user: 用户不存在"
        );
        assert_eq!(
            classify_outbound_fetch(
                "Failed to fetch hitokoto",
                "expected value at line 1 column 1"
            ),
            "Failed to fetch hitokoto"
        );
    }
}
