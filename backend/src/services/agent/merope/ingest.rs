//! Named-event speech: gate → line → hidden proactive → maybe notify.
//!
//! The line is written by Lite only when it will be shown. Everything else keeps
//! the event summary verbatim: the transcript's other reader is this module
//! itself, checking that it does not repeat what it already said.

use chrono::Utc;
use sea_orm::DatabaseConnection;
use std::collections::BTreeMap;

use super::is_logged_in_addressee;
use crate::config::ModelTier;
use crate::services::agent::consciousness::{
    consider_event, is_work_outcome, last_live_presence, ConsciousnessAction, ConsciousnessEvent,
    EventUrgency, IntentStore,
};
use crate::services::agent::notifications::{
    get_notification_manager, Notification, NotificationPriority, NotificationType,
};
use crate::services::agent::run_hub;
use crate::services::ai::create_ai_analyzer_for_tier;

use super::gates::{decide_ingest, is_chatting, is_valuable_event};
use super::store::{
    get_or_create_state, get_persona, insert_diary, insert_proactive, latest_open_session,
    list_remembered, recent_proactive, recently_spoke_event, save_mood, set_activity,
    touch_proactive,
};
use super::{
    addressee_speaking_section, apply_task_outcome, format_mood_section, is_extremely_low,
    public_persona_name,
};

const SAME_EVENT_MINUTES: i64 = 15;

pub fn work_outcome_parent(
    event_key: &str,
    latest_work_source_event: Option<String>,
) -> Option<String> {
    if is_work_outcome(event_key) {
        latest_work_source_event
    } else {
        None
    }
}

pub fn stable_consciousness_event_id(user_id: i32, event_key: &str, summary: &str) -> String {
    let key: String = event_key
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let distinguisher = if is_work_outcome(event_key) {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        summary.hash(&mut hasher);
        format!("{:x}", hasher.finish())
    } else {
        (Utc::now().timestamp() / (SAME_EVENT_MINUTES * 60)).to_string()
    };
    format!("evt_{user_id}_{key}_{distinguisher}")
}
const MEROPE_OWNED_NOTIFY: &[&str] = &["agent.merope.platform_activity"];

pub async fn is_enabled() -> bool {
    crate::GLOBAL_DYNAMIC_CONFIG
        .read()
        .await
        .merope_enabled_resolved()
}

/// Existing producers keep notifying unless Merope is on and the addressee is mid-conversation.
pub async fn latest_session_id_for(user_id: i32) -> Option<String> {
    let db = crate::services::tapp_registry::database().await.ok()?;
    latest_open_session(&db, user_id)
        .await
        .ok()
        .flatten()
        .map(|(id, _)| id)
}

pub async fn allow_existing_notify(user_id: i32) -> bool {
    if !is_logged_in_addressee(user_id) {
        return true;
    }
    if !is_enabled().await {
        return true;
    }
    let Ok(db) = crate::services::tapp_registry::database().await else {
        return true;
    };
    // Only the live chat window suppresses these — the addressee is already
    // watching the panel. Do-not-disturb means "don't speak up on your own",
    // not "swallow the failures of work this person asked for", so it is
    // deliberately not consulted here; it gates speech in `decide_ingest`.
    !addressee_is_chatting(&db, user_id).await
}

pub fn spawn_diary(user_id: i32, summary: impl Into<String>) {
    let summary = compact_summary(&summary.into());
    if summary.is_empty() {
        return;
    }
    tokio::spawn(async move {
        if !is_logged_in_addressee(user_id) || !is_enabled().await {
            return;
        }
        let Ok(db) = crate::services::tapp_registry::database().await else {
            return;
        };
        if let Err(error) = insert_diary(&db, user_id, &summary, "event").await {
            tracing::debug!(%error, user_id, "[Merope] diary write failed");
        }
    });
}

