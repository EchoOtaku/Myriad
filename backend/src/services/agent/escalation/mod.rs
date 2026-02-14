//! 结果评估与智能升级模块
//!
//! 当任务执行结果不满足用户目标时，自动升级到更高等级的策略：
//! - 本地搜索无结果 → 联网搜索
//! - 最近时间范围无结果 → 扩大时间范围
//! - 特定平台无结果 → 跨平台搜索

mod capability_mapping;
mod evaluator;
mod strategy;

// 导出供外部使用
#[allow(unused_imports)]
pub use capability_mapping::{
    get_escalation, has_escalation, transform_params,
    CapabilityEscalation, CAPABILITY_ESCALATION_MAP
};
pub use evaluator::ResultEvaluator;
#[allow(unused_imports)]
pub use strategy::{EscalationLevel, EscalationDecision};

use super::types::*;
use super::recipe::RecipeGenerator;
use serde_json::Value;

/// 升级管理器
///
/// 负责评估执行结果，决定是否需要升级，并生成新的执行方案
pub struct EscalationManager {
    evaluator: ResultEvaluator,
    recipe_generator: RecipeGenerator,
    /// 最大升级次数（防止无限循环）
    max_escalations: u32,
}

impl EscalationManager {
    pub fn new() -> Self {
        Self {
            evaluator: ResultEvaluator::new(),
            recipe_generator: RecipeGenerator::new(),
            max_escalations: 2, // 最多升级 2 次
        }
    }

    /// 评估结果并决定是否需要升级
    pub async fn evaluate_and_escalate(
        &self,
        original_intent: &ParsedIntent,
        _original_recipe: &Recipe,
        result: &Value,
        current_level: EscalationLevel,
        escalation_count: u32,
    ) -> EscalationDecision {
        // 检查是否超过最大升级次数
        if escalation_count >= self.max_escalations {
            tracing::info!(
                count = escalation_count,
                max = self.max_escalations,
                "[EscalationManager] Max escalations reached, stopping"
            );
            return EscalationDecision::Accept;
        }

        // 评估结果是否满足目标
        let evaluation = self.evaluator.evaluate(original_intent, result);

        let level_str = format!("{:?}", current_level);
        tracing::info!(
            satisfied = evaluation.is_satisfied,
            score = evaluation.satisfaction_score,
            reason = ?evaluation.reason,
            failure_patterns = ?evaluation.failure_patterns,
            suggests_web_search = evaluation.suggests_web_search,
            current_level = %level_str,
            "[EscalationManager] Result evaluation complete"
        );

        if evaluation.is_satisfied {
            tracing::info!("[EscalationManager] ✅ Result satisfied, accepting");
            return EscalationDecision::Accept;
        }

        tracing::info!(
            "[EscalationManager] ❌ Result NOT satisfied, attempting escalation"
        );

        // 决定升级策略
        let next_level = self.determine_next_level(
            original_intent,
            &evaluation,
            current_level.clone(),
        );

        match next_level {
            Some(level) => {
                let from_str = format!("{:?}", current_level);
                let to_str = format!("{:?}", level);
                tracing::info!(
                    from = %from_str,
                    to = %to_str,
                    reason = ?evaluation.reason,
                    "[EscalationManager] Escalating to higher level"
                );

                // 生成升级后的意图
                let escalated_intent = self.create_escalated_intent(
                    original_intent,
                    &evaluation,
                    level.clone(),
                );

                EscalationDecision::Escalate {
                    new_level: level,
                    new_intent: escalated_intent,
                    reason: evaluation.reason.unwrap_or_else(|| "结果不满足目标".to_string()),
                }
            }
            None => {
                tracing::info!(
                    "[EscalationManager] No higher level available, accepting result"
                );
                EscalationDecision::Accept
            }
        }
    }

