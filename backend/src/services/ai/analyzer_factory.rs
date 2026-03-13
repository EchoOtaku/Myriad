//! AI 分析器工厂
//!
//! 统一创建 AI 分析器实例，支持 OpenAI 和 Gemini，支持 Standard/Pro 模型层级

use crate::config::ModelTier;
use crate::services::analyzer::{AiAnalyzer, AiProvider};
use crate::GLOBAL_DYNAMIC_CONFIG;

/// 创建标准层级的 AI 分析器（默认，向后兼容）
#[allow(dead_code)]
pub async fn create_ai_analyzer() -> Option<AiAnalyzer> {
    create_ai_analyzer_for_tier(ModelTier::Standard).await
}

/// 根据模型层级创建 AI 分析器
pub async fn create_ai_analyzer_for_tier(tier: ModelTier) -> Option<AiAnalyzer> {
    let config = GLOBAL_DYNAMIC_CONFIG.read().await;
    let resolved = config.resolve_ai_config(tier);

    let api_key = resolved.api_key.filter(|k| !k.is_empty())?;
    let provider = AiProvider::from_str(&resolved.provider);
    let base_url = if resolved.base_url.is_empty() {
        None
    } else {
        Some(resolved.base_url)
    };

    Some(AiAnalyzer::new(provider, api_key, resolved.model, base_url).await)
}

/// 创建指定提供商的 AI 分析器（标准层级）
#[allow(dead_code)]
pub async fn create_ai_analyzer_with_provider(provider: AiProvider) -> Option<AiAnalyzer> {
    let config = GLOBAL_DYNAMIC_CONFIG.read().await;

    match provider {
        AiProvider::OpenAI => {
            let key = config.openai_api_key.clone().filter(|k| !k.is_empty())?;
            let model = if config.openai_model.is_empty() {
                "gpt-5-mini".to_string()
            } else {
                config.openai_model.clone()
            };
            let base_url = if config.openai_base_url.is_empty() {
                None
            } else {
                Some(config.openai_base_url.clone())
            };
            Some(AiAnalyzer::new(AiProvider::OpenAI, key, model, base_url).await)
        }
        AiProvider::Gemini => {
            let key = config.gemini_api_key.clone().filter(|k| !k.is_empty())?;
            let model = if config.gemini_model.is_empty() {
                "gemini-3-flash-preview".to_string()
            } else {
                config.gemini_model.clone()
            };
            Some(AiAnalyzer::new(AiProvider::Gemini, key, model, None).await)
        }
    }
}

/// 获取当前配置的 Gemini API 信息（用于 Grounding 搜索等）
#[allow(dead_code)]
pub async fn get_gemini_config() -> Option<(String, String)> {
    let config = GLOBAL_DYNAMIC_CONFIG.read().await;

    let key = config.gemini_api_key.clone().filter(|k| !k.is_empty())?;
    let model = if config.gemini_model.is_empty() {
        "gemini-3-flash-preview".to_string()
    } else {
        config.gemini_model.clone()
    };
    Some((key, model))
}