pub fn spawn_presence(user_id: i32) {
    if !is_logged_in_addressee(user_id) {
        return;
    }
    tokio::spawn(async move {
        if !is_enabled().await {
            return;
        }
        let Ok(db) = crate::services::tapp_registry::database().await else {
            return;
        };
        crate::services::agent::merope::maybe_apply_departure(&db, user_id).await;
        let Ok(state) = get_or_create_state(&db, user_id).await else {
            return;
        };
        let gap_hours = state
            .last_user_message_at
            .map(|at| (Utc::now() - at.with_timezone(&Utc)).num_minutes() as f64 / 60.0)
            .unwrap_or(24.0);
        let first_today = state
            .last_user_message_at
            .is_none_or(|at| at.with_timezone(&Utc).date_naive() != Utc::now().date_naive());
        if !first_today && gap_hours < 12.0 {
            return;
        }
        if recently_spoke_event(&db, user_id, "agent.merope.greeting", 12 * 60)
            .await
            .unwrap_or(true)
        {
            return;
        }
        let summary = if first_today {
            "这个人今天第一次来了"
        } else {
            "这个人隔了很久又来了"
        };
        if let Err(error) = ingest(&db, user_id, "agent.merope.greeting", summary).await {
            tracing::debug!(%error, user_id, "[Merope] presence ingest failed");
        }
    });
}

pub fn spawn(user_id: i32, event_key: impl Into<String>, summary: impl Into<String>) {
    let event_key = event_key.into();
    let summary = summary.into();
    tokio::spawn(async move {
        let Ok(db) = crate::services::tapp_registry::database().await else {
            return;
        };
        if let Err(error) = ingest(&db, user_id, &event_key, &summary).await {
            tracing::warn!(
                %error,
                user_id,
                event_key,
                "[Merope] ingest failed"
            );
        }
    });
}