    /// 根据评估结果决定下一个升级等级
    fn determine_next_level(
        &self,
        intent: &ParsedIntent,
        evaluation: &evaluator::Evaluation,
        current_level: EscalationLevel,
    ) -> Option<EscalationLevel> {
        use EscalationLevel::*;

        match current_level {
            Local => {
                // 本地搜索失败，尝试联网搜索
                if evaluation.suggests_web_search {
                    Some(WebSearch)
                } else if evaluation.suggests_expand_scope {
                    Some(ExpandedLocal)
                } else {
                    Some(WebSearch) // 默认升级到联网
                }
            }
            ExpandedLocal => {
                // 扩展本地搜索仍然失败，尝试联网
                Some(WebSearch)
            }
            WebSearch => {
                // 联网搜索也失败，尝试扩展联网搜索
                if !matches!(intent.action, IntentAction::Summarize | IntentAction::Analyze) {
                    Some(ExpandedWebSearch)
                } else {
                    None // 总结/分析类任务不再升级
                }
            }
            ExpandedWebSearch => {
                // 已经是最高等级
                None
            }
        }
    }

    /// 创建升级后的意图
    ///
    /// 关键原则：
    /// 1. 保留原始查询的完整语义（关键词 + 时间限定）
    /// 2. 根据原始目标类型选择最合适的升级能力
    fn create_escalated_intent(
        &self,
        original: &ParsedIntent,
        _evaluation: &evaluator::Evaluation,
        new_level: EscalationLevel,
    ) -> ParsedIntent {
        let mut escalated = original.clone();

        // 根据升级等级修改意图
        match new_level {
            EscalationLevel::WebSearch | EscalationLevel::ExpandedWebSearch => {
                // 切换到联网搜索
                escalated.target = IntentTarget::Data("web_search".to_string());

                // ⭐ 根据原始目标类型选择最合适的联网能力
                let web_capability = self.select_web_capability_for_target(&original.target);

                // 清除原有的本地能力，添加联网能力
                escalated.suggested_capabilities.retain(|c| {
                    // 保留 AI 处理类能力（summarize, analyze）
                    c.starts_with("ai.summarize") || c.starts_with("ai.analyze")
                });

                if !escalated.suggested_capabilities.contains(&web_capability) {
                    escalated.suggested_capabilities.insert(0, web_capability.clone());
                }

                // ⭐ 增强搜索查询：合并关键词和时间限定
                self.enhance_search_query(&mut escalated, original);

                // 如果是扩展联网搜索，增加结果数量
                if matches!(new_level, EscalationLevel::ExpandedWebSearch) {
                    escalated.constraints.limit = Some(
                        escalated.constraints.limit.unwrap_or(5) * 2
                    );
                }

                tracing::info!(
                    original_target = ?original.target,
                    web_capability = %web_capability,
                    enhanced_filters = ?escalated.constraints.filters,
                    "[EscalationManager] Created escalated intent for web search"
                );
            }
            EscalationLevel::ExpandedLocal => {
                // 扩展本地搜索范围
                // 移除时间限制或扩大时间范围
                if let Some(ref mut time_range) = escalated.constraints.time_range {
                    // 将时间范围扩大 3 倍
                    if let (Some(start), Some(end)) = (time_range.start, time_range.end) {
                        let duration = end - start;
                        time_range.start = Some(start - duration * 2);
                        time_range.relative = Some("expanded".to_string());
                    }
                } else {
                    // 没有时间限制，增加结果数量
                    escalated.constraints.limit = Some(
                        escalated.constraints.limit.unwrap_or(10) * 2
                    );
                }
            }
            EscalationLevel::Local => {
                // 不变
            }
        }

        // 提高置信度，因为这是基于失败结果的重试
        escalated.confidence = 0.8;

        // 清除之前的澄清请求
        escalated.clarifications_needed.clear();

        escalated
    }

