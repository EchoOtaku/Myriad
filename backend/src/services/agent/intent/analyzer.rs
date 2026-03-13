//! 意图分析器
//!
//! 将用户自然语言输入解析为结构化的意图。
//! 支持 AI 辅助解析和规则后备解析。

use chrono::{Duration, Utc};

use super::keywords::{KeywordMatcher, LanguageDetector};
use super::parser::ResponseParser;
use super::prompt::PromptBuilder;
use super::{
    ClarificationPoint, ClarificationType, IntentAction, IntentConstraints, IntentTarget,
    ParsedIntent, TimeRange,
};
use crate::services::agent::types::{Capability, UserRequest};
use crate::services::ai::create_ai_analyzer_for_tier;
use crate::config::ModelTier;
use crate::services::analyzer::AiAnalyzer;

/// 意图分析器
pub struct IntentAnalyzer {
    /// AI 分析器（可选）
    ai_analyzer: Option<AiAnalyzer>,
    /// 关键词匹配器
    keyword_matcher: KeywordMatcher,
    /// 语言检测器
    language_detector: LanguageDetector,
    /// 响应解析器
    response_parser: ResponseParser,
}

impl IntentAnalyzer {
    /// 创建新的意图分析器（自动从全局配置初始化 AI）
    pub async fn new() -> Self {
        let ai_analyzer = Self::create_ai_analyzer().await;
        Self {
            ai_analyzer,
            keyword_matcher: KeywordMatcher::new(),
            language_detector: LanguageDetector::new(),
            response_parser: ResponseParser::new(),
        }
    }

    /// 创建 AI 分析器实例（使用 Pro 层级处理复杂意图分析）
    async fn create_ai_analyzer() -> Option<AiAnalyzer> {
        create_ai_analyzer_for_tier(ModelTier::Pro).await
    }

    /// 创建无 AI 的分析器（仅规则匹配）
    pub fn without_ai() -> Self {
        Self {
            ai_analyzer: None,
            keyword_matcher: KeywordMatcher::new(),
            language_detector: LanguageDetector::new(),
            response_parser: ResponseParser::new(),
        }
    }

    /// 解析用户请求（主入口，向后兼容）
    pub async fn analyze(&self, request: &UserRequest) -> Result<ParsedIntent, String> {
        self.analyze_with_capabilities(request, &[]).await
    }

    /// 解析用户请求（带能力列表）
    pub async fn analyze_with_capabilities(
        &self,
        request: &UserRequest,
        capabilities: &[Capability],
    ) -> Result<ParsedIntent, String> {
        let input = &request.raw_input;

        // 尝试 AI 解析
        if let Some(ai_analyzer) = &self.ai_analyzer {
            match self.ai_parse(input, request, capabilities, ai_analyzer).await {
                Ok(intent) => return Ok(intent),
                Err(e) => {
                    tracing::warn!("AI parse failed, falling back to rules: {}", e);
                }
            }
        }

        // 后备规则解析
        Ok(self.fallback_parse(input, request))
    }

    /// AI 辅助解析
    async fn ai_parse(
        &self,
        input: &str,
        request: &UserRequest,
        capabilities: &[Capability],
        ai_analyzer: &AiAnalyzer,
    ) -> Result<ParsedIntent, String> {
        // 检测语言，选择对应的 prompt
        let language = self.language_detector.detect(input);

        // 构建 system prompt
        let system_prompt = PromptBuilder::new()
            .language(language)
            .with_capabilities(capabilities)
            .build();

        // 构建 user prompt
        let user_prompt = self.build_user_prompt(request);

        // 构建完整 prompt（system + user）
        let full_prompt = format!("{}\n\n---\n\n{}", system_prompt, user_prompt);

        // 调用 AI
        let response = ai_analyzer
            .analyze(&full_prompt)
            .await
            .map_err(|e| format!("AI analyzer error: {}", e))?;

        // 解析响应
        self.response_parser.parse(&response, input)
    }

