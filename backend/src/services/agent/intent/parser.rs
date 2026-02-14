//! AI 响应解析器
//!
//! 负责将 AI 返回的 JSON 响应解析为结构化的 ParsedIntent。

use chrono::{Duration, Utc};
use serde_json::Value;

use super::{
    ClarificationPoint, ClarificationType, IntentAction, IntentConstraints, IntentTarget,
    OutputFormat, ParsedIntent, SortOrder, SortSpec, TimeRange,
};

/// AI 响应解析器
#[derive(Debug, Clone, Default)]
pub struct ResponseParser;

impl ResponseParser {
    pub fn new() -> Self {
        Self
    }

    /// 解析 AI 响应
    pub fn parse(&self, response: &str, original_input: &str) -> Result<ParsedIntent, String> {
        // 提取 JSON
        let json_str = self.extract_json(response);

        let parsed: Value = serde_json::from_str(&json_str)
            .map_err(|e| format!("Failed to parse AI response as JSON: {}", e))?;

        // 构建 ParsedIntent
        let action = parsed
            .get("action")
            .and_then(|v| v.as_str())
            .map(IntentAction::from_verb)
            .unwrap_or(IntentAction::Unknown("ai_parse_failed".to_string()));

        let target = self.parse_target(&parsed);
        let constraints = self.parse_constraints(&parsed);
        let confidence = parsed
            .get("confidence")
            .and_then(|v| v.as_f64())
            .unwrap_or(0.5) as f32;

        let clarifications = self.parse_clarifications(&parsed);
        let sub_intents = self.parse_sub_intents(&parsed, original_input);
        let suggested_capabilities = self.parse_suggested_capabilities(&parsed);
        let unsupported_reason = parsed
            .get("unsupportedReason")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(ParsedIntent {
            id: uuid::Uuid::new_v4().to_string(),
            action,
            target,
            constraints,
            confidence,
            clarifications_needed: clarifications,
            sub_intents,
            suggested_capabilities,
            unsupported_reason,
        })
    }

    /// 从响应中提取 JSON
    fn extract_json(&self, response: &str) -> String {
        // 尝试找到 JSON 块
        if let Some(start) = response.find('{') {
            if let Some(end) = response.rfind('}') {
                return response[start..=end].to_string();
            }
        }
        response.to_string()
    }

    /// 解析目标
    fn parse_target(&self, parsed: &Value) -> IntentTarget {
        if let Some(target) = parsed.get("target") {
            let target_type = target.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let target_value = target.get("value").and_then(|v| v.as_str());

            match target_type {
                "platform" => IntentTarget::Platform(target_value.unwrap_or("unknown").to_string()),
                "report" => IntentTarget::Report(target_value.map(|s| s.to_string())),
                "tapp" => IntentTarget::Tapp(target_value.map(|s| s.to_string())),
                "brew" => IntentTarget::Brew(target_value.map(|s| s.to_string())),
                "music" => IntentTarget::Music(target_value.map(|s| s.to_string())),
                "profile" => IntentTarget::Profile,
                "data" => IntentTarget::Data(target_value.unwrap_or("").to_string()),
                "event" => IntentTarget::Event(target_value.unwrap_or("").to_string()),
                "current_page" => {
                    IntentTarget::CurrentPage(target_value.unwrap_or("unknown").to_string())
                }
                _ => IntentTarget::Unspecified,
            }
        } else {
            IntentTarget::Unspecified
        }
    }

