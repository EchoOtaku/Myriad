//! Module visibility for Agent — re-export of workspace crate.
//!
//! Prefer this over `api::config` so services never import the HTTP layer.

pub use myriad_module_visibility::load_module_visibility_preferences_for_agent;

/// Convenience: agent visibility level only (`all` / `authenticated` / `admin`).
pub async fn agent_module_visibility(db: &sea_orm::DatabaseConnection) -> String {
    load_module_visibility_preferences_for_agent(db)
        .await
        .agent_visibility()
        .to_string()
}