    /// 构建用户提示
    fn build_user_prompt(&self, request: &UserRequest) -> String {
        let mut prompt = format!("用户请求：{}", request.raw_input);

        if let Some(context) = &request.context {
            if let Some(route) = &context.current_route {
                let page_desc = self.describe_route(route);
                prompt.push_str(&format!("\n当前页面：{} ({})", page_desc, route));
            }
            if !context.active_platforms.is_empty() {
                prompt.push_str(&format!(
                    "\n活跃平台：{}",
                    context.active_platforms.join(", ")
                ));
            }

            // 添加对话历史上下文
            if let Some(custom_data) = &context.custom_data {
                tracing::info!(
                    "[IntentAnalyzer] custom_data keys: {:?}",
                    custom_data.as_object().map(|o| o.keys().collect::<Vec<_>>())
                );
                if let Some(history) = custom_data.get("conversation_history").and_then(|h| h.as_str()) {
                    tracing::info!(
                        "[IntentAnalyzer] Found conversation_history, length: {}",
                        history.len()
                    );
                    if !history.is_empty() {
                        prompt.push_str(&format!("\n\n最近对话历史：\n{}", history));
                        prompt.push_str("\n\n请注意：用户可能在引用之前对话中提到的内容，注意理解代词和上下文指代。");
                    }
                } else {
                    tracing::info!("[IntentAnalyzer] No conversation_history in custom_data");
                }

                // 添加用户偏好提示
                if let Some(prefs) = custom_data.get("user_preferences") {
                    if let Some(prefs_obj) = prefs.as_object() {
                        if !prefs_obj.is_empty() {
                            prompt.push_str("\n\n用户历史偏好：");
                            if let Some(preferred_action) = prefs_obj.get("preferred_action").and_then(|v| v.as_str()) {
                                prompt.push_str(&format!("\n- 常用操作：{}", preferred_action));
                            }
                            if let Some(platforms) = prefs_obj.get("preferred_platforms").and_then(|v| v.as_array()) {
                                let platform_names: Vec<&str> = platforms
                                    .iter()
                                    .filter_map(|p| p.as_str())
                                    .collect();
                                if !platform_names.is_empty() {
                                    prompt.push_str(&format!("\n- 常用平台：{}", platform_names.join(", ")));
                                }
                            }
                            prompt.push_str("\n（如果用户请求不明确，可参考这些偏好）");
                        }
                    }
                }
            }
        }

        prompt
    }

