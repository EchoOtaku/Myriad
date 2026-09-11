//! 结果评估与智能升级模块
//!
//! 提供结果评估器（失败模式检测、满意度评分），
//! 由 Planner.replan_with_progress_for() 消费评估结果来驱动升级决策。
//!
//! 本模块只导出 `ResultEvaluator`（`should_escalate` / `build_escalation_hint`）。

mod evaluator;

// 核心导出：ResultEvaluator 供 Agent.should_escalate / build_escalation_hint 使用
pub use evaluator::{EvaluationContext, ResultEvaluator};
