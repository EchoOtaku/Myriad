//! Event-driven autonomy contracts.
//!
//! This layer may decide that something is worth remembering, saying, asking,
//! or proposing as Work. It deliberately cannot select tools, grant
//! permissions, or execute a proposal; accepted work re-enters the existing
//! Planner / Executor path.

mod dispatch;
mod engine;
mod grant;
mod grant_store;
mod policy;
mod presence;
mod snapshot;
mod store;
mod types;

pub use dispatch::{
    autonomy_cap_from_grant, autonomy_claim_decision, build_autonomy_work_request, AutonomyClaim,
};
pub use engine::{
    consider_event, forbids_propose_work, is_work_outcome, pre_gate, ConsciousnessGate,
    Consideration,
};
pub use grant::{
    autonomy_cap_still_allows, autonomy_execute_permission_error, effective_granted_permissions,
    evaluate_autonomy_grant, intention_may_enter_work, prepare_personal_grant,
    required_permissions_within_cap, revoke_personal_grant, skips_user_review, AutonomyGrantView,
    AutonomyGrantWriteError, AutonomyVerdict,
};
pub use grant_store::AutonomyGrantStore;
pub use policy::{validate_decision, DecisionPolicyError};
pub use presence::{last_live_presence, live_presence_from_request, remember_live_presence};
pub use snapshot::capture_self_snapshot;
pub use store::IntentStore;
pub use types::{
    AcceptSource, ConsciousnessAction, ConsciousnessDecision, ConsciousnessEvent, EventUrgency,
    IntentRecord, IntentStatus, RecentIntent, SelfLivePresence, SelfSnapshot, WorkProposal,
};
