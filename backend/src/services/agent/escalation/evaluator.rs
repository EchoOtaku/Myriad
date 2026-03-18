//! 结果评估器
//!
//! 评估任务执行结果是否**真正满足**用户的原始目标
//!
//! ## 验证层次
//!
//! 1. **失败模式检测**：识别"未找到"、"无结果"等语义失败
//! 2. **数据源验证**：检查数据获取步骤是否返回了有效数据
//! 3. **目标匹配验证**：确保结果真正回答了用户的问题

use super::super::types::*;
use serde_json::Value;

/// 评估结果
#[derive(Debug, Clone)]
pub struct Evaluation {
    /// 结果是否满足目标
    pub is_satisfied: bool,
    /// 满意度分数 (0.0 - 1.0)
    pub satisfaction_score: f32,
    /// 不满意的原因
    pub reason: Option<String>,
    /// 建议尝试联网搜索
    pub suggests_web_search: bool,
    /// 建议扩大搜索范围
    pub suggests_expand_scope: bool,
    /// 建议的改进方向
    pub improvement_hints: Vec<String>,
    /// 检测到的失败模式
    pub failure_patterns: Vec<FailurePattern>,
}

/// 失败模式类型
#[derive(Debug, Clone, PartialEq)]
pub enum FailurePattern {
    /// 数据源返回空结果
    EmptyDataSource,
    /// 检测到"未找到"语义
    NotFoundSemantic,
    /// 检测到"无匹配"语义
    NoMatchSemantic,
    /// 结果与查询不相关
    IrrelevantResult,
    /// AI 总结了"没有数据"
    SummarizedNothing,
    /// 数据数量为 0
    ZeroCount,
}

impl Default for Evaluation {
    fn default() -> Self {
        Self {
            is_satisfied: true,
            satisfaction_score: 1.0,
            reason: None,
            suggests_web_search: false,
            suggests_expand_scope: false,
            improvement_hints: Vec::new(),
            failure_patterns: Vec::new(),
        }
    }
}

/// 结果评估器
pub struct ResultEvaluator {
    /// 最小可接受的数据条数
    min_data_count: usize,
}

impl ResultEvaluator {
    pub fn new() -> Self {
        Self { min_data_count: 1 }
    }

    /// 评估结果（无需 ParsedIntent，仅检测失败模式和数据充足性）
    ///
    /// 用于 Planner 管线的简化评估，不依赖旧的 ParsedIntent 类型。
    pub fn evaluate_result(&self, result: &Value) -> Evaluation {
        let mut eval = Evaluation::default();

        // 第一层：失败模式检测
        self.detect_failure_patterns(&mut eval, result);
        if !eval.failure_patterns.is_empty() {
            eval.is_satisfied = false;
            eval.satisfaction_score = 0.0;
            eval.reason = Some(self.describe_failure_patterns(&eval.failure_patterns));
            eval.suggests_web_search = true;
            eval.improvement_hints.push("本地数据不足，尝试联网搜索".to_string());
            return eval;
        }

        // 第二层：数据源验证
        let data_count = self.count_actual_data(result);
        if data_count < self.min_data_count {
            eval.is_satisfied = false;
            eval.satisfaction_score = 0.1;
            eval.failure_patterns.push(FailurePattern::ZeroCount);
            eval.reason = Some(format!(
                "数据不足：找到 {} 条有效数据，需要至少 {} 条",
                data_count, self.min_data_count
            ));
            eval.suggests_web_search = true;
            eval.improvement_hints.push("需要从网络获取实时数据".to_string());
            return eval;
        }

        // 通用目标评估
        self.evaluate_generic_goal(&mut eval, result);
        eval
    }

