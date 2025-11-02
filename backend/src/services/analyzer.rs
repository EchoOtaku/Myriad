// AI analysis service using Google Gemini API
use anyhow::{Result, Context};
use reqwest::Client;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: GeminiCandidateContent,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidateContent {
    parts: Vec<GeminiResponsePart>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponsePart {
    text: String,
}

pub struct AiAnalyzer {
    client: Client,
    api_key: String,
    model: String,
}

impl AiAnalyzer {
    pub fn new(api_key: String, model: String) -> Self {
        let client = Client::new();
        Self { client, api_key, model }
    }

    pub async fn analyze_profile(&self, profile_data: &serde_json::Value) -> Result<String> {
        let system_prompt = "You are an expert data analyst specializing in social media and professional profiles.";
        let user_prompt = format!(
            "{}\n\nAnalyze the following user profile data and provide insights on their professional background, skills, interests, and online presence:\n\n{}",
            system_prompt,
            serde_json::to_string_pretty(profile_data)?
        );

        let request_body = GeminiRequest {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart {
                    text: user_prompt,
                }],
            }],
        };

        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
            self.model, self.api_key
        );

        let response = self.client
            .post(&url)
            .json(&request_body)
            .send()
            .await
            .context("Failed to send request to Gemini API")?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(anyhow::anyhow!("Gemini API error {}: {}", status, error_text));
        }

        let gemini_response: GeminiResponse = response
            .json()
            .await
            .context("Failed to parse Gemini API response")?;

        let analysis = gemini_response
            .candidates
            .first()
            .and_then(|c| c.content.parts.first())
            .map(|p| p.text.clone())
            .unwrap_or_else(|| "No analysis generated".to_string());

        Ok(analysis)
    }

    // TODO: Add more analysis methods
    // pub async fn generate_summary(&self, profiles: Vec<serde_json::Value>) -> Result<String>
    // pub async fn extract_skills(&self, profile_data: &serde_json::Value) -> Result<Vec<String>>
}
