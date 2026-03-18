//! 语言检测模块
//!
//! 仅保留 Language 枚举和 LanguageDetector，供 Planner 选择 prompt 语言。

/// 支持的语言（仅用于 prompt 语言选择）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Language {
    #[default]
    Chinese,
    English,
    Japanese,
}

impl Language {
    /// 获取语言代码
    #[allow(dead_code)]
    pub fn code(&self) -> &'static str {
        match self {
            Language::Chinese => "zh",
            Language::English => "en",
            Language::Japanese => "ja",
        }
    }
}

/// 语言检测器（用于选择 prompt 语言）
#[derive(Debug, Clone, Default)]
pub struct LanguageDetector;

impl LanguageDetector {
    pub fn new() -> Self {
        Self
    }

    /// 检测输入文本的主要语言
    pub fn detect(&self, text: &str) -> Language {
        let mut has_japanese = false;
        let mut has_chinese = false;
        let mut ascii_count = 0usize;
        let total_chars = text.chars().count();

        for ch in text.chars() {
            // 日文假名（优先检测）
            if ('\u{3040}'..='\u{309f}').contains(&ch)  // 平假名
                || ('\u{30a0}'..='\u{30ff}').contains(&ch)
            // 片假名
            {
                has_japanese = true;
            }
            // 中文汉字
            else if ('\u{4e00}'..='\u{9fff}').contains(&ch) {
                has_chinese = true;
            }
            // ASCII
            else if ch.is_ascii_alphabetic() {
                ascii_count += 1;
            }
        }

        if has_japanese {
            Language::Japanese
        } else if has_chinese {
            Language::Chinese
        } else if total_chars > 0 && ascii_count * 2 > total_chars {
            Language::English
        } else {
            Language::Chinese // 默认
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_detection() {
        let detector = LanguageDetector::new();

        assert_eq!(detector.detect("查看最近的数据"), Language::Chinese);
        assert_eq!(detector.detect("show me recent data"), Language::English);
        assert_eq!(detector.detect("最近のデータを見せて"), Language::Japanese);
    }
}
