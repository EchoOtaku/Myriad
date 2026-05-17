//! Minimal GitHub Release API client. Only needs:
//!   - list releases for a repo (filter by channel)
//!   - download release.json asset from a specific release
//!
//! Respects ETags via a small file cache under state/cache/.

use std::path::PathBuf;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, IF_NONE_MATCH, USER_AGENT};
use reqwest::Client;
use serde::Deserialize;

use crate::config::{Channel, SecretString};
use crate::error::{Result, UpdaterError};
use crate::release::Manifest;
use crate::state::atomic;

pub struct GithubClient {
    repo: String,
    token: Option<SecretString>,
    client: Client,
    cache_dir: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Release {
    pub tag_name: String,
    pub name: Option<String>,
    pub prerelease: bool,
    pub draft: bool,
    pub assets: Vec<Asset>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Asset {
    pub name: String,
    pub browser_download_url: String,
    #[serde(default)]
    pub size: u64,
}

impl GithubClient {
    pub fn new(repo: impl Into<String>, token: Option<SecretString>, cache_dir: PathBuf) -> Result<Self> {
        let client = Client::builder()
            .user_agent("myriad-updater")
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| UpdaterError::Github(format!("client build: {e}")))?;
        Ok(Self {
            repo: repo.into(),
            token,
            client,
            cache_dir,
        })
    }

    fn auth_headers(&self) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert(USER_AGENT, HeaderValue::from_static("myriad-updater"));
        h.insert(ACCEPT, HeaderValue::from_static("application/vnd.github+json"));
        if let Some(t) = &self.token {
            if let Ok(v) = HeaderValue::from_str(&format!("Bearer {}", t.expose())) {
                h.insert(AUTHORIZATION, v);
            }
        }
        h
    }

    /// Returns releases newest-first.
    pub async fn list_releases(&self) -> Result<Vec<Release>> {
        let url = format!("https://api.github.com/repos/{}/releases?per_page=20", self.repo);
        let resp = self
            .client
            .get(&url)
            .headers(self.auth_headers())
            .send()
            .await
            .map_err(|e| UpdaterError::Github(format!("GET releases: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(UpdaterError::Github(format!(
                "GET releases failed: {status} {body}"
            )));
        }
        resp.json::<Vec<Release>>()
            .await
            .map_err(|e| UpdaterError::Github(format!("decode releases: {e}")))
    }

    /// Pick the newest release matching the requested channel (and ignoring drafts).
    pub async fn latest_for_channel(&self, channel: Channel) -> Result<Option<Release>> {
        let releases = self.list_releases().await?;
        Ok(releases.into_iter().find(|r| {
            !r.draft
                && match channel {
                    Channel::Stable => !r.prerelease && !is_marked(&r.tag_name, "nightly") && !is_marked(&r.tag_name, "beta"),
                    Channel::Beta => is_marked(&r.tag_name, "beta") || (!r.prerelease && !is_marked(&r.tag_name, "nightly")),
                    Channel::Nightly => is_marked(&r.tag_name, "nightly"),
                }
        }))
    }

    /// Download release.json for the given tag. Uses ETag/If-None-Match cache.
    pub async fn fetch_manifest(&self, tag: &str) -> Result<Manifest> {
        let release = self.get_release_by_tag(tag).await?;
        let asset = release
            .assets
            .iter()
            .find(|a| a.name == "release.json")
            .ok_or_else(|| UpdaterError::Github(format!("release {tag} has no release.json asset")))?;
        let bytes = self.download_with_cache(tag, asset).await?;
        Manifest::from_json(&bytes)
    }

    async fn get_release_by_tag(&self, tag: &str) -> Result<Release> {
        let url = format!("https://api.github.com/repos/{}/releases/tags/{}", self.repo, tag);
        let resp = self
            .client
            .get(&url)
            .headers(self.auth_headers())
            .send()
            .await
            .map_err(|e| UpdaterError::Github(format!("GET release by tag: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(UpdaterError::Github(format!(
                "GET release {tag} failed: {status} {body}"
            )));
        }
        resp.json::<Release>()
            .await
            .map_err(|e| UpdaterError::Github(format!("decode release: {e}")))
    }

    async fn download_with_cache(&self, tag: &str, asset: &Asset) -> Result<Vec<u8>> {
        std::fs::create_dir_all(&self.cache_dir)?;
        let cache_path = self.cache_dir.join(format!("release-{tag}.json"));
        let etag_path = self.cache_dir.join(format!("release-{tag}.etag"));

        let mut headers = self.auth_headers();
        // The asset download URL returns the binary; accept octet-stream.
        headers.insert(ACCEPT, HeaderValue::from_static("application/octet-stream"));
        if let Ok(etag) = std::fs::read_to_string(&etag_path) {
            if let Ok(v) = HeaderValue::from_str(etag.trim()) {
                headers.insert(IF_NONE_MATCH, v);
            }
        }

        let resp = self
            .client
            .get(&asset.browser_download_url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| UpdaterError::Github(format!("download manifest: {e}")))?;

        if resp.status() == reqwest::StatusCode::NOT_MODIFIED && cache_path.exists() {
            return Ok(std::fs::read(&cache_path)?);
        }
        if !resp.status().is_success() {
            return Err(UpdaterError::Github(format!(
                "download {} failed: {}",
                asset.name,
                resp.status()
            )));
        }

        let etag = resp
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| UpdaterError::Github(format!("read body: {e}")))?
            .to_vec();
        atomic::write_atomic_bytes(&cache_path, &bytes)?;
        if let Some(e) = etag {
            atomic::write_atomic_bytes(&etag_path, e.as_bytes())?;
        }
        Ok(bytes)
    }
}

fn is_marked(tag: &str, marker: &str) -> bool {
    tag.contains(&format!("-{marker}."))
}
