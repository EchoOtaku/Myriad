//! Strict-Lite semantic motion selection for Merope.
//!
//! The model selects only a bounded expression/posture baseline and semantic
//! cues. Anime2.5DRig driver values, lip sync, blinking, breathing and secondary
//! motion remain deterministic on the client.

use std::time::{Duration, Instant};

use myriad_merope::{
    parse_performance_plan, plan_is_empty, refine_performance_plan, round_motion_style,
    ChatPerformancePlan, RigStateSummary, PERFORMANCE_BASELINE_EXPRESSIONS,
    PERFORMANCE_CUE_INTENTS, PERFORMANCE_INTERRUPT_MODES, PERFORMANCE_POSTURES,
    RIG_STATE_MOTION_STYLES,
};
use serde::{Deserialize, Serialize};

use super::store::get_persona;
use super::MoodTransition;

const MOTION_TIMEOUT: Duration = Duration::from_millis(1_400);
const MOTION_TOTAL_TIMEOUT: Duration = Duration::from_millis(1_600);
const MOTION_SCHEMA_NAME: &str = "merope_motion";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MotionPhase {
    Reaction,
    Delivery,
    Outcome,
    Proactive,
    Mood,
}

impl MotionPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Reaction => "reaction",
            Self::Delivery => "delivery",
            Self::Outcome => "outcome",
            Self::Proactive => "proactive",
            Self::Mood => "mood",
        }
    }
}

#[derive(Debug, Clone)]
pub struct MotionContext {
    pub user_id: i32,
    pub phase: MotionPhase,
    pub mood: MoodTransition,
    pub activity: String,
    pub user_text: String,
    pub response_text: Option<String>,
    pub task_success: Option<bool>,
    pub rig_state: Option<RigStateSummary>,
    /// Resolved once per Chat/Work round. Client style is only a fallback.
    pub motion_style: String,
}

