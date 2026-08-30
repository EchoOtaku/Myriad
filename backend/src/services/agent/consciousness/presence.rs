//! Process-local live presence. Not a table, not a grant.

use std::collections::HashMap;
use std::sync::RwLock;

use once_cell::sync::Lazy;
use serde_json::Value;

use crate::services::agent::types::UserRequest;

use super::SelfLivePresence;

static LIVE: Lazy<RwLock<HashMap<i32, SelfLivePresence>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

pub fn remember_live_presence(user_id: i32, live: SelfLivePresence) {
    if user_id <= 0 {
        return;
    }
    if let Ok(mut map) = LIVE.write() {
        map.insert(user_id, live);
    }
}

pub fn last_live_presence(user_id: i32) -> SelfLivePresence {
    LIVE.read()
        .ok()
        .and_then(|map| map.get(&user_id).cloned())
        .unwrap_or_default()
}

pub fn live_presence_from_request(request: &UserRequest) -> SelfLivePresence {
    let mut live = SelfLivePresence::default();
    let Some(context) = request.context.as_ref() else {
        return live;
    };
    live.rig_state = context.rig_state.clone();
    live.visible_mode = Some(context.interaction_mode.as_str().to_string());
    if let Some(rig) = live.rig_state.as_ref() {
        live.speaking = rig.speaking;
        live.face_visible = rig.face_visible;
        live.motion_intent = rig.acting.intent.clone();
        live.speech_intent = if rig.speaking {
            Some("speech".into())
        } else {
            Some("idle".into())
        };
        live.speech_interruptible = rig.speaking;
    }
    if let Some(data) = context.custom_data.as_ref() {
        if let Some(presence) = data.get("presence").and_then(Value::as_object) {
            live.speaking = presence
                .get("speaking")
                .and_then(Value::as_bool)
                .unwrap_or(live.speaking);
            live.face_visible = presence
                .get("faceVisible")
                .and_then(Value::as_bool)
                .unwrap_or(live.face_visible);
            live.speech_interruptible = presence
                .get("speechInterruptible")
                .and_then(Value::as_bool)
                .unwrap_or(live.speech_interruptible);
            if let Some(mode) = presence.get("visibleMode").and_then(Value::as_str) {
                live.visible_mode = Some(mode.to_string());
            }
            live.motion_intent = presence
                .get("motionIntent")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or(live.motion_intent);
            live.speech_intent = presence
                .get("speechIntent")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or(live.speech_intent);
        }
        if let Some(items) = data.get("perception").and_then(Value::as_array) {
            live.perception = items
                .iter()
                .filter_map(|item| item.get("summary").and_then(Value::as_str))
                .map(|summary| summary.chars().take(160).collect())
                .take(8)
                .collect();
        }
    }
    live
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::agent::types::{RequestContext, UserRequest};
    use crate::services::agent::AgentInteractionMode;

    #[test]
    fn live_presence_does_not_invent_grants() {
        let request = UserRequest {
            raw_input: "hi".into(),
            timestamp: chrono::Utc::now(),
            user_id: 7,
            context: Some(RequestContext {
                interaction_mode: AgentInteractionMode::Chat,
                custom_data: Some(serde_json::json!({
                    "presence": {
                        "speaking": true,
                        "speechInterruptible": true,
                        "visibleMode": "chat",
                        "speechIntent": "tts"
                    },
                    "perception": [{ "summary": "music idle" }]
                })),
                ..Default::default()
            }),
        };
        let live = live_presence_from_request(&request);
        assert!(live.speaking);
        assert_eq!(live.visible_mode.as_deref(), Some("chat"));
        assert_eq!(live.perception, vec!["music idle"]);
        remember_live_presence(7, live.clone());
        assert_eq!(last_live_presence(7).speech_intent.as_deref(), Some("tts"));
    }
}
