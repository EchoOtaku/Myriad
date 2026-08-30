use chrono::Utc;
use sea_orm::DatabaseConnection;

use crate::services::agent::{get_user_permissions, merope, run_hub, AgentInteractionMode};

use super::{IntentStore, SelfSnapshot};

/// Capture trusted state immediately before an autonomy decision.
///
/// Permission names come only from the runtime grant filter. No host secret,
/// installation credential, declared permission, or approved permission is
/// copied into this snapshot.
pub async fn capture_self_snapshot(
    db: &DatabaseConnection,
    user_id: i32,
    interaction_mode: AgentInteractionMode,
) -> Result<SelfSnapshot, anyhow::Error> {
    let enabled = merope::is_enabled().await;
    let persona = merope::get_persona(db).await?;
    let state = merope::get_or_create_state(db, user_id).await?;
    let mut granted_permissions = get_user_permissions(db, user_id)
        .await
        .into_iter()
        .collect::<Vec<_>>();
    granted_permissions.sort_unstable();

    Ok(SelfSnapshot {
        persona_name: merope::public_persona_name(
            enabled,
            persona.as_ref().map(|value| value.name.as_str()),
        ),
        addressee_user_id: user_id,
        interaction_mode,
        mood: merope::clamp_mood(state.mood),
        activity: merope::current_activity(&state).to_string(),
        do_not_disturb: merope::effective_do_not_disturb(&state),
        has_active_work: run_hub::user_has_executing_run(user_id).await,
        granted_permissions,
        recent_intents: IntentStore::new(db.clone()).recent(user_id, 8).await?,
        captured_at: Utc::now(),
        live: super::presence::last_live_presence(user_id),
    })
}
