//! 意图解析模块
//!
//! 负责将用户自然语言输入解析为结构化的意图。
//! 支持多语言（中文、英文、日文）识别。

mod analyzer;
mod keywords;
mod parser;
mod prompt;

pub use analyzer::IntentAnalyzer;

// 重导出常用类型
pub use super::types::{
    ClarificationPoint, ClarificationType, IntentAction, IntentConstraints, IntentTarget,
    OutputFormat, ParsedIntent, SortOrder, SortSpec, TimeRange,
};
