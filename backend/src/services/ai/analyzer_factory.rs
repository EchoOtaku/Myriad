//! AI 分析器工厂
//!
//! 统一创建 AI 分析器实例，支持 OpenAI 和 Gemini

use crate::services::analyzer::{AiAnalyzer, AiProvider};
use crate::GLOBAL_DYNAMIC_CONFIG;

/// 创建 AI 分析器实例
///
/// 按优先级尝试：OpenAI > Gemini
/// 这是一个通用工厂函数，被 executor、intent、mod 等多个模块使用
pub async fn create_ai_analyzer() -> Option<AiAnalyzer> {
    let config = GLOBAL_DYNAMIC_CONFIG.read().await;

    // 优先使用 OpenAI
    if let Some(key) = &config.openai_api_key {
        if !key.is_empty() {
            let model = if config.openai_model.is_empty() {
                "gpt-4o-mini".to_string()
            } else {
                config.openai_model.clone()
            };
            let base_url = if config.openai_base_url.is_empty() {
                None
            } else {
                Some(config.openai_base_url.clone())
            };
            return Some(AiAnalyzer::new(
                AiProvider::OpenAI,
                key.clone(),
                model,
                base_url,
            ).await);
        }
    }

    // 其次使用 Gemini
    if let Some(key) = &config.gemini_api_key {
        if !key.is_empty() {
            let model = if config.gemini_model.is_empty() {
                "gemini-3-flash-preview".to_string()
            } else {
                config.gemini_model.clone()
            };
            return Some(AiAnalyzer::new(
                AiProvider::Gemini,
                key.clone(),
                model,
                None,
            ).await);
        }
    }

    None
}

/// 创建指定提供商的 AI 分析器
#[allow(dead_code)]
pub async fn create_ai_analyzer_with_provider(provider: AiProvider) -> Option<AiAnalyzer> {
    let config = GLOBAL_DYNAMIC_CONFIG.read().await;

    match provider {
        AiProvider::OpenAI => {
            if let Some(key) = &config.openai_api_key {
                if !key.is_empty() {
                    let model = if config.openai_model.is_empty() {
                        "gpt-4o-mini".to_string()
                    } else {
                        config.openai_model.clone()
                    };
                    let base_url = if config.openai_base_url.is_empty() {
                        None
                    } else {
                        Some(config.openai_base_url.clone())
                    };
                    return Some(AiAnalyzer::new(
                        AiProvider::OpenAI,
                        key.clone(),
                        model,
                        base_url,
                    ).await);
                }
            }
        }
        AiProvider::Gemini => {
            if let Some(key) = &config.gemini_api_key {
                if !key.is_empty() {
                    let model = if config.gemini_model.is_empty() {
                        "gemini-3-flash-preview".to_string()
                    } else {
                        config.gemini_model.clone()
                    };
                    return Some(AiAnalyzer::new(
                        AiProvider::Gemini,
                        key.clone(),
                        model,
                        None,
                    ).await);
                }
            }
        }
    }

    None
}

/// 获取当前配置的 Gemini API 信息（用于 Grounding 搜索等）
#[allow(dead_code)]
pub async fn get_gemini_config() -> Option<(String, String)> {
    let config = GLOBAL_DYNAMIC_CONFIG.read().await;

    if let Some(key) = &config.gemini_api_key {
        if !key.is_empty() {
            let model = if config.gemini_model.is_empty() {
                "gemini-3-flash-preview".to_string()
            } else {
                config.gemini_model.clone()
            };
            return Some((key.clone(), model));
        }
    }

    None
}
