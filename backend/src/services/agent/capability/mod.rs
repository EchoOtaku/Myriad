//! 能力注册表模块
//!
//! 管理系统所有可用能力的注册、查询和匹配

mod utils;
pub mod definitions;

pub use utils::*;

use super::types::*;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// 全局能力注册表
static CAPABILITY_REGISTRY: Lazy<Arc<RwLock<CapabilityRegistry>>> =
    Lazy::new(|| Arc::new(RwLock::new(CapabilityRegistry::new())));

/// 能力注册表
pub struct CapabilityRegistry {
    /// 能力 ID -> 能力定义
    capabilities: HashMap<String, Capability>,
    /// 类别 -> 能力 ID 列表
    by_category: HashMap<CapabilityCategory, Vec<String>>,
    /// 动作 -> 能力 ID 列表
    by_action: HashMap<String, Vec<String>>,
}

impl CapabilityRegistry {
    pub fn new() -> Self {
        let mut registry = Self {
            capabilities: HashMap::new(),
            by_category: HashMap::new(),
            by_action: HashMap::new(),
        };
        // 注册内置能力
        definitions::register_all(&mut registry);
        registry
    }

    /// 注册一个能力
    pub fn register(&mut self, capability: Capability) {
        let id = capability.id.clone();

        // 更新类别索引
        self.by_category
            .entry(capability.category.clone())
            .or_default()
            .push(id.clone());

        // 更新动作索引
        for action in &capability.supported_actions {
            let action_key = format!("{:?}", action).to_lowercase();
            self.by_action
                .entry(action_key)
                .or_default()
                .push(id.clone());
        }

        self.capabilities.insert(id, capability);
    }

    /// 根据 ID 获取能力
    pub fn get(&self, id: &str) -> Option<&Capability> {
        self.capabilities.get(id)
    }

    /// 获取所有能力
    pub fn get_all(&self) -> Vec<&Capability> {
        self.capabilities.values().collect()
    }