pub async fn ingest(
    db: &DatabaseConnection,
    user_id: i32,
    event_key: &str,
    summary: &str,
) -> Result<(), anyhow::Error> {
    if !is_logged_in_addressee(user_id) {
        return Ok(());
    }
    if !is_enabled().await {
        return Ok(());
    }
    super::maybe_apply_departure(db, user_id).await;
    let summary = compact_summary(summary);
    if summary.is_empty() {
        return Ok(());
    }

    let state = get_or_create_state(db, user_id).await?;
    let chatting = addressee_is_chatting(db, user_id).await;
    let working = super::current_activity(&state) == "working";
    let decision = decide_ingest(
        event_key,
        super::effective_do_not_disturb(&state),
        chatting,
        working,
    );
    // Whether this is a Chat completion is a property of the event, and it is
    // already filtered twice: `run_hub` stops publishing one, and the match in
    // `apply_task_mood` ignores every key but the three task outcomes. Whether
    // the addressee happens to be chatting right now is a different question,
    // and gating on it meant a real Work task that finished inside the chat
    // window never counted — success or failure — for good.
    apply_task_mood(db, user_id, event_key, state.mood).await;

    if !decision.allow_model {
        let _ = insert_diary(db, user_id, &summary, "event").await;
        return Ok(());
    }
    if recently_spoke_event(db, user_id, event_key, SAME_EVENT_MINUTES).await? {
        let _ = insert_diary(db, user_id, &summary, "event").await;
        return Ok(());
    }

    let parent_event_id = work_outcome_parent(
        event_key,
        IntentStore::new(db.clone())
            .latest_work_source_event(user_id)
            .await
            .ok()
            .flatten(),
    );
    let conscious_event = ConsciousnessEvent {
        id: stable_consciousness_event_id(user_id, event_key, &summary),
        source: "merope".into(),
        kind: event_key.to_string(),
        headline: summary.clone(),
        summary: summary.clone(),
        addressee_user_id: user_id,
        urgency: if is_valuable_event(event_key) {
            EventUrgency::Soon
        } else {
            EventUrgency::Normal
        },
        occurred_at: Utc::now(),
        parent_event_id,
        safe_facts: BTreeMap::new(),
    };
    let consideration = match consider_event(db, &conscious_event).await {
        Ok(value) => value,
        Err(error) => {
            tracing::warn!(%error, event_key, "[Merope] consciousness decision failed");
            None
        }
    };

    if let Some(value) = consideration.as_ref() {
        match value.decision.action {
            ConsciousnessAction::Ignore => {
                return Ok(());
            }
            ConsciousnessAction::Remember => {
                persist_persona_remember(db, user_id, value.decision.memory.as_deref()).await;
                return Ok(());
            }
            ConsciousnessAction::Speak | ConsciousnessAction::Ask => {
                persist_persona_remember(db, user_id, value.decision.memory.as_deref()).await;
            }
            ConsciousnessAction::ProposeWork => {}
        }
    }

    // Only a line the addressee will actually read is worth a model call. The rest
    // of the transcript is a ledger with no reader — it exists so the next line
    // does not repeat itself — so the human-readable summary stands in for it.
    let source_intent_id = consideration
        .as_ref()
        .and_then(|value| value.intent.as_ref())
        .map(|intent| intent.id.as_str());
    // A Work proposal has no existing producer-owned surface. It must reach the
    // addressee so they can review it; ordinary event speech keeps the existing
    // duplicate-notification rule.
    let shown = (source_intent_id.is_some() && is_valuable_event(event_key))
        || speech_is_shown(event_key, decision.notify);
    let selected_line = consideration
        .as_ref()
        .and_then(|value| match value.decision.action {
            ConsciousnessAction::Speak => value.decision.speech.clone(),
            ConsciousnessAction::Ask => value.decision.question.clone(),
            ConsciousnessAction::ProposeWork => value
                .intent
                .as_ref()
                .map(|intent| format!("我注意到{}。要不要交给我处理？", intent.proposal.title)),
            ConsciousnessAction::Ignore | ConsciousnessAction::Remember => None,
        });
    let spoken = if let Some(selected) = selected_line {
        selected
    } else if shown {
        let _ = set_activity(db, user_id, "thinking").await;
        let line = compose_line(db, user_id, &summary).await;
        let _ = set_activity(db, user_id, "idle").await;
        line
    } else {
        fallback_line(&summary)
    };

    if is_trivial_line(&spoken) {
        let _ = insert_diary(db, user_id, &summary, "event").await;
        return Ok(());
    }
    if let Ok(recent) = recent_proactive(db, user_id, 1).await {
        if recent
            .first()
            .is_some_and(|last| last.content.trim() == spoken.trim())
        {
            let _ = insert_diary(db, user_id, &summary, "event").await;
            return Ok(());
        }
    }

    // Direct motion only after the line has passed every suppression check. This
    // keeps the Lite budget tied to speech the addressee will actually receive.
    let (performance, motion_mood) = if shown {
        match get_or_create_state(db, user_id).await {
            Ok(current) => {
                let band = super::mood_band(current.mood).to_string();
                let mood = super::MoodTransition {
                    before: current.mood,
                    after: current.mood,
                    band_before: band.clone(),
                    band_after: band,
                    delta: 0.0,
                    cause: event_key.to_string(),
                    revision: current.updated_at.with_timezone(&Utc).timestamp_millis(),
                };
                let motion_style =
                    super::resolve_round_motion_style(None, current.mood.round() as i32).await;
                let performance = super::direct_motion(super::MotionContext {
                    user_id,
                    phase: super::MotionPhase::Proactive,
                    mood: mood.clone(),
                    activity: "talking".to_string(),
                    user_text: summary.clone(),
                    response_text: Some(spoken.clone()),
                    task_success: None,
                    rig_state: last_live_presence(user_id).rig_state,
                    motion_style,
                })
                .await;
                (performance, Some(mood))
            }
            Err(_) => (None, None),
        }
    } else {
        (None, None)
    };

    let _ = insert_diary(db, user_id, &summary, "event").await;
    insert_proactive(db, user_id, &spoken, Some(event_key), shown).await?;
    let _ = touch_proactive(db, user_id).await;

    if shown {
        emit_speech_notification(
            db,
            user_id,
            event_key,
            &spoken,
            performance.as_ref(),
            motion_mood.as_ref(),
            source_intent_id,
        )
        .await;
    }
    Ok(())
}

