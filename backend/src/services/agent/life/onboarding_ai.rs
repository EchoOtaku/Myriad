//! Lite onboarding helpers copied from digital-life v2: name roll + structured
//! persona draft. Visual identity / outfits stay out.

use serde_json::{json, Map, Value};
use std::time::Duration;

use crate::config::ModelTier;
use crate::services::ai::create_ai_analyzer_for_tier_with_timeout;

use super::report_dna::sanitize_onboarding_tags;

const ONBOARDING_AI_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_PERSONA_LIST_ITEMS: usize = 12;

const NAME_SYSTEM_PROMPT: &str = r#"You design ONE original character display name for Agent life onboarding (step 2).
This is a CHARACTER NAME, not a real-life nickname and not a poem title.

Return ONLY one JSON object, no markdown:
{"name":"..."}

## Goal
A short original OC name that feels intentional: one identity unit with internal logic (phonetics + meaning cohere), matching genderPresentation and the mood of selectedTags.

## Logical name (required)
- The two/three characters belong together as ONE designed name, not random pretty characters glued together.
- Meaning should be simple and coherent as a persona label — not a landscape collage, not a proverb, not a tag dump.
- genderPresentation must fit (female / male name color; nonbinary/unspecified → androgynous OC name).
- selectedTags (if any) steer temperament only: cooler vs warmer, restrained vs open, night vs soft — WITHOUT naming the trait literally.

## Form
- Prefer 2–4 Simplified Chinese characters (max 6). No spaces, no punctuation, no Latin.
- Original only. Invented OK; must still feel name-like.

## Hard ban
A) Everyday social nicknames / 阿X / 小X / 张三李四 real-world handles.
B) Scenery/poetry stacks with no name unity.
C) Pasting persona tags as the name (慢热、边界感、夜猫子…).
D) English tokens, pure digits, 小姐/大人, famous real people or existing game characters.

## Tags usage
- NON-EMPTY selectedTags = hard mood lock. Name should feel like it could belong to that kernel.
- Do not illustrate every tag; one coherent temperament is enough.
- EMPTY tags: invent from genderPresentation only.

## Other
- Must differ from avoidName when avoidName is set.
- One name only."#;

const PERSONA_SYSTEM_PROMPT: &str = r#"You design one coherent original CHARACTER persona for Agent life onboarding.
Return only one JSON object with this exact shape:
{"persona":{"summary":"...","temperament":["..."],"likes":["..."],"drives":["..."],"socialStyle":"...","speechStyle":"..."}}

Rules:
- This is a pure character persona. Never add appearance, hair, outfit, accessory, palette, room, furniture, environment, inventory, location, world lore, job title, platform brand, or site capability.
- Ground the persona in selectedTags, genderPresentation, and extraRequirements.
- summary: one natural sentence, 20-120 characters in the requested language. Personality, not looks.
- temperament: 3-8 concise spoken traits, not poetic slogans or media titles.
- likes and drives: 2-6 grounded items each; required, never empty; do not invent biographical facts.
- socialStyle and speechStyle: concrete interaction guidance, not roleplay prose; required, never empty.
- No Markdown, no comments, no extra keys outside persona."#;

#[derive(Debug)]
pub enum OnboardingAiError {
    AnalyzerUnavailable,
    ProviderFailed,
    UnusableResponse,
}

pub async fn suggest_display_name(
    selected_tags: &[String],
    gender: &str,
    avoid_name: Option<&str>,
) -> Result<(String, Option<String>), OnboardingAiError> {
    let seeds = sanitize_onboarding_tags(selected_tags);
    let avoid = avoid_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(40).collect::<String>());
    let input = json!({
        "task": "recommend_display_name",
        "rollId": format!("n{}", uuid::Uuid::new_v4().simple()),
        "genderPresentation": normalize_gender(gender),
        "selectedTags": seeds,
        "avoidName": avoid.clone().unwrap_or_default(),
    })
    .to_string();
    let (raw, model) = run_onboarding_call("onboarding_name", NAME_SYSTEM_PROMPT, &input).await?;
    let name = parse_display_name_suggestion(&raw, avoid.as_deref())
        .ok_or(OnboardingAiError::UnusableResponse)?;
    Ok((name, model))
}

pub async fn suggest_persona(
    name: &str,
    language: &str,
    selected_tags: &[String],
    gender: &str,
    extra_requirements: &str,
) -> (Value, Option<String>, &'static str) {
    let tags = sanitize_onboarding_tags(selected_tags);
    let fallback = fallback_persona_draft(name, language, &tags);
    let input = json!({
        "task": "design_character_persona",
        "rollId": format!("p{}", uuid::Uuid::new_v4().simple()),
        "name": name.chars().take(50).collect::<String>(),
        "language": language,
        "genderPresentation": normalize_gender(gender),
        "selectedTags": tags,
        "extraRequirements": extra_requirements.chars().take(500).collect::<String>(),
    })
    .to_string();
    let Ok((raw, model)) =
        run_onboarding_call("onboarding_persona", PERSONA_SYSTEM_PROMPT, &input).await
    else {
        return (fallback, None, "fallback");
    };
    let Some(parsed) = parse_json_object(&raw) else {
        return (fallback, None, "fallback");
    };
    if !persona_draft_is_complete(&parsed) {
        return (fallback, None, "fallback");
    }
    let Some(persona) = sanitize_persona_draft(&parsed, &fallback) else {
        return (fallback, None, "fallback");
    };
    (persona, model, "lite")
}