    /// 解析约束条件
    fn parse_constraints(&self, parsed: &Value) -> IntentConstraints {
        let mut constraints = IntentConstraints::default();

        if let Some(c) = parsed.get("constraints") {
            // 解析时间范围
            if let Some(tr) = c.get("timeRange") {
                let now = Utc::now();
                let start_days = tr.get("startDays").and_then(|v| v.as_i64()).unwrap_or(0);
                let end_days = tr.get("endDays").and_then(|v| v.as_i64()).unwrap_or(0);

                constraints.time_range = Some(TimeRange {
                    start: Some(now + Duration::days(start_days)),
                    end: Some(now + Duration::days(end_days)),
                    relative: tr
                        .get("relative")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string()),
                });
            }

            // 解析数量限制
            constraints.limit = c.get("limit").and_then(|v| v.as_u64()).map(|n| n as u32);

            // 解析过滤条件
            if let Some(filters) = c.get("filters").and_then(|v| v.as_object()) {
                for (key, value) in filters {
                    constraints.filters.insert(key.clone(), value.clone());
                }
            }

            // 解析排序
            if let Some(sort) = c.get("sort") {
                let field = sort
                    .get("field")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let order = match sort.get("order").and_then(|v| v.as_str()) {
                    Some("desc") => SortOrder::Desc,
                    _ => SortOrder::Asc,
                };
                if !field.is_empty() {
                    constraints.sort = Some(SortSpec { field, order });
                }
            }

            // 解析输出格式
            if let Some(format) = c.get("outputFormat").and_then(|v| v.as_str()) {
                constraints.output_format = Some(match format {
                    "json" => OutputFormat::Json,
                    "markdown" => OutputFormat::Markdown,
                    "html" => OutputFormat::Html,
                    "chart" => OutputFormat::Chart,
                    _ => OutputFormat::Text,
                });
            }
        }

        constraints
    }

    /// 解析澄清点
    fn parse_clarifications(&self, parsed: &Value) -> Vec<ClarificationPoint> {
        let mut clarifications = Vec::new();

        if let Some(items) = parsed
            .get("clarificationsNeeded")
            .and_then(|v| v.as_array())
        {
            for item in items {
                let clarification_type = match item.get("type").and_then(|v| v.as_str()) {
                    Some("time_range") => ClarificationType::TimeRange,
                    Some("target") => ClarificationType::Target,
                    Some("action") => ClarificationType::Action,
                    Some("missing_parameter") => ClarificationType::MissingParameter,
                    _ => ClarificationType::Ambiguity,
                };

                let question = item
                    .get("question")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let options: Vec<String> = item
                    .get("options")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(|s| s.to_string()))
                            .collect()
                    })
                    .unwrap_or_default();

                let default = item
                    .get("default")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());

                clarifications.push(ClarificationPoint {
                    id: uuid::Uuid::new_v4().to_string(),
                    clarification_type,
                    question,
                    options,
                    default,
                });
            }
        }

        clarifications
    }

    /// 解析子意图
    fn parse_sub_intents(&self, parsed: &Value, _original_input: &str) -> Vec<ParsedIntent> {
        let mut sub_intents = Vec::new();

        if let Some(items) = parsed.get("subIntents").and_then(|v| v.as_array()) {
            for item in items {
                if let Ok(intent) = self.parse(&item.to_string(), "") {
                    sub_intents.push(intent);
                }
            }
        }

        sub_intents
    }

    /// 解析 AI 建议的能力列表
    fn parse_suggested_capabilities(&self, parsed: &Value) -> Vec<String> {
        parsed
            .get("suggestedCapabilities")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_basic_response() {
        let parser = ResponseParser::new();
        let response = r#"{
            "action": "query",
            "target": { "type": "platform", "value": "bilibili" },
            "confidence": 0.9,
            "suggestedCapabilities": ["platform.bilibili"]
        }"#;

        let result = parser.parse(response, "查看B站数据").unwrap();
        assert!(matches!(result.action, IntentAction::Query));
        assert!(matches!(result.target, IntentTarget::Platform(p) if p == "bilibili"));
    }

    #[test]
    fn test_extract_json_from_text() {
        let parser = ResponseParser::new();
        let response = r#"Here is the analysis:
{
    "action": "summarize",
    "target": { "type": "current_page", "value": "article" }
}
Thank you!"#;

        let json = parser.extract_json(response);
        assert!(json.starts_with('{'));
        assert!(json.ends_with('}'));
    }
}