/// Whether the composed line reaches the addressee at all. Valuable events whose
/// notification an existing producer already owns are excluded: sending our own
/// would mean two notifications for one thing.
fn speech_is_shown(event_key: &str, notify: bool) -> bool {
    notify && MEROPE_OWNED_NOTIFY.contains(&event_key)
}

pub fn fallback_line(summary: &str) -> String {
    match compact_summary(summary).as_str() {
        "这个人今天第一次来了" => "今天又见到你了。".to_string(),
        "这个人隔了很久又来了" => "好久不见。".to_string(),
        "跟这个人的心情掉到了极低" => "我在。".to_string(),
        _ => "刚才有件事，想跟你说一声。".to_string(),
    }
}

pub fn is_trivial_line(text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.chars().count() < 2 || trimmed.starts_with('{')
}

/// Compact a candidate persona-memory fact and skip empty or duplicate text.
///
/// `existing` is already-stored remember content for this addressee. Comparison
/// uses the same compact form ingest writes, so ledger rows are not involved.
pub fn persona_remember_insert(candidate: &str, existing: &[String]) -> Option<String> {
    let compact = compact_summary(candidate);
    if compact.is_empty() {
        return None;
    }
    let duplicate = existing.iter().any(|fact| compact_summary(fact) == compact);
    if duplicate {
        None
    } else {
        Some(compact)
    }
}

pub(crate) async fn persist_persona_remember(
    db: &DatabaseConnection,
    user_id: i32,
    candidate: Option<&str>,
) {
    let Some(candidate) = candidate else {
        return;
    };
    let existing = match list_remembered(db, user_id, 32).await {
        Ok(notes) => notes
            .into_iter()
            .map(|note| note.content)
            .collect::<Vec<_>>(),
        Err(_) => return,
    };
    let Some(fact) = persona_remember_insert(candidate, &existing) else {
        return;
    };
    let _ = insert_diary(db, user_id, &fact, super::store::DIARY_SOURCE_REMEMBER).await;
}

pub fn compact_summary(summary: &str) -> String {
    redact_event_text(summary)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(240)
        .collect()
}

pub fn redact_event_text(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return String::new();
    }
    let mut skip_next = false;
    let mut out = Vec::new();
    for token in trimmed.split_whitespace() {
        if skip_next {
            skip_next = false;
            continue;
        }
        let lower = token.to_ascii_lowercase();
        if lower == "bearer" || lower.starts_with("bearer") {
            skip_next = lower == "bearer";
            continue;
        }
        if let Some(cleaned) = redact_token(token) {
            out.push(cleaned);
        }
    }
    out.join(" ")
}

fn redact_token(token: &str) -> Option<String> {
    let stripped = if let Some(scheme) = token.find("://") {
        let after_scheme = &token[scheme + 3..];
        if let Some(query) = after_scheme.find('?') {
            token[..scheme + 3 + query].to_string()
        } else {
            token.to_string()
        }
    } else {
        token.to_string()
    };
    let lower = stripped.to_ascii_lowercase();
    if lower.contains("api_key=")
        || lower.contains("access_token=")
        || lower.contains("refresh_token=")
        || lower.contains("secret=")
        || lower.contains("password=")
        || lower.starts_with("bearer")
    {
        return None;
    }
    Some(stripped)
}

async fn addressee_is_chatting(db: &DatabaseConnection, user_id: i32) -> bool {
    let last_active = latest_open_session(db, user_id)
        .await
        .ok()
        .flatten()
        .map(|(_, at)| at);
    // A run parked on `waiting_for_input` is the addressee *not* talking: counting
    // it as chatting would suppress the very clarification notice that asks them
    // to come back, so only actively executing runs hold the floor.
    let executing_run = run_hub::user_has_executing_run(user_id).await;
    is_chatting(last_active, executing_run, Utc::now())
}