    /// 描述路由
    fn describe_route(&self, route: &str) -> &'static str {
        match route.trim_matches('/') {
            "brew" => "Brew 订阅页面",
            "tapp" | "tapps" => "Tapp 应用页面",
            route if route.starts_with("platform/bilibili") => "B站数据页面",
            route if route.starts_with("platform/steam") => "Steam 游戏页面",
            route if route.starts_with("platform/github") => "GitHub 页面",
            route if route.starts_with("platform/netease") => "网易云音乐页面",
            route if route.starts_with("platform/") => "平台页面",
            "report" | "reports" => "报告页面",
            "" | "dashboard" => "仪表盘首页",
            _ => "未知页面",
        }
    }

    /// 后备规则解析（无 AI 时使用）
    fn fallback_parse(&self, input: &str, request: &UserRequest) -> ParsedIntent {
        let input_lower = input.to_lowercase();

        // 提取关键词（从输入中移除动作词、平台词、时间词后的内容）
        let mut filters = std::collections::HashMap::new();
        let keywords = self.extract_keywords_from_input(input);
        if !keywords.is_empty() {
            filters.insert("keyword".to_string(), serde_json::Value::String(keywords.clone()));
            filters.insert("query".to_string(), serde_json::Value::String(keywords));
        }

        // 如果有时间词，也放到 filters 中供升级时使用
        if let Some(time_word) = self.extract_time_word_from_input(input) {
            filters.insert("time".to_string(), serde_json::Value::String(time_word));
        }

        ParsedIntent {
            id: uuid::Uuid::new_v4().to_string(),
            action: self.detect_action(&input_lower),
            target: self.detect_target(&input_lower, request),
            constraints: IntentConstraints {
                time_range: self.detect_time_range(&input_lower),
                limit: self.keyword_matcher.extract_quantity(&input_lower),
                filters,
                ..Default::default()
            },
            confidence: 0.3, // 后备解析置信度较低
            clarifications_needed: vec![ClarificationPoint {
                id: uuid::Uuid::new_v4().to_string(),
                clarification_type: ClarificationType::Ambiguity,
                question: "我可能没有完全理解你的意图，请确认或提供更多细节".to_string(),
                options: Vec::new(),
                default: None,
            }],
            sub_intents: Vec::new(),
            suggested_capabilities: Vec::new(),
            unsupported_reason: None,
        }
    }

    /// 从输入中提取主要关键词（移除功能词后的内容主体）
    fn extract_keywords_from_input(&self, input: &str) -> String {
        let mut result = input.to_string();

        // 移除动作词（中/英/日）
        let action_words = [
            // 中文
            "总结", "摘要", "概括", "分析", "查看", "搜索", "查询", "找", "看看", "告诉我",
            "显示", "列出", "获取", "给我",
            // 英文
            "summarize", "analyze", "show", "list", "get", "find", "search", "tell me",
            // 日文
            "まとめて", "まとめ", "要約", "分析", "見せて", "教えて", "検索", "調べて",
        ];

        // 时间词不需要移除，它们会被单独提取

        // 移除连接词/助词
        let connectors = [
            // 中文
            "的", "有关", "关于", "相关",
            // 日文
            "の", "に関する", "について", "を",
            // 英文
            "about", "related to", "regarding",
        ];

        for word in action_words.iter().chain(connectors.iter()) {
            result = result.replace(word, " ");
        }

        // 清理多余空格
        result = result.split_whitespace().collect::<Vec<_>>().join(" ");
        result = result.trim().to_string();

        // 如果结果为空，尝试保留原始输入中的非功能词
        if result.is_empty() || result.chars().all(|c| c.is_whitespace()) {
            return input.to_string();
        }

        result
    }

    /// 从输入中提取时间词
    fn extract_time_word_from_input(&self, input: &str) -> Option<String> {
        let time_patterns = [
            ("最近", "最近"),
            ("今天", "今天"),
            ("昨天", "昨天"),
            ("本周", "本周"),
            ("本月", "本月"),
            ("今年", "今年"),
            ("recent", "最近"),
            ("today", "今天"),
            ("yesterday", "昨天"),
            ("this week", "本周"),
            ("this month", "本月"),
            // 日语
            ("最近", "最近"),
            ("今日", "今天"),
            ("昨日", "昨天"),
            ("今週", "本周"),
            ("今月", "本月"),
            ("この頃", "最近"),
        ];

        let input_lower = input.to_lowercase();
        for (pattern, normalized) in time_patterns {
            if input_lower.contains(&pattern.to_lowercase()) || input.contains(pattern) {
                return Some(normalized.to_string());
            }
        }
        None
    }

    /// 检测动作
    fn detect_action(&self, input: &str) -> IntentAction {
        if let Some(action) = self.keyword_matcher.detect_action(input) {
            IntentAction::from_verb(action)
        } else {
            IntentAction::Unknown("unrecognized".to_string())
        }
    }

    /// 检测目标
    fn detect_target(&self, input: &str, request: &UserRequest) -> IntentTarget {
        // 检测平台
        if let Some(platform) = self.keyword_matcher.detect_platform(input) {
            return IntentTarget::Platform(platform.to_string());
        }

        // 检测 brew 相关（中/英/日）
        let brew_keywords = [
            // 中文
            "订阅", "文章", "阅读", "新闻",
            // 英文
            "rss", "brew", "feed", "article", "news", "blog",
            // 日文
            "記事", "ニュース", "購読", "フィード", "ブログ",
        ];
        if brew_keywords.iter().any(|k| input.contains(k)) {
            return IntentTarget::Brew(None);
        }

        // 检测 tapp 相关（中/英/日）
        let tapp_keywords = [
            "应用", "tapp", "app", "工具",
            "アプリ", "ツール",
        ];
        if tapp_keywords.iter().any(|k| input.contains(k)) {
            return IntentTarget::Tapp(None);
        }

        // 检测报告相关（中/英/日）
        let report_keywords = [
            "报告", "报表",
            "report",
            "レポート", "報告",
        ];
        if report_keywords.iter().any(|k| input.contains(k)) {
            return IntentTarget::Report(None);
        }

        // 检测音乐相关（中/英/日）
        let music_keywords = [
            "音乐", "歌", "播放",
            "music", "song", "play", "playlist",
            "音楽", "曲", "再生", "プレイリスト",
        ];
        if music_keywords.iter().any(|k| input.contains(k)) {
            return IntentTarget::Music(None);
        }

        // 检测当前页面（中/英/日）
        let current_page_keywords = [
            "当前", "这个",
            "current", "this",
            "現在", "この",
        ];
        if current_page_keywords.iter().any(|k| input.contains(k)) {
            if let Some(context) = &request.context {
                if let Some(route) = &context.current_route {
                    let page_type = route
                        .trim_matches('/')
                        .split('/')
                        .next()
                        .unwrap_or("unknown");
                    return IntentTarget::CurrentPage(page_type.to_string());
                }
            }
            return IntentTarget::CurrentPage("unknown".to_string());
        }

        // 检测联网搜索相关（中/英/日）
        // 如果用户询问的内容看起来需要联网搜索（如查询某个主题）
        let web_search_keywords = [
            // 中文
            "搜索", "搜一下", "查一下", "了解", "有关", "关于", "什么是",
            // 英文
            "search", "look up", "find out", "about", "what is",
            // 日文
            "検索", "調べ", "について", "に関する", "とは",
        ];
        if web_search_keywords.iter().any(|k| input.contains(k)) {
            return IntentTarget::Data("web_search".to_string());
        }

        IntentTarget::Unspecified
    }

    /// 检测时间范围
    fn detect_time_range(&self, input: &str) -> Option<TimeRange> {
        let relative = self.keyword_matcher.detect_time(input)?;
        let now = Utc::now();

        let (start, end) = match relative {
            "today" => (now - Duration::days(1), now),
            "yesterday" => (now - Duration::days(2), now - Duration::days(1)),
            "last_week" => (now - Duration::days(7), now),
            "last_month" => (now - Duration::days(30), now),
            "last_year" => (now - Duration::days(365), now),
            "recent" => (now - Duration::days(7), now),
            _ => return None,
        };

        Some(TimeRange {
            start: Some(start),
            end: Some(end),
            relative: Some(relative.to_string()),
        })
    }
}