    /// 评估结果是否满足用户目标
    ///
    /// 这是一个**严格的**评估器，会检测各种失败模式
    /// Legacy: 由 evaluate_result() 替代，保留供测试使用
    #[allow(dead_code)]
    pub fn evaluate(&self, intent: &ParsedIntent, result: &Value) -> Evaluation {
        let mut eval = Evaluation::default();

        tracing::debug!(
            result_preview = %serde_json::to_string(result).unwrap_or_default().chars().take(500).collect::<String>(),
            "[ResultEvaluator] Evaluating result"
        );

        // ===== 第一层：失败模式检测 =====
        // 这是最重要的检测，能识别"表面成功但实际失败"的情况
        self.detect_failure_patterns(&mut eval, result);

        // 如果检测到任何失败模式，立即返回不满足
        if !eval.failure_patterns.is_empty() {
            eval.is_satisfied = false;
            eval.satisfaction_score = 0.0;
            eval.reason = Some(self.describe_failure_patterns(&eval.failure_patterns));
            self.suggest_improvements(&mut eval, intent);

            tracing::warn!(
                patterns = ?eval.failure_patterns,
                reason = ?eval.reason,
                suggests_web_search = eval.suggests_web_search,
                "[ResultEvaluator] ⚠️ Failure patterns detected - result NOT satisfied"
            );
            return eval;
        }

        // ===== 第二层：数据源验证 =====
        // 检查是否有实际的数据内容
        let data_count = self.count_actual_data(result);
        if data_count < self.min_data_count {
            eval.is_satisfied = false;
            eval.satisfaction_score = 0.1;
            eval.failure_patterns.push(FailurePattern::ZeroCount);
            eval.reason = Some(format!(
                "数据不足：找到 {} 条有效数据，需要至少 {} 条",
                data_count, self.min_data_count
            ));
            self.suggest_improvements(&mut eval, intent);
            return eval;
        }

        // ===== 第三层：目标匹配验证 =====
        // 根据意图类型进行针对性检查
        match intent.action {
            IntentAction::Query => {
                self.evaluate_query_goal(&mut eval, intent, result);
            }
            IntentAction::Summarize => {
                self.evaluate_summarize_goal(&mut eval, intent, result);
            }
            IntentAction::Analyze => {
                self.evaluate_analyze_goal(&mut eval, intent, result);
            }
            _ => {
                // 其他类型使用通用验证
                self.evaluate_generic_goal(&mut eval, result);
            }
        }

        eval
    }

    /// 检测各种失败模式
    fn detect_failure_patterns(&self, eval: &mut Evaluation, result: &Value) {
        // 1. 检测空数据源
        if self.is_data_source_empty(result) {
            eval.failure_patterns.push(FailurePattern::EmptyDataSource);
        }

        // 2. 检测"未找到"语义
        if self.has_not_found_semantic(result) {
            eval.failure_patterns.push(FailurePattern::NotFoundSemantic);
        }

        // 3. 检测"无匹配"语义
        if self.has_no_match_semantic(result) {
            eval.failure_patterns.push(FailurePattern::NoMatchSemantic);
        }

        // 4. 检测 AI 总结了"没有数据"
        if self.is_summarized_nothing(result) {
            eval.failure_patterns.push(FailurePattern::SummarizedNothing);
        }

        // 5. 检测显式的 count=0
        if self.has_zero_count(result) {
            eval.failure_patterns.push(FailurePattern::ZeroCount);
        }
    }

    /// 检测数据源是否为空
    fn is_data_source_empty(&self, result: &Value) -> bool {
        if let Value::Object(obj) = result {
            // 检查 items 数组
            if let Some(items) = obj.get("items") {
                if let Value::Array(arr) = items {
                    if arr.is_empty() {
                        return true;
                    }
                }
            }

            // 检查 results 数组
            if let Some(results) = obj.get("results") {
                if let Value::Array(arr) = results {
                    if arr.is_empty() {
                        return true;
                    }
                }
            }

            // 检查 data 数组
            if let Some(data) = obj.get("data") {
                if let Value::Array(arr) = data {
                    if arr.is_empty() {
                        return true;
                    }
                }
            }
        }

        matches!(result, Value::Array(arr) if arr.is_empty())
    }

    /// 检测"未找到"语义
    fn has_not_found_semantic(&self, result: &Value) -> bool {
        // 检查 notFound 标志
        if let Value::Object(obj) = result {
            if let Some(Value::Bool(true)) = obj.get("notFound") {
                return true;
            }
            if let Some(Value::Bool(true)) = obj.get("not_found") {
                return true;
            }
        }

        // 在文本中检测"未找到"模式
        let text = self.extract_all_text(result).to_lowercase();
        let not_found_patterns = [
            "未找到",
            "没有找到",
            "无结果",
            "不存在",
            "找不到",
            "not found",
            "no results",
            "no data",
            "nothing found",
            "見つかりません",
            "見つからない",
            "結果なし",
            "検索結果は0件",
        ];

        not_found_patterns.iter().any(|p| text.contains(p))
    }