/// Whether an event is a task outcome, and whether it went well.
///
/// This is the only thing that decides if mood moves — not what the addressee
/// happened to be doing when the event arrived.
fn task_mood_outcome(event_key: &str) -> Option<bool> {
    match event_key {
        "agent.task_completed" => Some(true),
        "agent.task_failed" | "agent.task_cancelled" => Some(false),
        _ => None,
    }
}

async fn apply_task_mood(db: &DatabaseConnection, user_id: i32, event_key: &str, mood: f64) {
    let Some(succeeded) = task_mood_outcome(event_key) else {
        return;
    };
    let next = apply_task_outcome(mood, succeeded);
    let _ = save_mood(db, user_id, next, false).await;
    if !is_extremely_low(mood) && is_extremely_low(next) {
        spawn(
            user_id,
            "agent.merope.mood_floor",
            "跟这个人的心情掉到了极低",
        );
    }
}

async fn compose_line(db: &DatabaseConnection, user_id: i32, summary: &str) -> String {
    let fallback = fallback_line(summary);
    let Some(analyzer) = create_ai_analyzer_for_tier(ModelTier::Lite).await else {
        return fallback;
    };
    let soul = crate::services::agent::identity::get_speaking_soul()
        .await
        .unwrap_or_else(|| "你是 Agent。".to_string());
    let addressee = super::resolve_addressee_label(db, user_id).await;
    let mood_block = match get_or_create_state(db, user_id).await {
        Ok(state) => format!("\n\n{}", format_mood_section(state.mood)),
        Err(_) => String::new(),
    };
    let recent = recent_proactive(db, user_id, 6)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|row| format!("- {}", compact_summary(&row.content)))
        .collect::<Vec<_>>()
        .join("\n");
    let recent_block = if recent.is_empty() {
        "（还没有对这个人说过话）".to_string()
    } else {
        recent
    };
    let system = super::speaking_prompts::compose_proactive_system(
        &soul,
        &addressee_speaking_section(&addressee),
        &mood_block,
        &recent_block,
    );
    let prompt = super::speaking_prompts::compose_proactive_user(summary);
    match crate::services::ai_cost_ledger::with_site_ai_ledger(
        user_id,
        "merope",
        "speak",
        analyzer.analyze_with_system(&system, &prompt),
    )
    .await
    {
        Ok(raw) => {
            let spoken = sanitize_speech(&raw);
            if is_trivial_line(&spoken) {
                fallback
            } else {
                spoken
            }
        }
        Err(error) => {
            tracing::debug!(%error, "[Merope] Lite speech failed, using fallback");
            fallback
        }
    }
}

fn sanitize_speech(raw: &str) -> String {
    let mut text = raw.trim().to_string();
    if text.starts_with("```") {
        text = text
            .lines()
            .skip(1)
            .take_while(|line| !line.trim_start().starts_with("```"))
            .collect::<Vec<_>>()
            .join(" ");
    }
    let text = text
        .trim()
        .trim_matches(|c| c == '"' || c == '“' || c == '”')
        .trim();
    let first = text
        .split_once('\n')
        .map(|(head, _)| head)
        .unwrap_or(text)
        .trim();
    first.chars().take(160).collect()
}

async fn emit_speech_notification(
    db: &DatabaseConnection,
    user_id: i32,
    event_key: &str,
    spoken: &str,
    performance: Option<&super::PerformanceDirective>,
    mood: Option<&super::MoodTransition>,
    source_intent_id: Option<&str>,
) {
    let Some(manager) = get_notification_manager() else {
        return;
    };
    if !is_valuable_event(event_key) {
        return;
    }
    let title = display_name(db).await;
    let session_id = latest_open_session(db, user_id)
        .await
        .ok()
        .flatten()
        .map(|(id, _)| id);
    let mut metadata = serde_json::json!({
        "event_key": event_key,
        "action": "open_arael",
        "session_id": session_id,
    });
    if let Some(object) = metadata.as_object_mut() {
        if let Some(performance) = performance {
            object.insert(
                "performance".to_string(),
                serde_json::to_value(performance).unwrap_or_default(),
            );
        }
        if let Some(mood) = mood {
            object.insert(
                "merope_state".to_string(),
                serde_json::json!({ "mood": mood, "activity": "talking" }),
            );
        }
        if let Some(intent_id) = source_intent_id {
            object.insert(
                "intention_id".to_string(),
                serde_json::Value::String(intent_id.to_string()),
            );
        }
    }
    let notification = Notification::new(
        user_id,
        NotificationType::SystemInfo,
        NotificationPriority::Normal,
        title,
        spoken,
    )
    .with_metadata(metadata);
    manager.notify(notification).await;
}