// 为了向后兼容，提供一个不需要 AI 的构造函数
impl Default for IntentAnalyzer {
    fn default() -> Self {
        Self::without_ai()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::agent::types::RequestContext;

    fn make_request(input: &str) -> UserRequest {
        UserRequest {
            raw_input: input.to_string(),
            timestamp: chrono::Utc::now(),
            user_id: 1,
            context: None,
        }
    }

    fn make_request_with_context(input: &str, route: &str) -> UserRequest {
        UserRequest {
            raw_input: input.to_string(),
            timestamp: chrono::Utc::now(),
            user_id: 1,
            context: Some(RequestContext {
                current_route: Some(route.to_string()),
                active_platforms: vec![],
                preferences: None,
                session_id: None,
                conversation_history: None,
                custom_data: None,
            }),
        }
    }

    #[test]
    fn test_detect_action() {
        let analyzer = IntentAnalyzer::default();

        assert!(matches!(
            analyzer.detect_action("总结一下最近的内容"),
            IntentAction::Summarize
        ));
        assert!(matches!(
            analyzer.detect_action("分析bilibili数据"),
            IntentAction::Analyze
        ));
        assert!(matches!(
            analyzer.detect_action("创建一个tapp"),
            IntentAction::Create
        ));
    }

    #[test]
    fn test_detect_target() {
        let analyzer = IntentAnalyzer::default();

        let request = make_request("b站的视频");
        assert!(matches!(
            analyzer.detect_target("b站的视频", &request),
            IntentTarget::Platform(p) if p == "bilibili"
        ));

        let request = make_request("steam游戏");
        assert!(matches!(
            analyzer.detect_target("steam游戏", &request),
            IntentTarget::Platform(p) if p == "steam"
        ));
    }

    #[test]
    fn test_detect_current_page() {
        let analyzer = IntentAnalyzer::default();

        let request = make_request_with_context("分析当前页面", "/brew");
        assert!(matches!(
            analyzer.detect_target("分析当前页面", &request),
            IntentTarget::CurrentPage(p) if p == "brew"
        ));
    }

    #[test]
    fn test_detect_time_range() {
        let analyzer = IntentAnalyzer::default();

        let range = analyzer.detect_time_range("最近一周的数据");
        assert!(range.is_some());
        assert_eq!(range.unwrap().relative, Some("last_week".to_string()));
    }

    #[test]
    fn test_multilingual_action() {
        let analyzer = IntentAnalyzer::default();

        // 中文
        assert!(matches!(
            analyzer.detect_action("总结"),
            IntentAction::Summarize
        ));
        // 英文
        assert!(matches!(
            analyzer.detect_action("summarize this"),
            IntentAction::Summarize
        ));
        // 日文
        assert!(matches!(
            analyzer.detect_action("まとめて"),
            IntentAction::Summarize
        ));
    }

    #[test]
    fn test_multilingual_target() {
        let analyzer = IntentAnalyzer::default();

        // 日语新闻关键词应识别为 Brew 目标
        let request = make_request("最近のニュースをまとめて");
        assert!(
            matches!(
                analyzer.detect_target("最近のニュースをまとめて", &request),
                IntentTarget::Brew(_)
            ),
            "日语 ニュース 应该识别为 Brew 目标"
        );

        // 日语音乐关键词应识别为 Music 目标
        let request = make_request("音楽を再生して");
        assert!(
            matches!(
                analyzer.detect_target("音楽を再生して", &request),
                IntentTarget::Music(_)
            ),
            "日语 音楽/再生 应该识别为 Music 目标"
        );

        // 日语搜索关键词应识别为 Data(web_search)
        let request = make_request("政治について調べて");
        assert!(
            matches!(
                analyzer.detect_target("政治について調べて", &request),
                IntentTarget::Data(d) if d == "web_search"
            ),
            "日语 について/調べて 应该识别为 web_search"
        );
    }

    #[test]
    fn test_japanese_full_input() {
        let analyzer = IntentAnalyzer::default();

        // 用户报告的日语输入
        let input = "政治に関する　最近のニュースをまとめて";
        let request = make_request(input);
        let input_lower = input.to_lowercase();

        // 动作应该是 Summarize
        assert!(
            matches!(analyzer.detect_action(&input_lower), IntentAction::Summarize),
            "日语 まとめて 应该识别为 Summarize 动作"
        );

        // 目标应该是 Brew（因为有 ニュース）或 Data(web_search)（因为有 に関する）
        let target = analyzer.detect_target(&input_lower, &request);
        assert!(
            matches!(target, IntentTarget::Brew(_) | IntentTarget::Data(_)),
            "日语输入应该识别为 Brew 或 web_search 目标，实际: {:?}",
            target
        );
    }

    #[test]
    fn test_extract_keywords_and_time() {
        let analyzer = IntentAnalyzer::default();

        // 测试关键词提取
        let keywords = analyzer.extract_keywords_from_input("政治に関する　最近のニュースをまとめて");
        assert!(
            keywords.contains("政治") || keywords.contains("ニュース"),
            "应该提取出 '政治' 或 'ニュース' 关键词，实际: {}",
            keywords
        );

        // 测试时间词提取
        let time_word = analyzer.extract_time_word_from_input("政治に関する　最近のニュースをまとめて");
        assert!(
            time_word.is_some(),
            "应该提取出时间词 '最近'"
        );
        assert_eq!(time_word.unwrap(), "最近");

        // 测试 fallback_parse 是否正确填充 filters
        let request = make_request("政治に関する　最近のニュースをまとめて");
        let intent = analyzer.fallback_parse("政治に関する　最近のニュースをまとめて", &request);

        assert!(
            intent.constraints.filters.contains_key("keyword") || intent.constraints.filters.contains_key("query"),
            "filters 应该包含 keyword 或 query"
        );
        assert!(
            intent.constraints.filters.contains_key("time"),
            "filters 应该包含 time"
        );
    }
}
