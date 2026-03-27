//! 结果评估与智能升级模块
//!
//! 提供结果评估器（失败模式检测、满意度评分），
//! 由 Planner.replan() 消费评估结果来驱动升级决策。

#[allow(dead_code)]
mod capability_mapping;
mod evaluator;
#[allow(dead_code)]
mod strategy;

// 核心导出：ResultEvaluator 供 Agent.should_escalate / build_escalation_hint 使用
pub use evaluator::ResultEvaluator;

// 能力升级映射表（供 Planner 提示词参考）
#[allow(unused_imports)]
pub use capability_mapping::{
    get_escalation, transform_params,
    CapabilityEscalation, CAPABILITY_ESCALATION_MAP
};

// 升级策略类型
#[allow(unused_imports)]
pub use strategy::EscalationLevel;