    /// 检测"无匹配"语义
    fn has_no_match_semantic(&self, result: &Value) -> bool {
        if let Value::Object(obj) = result {
            // 检查 ambiguous 或 noMatch 标志
            if let Some(Value::Bool(true)) = obj.get("ambiguous") {
                return true;
            }
            if let Some(Value::Bool(true)) = obj.get("noMatch") {
                return true;
            }
        }

        let text = self.extract_all_text(result).to_lowercase();
        let no_match_patterns = [
            "没有匹配",
            "无法匹配",
            "不匹配",
            "搜索结果具有歧义",
            "未命中",
        ];

        no_match_patterns.iter().any(|p| text.contains(p))
    }

    /// 检测 AI 是否总结了"没有数据"
    fn is_summarized_nothing(&self, result: &Value) -> bool {
        if let Value::Object(obj) = result {
            // 获取 summary 文本
            let summary = obj
                .get("summary")
                .and_then(|v| v.as_str())
                .or_else(|| obj.get("aiSummary").and_then(|v| v.as_str()))
                .unwrap_or("");

            if summary.is_empty() {
                return false;
            }

            let summary_lower = summary.to_lowercase();

            // 检测总结中的"无数据"模式
            let nothing_patterns = [
                "未找到",
                "没有找到",
                "无结果",
                "结果为0",
                "结果总数为0",
                "0条",
                "零条",
                "not found",
                "no results",
                "empty",
                "notfound: true",
                "`notfound: true`",
                "notfound",
            ];

            if nothing_patterns.iter().any(|p| summary_lower.contains(p)) {
                return true;
            }

            // 检测总结是否主要在描述"没有内容"
            let negative_indicators = [
                "但未找到",
                "但没有",
                "搜索无结果",
                "没有相关",
                "未能找到",
                "无法找到",
            ];

            // 如果总结中有多个负面指标，认为是在总结"没有数据"
            let negative_count = negative_indicators
                .iter()
                .filter(|p| summary_lower.contains(*p))
                .count();

            negative_count >= 1
        } else {
            false
        }
    }

    /// 检测显式的 count=0
    fn has_zero_count(&self, result: &Value) -> bool {
        if let Value::Object(obj) = result {
            // 检查 total
            if let Some(total) = obj.get("total") {
                if let Some(n) = total.as_i64() {
                    if n == 0 {
                        return true;
                    }
                }
            }

            // 检查 count
            if let Some(count) = obj.get("count") {
                if let Some(n) = count.as_i64() {
                    if n == 0 {
                        return true;
                    }
                }
            }

            // 检查 resultCount
            if let Some(count) = obj.get("resultCount") {
                if let Some(n) = count.as_i64() {
                    if n == 0 {
                        return true;
                    }
                }
            }
        }

        false
    }

    /// 统计实际的数据条数
    fn count_actual_data(&self, result: &Value) -> usize {
        match result {
            Value::Array(arr) => arr.len(),
            Value::Object(obj) => {
                // 优先检查数组类型的字段
                for key in &["items", "results", "data", "records", "entries"] {
                    if let Some(Value::Array(arr)) = obj.get(*key) {
                        return arr.len();
                    }
                }

                // 检查 total/count 字段
                if let Some(n) = obj
                    .get("total")
                    .or_else(|| obj.get("count"))
                    .and_then(|v| v.as_u64())
                {
                    return n as usize;
                }

                // 如果是包含内容的对象，视为 1 条数据
                // 但要排除只有 summary 的情况（因为 summary 可能是对"空数据"的总结）
                let has_only_summary = obj.len() <= 2
                    && (obj.contains_key("summary") || obj.contains_key("style"));

                if has_only_summary {
                    0
                } else if !obj.is_empty() {
                    1
                } else {
                    0
                }
            }
            Value::String(s) if !s.is_empty() => 1,
            _ => 0,
        }
    }

