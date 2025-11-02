// AI analysis service
use anyhow::Result;
use async_openai::{Client, config::OpenAIConfig, types::{ChatCompletionRequestMessage, CreateChatCompletionRequestArgs}};

pub struct AiAnalyzer {
    client: Client<OpenAIConfig>,
    model: String,
}

impl AiAnalyzer {
    pub fn new(api_key: String, model: String) -> Self {
        let config = OpenAIConfig::new().with_api_key(api_key);
        let client = Client::with_config(config);
        Self { client, model }
    }

    pub async fn analyze_profile(&self, profile_data: &serde_json::Value) -> Result<String> {
        let prompt = format!(
            "Analyze the following user profile data and provide insights on their professional background, skills, interests, and online presence:\n\n{}",
            serde_json::to_string_pretty(profile_data)?
        );

        let request = CreateChatCompletionRequestArgs::default()
            .model(&self.model)
            .messages(vec![
                ChatCompletionRequestMessage::System(
                    async_openai::types::ChatCompletionRequestSystemMessageArgs::default()
                        .content("You are an expert data analyst specializing in social media and professional profiles.")
                        .build()?
                ),
                ChatCompletionRequestMessage::User(
                    async_openai::types::ChatCompletionRequestUserMessageArgs::default()
                        .content(prompt)
                        .build()?
                ),
            ])
            .build()?;

        let response = self.client.chat().create(request).await?;
        
        Ok(response.choices[0]
            .message
            .content
            .clone()
            .unwrap_or_else(|| "No analysis generated".to_string()))
    }

    // TODO: Add more analysis methods
    // pub async fn generate_summary(&self, profiles: Vec<serde_json::Value>) -> Result<String>
    // pub async fn extract_skills(&self, profile_data: &serde_json::Value) -> Result<Vec<String>>
}