    /// 根据类别获取能力
    #[allow(dead_code)]
    pub fn get_by_category(&self, category: &CapabilityCategory) -> Vec<&Capability> {
        self.by_category
            .get(category)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| self.capabilities.get(id))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 根据动作获取能力
    pub fn get_by_action(&self, action: &IntentAction) -> Vec<&Capability> {
        let action_key = format!("{:?}", action).to_lowercase();
        self.by_action
            .get(&action_key)
            .map(|ids| {
                ids.iter()
                    .filter_map(|id| self.capabilities.get(id))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// 匹配最佳能力
    #[allow(dead_code)]
    pub fn find_best_match(&self, intent: &ParsedIntent) -> Option<&Capability> {
        let candidates = self.get_by_action(&intent.action);

        let filtered: Vec<_> = candidates
            .into_iter()
            .filter(|cap| self.matches_target(cap, &intent.target))
            .collect();

        if filtered.is_empty() {
            return None;
        }

        let mut scored: Vec<_> = filtered
            .into_iter()
            .map(|cap| {
                let score = self.calculate_capability_score(cap, intent);
                (cap, score)
            })
            .collect();

        scored.sort_by(|a, b| b.1.cmp(&a.1));
        scored.into_iter().next().map(|(cap, _)| cap)
    }

    /// 计算能力匹配分数
    #[allow(dead_code)]
    fn calculate_capability_score(&self, capability: &Capability, intent: &ParsedIntent) -> i32 {
        let mut score = 0;
        let cap_id = &capability.id;

        if intent.suggested_capabilities.contains(cap_id) {
            score += 100;
        }

        match &intent.target {
            IntentTarget::Platform(platform) => {
                if cap_id.starts_with(&format!("{}.", platform)) {
                    score += 50;
                } else if cap_id.starts_with("platform.") {
                    score += 30;
                }
            }
            IntentTarget::Brew(_) => {
                if cap_id == "brew.subscribe" && intent.action == IntentAction::Create {
                    score += 50;
                } else if cap_id == "brew.discover" {
                    score += 40;
                } else if cap_id.starts_with("brew.") {
                    score += 30;
                }
            }
            IntentTarget::Tapp(_) => {
                if cap_id.starts_with("tapp.") {
                    score += 40;
                }
            }
            IntentTarget::Report(_) => {
                if cap_id.starts_with("report.") {
                    score += 40;
                }
            }
            IntentTarget::Music(_) => {
                if cap_id.starts_with("music.") {
                    score += 50;
                }
            }
            _ => {}
        }

        if capability.supported_actions.contains(&intent.action) {
            score += 20;
        }

        if capability.requires_ai && intent.requires_ai_processing() {
            score += 15;
        }

        if cap_id.matches('.').count() == 1 {
            score += 5;
        }

        score
    }

    /// 检查能力是否匹配目标
    pub fn matches_target(&self, capability: &Capability, target: &IntentTarget) -> bool {
        let cap_id = &capability.id;

        match target {
            IntentTarget::Platform(platform) => {
                cap_id.starts_with("platform.")
                    || cap_id.starts_with(&format!("{}.", platform))
                    || cap_id == platform
            }
            IntentTarget::Report(_) => cap_id.starts_with("report.") || cap_id == "report",
            IntentTarget::Tapp(_) => cap_id.starts_with("tapp.") || cap_id == "tapp",
            IntentTarget::Brew(_) => cap_id.starts_with("brew.") || cap_id == "brew",
            IntentTarget::Music(_) => cap_id.starts_with("music."),
            IntentTarget::Profile => {
                cap_id.starts_with("profile.") || cap_id.starts_with("user.")
            }
            IntentTarget::Data(data_type) => {
                if data_type == "web_search" {
                    cap_id == "ai.webSearch" || cap_id.starts_with("search.")
                } else {
                    cap_id.starts_with("data.")
                        || cap_id.starts_with("storage.")
                        || cap_id.starts_with("cache.")
                        || cap_id.starts_with("export.")
                }
            }
            IntentTarget::Event(_) => {
                cap_id.starts_with("event.") || cap_id.starts_with("scheduler.")
            }
            IntentTarget::CurrentPage(page_type) => match page_type.as_str() {
                "brew" => cap_id.starts_with("brew."),
                "tapp" => cap_id.starts_with("tapp."),
                "report" => cap_id.starts_with("report."),
                "dashboard" => cap_id.starts_with("platform.") || cap_id.starts_with("profile."),
                _ => true,
            },
            IntentTarget::Unspecified => {
                !cap_id.starts_with("tapp.")
                    && !cap_id.starts_with("brew.")
                    && !cap_id.starts_with("report.")
                    && !cap_id.starts_with("scheduler.")
            }
        }
    }
}

impl Default for CapabilityRegistry {
    fn default() -> Self {
        Self::new()
    }
}

// ============ 公共 API ============

/// 获取全局能力注册表（只读）
pub async fn get_registry() -> tokio::sync::RwLockReadGuard<'static, CapabilityRegistry> {
    CAPABILITY_REGISTRY.read().await
}

/// 获取全局能力注册表（可写）
#[allow(dead_code)]
pub async fn get_registry_mut() -> tokio::sync::RwLockWriteGuard<'static, CapabilityRegistry> {
    CAPABILITY_REGISTRY.write().await
}

/// 异步版本：检查能力是否需要确认（从注册表读取）
pub async fn capability_requires_confirmation_async(
    capability_id: &str,
) -> Option<(String, RiskLevel)> {
    let registry = get_registry().await;
    if let Some(cap) = registry.get(capability_id) {
        if cap.requires_confirmation || cap.risk_level != RiskLevel::None {
            let message = cap
                .confirmation_message
                .clone()
                .unwrap_or_else(|| format!("此操作将执行 {}", cap.name));
            return Some((message, cap.risk_level));
        }
    }
    get_sensitive_capabilities()
        .get(capability_id)
        .map(|(msg, risk)| (msg.to_string(), *risk))
}

/// 查找匹配意图的能力
pub async fn find_capabilities_for_intent(intent: &ParsedIntent) -> Vec<Capability> {
    let registry = get_registry().await;
    registry
        .get_by_action(&intent.action)
        .into_iter()
        .filter(|cap| registry.matches_target(cap, &intent.target))
        .cloned()
        .collect()
}

/// 获取能力摘要（用于 AI 提示）
pub async fn get_capability_summary() -> Value {
    let registry = get_registry().await;

    let mut by_category: std::collections::HashMap<String, Vec<Value>> =
        std::collections::HashMap::new();

    for cap in registry.get_all() {
        let usage_hint = get_capability_usage_hint(&cap.id);
        let category = get_capability_category_name(&cap.category);

        let cap_info = json!({
            "id": cap.id,
            "name": cap.name,
            "hint": usage_hint,
            "ai": cap.requires_ai
        });

        by_category.entry(category).or_default().push(cap_info);
    }

    json!({
        "total": registry.get_all().len(),
        "byCategory": by_category,
        "quickReference": get_quick_reference()
    })
}

/// 获取能力类别的友好名称
fn get_capability_category_name(category: &CapabilityCategory) -> String {
    match category {
        CapabilityCategory::DataRead => "数据读取".to_string(),
        CapabilityCategory::DataWrite => "数据写入".to_string(),
        CapabilityCategory::AiProcess => "AI处理".to_string(),
        CapabilityCategory::ResourceCreate => "资源创建".to_string(),
        CapabilityCategory::SystemOp => "系统操作".to_string(),
        CapabilityCategory::ExternalIntegration => "外部集成".to_string(),
        CapabilityCategory::UiControl => "界面控制".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_initialization() {
        let registry = CapabilityRegistry::new();
        assert!(!registry.capabilities.is_empty());
        assert!(registry.get("platform.read").is_some());
        assert!(registry.get("ai.summarize").is_some());
    }

    #[test]
    fn test_action_mapping() {
        let action = IntentAction::from_verb("总结");
        assert_eq!(action, IntentAction::Summarize);

        let action = IntentAction::from_verb("query");
        assert_eq!(action, IntentAction::Query);
    }

    #[test]
    fn test_find_by_action() {
        let registry = CapabilityRegistry::new();
        let caps = registry.get_by_action(&IntentAction::Summarize);
        assert!(!caps.is_empty());
        assert!(caps.iter().any(|c| c.id == "ai.summarize"));
    }
}