    /// 描述失败模式
    fn describe_failure_patterns(&self, patterns: &[FailurePattern]) -> String {
        let descriptions: Vec<&str> = patterns
            .iter()
            .map(|p| match p {
                FailurePattern::EmptyDataSource => "数据源返回空结果",
                FailurePattern::NotFoundSemantic => "检测到「未找到」标记",
                FailurePattern::NoMatchSemantic => "检测到「无匹配」标记",
                FailurePattern::IrrelevantResult => "结果与查询不相关",
                FailurePattern::SummarizedNothing => "AI 总结显示没有有效数据",
                FailurePattern::ZeroCount => "结果数量为 0",
            })
            .collect();

        descriptions.join("；")
    }

    /// 建议改进方向 (legacy — 由 evaluate() 调用)
    #[allow(dead_code)]
    fn suggest_improvements(&self, eval: &mut Evaluation, intent: &ParsedIntent) {
        // 根据失败模式和意图类型给出建议
        for pattern in &eval.failure_patterns.clone() {
            match pattern {
                FailurePattern::EmptyDataSource
                | FailurePattern::NotFoundSemantic
                | FailurePattern::NoMatchSemantic
                | FailurePattern::ZeroCount => {
                    // 本地数据不足，建议联网
                    if !eval.suggests_web_search {
                        eval.suggests_web_search = true;
                        eval.improvement_hints
                            .push("本地数据不足，尝试联网搜索".to_string());
                    }
                }
                FailurePattern::SummarizedNothing => {
                    // AI 总结了空数据，需要先获取真实数据
                    eval.suggests_web_search = true;
                    eval.improvement_hints
                        .push("需要从网络获取实时数据".to_string());
                }
                FailurePattern::IrrelevantResult => {
                    eval.suggests_expand_scope = true;
                    eval.improvement_hints
                        .push("结果不相关，尝试扩大搜索范围".to_string());
                }
            }
        }

        // 根据目标类型添加特定建议
        match &intent.target {
            IntentTarget::Brew(_) | IntentTarget::Music(_) => {
                if !eval.improvement_hints.iter().any(|h| h.contains("联网")) {
                    eval.suggests_web_search = true;
                    eval.improvement_hints
                        .push("本地内容中没有相关数据，建议联网搜索".to_string());
                }
            }
            _ => {}
        }
    }

    /// 评估查询目标 (legacy)
    #[allow(dead_code)]
    fn evaluate_query_goal(&self, eval: &mut Evaluation, intent: &ParsedIntent, result: &Value) {
        // 提取关键词
        let keywords = self.extract_keywords_from_intent(intent);
        if keywords.is_empty() {
            return;
        }

        // 检查结果文本是否包含关键词
        let text = self.extract_all_text(result);
        let matches = keywords
            .iter()
            .filter(|kw| text.to_lowercase().contains(&kw.to_lowercase()))
            .count();

        let relevance = matches as f32 / keywords.len() as f32;

        if relevance < 0.3 {
            eval.is_satisfied = false;
            eval.satisfaction_score = relevance;
            eval.failure_patterns.push(FailurePattern::IrrelevantResult);
            eval.reason = Some(format!(
                "结果与关键词「{}」相关性低 ({:.0}%)",
                keywords.join("、"),
                relevance * 100.0
            ));
            self.suggest_improvements(eval, intent);
        } else {
            eval.satisfaction_score = relevance;
        }
    }