#[derive(Debug, Clone, PartialEq)]
enum MotionDecision {
    Continue,
    Perform(ChatPerformancePlan),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceDirective {
    pub phase: MotionPhase,
    pub mood_revision: i64,
    pub plan: ChatPerformancePlan,
}

/// Runs exactly one Lite-tier call. Unavailable, slow or invalid Lite output
/// yields no semantic directive; callers keep deterministic ambient motion.
pub async fn direct_motion(context: MotionContext) -> Option<PerformanceDirective> {
    let started = Instant::now();
    let phase = context.phase.as_str();
    let rig_state = apply_round_motion_style(context.rig_state.clone(), &context.motion_style);
    if face_is_hidden(rig_state.as_ref()) {
        tracing::debug!(phase, "[MeropeMotion] Face hidden; ambient motion only");
        return None;
    }
    let Some(analyzer) =
        crate::services::ai::create_strict_lite_ai_analyzer_with_timeout(Some(MOTION_TIMEOUT))
            .await
    else {
        tracing::debug!(
            phase,
            "[MeropeMotion] Lite unavailable; ambient motion only"
        );
        return None;
    };

    let input = serde_json::json!({
        "phase": phase,
        "mood": {
            "value": context.mood.after,
            "band": context.mood.band_after,
            "previousBand": context.mood.band_before,
            "delta": context.mood.delta,
            "cause": context.mood.cause,
            "revision": context.mood.revision,
        },
        "activity": context.activity,
        "userText": truncate(&context.user_text, 600),
        "responseText": context.response_text.as_deref().map(|value| truncate(value, 900)),
        "taskSuccess": context.task_success,
        "rig": rig_state.as_ref(),
    })
    .to_string();

    let schema = motion_schema();
    let system_prompt = motion_system_prompt();
    let call = analyzer.analyze_json(&system_prompt, &input, MOTION_SCHEMA_NAME, Some(&schema));
    let result = tokio::time::timeout(
        MOTION_TOTAL_TIMEOUT,
        crate::services::ai_cost_ledger::with_site_ai_ledger(
            context.user_id,
            "merope",
            &format!("motion_{phase}"),
            call,
        ),
    )
    .await;

    let elapsed_ms = started.elapsed().as_millis() as u64;
    let raw = match result {
        Ok(Ok(raw)) => raw,
        Ok(Err(error)) => {
            tracing::warn!(phase, elapsed_ms, error = %error, "[MeropeMotion] Lite call dropped");
            return None;
        }
        Err(_) => {
            tracing::warn!(
                phase,
                elapsed_ms,
                "[MeropeMotion] Lite total timeout; plan dropped"
            );
            return None;
        }
    };
    match parse_motion_decision(&raw) {
        Some(MotionDecision::Continue) => {
            tracing::debug!(
                phase,
                elapsed_ms,
                "[MeropeMotion] Lite continued current acting"
            );
            None
        }
        Some(MotionDecision::Perform(parsed)) => {
            let plan = if let Some(state) = rig_state.as_ref() {
                refine_performance_plan(parsed, state)
            } else {
                parsed
            };
            if plan_is_empty(&plan) {
                tracing::debug!(
                    phase,
                    elapsed_ms,
                    "[MeropeMotion] Lite plan had no capable cues"
                );
                return None;
            }
            tracing::info!(phase, elapsed_ms, "[MeropeMotion] Lite plan ready");
            Some(PerformanceDirective {
                phase: context.phase,
                mood_revision: context.mood.revision,
                plan,
            })
        }
        None => {
            tracing::warn!(
                phase,
                elapsed_ms,
                "[MeropeMotion] Invalid Lite plan dropped"
            );
            None
        }
    }
}

/// One persona read per Chat/Work round. Client style is only used when the
/// site persona cannot be loaded.
pub async fn resolve_round_motion_style(client: Option<&RigStateSummary>, mood: i32) -> String {
    let client_style = client.map(|summary| summary.motion_style.as_str());
    if let Ok(db) = crate::services::tapp_registry::database().await {
        if let Ok(Some(persona)) = get_persona(&db).await {
            return round_motion_style(client_style, persona.persona_json.as_ref(), true, mood);
        }
    }
    round_motion_style(client_style, None, false, mood)
}

fn apply_round_motion_style(
    summary: Option<RigStateSummary>,
    motion_style: &str,
) -> Option<RigStateSummary> {
    let mut summary = summary?;
    summary.motion_style = if RIG_STATE_MOTION_STYLES.contains(&motion_style) {
        motion_style.to_string()
    } else {
        summary.motion_style
    };
    Some(summary)
}

fn face_is_hidden(state: Option<&RigStateSummary>) -> bool {
    state.is_some_and(|summary| !summary.page_visible || !summary.face_visible)
}

fn parse_motion_decision(raw: &str) -> Option<MotionDecision> {
    let stripped = strip_motion_json(raw);
    let value: serde_json::Value = serde_json::from_str(stripped).ok()?;
    let object = value.as_object()?;
    match object.get("continue") {
        Some(flag) if !flag.is_boolean() => return None,
        Some(flag) if flag.as_bool() == Some(true) => {
            if motion_payload_present(object) {
                return None;
            }
            return Some(MotionDecision::Continue);
        }
        _ => {}
    }
    parse_performance_plan(stripped).map(MotionDecision::Perform)
}

fn motion_payload_present(object: &serde_json::Map<String, serde_json::Value>) -> bool {
    let has_baseline = object.get("baseline").is_some_and(|value| !value.is_null());
    let has_cues = object
        .get("cues")
        .and_then(serde_json::Value::as_array)
        .is_some_and(|cues| !cues.is_empty());
    has_baseline || has_cues
}

fn strip_motion_json(raw: &str) -> &str {
    let trimmed = raw.trim();
    trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|inner| inner.strip_suffix("```"))
        .unwrap_or(trimmed)
        .trim()
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn motion_system_prompt() -> String {
    format!(
        r#"你是 Merope 的动作导演。输入中的 mood 是已保存的事实，不要修改心情。
只选择语义表演，不输出骨骼、坐标、角度、blendshape、口型、driver 或逐帧数据。
baseline.expression 只能是 {}；baseline.posture 只能是 {}。
cues.intent 只能是 {}，最多 3 个。
输入里的 rig 是现场语义状态，不是底层驱动。
若 rig.acting.remainingMs 仍大且当前动作仍然合适，输出 {{"continue":true}}，不要强行换动作。
不要连续重复 rig.recentIntents 里最近一次特殊表情（dizzy/cry/angry/speechless/maniac/silly/lovestruck）。
若 rig.owners.mouth 是 speech，嘴已被语音占用：只选表情或头身，不要试图做口型。
若 rig.singing 或 rig.musicPlaying 为真，选与节奏兼容的动作：优先 listen/respond/think 等不抢头身的意图，tempo 贴近节拍。
只使用 rig.capabilities 里有的能力；缺 dizzy-eye 就不要 dizzy，缺 lovestruck 就不要 lovestruck。
若 rig.capabilities 为空，不要选择依赖特殊素材的表情，也不要选择占头身的动作。
人设动作习惯是 rig.motionStyle：restrained 少用 open/delight，open 才更放开，even 保持克制的中度。
reaction 立即回应用户输入；delivery 配合即将说出的话；outcome 配合任务结果。不要打乱这个阶段顺序。
无合适动作时必须输出 {{"continue":true}}，不要输出空对象；空对象是无效输出。
只有确实需要斟酌、回忆或推理时才使用 think；不要让每次普通回复都思考。
只有文本明确表现眩晕、失去平衡或认知过载时才使用 dizzy；普通困惑、无奈或失败不要使用。
只有文本明确表现正在哭泣、落泪、强烈悲伤或情绪崩溃时才使用 cry；普通低心情、失败或道歉不要使用。
只有文本明确表现生气、恼怒或受挫时才使用 angry；普通失败、不同意或严肃说明不要使用。
只有文本明确表现无语、尴尬或对荒谬情况无奈时才使用 speechless；它是短暂反应，不代表静默或停止说话。
只有文本明确表现失控狂笑、疯癫式兴奋或故意夸张的疯狂时才使用 maniac；普通开心、笑话或胜利不要使用。
只有文本明确表现发呆、走神、没反应过来或自嘲犯傻时才使用 silly；它会让眼神完全涣散，普通俏皮、玩笑或思考不要使用。
只有文本明确表现被迷住、强烈心动、害羞到招架不住或故意夸张的沉醉时才使用 lovestruck；普通友好、感谢、开心或称赞不要使用。
低心情应克制，高心情可以更开放，但不要夸张。输出必须符合 JSON schema。"#,
        PERFORMANCE_BASELINE_EXPRESSIONS.join("/"),
        PERFORMANCE_POSTURES.join("/"),
        PERFORMANCE_CUE_INTENTS.join("/")
    )
}

fn motion_schema() -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "baseline": {
                "type": "object",
                "properties": {
                    "expression": { "type": "string", "enum": PERFORMANCE_BASELINE_EXPRESSIONS },
                    "posture": { "type": "string", "enum": PERFORMANCE_POSTURES },
                    "motionEnergy": { "type": "number", "minimum": 0.2, "maximum": 1.4 },
                    "attention": { "type": "number", "minimum": 0.0, "maximum": 1.0 }
                },
                "required": ["expression", "posture", "motionEnergy", "attention"]
            },
            "cues": {
                "type": "array",
                "maxItems": 3,
                "items": {
                    "type": "object",
                    "properties": {
                        "intent": { "type": "string", "enum": PERFORMANCE_CUE_INTENTS },
                        "atMs": { "type": "integer", "minimum": 0, "maximum": 5000 },
                        "intensity": { "type": "number", "minimum": 0.2, "maximum": 1.4 },
                        "tempo": { "type": "number", "minimum": 0.5, "maximum": 1.6 },
                        "fadeInMs": { "type": "integer", "minimum": 40, "maximum": 600 },
                        "fadeOutMs": { "type": "integer", "minimum": 60, "maximum": 800 },
                        "interrupt": { "type": "string", "enum": PERFORMANCE_INTERRUPT_MODES }
                    },
                    "required": ["intent", "atMs", "intensity", "tempo", "fadeInMs", "fadeOutMs", "interrupt"]
                }
            },
            "continue": { "type": "boolean" }
        },
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncates_on_character_boundary() {
        assert_eq!(truncate("你好吗", 2), "你好");
    }

    #[test]
    fn phases_have_stable_wire_names() {
        assert_eq!(MotionPhase::Reaction.as_str(), "reaction");
        assert_eq!(
            serde_json::to_string(&MotionPhase::Delivery).unwrap(),
            "\"delivery\""
        );
    }

    #[test]
    fn directive_wire_shape_is_camel_case_and_semantic_only() {
        let value = serde_json::to_value(PerformanceDirective {
            phase: MotionPhase::Reaction,
            mood_revision: 42,
            plan: ChatPerformancePlan {
                baseline: None,
                cues: vec![myriad_merope::ChatPerformanceCue {
                    intent: "listen".to_string(),
                    at_ms: 0,
                    intensity: 1.0,
                    tempo: 1.0,
                    fade_in_ms: 100,
                    fade_out_ms: 200,
                    interrupt: "if-lower".to_string(),
                }],
            },
        })
        .unwrap();
        assert_eq!(value["phase"], "reaction");
        assert_eq!(value["moodRevision"], 42);
        assert!(value.pointer("/plan/cues/0/atMs").is_some());
        assert!(value.get("driver").is_none());
    }

    #[test]
    fn motion_schema_exposes_new_expressions_only_as_semantic_cues() {
        let schema = motion_schema();
        let intents = schema
            .pointer("/properties/cues/items/properties/intent/enum")
            .and_then(serde_json::Value::as_array)
            .unwrap();
        assert!(intents.iter().any(|value| value == "think"));
        assert!(intents.iter().any(|value| value == "dizzy"));
        assert!(intents.iter().any(|value| value == "cry"));
        assert!(intents.iter().any(|value| value == "angry"));
        assert!(intents.iter().any(|value| value == "speechless"));
        assert!(intents.iter().any(|value| value == "maniac"));
        assert!(intents.iter().any(|value| value == "silly"));
        assert!(intents.iter().any(|value| value == "lovestruck"));
        let prompt = motion_system_prompt();
        assert!(prompt.contains("普通低心情、失败或道歉不要使用"));
        assert!(prompt.contains(&PERFORMANCE_BASELINE_EXPRESSIONS.join("/")));
        assert!(prompt.contains(&PERFORMANCE_POSTURES.join("/")));
        assert!(prompt.contains(&PERFORMANCE_CUE_INTENTS.join("/")));
        assert!(!prompt.contains("angleZ"));
        assert!(prompt.contains("continue"));
        assert!(prompt.contains("不要输出空对象"));
        assert!(prompt.contains("rig.capabilities 为空"));
        assert!(prompt.contains("rig.owners.mouth"));
        assert!(prompt.contains("musicPlaying"));
        assert!(prompt.contains("motionStyle"));
        assert!(prompt.contains("capabilities"));
        assert!(schema.pointer("/properties/continue").is_some());
        assert!(schema.get("required").is_none());
    }

    #[test]
    fn explicit_continue_is_not_a_plan() {
        assert_eq!(
            parse_motion_decision(r#"{"continue":true}"#),
            Some(MotionDecision::Continue)
        );
        assert_eq!(
            parse_motion_decision(r#"{"continue":true,"cues":[]}"#),
            Some(MotionDecision::Continue)
        );
        assert_eq!(
            parse_motion_decision("```json\n{\"continue\": true}\n```"),
            Some(MotionDecision::Continue)
        );
    }

    #[test]
    fn empty_object_is_invalid_not_continue() {
        assert_eq!(parse_motion_decision("{}"), None);
        assert_eq!(parse_motion_decision(r#"{"cues":[]}"#), None);
        assert_eq!(parse_motion_decision(r#"{"continue":false}"#), None);
    }

    #[test]
    fn illegal_baseline_without_cues_is_invalid() {
        assert_eq!(
            parse_motion_decision(
                r#"{"baseline":{"expression":"angry","posture":"attack"},"cues":[]}"#
            ),
            None
        );
    }

    #[test]
    fn legal_plan_is_perform() {
        let decision = parse_motion_decision(
            r#"{"cues":[{"intent":"listen","atMs":0,"intensity":1,"tempo":1,"fadeInMs":80,"fadeOutMs":120,"interrupt":"if-lower"}]}"#,
        );
        match decision {
            Some(MotionDecision::Perform(plan)) => {
                assert_eq!(plan.cues.len(), 1);
                assert_eq!(plan.cues[0].intent, "listen");
            }
            other => panic!("expected perform, got {other:?}"),
        }
    }

    #[test]
    fn continue_with_a_plan_is_rejected() {
        assert_eq!(
            parse_motion_decision(r#"{"continue":true,"cues":[{"intent":"listen"}]}"#),
            None
        );
        assert_eq!(
            parse_motion_decision(
                r#"{"continue":true,"baseline":{"expression":"warm","posture":"open","motionEnergy":1,"attention":0.8}}"#
            ),
            None
        );
    }

    #[test]
    fn hidden_face_skips_motion() {
        let hidden = myriad_merope::sanitize_rig_state(&serde_json::json!({
            "pageVisible": false,
            "faceVisible": true
        }))
        .unwrap();
        assert!(face_is_hidden(Some(&hidden)));
        let no_face = myriad_merope::sanitize_rig_state(&serde_json::json!({
            "pageVisible": true,
            "faceVisible": false
        }))
        .unwrap();
        assert!(face_is_hidden(Some(&no_face)));
        assert!(!face_is_hidden(None));
    }
}
