//! Structured result evaluation and local/web replan policy.

mod evaluator;

pub use evaluator::{EvaluationContext, evaluate_with_context, is_local_data_capability};
