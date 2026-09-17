//! Best-effort secret redaction for logs and JSON error bodies.
//!
//! Replaces known env values (`UPDATE_TOKEN`, `DOCKER_GUARD_SELF_UPDATE_TOKEN`,
//! `UPDATER_GATEWAY_SECRET`, `JWT_SECRET`,
//! `POSTGRES_PASSWORD`, `PERSONA_DB_PASSWORD`, `FEDERATION_DB_PASSWORD`,
//! `GITHUB_TOKEN`) and a few common header/URL patterns so
//! accidental echo of secrets does not leak into operator-facing output.

use once_cell::sync::Lazy;
use regex::Regex;

static AUTHORIZATION_VALUE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)(?P<prefix>(?:proxy-)?authorization["']?\s*:\s*).*$"#)
        .expect("valid authorization regex")
});

/// Env keys whose values must never appear in logs or error bodies.
const SECRET_ENV_KEYS: &[&str] = &[
    "UPDATE_TOKEN",
    "DOCKER_GUARD_SELF_UPDATE_TOKEN",
    "UPDATER_GATEWAY_SECRET",
    "JWT_SECRET",
    "POSTGRES_PASSWORD",
    "PERSONA_DB_PASSWORD",
    "FEDERATION_DB_PASSWORD",
    "GITHUB_TOKEN",
];

/// Redact known secrets from `input`. Safe to call on every error path.
pub fn redact_secrets(input: &str) -> String {
    let mut out = input.to_string();
    for key in SECRET_ENV_KEYS {
        if let Ok(val) = std::env::var(key) {
            let val = val.trim();
            if val.len() >= 8 && out.contains(val) {
                out = out.replace(val, &format!("[{key}_REDACTED]"));
            }
        }
    }
    out = AUTHORIZATION_VALUE
        .replace_all(&out, "${prefix}[REDACTED]")
        .into_owned();
    // Header / query patterns even when env is unavailable in this process.
    out = redact_pattern(&out, "Bearer ");
    out = redact_pattern(&out, "X-Update-Token:");
    out = redact_pattern(&out, "X-Guard-Self-Update-Token:");
    out = redact_pattern(&out, "X-Updater-Gateway-Secret:");
    out = redact_kv_assignment(&out, "password");
    out = redact_kv_assignment(&out, "token");
    out
}

/// After a known prefix (e.g. `Bearer `), replace the following token-ish span.
fn redact_pattern(input: &str, prefix: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let pref_lower = prefix.to_ascii_lowercase();
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    let mut rest_lower = lower.as_str();
    while let Some(idx) = rest_lower.find(&pref_lower) {
        out.push_str(&rest[..idx]);
        out.push_str(prefix);
        let after = &rest[idx + prefix.len()..];
        let after_l = &rest_lower[idx + pref_lower.len()..];
        // Skip whitespace after prefix.
        let trim_start = prefix_len_while(after, char::is_whitespace);
        out.push_str(&after[..trim_start]);
        let token_part = &after[trim_start..];
        let token_len = prefix_len_while(token_part, |c| {
            !c.is_whitespace() && c != '"' && c != '\'' && c != ',' && c != '}'
        });
        if token_len > 0 {
            out.push_str("[REDACTED]");
        }
        rest = &token_part[token_len..];
        rest_lower = &after_l[trim_start + token_len..];
    }
    out.push_str(rest);
    out
}

/// Redact `password=...` / `token=...` style assignments (case-insensitive key).
fn redact_kv_assignment(input: &str, key: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let lower = input.to_ascii_lowercase();
    let needle = format!("{key}=");
    let mut rest = input;
    let mut rest_lower = lower.as_str();
    while let Some(idx) = rest_lower.find(&needle) {
        out.push_str(&rest[..idx + needle.len()]);
        let after = &rest[idx + needle.len()..];
        let after_l = &rest_lower[idx + needle.len()..];
        let val_len = prefix_len_while(after, |c| {
            !c.is_whitespace() && c != '&' && c != '"' && c != '\'' && c != ','
        });
        if val_len > 0 {
            out.push_str("[REDACTED]");
        }
        rest = &after[val_len..];
        rest_lower = &after_l[val_len..];
    }
    out.push_str(rest);
    out
}

fn prefix_len_while(input: &str, predicate: impl Fn(char) -> bool) -> usize {
    input
        .char_indices()
        .find_map(|(index, character)| (!predicate(character)).then_some(index))
        .unwrap_or(input.len())
}

/// Sanitize an actor claim for audit lines: `admin:<id>` or `admin:<id>:<user>`.
/// Returns None if empty or contains unsafe characters.
pub fn sanitize_actor(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() || s.len() > 128 {
        return None;
    }
    if !s
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '-' | '_' | '.' | '@'))
    {
        return None;
    }
    Some(s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_bearer_and_update_token_headers() {
        let s = "upstream 401: Authorization: Bearer supersecrettoken123 X-Update-Token: abcdefghijklmnop X-Guard-Self-Update-Token: guardcapabilitysecret123";
        let r = redact_secrets(s);
        assert!(!r.contains("supersecrettoken123"));
        assert!(!r.contains("abcdefghijklmnop"));
        assert!(!r.contains("guardcapabilitysecret123"));
        assert!(r.contains("[REDACTED]"));
    }

    #[test]
    fn sanitize_actor_accepts_admin_form() {
        assert_eq!(
            sanitize_actor("admin:1:alice").as_deref(),
            Some("admin:1:alice")
        );
        assert!(sanitize_actor("admin:1; DROP").is_none());
        assert!(sanitize_actor("").is_none());
    }

    #[test]
    fn redacts_password_assignment() {
        let s = "connect failed password=hunter2extra and done";
        let r = redact_secrets(s);
        assert!(!r.contains("hunter2extra"));
        assert!(r.contains("password=[REDACTED]"));
    }

    #[test]
    fn redacts_non_ascii_values_without_breaking_utf8_boundaries() {
        let r = redact_secrets("token=秘密 Authorization: 密钥");
        assert_eq!(r, "token=[REDACTED] Authorization: [REDACTED]");
    }

    #[test]
    fn redacts_complete_basic_and_json_authorization_values() {
        for value in [
            "Authorization: Basic dXNlcjpwYXNz",
            r#"{"Authorization":"Digest username=\"u\", response=\"secret\""}"#,
            r#"Authorization: AWS4-HMAC Credential=x, SignedHeaders=host, Signature=secret"#,
            r#"{"Authorization":["Basic dXNlcjpwYXNz"]}"#,
        ] {
            let redacted = redact_secrets(value);
            assert!(!redacted.contains("dXNlcjpwYXNz"), "{redacted}");
            assert!(!redacted.contains("response="), "{redacted}");
            assert!(!redacted.contains("Signature="), "{redacted}");
            assert!(redacted.contains("[REDACTED]"), "{redacted}");
        }
    }
}
