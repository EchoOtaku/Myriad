//! Strict-Lite semantic motion selection for Merope.
//!
//! The model selects only a bounded expression/posture baseline and semantic
//! cues. Anime2.5DRig driver values, lip sync, blinking, breathing and secondary
//! motion remain deterministic on the client.

use std::time::{Duration, Instant};

use myriad_merope::{
    ChatPerformancePlan, PERFORMANCE_BASELINE_EXPRESSIONS, PERFORMANCE_CUE_INTENTS,
    PERFORMANCE_INTERRUPT_MODES, PERFORMANCE_POSTURES, RIG_STATE_MOTION_STYLES, RigStateSummary,
    parse_performance_plan, plan_is_empty, refine_performance_plan, round_motion_style,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::entities::agent_persona;

use super::MoodTransition;
use super::store::get_persona;

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

    let persona_row = match crate::services::tapp_registry::database().await {
        Ok(db) => get_persona(&db).await.ok().flatten(),
        Err(_) => None,
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
        "persona": motion_persona_payload(persona_row.as_ref(), &context.motion_style),
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

/// Contract catalog the director may call. Keys must stay aligned with
/// `PERFORMANCE_*` so a new expression cannot ship unindexed.
const BASELINE_INDEX: &[(&str, &str)] = &[
    (
        "withdrawn",
        "收着、回避、不想展开。慢热、低心情、被冒犯时的底。",
    ),
    ("subdued", "压着但仍在场。克制、认真、不想热闹。"),
    ("steady", "平常脸。中性底，仍要配 cue，不能当成没表情。"),
    ("warm", "放松、亲近、带笑意。外向或软的人设常用。"),
];

const POSTURE_INDEX: &[(&str, &str)] = &[
    ("closed", "收着、不想占空间。"),
    ("neutral", "平常站位。"),
    ("open", "打开、靠近、欢迎。"),
];

const CUE_INDEX: &[(&str, &str, &str)] = &[
    ("greet", "打招呼、点头致意", "head-body"),
    ("respond", "接住对方刚说的话", ""),
    ("question", "疑惑、反问、没听清", "head-body"),
    ("delight", "开心、被逗到、事情顺利", "head-body"),
    ("emphasize", "加重、认真说一句", "head-body"),
    ("listen", "在听、等对方说完", ""),
    ("notify", "提醒、告知一件事", "head-body"),
    ("think", "在想、回忆、斟酌", ""),
    (
        "dizzy",
        "晕、转、过载。人设会晕或过载时用，不必等台词说「我晕了」",
        "dizzy-eye",
    ),
    (
        "cry",
        "难过到脸上。人设会露伤心时用，不必等台词说自己在哭",
        "cry-eye|cry-mouth",
    ),
    (
        "angry",
        "生气、被惹到。嘴硬或边界感强的人设可更快上来",
        "head-body",
    ),
    ("speechless", "无语、尴尬、愣住", "head-body"),
    (
        "maniac",
        "失控的兴奋或夸张狂气。爱闹的人设在高潮时可用",
        "maniac-mouth",
    ),
    (
        "silly",
        "呆、没反应过来、自嘲犯傻。俏皮人设遇到笑话时可用",
        "silly-eye|silly-mouth",
    ),
    (
        "lovestruck",
        "被说动、害羞、心动。亲近时可用，不必等情话",
        "lovestruck",
    ),
];

fn motion_expression_index() -> String {
    let mut lines = Vec::new();
    lines.push("表情底 baseline.expression（每回合必选一个）：".to_string());
    for (name, meaning) in BASELINE_INDEX {
        lines.push(format!("- {name}：{meaning}"));
    }
    lines.push("姿态 baseline.posture：".to_string());
    for (name, meaning) in POSTURE_INDEX {
        lines.push(format!("- {name}：{meaning}"));
    }
    lines.push(
        "瞬时表情 cues.intent（每回合 1–3 个。下列每一项都是可调用的合法选择；按人设取用，不要因为话里没有字面关键词就整表弃用）："
            .to_string(),
    );
    for (name, meaning, capability) in CUE_INDEX {
        if capability.is_empty() {
            lines.push(format!("- {name}：{meaning}。无额外能力要求。"));
        } else {
            lines.push(format!("- {name}：{meaning}。能力：{capability}。"));
        }
    }
    lines.join("\n")
}

fn motion_system_prompt() -> String {
    format!(
        r#"你是这个人设的动作导演。只选语义表演，不输出骨骼、坐标、角度、blendshape、口型、driver 或逐帧数据。
读输入里的 persona，按这个人会怎么露脸来选。mood 是已保存的事实，不要改。

{}

合法枚举：baseline.expression 只能是 {}；baseline.posture 只能是 {}；cues.intent 只能是 {}，最多 3 个。
每回合必须给出 baseline 和 1–3 个 cue。不要输出 continue，空对象无效。
只丢掉做不到的：缺能力表里的贴纸层就不要选那一项；说话占嘴时不要选 cry/maniac/silly；唱歌占身时不要选会抢头身的意图。

按性格取表情：
- 慢热、内向、克制：底用 withdrawn/subdued，常用 listen/think/respond；被戳到时仍用 cry/speechless。
- 外向、活泼、爱闹：底用 warm，常用 greet/delight/emphasize；玩笑用 silly，兴奋可用 maniac，亲近可用 lovestruck。
- 嘴硬、毒舌、边界感：speechless/angry/emphasize 多于 delight。
- 认真、轴：question/think/emphasize 多于 silly。
- 软、会亲近：warm + delight，被夸奖时可以用 lovestruck。
没有人设时按 even，仍要有 baseline + cue。
强度：restrained 的 motionEnergy 0.55–0.9、cue intensity 0.75–1.05；even 0.75–1.15 / 0.9–1.25；open 1.0–1.4 / 1.05–1.4。

reaction 回应用户刚说的；delivery 配合即将说的话；outcome 配合任务结果；proactive 配合自己找上门的那句。
输出必须符合 JSON schema。"#,
        motion_expression_index(),
        PERFORMANCE_BASELINE_EXPRESSIONS.join("/"),
        PERFORMANCE_POSTURES.join("/"),
        PERFORMANCE_CUE_INTENTS.join("/")
    )
}

fn motion_persona_payload(persona: Option<&agent_persona::Model>, motion_style: &str) -> Value {
    let (name, personality, json) = match persona {
        Some(row) => (
            row.name.as_str(),
            row.personality.as_str(),
            row.persona_json.as_ref(),
        ),
        None => ("", "", None),
    };
    let display = if name.trim().is_empty() {
        "Arael"
    } else {
        name.trim()
    };
    serde_json::json!({
        "name": truncate(display, 50),
        "personality": truncate(personality.trim(), 800),
        "summary": json_text(json, "summary", 400),
        "temperament": json_text_list(json, "temperament", 8, 48),
        "socialStyle": json_text(json, "socialStyle", 240),
        "speechStyle": json_text(json, "speechStyle", 240),
        "motionStyle": motion_style,
    })
}

fn json_text(value: Option<&Value>, key: &str, max_chars: usize) -> String {
    value
        .and_then(|item| item.get(key))
        .and_then(Value::as_str)
        .map(|text| truncate(text.trim(), max_chars))
        .filter(|text| !text.is_empty())
        .unwrap_or_default()
}

fn json_text_list(
    value: Option<&Value>,
    key: &str,
    max_items: usize,
    max_chars: usize,
) -> Vec<String> {
    value
        .and_then(|item| item.get(key))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .take(max_items)
                .map(|text| truncate(text, max_chars))
                .collect()
        })
        .unwrap_or_default()
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
        assert!(prompt.contains("按这个人会怎么露脸"));
        assert!(prompt.contains("按性格取表情"));
        assert!(!prompt.contains("只有文本明确表现"));
        assert!(!prompt.contains("不要夸张"));
        assert!(!prompt.contains("不要连续重复"));
        assert!(!prompt.contains("rig.capabilities 为空"));
        assert!(prompt.contains(&PERFORMANCE_BASELINE_EXPRESSIONS.join("/")));
        assert!(prompt.contains(&PERFORMANCE_POSTURES.join("/")));
        assert!(prompt.contains(&PERFORMANCE_CUE_INTENTS.join("/")));
        assert!(!prompt.contains("angleZ"));
        assert!(prompt.contains("不要输出 continue"));
        assert!(prompt.contains("空对象无效"));
        assert!(prompt.contains("persona"));
        assert!(schema.pointer("/properties/continue").is_none());
        assert!(schema.get("required").is_none());
    }

    #[test]
    fn motion_prompt_indexes_every_contract_expression() {
        assert_eq!(
            BASELINE_INDEX
                .iter()
                .map(|(name, _)| *name)
                .collect::<Vec<_>>(),
            PERFORMANCE_BASELINE_EXPRESSIONS.to_vec()
        );
        assert_eq!(
            POSTURE_INDEX
                .iter()
                .map(|(name, _)| *name)
                .collect::<Vec<_>>(),
            PERFORMANCE_POSTURES.to_vec()
        );
        assert_eq!(
            CUE_INDEX
                .iter()
                .map(|(name, _, _)| *name)
                .collect::<Vec<_>>(),
            PERFORMANCE_CUE_INTENTS.to_vec()
        );
        let prompt = motion_system_prompt();
        for name in PERFORMANCE_BASELINE_EXPRESSIONS {
            assert!(prompt.contains(&format!("- {name}：")), "{name}");
        }
        for name in PERFORMANCE_POSTURES {
            assert!(prompt.contains(&format!("- {name}：")), "{name}");
        }
        for name in PERFORMANCE_CUE_INTENTS {
            assert!(prompt.contains(&format!("- {name}：")), "{name}");
        }
    }

    #[test]
    fn motion_persona_payload_carries_temperament() {
        let blank = crate::models::entities::agent_persona::Model {
            id: "site".into(),
            name: "瞳".into(),
            personality: "气质：认真\n社交：慢热".into(),
            persona_json: Some(serde_json::json!({
                "summary": "认真，慢热，亲近之后会软。",
                "temperament": ["慢热", "嘴硬心软", "认真起来很轴"],
                "socialStyle": "先看，再靠近。",
                "speechStyle": "话短，不客套。",
            })),
            visual_profile: None,
            portrait_asset_id: None,
            portrait_generation: None,
            updated_by: None,
            updated_at: chrono::Utc::now().into(),
        };
        let payload = motion_persona_payload(Some(&blank), "restrained");
        assert_eq!(payload["name"], "瞳");
        assert_eq!(payload["motionStyle"], "restrained");
        assert!(payload["personality"].as_str().unwrap().contains("认真"));
        assert_eq!(payload["temperament"][0], "慢热");
        assert_eq!(payload["socialStyle"], "先看，再靠近。");
        let fallback = motion_persona_payload(None, "even");
        assert_eq!(fallback["name"], "Arael");
        assert_eq!(fallback["motionStyle"], "even");
        assert!(fallback["temperament"].as_array().unwrap().is_empty());
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
    fn streaming_chat_does_not_join_delivery_before_text_completes() {
        let src = include_str!("../process_and_recipe.rs");
        assert!(src.contains("Streamed text completion must not wait on delivery motion"));
        assert!(src.contains("let performance = None;"));
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