async fn display_name(db: &DatabaseConnection) -> String {
    let stored = get_persona(db)
        .await
        .ok()
        .flatten()
        .map(|persona| persona.name);
    public_persona_name(true, stored.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_keeps_human_summary() {
        assert_eq!(
            fallback_line("  Steam  解锁了成就  "),
            "刚才有件事，想跟你说一声。"
        );
        assert_eq!(fallback_line("这个人今天第一次来了"), "今天又见到你了。");
        assert_eq!(fallback_line("这个人隔了很久又来了"), "好久不见。");
    }

    #[test]
    fn compact_summary_drops_json_and_secret_shaped_tokens() {
        assert!(compact_summary("{\"token\":\"abc\"}").is_empty());
        assert_eq!(
            compact_summary("Steam 刷新失败 https://api.example/sync?access_token=abcd"),
            "Steam 刷新失败 https://api.example/sync"
        );
        assert_eq!(compact_summary("抓取失败 Bearer eyJhbGciOi"), "抓取失败");
        assert_eq!(compact_summary("  Steam  解锁了成就  "), "Steam 解锁了成就");
    }

    #[test]
    fn persona_remember_insert_skips_empty_and_duplicate_compact_text() {
        assert_eq!(persona_remember_insert("{\"token\":\"abc\"}", &[]), None);
        assert_eq!(persona_remember_insert("   ", &[]), None);
        let kept = persona_remember_insert("  晚上想打独立游戏  ", &[]).unwrap();
        assert_eq!(kept, "晚上想打独立游戏");
        assert_eq!(
            persona_remember_insert("晚上想打独立游戏", &[kept.clone()]),
            None
        );
        assert_eq!(
            persona_remember_insert("  晚上想打独立游戏  ", &["晚上想打独立游戏".into()]),
            None
        );
        assert_eq!(
            persona_remember_insert("早上喝美式", &["晚上想打独立游戏".into()]).as_deref(),
            Some("早上喝美式")
        );
    }

    #[test]
    fn remember_writes_persona_memory_not_event_ledger() {
        let src = include_str!("ingest.rs");
        assert!(src.contains("DIARY_SOURCE_REMEMBER"));
        assert!(src.contains("ConsciousnessAction::Remember"));
        assert!(src.contains("persist_persona_remember"));
        assert!(src.contains("ConsciousnessAction::Speak | ConsciousnessAction::Ask"));
        assert!(!src.contains("insert_diary(db, user_id, memory, \"event\")"));
        assert!(!src.contains("insert_diary(db, user_id, &memory, \"event\")"));
        assert!(src.contains("ConsciousnessAction::Ignore =>") && src.contains("return Ok(());"));
        assert!(
            src.contains("persona_remember_insert(candidate, &existing)")
                && src.contains("DIARY_SOURCE_REMEMBER")
        );
        let speak_arm = src
            .find("ConsciousnessAction::Speak | ConsciousnessAction::Ask")
            .expect("speak/ask arm");
        let persist_in_arm = src[speak_arm..]
            .find("persist_persona_remember")
            .expect("persist in speak/ask arm");
        let persist_at = speak_arm + persist_in_arm;
        let trivial_at = src
            .find("if is_trivial_line(&spoken)")
            .expect("trivial-line gate");
        let duplicate_at = src
            .find("last.content.trim() == spoken.trim()")
            .expect("duplicate-proactive gate");
        assert!(
            persist_at < trivial_at,
            "Speak/Ask memory must persist before trivial-line return"
        );
        assert!(
            persist_at < duplicate_at,
            "Speak/Ask memory must persist before duplicate-proactive return"
        );
    }

    #[test]
    fn speak_memory_fact_is_kept_when_spoken_line_would_be_skipped() {
        let speech = "晚上好。";
        let memory = "晚上想打独立游戏";
        assert!(!is_trivial_line(speech));
        assert_eq!(speech.trim(), "晚上好。");
        assert_eq!(
            persona_remember_insert(memory, &[]).as_deref(),
            Some("晚上想打独立游戏")
        );
        assert_eq!(
            persona_remember_insert(memory, &["晚上想打独立游戏".into()]),
            None
        );
    }

    #[test]
    fn work_outcome_event_ids_are_stable_for_the_same_summary() {
        let a = stable_consciousness_event_id(7, "agent.task_completed", "报告写好了");
        let b = stable_consciousness_event_id(7, "agent.task_completed", "报告写好了");
        let c = stable_consciousness_event_id(7, "agent.task_completed", "另一件事");
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert!(a.starts_with("evt_7_agent.task_completed_"));
    }

    #[test]
    fn ordinary_event_ids_share_a_time_bucket() {
        let a = stable_consciousness_event_id(7, "brew.source_error", "feed failed");
        let b = stable_consciousness_event_id(7, "brew.source_error", "feed failed again");
        assert_eq!(a, b);
    }

    #[test]
    fn work_outcomes_chain_parent_to_the_proposal_source() {
        assert_eq!(
            work_outcome_parent(
                "agent.task_completed",
                Some("evt_7_brew.source_error_1".into())
            ),
            Some("evt_7_brew.source_error_1".into())
        );
        assert_eq!(
            work_outcome_parent(
                "brew.source_error",
                Some("evt_7_brew.source_error_1".into())
            ),
            None
        );
    }

    #[test]
    fn only_merope_owned_speech_is_worth_a_model_call() {
        assert!(speech_is_shown("agent.merope.platform_activity", true));
        // These already have a producer sending the notification.
        assert!(!speech_is_shown("agent.task_failed", true));
        assert!(!speech_is_shown("brew.source_error", true));
        // Ambient speech never notifies at all.
        assert!(!speech_is_shown("agent.merope.greeting", false));
    }

    #[test]
    fn json_shaped_speech_is_trivial() {
        assert!(is_trivial_line("{\"line\":\"hi\"}"));
        assert!(!is_trivial_line("刚才那件事做成了。"));
    }

    /// Mood follows what happened, not what the addressee was doing when it
    /// happened. Chat completions are filtered by event kind — in `run_hub`,
    /// and again by the match in `apply_task_mood` — so a Work outcome must
    /// still count while the addressee is mid-conversation.
    #[test]
    fn task_mood_follows_the_event_kind_not_the_addressees_activity() {
        let src = include_str!("ingest.rs")
            .split("#[cfg(test)]")
            .next()
            .unwrap();
        let apply = src
            .find("apply_task_mood(db")
            .expect("apply_task_mood call");
        let guard = src[..apply].rfind("if !chatting");
        assert!(
            guard.is_none_or(|at| apply - at > 400),
            "a Work outcome must not be dropped because the addressee is chatting"
        );
        // `chatting` still decides whether she *says* something about it.
        assert!(src.contains("chatting,\n        working,"));
    }

    #[test]
    fn only_task_outcomes_move_mood() {
        for key in [
            "agent.task_progress",
            "agent.clarification",
            "agent.chat_completed",
            "merope.diary",
        ] {
            assert_eq!(task_mood_outcome(key), None, "{key} must not move mood");
        }
        assert_eq!(task_mood_outcome("agent.task_completed"), Some(true));
        assert_eq!(task_mood_outcome("agent.task_failed"), Some(false));
        assert_eq!(task_mood_outcome("agent.task_cancelled"), Some(false));
    }
}