    /// 评估总结目标 (legacy)
    #[allow(dead_code)]
    fn evaluate_summarize_goal(&self, eval: &mut Evaluation, intent: &ParsedIntent, result: &Value) {
        // 检查总结是否有实质内容
        let summary = if let Value::Object(obj) = result {
            obj.get("summary")
                .or_else(|| obj.get("aiSummary"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
        } else {
            ""
        };

        // 如果总结太短，可能数据不足
        if summary.len() < 50 {
            eval.is_satisfied = false;
            eval.satisfaction_score = 0.2;
            eval.reason = Some("总结内容过短，可能源数据不足".to_string());
            eval.suggests_web_search = true;
            return;
        }

        // 检查总结是否主要在描述"没有内容"
        // 这是关键检测：即使有总结，也要检查内容是否有意义
        if self.is_summarized_nothing(result) {
            eval.is_satisfied = false;
            eval.satisfaction_score = 0.0;
            eval.failure_patterns.push(FailurePattern::SummarizedNothing);
            eval.reason = Some("总结内容表明没有找到相关数据".to_string());
            self.suggest_improvements(eval, intent);
        }
    }

    /// 评估分析目标 (legacy)
    #[allow(dead_code)]
    fn evaluate_analyze_goal(&self, eval: &mut Evaluation, intent: &ParsedIntent, result: &Value) {
        // 分析需要足够的内容
        let text = self.extract_all_text(result);
        if text.len() < 100 {
            eval.is_satisfied = false;
            eval.satisfaction_score = 0.3;
            eval.reason = Some("分析内容不够详细，可能数据不足".to_string());
            eval.suggests_web_search = true;
            self.suggest_improvements(eval, intent);
        }
    }

    /// 通用目标评估
    fn evaluate_generic_goal(&self, eval: &mut Evaluation, result: &Value) {
        // 简单检查：是否有实质内容
        let data_count = self.count_actual_data(result);
        if data_count == 0 {
            eval.is_satisfied = false;
            eval.satisfaction_score = 0.0;
            eval.reason = Some("没有返回有效数据".to_string());
        }
    }

    /// 从意图中提取关键词
    fn extract_keywords_from_intent(&self, intent: &ParsedIntent) -> Vec<String> {
        let mut keywords = Vec::new();

        // 从 filters 中提取
        if let Some(kw) = intent.constraints.filters.get("keyword") {
            if let Some(s) = kw.as_str() {
                keywords.push(s.to_string());
            }
        }

        if let Some(kws) = intent.constraints.filters.get("keywords") {
            if let Some(arr) = kws.as_array() {
                for v in arr {
                    if let Some(s) = v.as_str() {
                        keywords.push(s.to_string());
                    }
                }
            }
        }

        keywords
    }

    /// 提取所有文本内容
    fn extract_all_text(&self, result: &Value) -> String {
        match result {
            Value::String(s) => s.clone(),
            Value::Array(arr) => arr
                .iter()
                .map(|v| self.extract_all_text(v))
                .collect::<Vec<_>>()
                .join(" "),
            Value::Object(obj) => {
                let mut texts = Vec::new();

                // 提取所有字符串值
                for (_key, value) in obj {
                    match value {
                        Value::String(s) => texts.push(s.clone()),
                        Value::Array(_) | Value::Object(_) => {
                            texts.push(self.extract_all_text(value));
                        }
                        _ => {}
                    }
                }

                texts.join(" ")
            }
            _ => String::new(),
        }
    }
}

impl Default for ResultEvaluator {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn create_search_intent(keywords: Vec<&str>) -> ParsedIntent {
        let mut filters = std::collections::HashMap::new();
        filters.insert(
            "keywords".to_string(),
            serde_json::Value::Array(
                keywords
                    .iter()
                    .map(|k| serde_json::Value::String(k.to_string()))
                    .collect(),
            ),
        );

        ParsedIntent {
            id: "test".to_string(),
            action: IntentAction::Query,
            target: IntentTarget::Brew(None),
            constraints: IntentConstraints {
                filters,
                ..Default::default()
            },
            confidence: 0.8,
            clarifications_needed: vec![],
            sub_intents: vec![],
            suggested_capabilities: vec![],
            unsupported_reason: None,
        }
    }

    fn create_summarize_intent() -> ParsedIntent {
        ParsedIntent {
            id: "test".to_string(),
            action: IntentAction::Summarize,
            target: IntentTarget::Brew(None),
            constraints: IntentConstraints::default(),
            confidence: 0.8,
            clarifications_needed: vec![],
            sub_intents: vec![],
            suggested_capabilities: vec![],
            unsupported_reason: None,
        }
    }

    #[test]
    fn test_detect_empty_data_source() {
        let evaluator = ResultEvaluator::new();
        let intent = create_search_intent(vec!["政治"]);
        let result = json!({
            "items": [],
            "total": 0
        });

        let eval = evaluator.evaluate(&intent, &result);

        assert!(!eval.is_satisfied);
        assert!(eval.failure_patterns.contains(&FailurePattern::EmptyDataSource));
        assert!(eval.suggests_web_search);
    }

    #[test]
    fn test_detect_not_found_semantic() {
        let evaluator = ResultEvaluator::new();
        let intent = create_search_intent(vec!["政治"]);
        let result = json!({
            "notFound": true,
            "message": "未找到相关内容"
        });

        let eval = evaluator.evaluate(&intent, &result);

        assert!(!eval.is_satisfied);
        assert!(eval.failure_patterns.contains(&FailurePattern::NotFoundSemantic));
    }

    #[test]
    fn test_detect_summarized_nothing() {
        let evaluator = ResultEvaluator::new();
        let intent = create_summarize_intent();

        // 这是用户遇到的实际情况：AI 总结了"没有找到"
        let result = json!({
            "summary": "搜索关键词「政治」，但未找到匹配的订阅源或作者（notFound: true，结果总数为0）。系统提示搜索结果具有歧义或未命中，明确指出未找到名为\"政治\"的相关内容。",
            "style": "brief"
        });

        let eval = evaluator.evaluate(&intent, &result);

        assert!(!eval.is_satisfied, "应该检测到总结了空数据");
        assert!(
            eval.failure_patterns.contains(&FailurePattern::SummarizedNothing),
            "应该包含 SummarizedNothing 模式: {:?}",
            eval.failure_patterns
        );
        assert!(eval.suggests_web_search, "应该建议联网搜索");
    }

    #[test]
    fn test_valid_summary_passes() {
        let evaluator = ResultEvaluator::new();
        let intent = create_summarize_intent();
        let result = json!({
            "summary": "这是关于政治新闻的总结。最近的政治动态包括：1. 某国举行大选；2. 国际峰会召开；3. 新政策出台。这些事件对全球政治格局产生了重要影响。",
            "items": [
                {"title": "大选新闻", "content": "..."},
                {"title": "峰会报道", "content": "..."}
            ]
        });

        let eval = evaluator.evaluate(&intent, &result);

        assert!(eval.is_satisfied, "有效的总结应该通过验证");
        assert!(eval.failure_patterns.is_empty());
    }

    #[test]
    fn test_zero_count_detected() {
        let evaluator = ResultEvaluator::new();
        let intent = create_search_intent(vec!["news"]);
        let result = json!({
            "total": 0,
            "items": []
        });

        let eval = evaluator.evaluate(&intent, &result);

        assert!(!eval.is_satisfied);
        assert!(
            eval.failure_patterns.contains(&FailurePattern::ZeroCount)
                || eval.failure_patterns.contains(&FailurePattern::EmptyDataSource)
        );
    }

    #[test]
    fn test_irrelevant_result() {
        let evaluator = ResultEvaluator::new();
        let intent = create_search_intent(vec!["政治", "选举"]);
        let result = json!({
            "items": [
                {"title": "天气预报", "content": "明天晴天，气温20度"}
            ],
            "total": 1
        });

        let eval = evaluator.evaluate(&intent, &result);

        assert!(!eval.is_satisfied, "不相关的结果应该不满足");
        assert!(eval.failure_patterns.contains(&FailurePattern::IrrelevantResult));
    }

    #[test]
    fn test_japanese_not_found() {
        let evaluator = ResultEvaluator::new();
        let intent = create_search_intent(vec!["政治"]);
        let result = json!({
            "message": "検索結果は0件です。見つかりませんでした。"
        });

        let eval = evaluator.evaluate(&intent, &result);

        assert!(!eval.is_satisfied);
        assert!(eval.failure_patterns.contains(&FailurePattern::NotFoundSemantic));
    }

    #[test]
    fn test_real_world_failure_case() {
        // 这是用户实际遇到的失败案例
        let evaluator = ResultEvaluator::new();
        let intent = create_summarize_intent();
        let result = json!({
            "style": "brief",
            "summary": "这是一份搜索结果的JSON数据，主要内容如下：\n\n1.  **搜索状态**：用户搜索关键词\"政治\"，但未找到匹配的订阅源或作者（`notFound: true`，结果总数为0）。\n2.  **异常原因**：系统提示搜索结果具有歧义或未命中，明确指出未找到名为\"政治\"的相关内容。"
        });

        let eval = evaluator.evaluate(&intent, &result);

        assert!(!eval.is_satisfied, "这个案例应该被检测为失败");
        assert!(
            eval.failure_patterns.contains(&FailurePattern::SummarizedNothing)
                || eval.failure_patterns.contains(&FailurePattern::NotFoundSemantic),
            "应该检测到失败模式: {:?}",
            eval.failure_patterns
        );
        assert!(eval.suggests_web_search, "应该建议升级到联网搜索");
    }
}
