//! 升级策略定义
//!
//! 定义不同的升级等级和策略

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

}
