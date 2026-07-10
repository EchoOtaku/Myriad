//! Runtime configuration loaded from process environment variables.
//! In production compose these come from the host `.env`.

use crate::error::UpdaterError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    /// Required: shared secret for mutating API endpoints. Must be >= 32 chars.
    pub update_token: SecretString,

    /// Release channel to track.
    pub channel: Channel,

    /// Owner/repo on GitHub used to fetch release.json.
    pub github_repo: String,

    /// Optional bearer token for GitHub API (raises rate limit; required for private repos).
    pub github_token: Option<SecretString>,

    /// Optional image mirror prefix (e.g. `mirror.local`). Applied as a rewrite.
    pub registry_mirror: Option<String>,

    /// How often to poll GitHub for new releases. Set to 0 to disable polling.
    pub check_interval_secs: u64,

    /// Cosign signature verification policy. See release::cosign::CosignPolicy.
    /// COSIGN_VERIFY env: off | soft | strict (default: strict).
    pub cosign_verify: String,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Stable,
    Beta,
    Nightly,
}

impl std::fmt::Display for Channel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Channel::Stable => f.write_str("stable"),
            Channel::Beta => f.write_str("beta"),
            Channel::Nightly => f.write_str("nightly"),
        }
    }
}

impl std::str::FromStr for Channel {
    type Err = UpdaterError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "stable" => Ok(Channel::Stable),
            "beta" => Ok(Channel::Beta),
            "nightly" => Ok(Channel::Nightly),
            other => Err(UpdaterError::Config(format!("unknown channel: {other}"))),
        }
    }
}

/// Wrapper to keep secrets out of Debug/log output by accident.
#[derive(Clone, Serialize, Deserialize)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for SecretString {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("<redacted>")
    }
}

impl Config {
    pub fn load_from_env() -> Result<Self, UpdaterError> {
        let token = std::env::var("UPDATE_TOKEN")
            .map_err(|_| UpdaterError::Config("UPDATE_TOKEN is required".into()))?;
        if token.trim().len() < 32 {
            return Err(UpdaterError::Config(
                "UPDATE_TOKEN must be at least 32 characters".into(),
            ));
        }
        if is_weak_token(&token) {
            return Err(UpdaterError::Config(
                "UPDATE_TOKEN appears to be a weak/common value".into(),
            ));
        }

        let channel: Channel = std::env::var("CHANNEL")
            .unwrap_or_else(|_| "stable".into())
            .parse()?;

        let github_repo =
            std::env::var("MYRIAD_GITHUB_REPO").unwrap_or_else(|_| "Myriad-You/Myriad".into());

        let github_token = optional_secret(std::env::var("GITHUB_TOKEN").ok());

        let registry_mirror = std::env::var("REGISTRY_MIRROR")
            .ok()
            .filter(|s| !s.trim().is_empty());

        let check_interval_secs: u64 = std::env::var("CHECK_INTERVAL_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(3600);

        let cosign_verify = std::env::var("COSIGN_VERIFY").unwrap_or_else(|_| "strict".into());

        Ok(Self {
            update_token: SecretString::new(token),
            channel,
            github_repo,
            github_token,
            registry_mirror,
            check_interval_secs,
            cosign_verify,
        })
    }
}

fn is_weak_token(s: &str) -> bool {
    const WEAK: &[&str] = &[
        "admin",
        "password",
        "secret",
        "changeme",
        "test",
        "00000000000000000000000000000000",
        "11111111111111111111111111111111",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ];
    let lower = s.to_ascii_lowercase();
    WEAK.iter().any(|w| lower.contains(w))
}

fn optional_secret(value: Option<String>) -> Option<SecretString> {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .map(SecretString::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channel_parse() {
        assert_eq!("stable".parse::<Channel>().unwrap(), Channel::Stable);
        assert!("foo".parse::<Channel>().is_err());
    }

    #[test]
    fn weak_token_detection() {
        assert!(is_weak_token("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"));
        assert!(is_weak_token("MyPassword12345678901234567890123"));
        assert!(!is_weak_token("9xQ3vN8mP2rT5wY7zA1bC4dF6hJ8kL0n"));
    }

    #[test]
    fn optional_secret_ignores_empty_values() {
        assert!(optional_secret(None).is_none());
        assert!(optional_secret(Some("".into())).is_none());
        assert!(optional_secret(Some("   ".into())).is_none());
        assert_eq!(
            optional_secret(Some(" token-value ".into()))
                .expect("token")
                .expose(),
            "token-value"
        );
    }
}