async fn run_onboarding_call(
    _task: &str,
    system: &str,
    input: &str,
) -> Result<(String, Option<String>), OnboardingAiError> {
    let Some(analyzer) =
        create_ai_analyzer_for_tier_with_timeout(ModelTier::Lite, Some(ONBOARDING_AI_TIMEOUT)).await
    else {
        return Err(OnboardingAiError::AnalyzerUnavailable);
    };
    match analyzer.analyze_with_system(system, input).await {
        Ok(raw) if !raw.trim().is_empty() => Ok((raw, None)),
        _ => Err(OnboardingAiError::ProviderFailed),
    }
}

fn normalize_gender(value: &str) -> &str {
    match value {
        "female" | "male" | "nonbinary" | "unspecified" => value,
        _ => "unspecified",
    }
}

fn parse_json_object(raw: &str) -> Option<Value> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    serde_json::from_str(&raw[start..=end]).ok()
}

fn parse_display_name_suggestion(raw: &str, avoid: Option<&str>) -> Option<String> {
    let parsed = parse_json_object(raw)?;
    let candidates = if let Some(name) = parsed.get("name").and_then(Value::as_str) {
        vec![name.to_string()]
    } else if let Some(arr) = parsed.get("names").and_then(Value::as_array) {
        arr.iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    } else {
        return None;
    };
    let avoid_norm = avoid.map(str::trim).filter(|v| !v.is_empty());
    for candidate in candidates {
        let cleaned = sanitize_display_name_candidate(&candidate);
        if cleaned.is_empty() {
            continue;
        }
        if avoid_norm.is_some_and(|avoid| cleaned == avoid) {
            continue;
        }
        return Some(cleaned);
    }
    None
}

fn sanitize_display_name_candidate(raw: &str) -> String {
    let trimmed = raw
        .chars()
        .filter(|ch| !ch.is_control())
        .collect::<String>();
    let trimmed = trimmed.trim().trim_matches(|ch: char| {
        matches!(
            ch,
            '"' | '\'' | '「' | '」' | '『' | '』' | '《' | '》' | ' '
        )
    });
    let collapsed = trimmed.split_whitespace().collect::<Vec<_>>().join("");
    let count = collapsed.chars().count();
    if count < 2 {
        return String::new();
    }
    if collapsed.chars().all(|ch| ch.is_ascii_alphanumeric()) {
        return String::new();
    }
    if collapsed.starts_with('阿') || collapsed.starts_with('小') {
        return String::new();
    }
    if collapsed.contains("小姐") || collapsed.contains("大人") {
        return String::new();
    }
    collapsed.chars().take(6).collect()
}

pub fn fallback_persona_draft(name: &str, language: &str, tags: &[String]) -> Value {
    let tags = sanitize_onboarding_tags(tags);
    json!({
        "displayName": bounded_text(name, 50),
        "summary": fallback_summary(name, language, &tags),
        "temperament": tags,
        "traits": tags,
        "likes": [],
        "drives": [],
        "socialStyle": "",
        "speechStyle": "",
        "language": bounded_text(language, 16),
        "draftSource": "fallback",
    })
}

fn sanitize_persona_draft(value: &Value, fallback: &Value) -> Option<Value> {
    let source = value.get("persona").unwrap_or(value).as_object()?;
    let mut result = fallback.as_object()?.clone();
    replace_text(&mut result, source, "summary", &["summary"], 1_200);
    replace_list(
        &mut result,
        source,
        "temperament",
        &["temperament", "traits"],
    );
    if let Some(temperament) = result.get("temperament").cloned() {
        result.insert("traits".into(), temperament);
    }
    replace_list(&mut result, source, "likes", &["likes"]);
    replace_list(&mut result, source, "drives", &["drives", "motivations"]);
    replace_text(
        &mut result,
        source,
        "socialStyle",
        &["socialStyle", "social_style"],
        500,
    );
    replace_text(
        &mut result,
        source,
        "speechStyle",
        &["speechStyle", "speech_style", "voice"],
        500,
    );
    result.insert("draftSource".into(), json!("lite"));
    Some(Value::Object(result))
}

pub fn persona_draft_is_complete(value: &Value) -> bool {
    let Some(source) = value.get("persona").unwrap_or(value).as_object() else {
        return false;
    };
    let summary_ready = source
        .get("summary")
        .and_then(Value::as_str)
        .is_some_and(|summary| summary.trim().chars().count() >= 8);
    let temperament_ready = list_from(source, &["temperament", "traits"]).is_some_and(|items| !items.is_empty());
    summary_ready && temperament_ready
}

