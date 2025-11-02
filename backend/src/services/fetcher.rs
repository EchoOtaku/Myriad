// Platform data fetching service
use anyhow::Result;

pub struct PlatformFetcher {
    client: reqwest::Client,
}

impl PlatformFetcher {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    pub async fn fetch_github_profile(&self, token: &str, username: &str) -> Result<serde_json::Value> {
        let url = format!("https://api.github.com/users/{}", username);
        let response = self
            .client
            .get(&url)
            .header("Authorization", format!("token {}", token))
            .header("User-Agent", "Myriad")
            .send()
            .await?
            .json()
            .await?;
        
        Ok(response)
    }

    // TODO: Add other platform fetchers
    // pub async fn fetch_twitter_profile(&self, token: &str, username: &str) -> Result<serde_json::Value>
    // pub async fn fetch_linkedin_profile(&self, token: &str, username: &str) -> Result<serde_json::Value>
}

impl Default for PlatformFetcher {
    fn default() -> Self {
        Self::new()
    }
}
