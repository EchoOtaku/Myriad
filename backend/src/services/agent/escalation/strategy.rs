//! 升级策略定义
//!
//! 定义不同的升级等级和策略

use super::super::types::ParsedIntent;

/// 升级等级
///
/// 从低到高排列，表示数据来源的范围和成本
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EscalationLevel {
    /// 本地搜索：仅搜索本地数据（Brew、Tapp 等）
    Local,
    /// 扩展本地：放宽时间范围或其他限制的本地搜索
    ExpandedLocal,
    /// 联网搜索：使用网络搜索引擎
    WebSearch,
    /// 扩展联网：更深入的联网搜索（更多结果、多源）
    ExpandedWebSearch,
}

#[allow(dead_code)]
impl EscalationLevel {
    /// 获取等级的数值表示（用于比较）
    pub fn level_number(&self) -> u8 {
        match self {
            Self::Local => 1,
            Self::ExpandedLocal => 2,
            Self::WebSearch => 3,
            Self::ExpandedWebSearch => 4,
        }
    }

    /// 判断是否是联网等级
    pub fn is_web_based(&self) -> bool {
        matches!(self, Self::WebSearch | Self::ExpandedWebSearch)
    }

    /// 判断是否是本地等级
    pub fn is_local(&self) -> bool {
        matches!(self, Self::Local | Self::ExpandedLocal)
    }

    /// 获取下一个更高的等级
    pub fn next(&self) -> Option<Self> {
        match self {
            Self::Local => Some(Self::ExpandedLocal),
            Self::ExpandedLocal => Some(Self::WebSearch),
            Self::WebSearch => Some(Self::ExpandedWebSearch),
            Self::ExpandedWebSearch => None,
        }
    }

    /// 从意图推断初始等级
    pub fn from_intent(intent: &ParsedIntent) -> Self {
        use super::super::types::IntentTarget;

        match &intent.target {
            IntentTarget::Data(source) if source == "web_search" => Self::WebSearch,
            IntentTarget::Platform(_) => Self::Local, // 平台数据可能需要联网，但先尝试缓存
            IntentTarget::Brew(_)
            | IntentTarget::Tapp(_)
            | IntentTarget::Report(_)
            | IntentTarget::CurrentPage(_)
            | IntentTarget::Music(_)
            | IntentTarget::Profile
            | IntentTarget::Data(_)
            | IntentTarget::Event(_) => Self::Local,
            IntentTarget::Unspecified => {
                // 未知目标根据动作推断
                if intent.suggested_capabilities.iter().any(|c| c.contains("web") || c.contains("search")) {
                    Self::WebSearch
                } else {
                    Self::Local
                }
            }
        }
    }
}

impl Default for EscalationLevel {
    fn default() -> Self {
        Self::Local
    }
}

impl std::fmt::Display for EscalationLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Local => write!(f, "本地搜索"),
            Self::ExpandedLocal => write!(f, "扩展本地搜索"),
            Self::WebSearch => write!(f, "联网搜索"),
            Self::ExpandedWebSearch => write!(f, "扩展联网搜索"),
        }
    }
}

/// 升级策略配置
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct EscalationStrategy {
    /// 是否允许自动升级
    pub auto_escalate: bool,
    /// 允许的最高等级
    pub max_level: EscalationLevel,
    /// 升级前是否需要用户确认
    pub require_confirmation: bool,
    /// 跳过的等级（例如直接从 Local 跳到 WebSearch）
    pub skip_levels: Vec<EscalationLevel>,
}

impl Default for EscalationStrategy {
    fn default() -> Self {
        Self {
            auto_escalate: true,
            max_level: EscalationLevel::ExpandedWebSearch,
            require_confirmation: false,
            skip_levels: vec![EscalationLevel::ExpandedLocal], // 默认跳过扩展本地
        }
    }
}

#[allow(dead_code)]
impl EscalationStrategy {
    /// 创建仅本地搜索的策略
    pub fn local_only() -> Self {
        Self {
            auto_escalate: false,
            max_level: EscalationLevel::ExpandedLocal,
            require_confirmation: false,
            skip_levels: vec![],
        }
    }

    /// 创建允许联网的策略
    pub fn with_web_search() -> Self {
        Self {
            auto_escalate: true,
            max_level: EscalationLevel::WebSearch,
            require_confirmation: false,
            skip_levels: vec![EscalationLevel::ExpandedLocal],
        }
    }

    /// 创建需要用户确认的策略
    pub fn with_confirmation() -> Self {
        Self {
            auto_escalate: true,
            max_level: EscalationLevel::ExpandedWebSearch,
            require_confirmation: true,
            skip_levels: vec![],
        }
    }

    /// 检查是否可以升级到目标等级
    pub fn can_escalate_to(&self, level: &EscalationLevel) -> bool {
        if !self.auto_escalate {
            return false;
        }

        if level.level_number() > self.max_level.level_number() {
            return false;
        }

        !self.skip_levels.contains(level)
    }

    /// 获取从当前等级可以升级到的下一个有效等级
    pub fn next_valid_level(&self, current: &EscalationLevel) -> Option<EscalationLevel> {
        let mut next = current.next();

        while let Some(ref level) = next {
            if self.can_escalate_to(level) {
                return next;
            }
            next = level.next();
        }

        None
    }
}

/// 升级决策结果
#[allow(dead_code)]
#[derive(Debug, Clone)]
pub enum EscalationDecision {
    /// 接受当前结果
    Accept,
    /// 需要升级
    Escalate {
        /// 新的升级等级
        new_level: EscalationLevel,
        /// 修改后的意图
        new_intent: ParsedIntent,
        /// 升级原因
        reason: String,
    },
    /// 需要用户确认
    RequireConfirmation {
        /// 建议的升级等级
        suggested_level: EscalationLevel,
        /// 确认消息
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_level_ordering() {
        assert!(EscalationLevel::Local.level_number() < EscalationLevel::WebSearch.level_number());
        assert!(EscalationLevel::WebSearch.level_number() < EscalationLevel::ExpandedWebSearch.level_number());
    }

    #[test]
    fn test_level_next() {
        assert_eq!(EscalationLevel::Local.next(), Some(EscalationLevel::ExpandedLocal));
        assert_eq!(EscalationLevel::WebSearch.next(), Some(EscalationLevel::ExpandedWebSearch));
        assert_eq!(EscalationLevel::ExpandedWebSearch.next(), None);
    }

    #[test]
    fn test_strategy_skip_levels() {
        let strategy = EscalationStrategy::default();

        // 默认跳过 ExpandedLocal
        assert!(!strategy.can_escalate_to(&EscalationLevel::ExpandedLocal));
        assert!(strategy.can_escalate_to(&EscalationLevel::WebSearch));

        // 从 Local 应该直接跳到 WebSearch
        let next = strategy.next_valid_level(&EscalationLevel::Local);
        assert_eq!(next, Some(EscalationLevel::WebSearch));
    }

    #[test]
    fn test_local_only_strategy() {
        let strategy = EscalationStrategy::local_only();

        assert!(!strategy.can_escalate_to(&EscalationLevel::WebSearch));
        assert!(!strategy.can_escalate_to(&EscalationLevel::ExpandedWebSearch));
    }
}