pub fn flatten_persona_text(persona: &Value) -> String {
    let source = persona.get("persona").unwrap_or(persona);
    let mut lines = Vec::new();
    if let Some(items) = list_from_value(source, &["temperament", "traits"]) {
        if !items.is_empty() {
            lines.push(format!("气质：{}", items.join("、")));
        }
    }
    if let Some(items) = list_from_value(source, &["likes"]) {
        if !items.is_empty() {
            lines.push(format!("喜好：{}", items.join("、")));
        }
    }
    if let Some(items) = list_from_value(source, &["drives"]) {
        if !items.is_empty() {
            lines.push(format!("驱动力：{}", items.join("、")));
        }
    }
    if let Some(text) = source
        .get("socialStyle")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("社交：{text}"));
    }
    if let Some(text) = source
        .get("speechStyle")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("表达：{text}"));
    }
    if let Some(summary) = source
        .get("summary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if !lines.is_empty() {
            lines.push(String::new());
        }
        lines.push(summary.to_string());
    }
    lines.join("\n")
}

fn fallback_summary(name: &str, language: &str, tags: &[String]) -> String {
    let name = bounded_text(name, 50);
    let display = if name.is_empty() { "Arael" } else { name.as_str() };
    let traits = tags.iter().take(5).cloned().collect::<Vec<_>>();
    if traits.is_empty() {
        return match language {
            "ja-JP" => format!("{display}は、これから個性を育てていく生命です。"),
            "en-US" => format!("{display} is a life whose personality will grow through shared experiences."),
            _ => format!("{display}是一个会在相处中逐渐形成独特个性的生命。"),
        };
    }
    match language {
        "ja-JP" => format!("{display}は、{}という気質を持つ生命です。", traits.join("、")),
        "en-US" => format!("{display} is a life with a {} temperament.", traits.join(", ")),
        _ => format!("{display}是一个带有{}气质的生命。", traits.join("、")),
    }
}

fn replace_text(
    target: &mut Map<String, Value>,
    source: &Map<String, Value>,
    target_key: &str,
    source_keys: &[&str],
    max_chars: usize,
) {
    if let Some(value) = source_keys
        .iter()
        .find_map(|key| source.get(*key).and_then(Value::as_str))
        .map(|value| bounded_text(value, max_chars))
        .filter(|value| !value.is_empty())
    {
        target.insert(target_key.to_string(), json!(value));
    }
}

fn replace_list(
    target: &mut Map<String, Value>,
    source: &Map<String, Value>,
    target_key: &str,
    source_keys: &[&str],
) {
    if let Some(values) = list_from(source, source_keys).filter(|values| !values.is_empty()) {
        target.insert(target_key.to_string(), json!(values));
    }
}

fn list_from(source: &Map<String, Value>, keys: &[&str]) -> Option<Vec<String>> {
    let value = keys.iter().find_map(|key| source.get(*key))?;
    list_value(value)
}

fn list_from_value(source: &Value, keys: &[&str]) -> Option<Vec<String>> {
    let value = keys.iter().find_map(|key| source.get(*key))?;
    list_value(value)
}

fn list_value(value: &Value) -> Option<Vec<String>> {
    let raw = match value {
        Value::Array(items) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>(),
        Value::String(value) => value
            .split(['、', ',', '，', ';', '/', '|'])
            .map(str::to_string)
            .collect(),
        _ => return None,
    };
    let mut sanitized = Vec::new();
    for item in raw {
        let item = bounded_text(&item, 120);
        if item.is_empty() || sanitized.iter().any(|existing| existing == &item) {
            continue;
        }
        sanitized.push(item);
        if sanitized.len() == MAX_PERSONA_LIST_ITEMS {
            break;
        }
    }
    Some(sanitized)
}

fn bounded_text(value: &str, max_chars: usize) -> String {
    value
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(max_chars)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_display_name_rejects_latin_and_nick_prefixes() {
        assert!(sanitize_display_name_candidate("Alice").is_empty());
        assert!(sanitize_display_name_candidate("阿强").is_empty());
        assert!(sanitize_display_name_candidate("小美").is_empty());
        assert_eq!(sanitize_display_name_candidate("澄羽"), "澄羽");
        assert_eq!(sanitize_display_name_candidate("「岚音」"), "岚音");
    }

    #[test]
    fn persona_parser_requires_real_character_content() {
        let parsed = parse_json_object(
            r#"{"persona":{"summary":"安静但会认真回应重要事情。","temperament":["克制","细心"],"likes":["雨声"],"drives":["理解彼此"],"socialStyle":"不抢话","speechStyle":"简洁温和"}}"#,
        )
        .unwrap();
        assert!(persona_draft_is_complete(&parsed));
        assert!(!persona_draft_is_complete(&json!({
            "persona": { "summary": "只有一句，没有性格数组" }
        })));
    }

    #[test]
    fn flatten_keeps_character_fields_and_drops_looks() {
        let text = flatten_persona_text(&json!({
            "summary": "话少，认真。",
            "temperament": ["克制"],
            "likes": ["雨声"],
            "visualIdentity": { "hairShape": "短发" }
        }));
        assert!(text.contains("气质：克制"));
        assert!(text.contains("话少，认真。"));
        assert!(!text.contains("短发"));
    }
}