    /// 根据原始目标类型和已使用的能力选择最合适的联网搜索能力
    ///
    /// 优先使用能力升级映射表，回退到基于目标类型的默认选择
    fn select_web_capability_for_target(&self, target: &IntentTarget) -> String {
        // 首先根据目标类型推断可能使用的本地能力，查询映射表
        let inferred_capability = match target {
            IntentTarget::Brew(_) => Some("brew.items"),
            IntentTarget::Music(_) => Some("netease.playlist"),
            IntentTarget::Platform(platform) => match platform.as_str() {
                "bilibili" => Some("bilibili.user"),
                "steam" => Some("steam.user"),
                "github" => Some("github.repos"),
                _ => Some("platform.read"),
            },
            IntentTarget::Tapp(_) => Some("tapp.list"),
            IntentTarget::Report(_) => Some("report.create"),
            _ => None,
        };

        // 如果能从映射表找到升级能力，使用它
        if let Some(cap_id) = inferred_capability {
            if let Some(escalation) = capability_mapping::get_escalation(cap_id) {
                tracing::info!(
                    from_capability = cap_id,
                    to_capability = escalation.target_capability,
                    description = escalation.description,
                    "[EscalationManager] Using capability escalation mapping"
                );
                return escalation.target_capability.to_string();
            }
        }

        // 回退到默认选择
        match target {
            IntentTarget::Music(_) => "netease.searchPlaylist".to_string(),
            _ => "ai.webSearch".to_string(),
        }
    }

    /// 根据原始能力 ID 查找升级能力
    ///
    /// 这个方法用于从 Recipe 的步骤中直接查找升级能力
    #[allow(dead_code)]
    pub fn get_escalated_capability(&self, original_capability_id: &str) -> Option<String> {
        capability_mapping::get_escalation(original_capability_id)
            .map(|esc| esc.target_capability.to_string())
    }

    /// 转换参数以适配升级后的能力
    #[allow(dead_code)]
    pub fn transform_capability_params(
        &self,
        original_capability_id: &str,
        original_params: &Value,
    ) -> Option<Value> {
        capability_mapping::transform_params(original_capability_id, original_params)
    }

    /// 增强搜索查询，合并关键词和时间限定
    fn enhance_search_query(&self, escalated: &mut ParsedIntent, original: &ParsedIntent) {
        // 提取原始关键词
        let mut keywords: Vec<String> = Vec::new();

        if let Some(kw) = original.constraints.filters.get("keyword") {
            if let Some(s) = kw.as_str() {
                keywords.push(s.to_string());
            }
        }

        if let Some(kws) = original.constraints.filters.get("keywords") {
            if let Some(arr) = kws.as_array() {
                for v in arr {
                    if let Some(s) = v.as_str() {
                        if !keywords.contains(&s.to_string()) {
                            keywords.push(s.to_string());
                        }
                    }
                }
            }
        }

        // 提取时间限定词
        let time_modifier = self.extract_time_modifier(original);

        // 构建增强的搜索查询
        let enhanced_query = if let Some(time_mod) = time_modifier {
            if keywords.is_empty() {
                time_mod
            } else {
                format!("{} {}", keywords.join(" "), time_mod)
            }
        } else {
            keywords.join(" ")
        };

        if !enhanced_query.is_empty() {
            escalated.constraints.filters.insert(
                "query".to_string(),
                serde_json::Value::String(enhanced_query.clone())
            );
            escalated.constraints.filters.insert(
                "keyword".to_string(),
                serde_json::Value::String(enhanced_query)
            );
        }
    }

    /// 从原始意图中提取时间限定词
    fn extract_time_modifier(&self, intent: &ParsedIntent) -> Option<String> {
        // 优先从 filters 中获取（这是最可靠的来源）
        if let Some(time_filter) = intent.constraints.filters.get("time") {
            if let Some(s) = time_filter.as_str() {
                if !s.is_empty() {
                    return Some(s.to_string());
                }
            }
        }

        // 检查是否有时间范围
        if let Some(ref time_range) = intent.constraints.time_range {
            if let Some(ref relative) = time_range.relative {
                // 转换相对时间为搜索词
                return match relative.as_str() {
                    "today" => Some("今天".to_string()),
                    "yesterday" => Some("昨天".to_string()),
                    "this_week" | "week" | "last_week" => Some("本周".to_string()),
                    "this_month" | "month" | "last_month" => Some("本月".to_string()),
                    "recent" => Some("最近".to_string()),
                    _ => None,
                };
            }
        }

        None
    }

    /// 为升级后的意图生成新的 Recipe
    pub async fn generate_escalated_recipe(
        &self,
        intent: &ParsedIntent,
        request: Option<&UserRequest>,
    ) -> Result<Recipe, String> {
        self.recipe_generator.generate(intent, request).await
    }
}

impl Default for EscalationManager {
    fn default() -> Self {
        Self::new()
    }
}
