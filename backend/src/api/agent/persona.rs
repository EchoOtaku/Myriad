//! Site persona — one personality, owner-writable.

use super::*;
use axum::{extract::State, Extension, Json};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::error::HttpError;
use crate::middleware::auth::Claims;
use crate::services::{agent::life, digital_life_rig};
use crate::services::site_owner::site_owner_user_id;
use axum::http::StatusCode;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutPersonaRequest {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub personality: String,
    /// Absent keeps the current portrait, explicit `null` clears it.
    #[serde(default, deserialize_with = "present_option")]
    pub portrait_asset_id: Option<Option<String>>,
    #[serde(default)]
    pub persona: Option<Value>,
    #[serde(default)]
    pub visual_profile: Option<Value>,
}

fn present_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftPersonaRequest {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub gender: String,
    #[serde(default)]
    pub extra_requirements: String,
    #[serde(default = "default_signals_language")]
    pub language: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestNameRequest {
    #[serde(default)]
    pub selected_tags: Vec<String>,
    #[serde(default)]
    pub gender: String,
    #[serde(default)]
    pub avoid_name: Option<String>,
    #[serde(default = "default_signals_language")]
    pub language: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportSignalsRequest {
    consent: bool,
    #[serde(default = "default_signals_language")]
    language: String,
    #[serde(default)]
    regenerate: bool,
}

fn default_signals_language() -> String {
    "zh-CN".to_string()
}

fn normalize_signals_language(raw: &str) -> &'static str {
    let value = raw.trim();
    if value.starts_with("zh") {
        "zh-CN"
    } else if value.starts_with("ja") {
        "ja-JP"
    } else {
        "en-US"
    }
}

fn life_disabled() -> HttpError {
    HttpError::from((
        StatusCode::FORBIDDEN,
        Json(json!({
            "error": "Agent life is disabled",
            "code": "agent_life_disabled"
        })),
    ))
}

async fn require_life_enabled() -> Result<(), HttpError> {
    let enabled = crate::GLOBAL_DYNAMIC_CONFIG
        .read()
        .await
        .agent_life_enabled_resolved();
    if enabled {
        Ok(())
    } else {
        Err(life_disabled())
    }
}

async fn report_platform_count(
    db: &DatabaseConnection,
    user_id: i32,
) -> Result<usize, HttpError> {
    life::report_dna::count_report_platforms(db, user_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[Agent persona] report count failed");
            HttpError::from((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            ))
        })
}

async fn require_persona_reports(
    db: &DatabaseConnection,
    user_id: i32,
) -> Result<usize, HttpError> {
    let count = report_platform_count(db, user_id).await?;
    if count < life::report_dna::MIN_PERSONA_REPORTS {
        return Err(HttpError::from((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Need at least 3 platform reports",
                "code": "persona_reports_required",
                "reportCount": count,
                "required": life::report_dna::MIN_PERSONA_REPORTS,
            })),
        )));
    }
    Ok(count)
}

async fn require_site_owner(claims: &Claims, db: &DatabaseConnection) -> Result<i32, HttpError> {
    let user_id = parse_user_id_with_agent_access(claims, db).await?;
    let owner = site_owner_user_id(db).await.map_err(|error| {
        tracing::error!(%error, "[Agent persona] Failed to resolve site owner");
        HttpError::from((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Failed to resolve site owner" })),
        ))
    })?;
    if user_id != owner {
        return Err(HttpError::from((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Only the site owner can change persona",
                "code": "site_owner_required"
            })),
        )));
    }
    Ok(user_id)
}

/// GET /api/agent/persona
pub async fn get_persona(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>, HttpError> {
    require_life_enabled().await?;
    let user_id = parse_user_id_with_agent_access(&claims, &db).await?;
    let owner = site_owner_user_id(&db).await.ok();
    let is_owner = owner == Some(user_id);
    let persona = life::get_persona(&db).await.map_err(|error| {
        tracing::error!(%error, "[Agent persona] load failed");
        HttpError::from((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Database error" })),
        ))
    })?;

    let (mood, activity, do_not_disturb) = if life::is_logged_in_addressee(user_id) {
        match life::get_or_create_state(&db, user_id).await {
            Ok(state) => (
                state.mood,
                life::current_activity(&state).to_string(),
                state.do_not_disturb,
            ),
            Err(_) => (70.0, "idle".to_string(), false),
        }
    } else {
        (70.0, "idle".to_string(), false)
    };

    let report_count = report_platform_count(&db, user_id).await.unwrap_or(0);

    let Some(persona) = persona else {
        let mut body = json!({
            "name": "Arael",
            "portraitAssetId": null,
            "hasCustomPersona": false,
            "mood": mood,
            "activity": activity,
            "doNotDisturb": do_not_disturb,
            "reportCount": report_count,
        });
        if is_owner {
            body["name"] = json!("");
            body["personality"] = json!("");
        }
        return Ok(Json(body));
    };

    let display_name = if persona.name.trim().is_empty() {
        "Arael"
    } else {
        persona.name.trim()
    };
    let mut body = json!({
        "name": display_name,
        "portraitAssetId": persona.portrait_asset_id,
        "hasCustomPersona": life::has_custom_persona(&persona),
        "mood": mood,
        "activity": activity,
        "doNotDisturb": do_not_disturb,
        "reportCount": report_count,
    });
    if is_owner {
        body["personality"] = json!(persona.personality);
        body["name"] = json!(persona.name);
        body["persona"] = persona.persona_json.unwrap_or(Value::Null);
        body["visualProfile"] = persona.visual_profile.unwrap_or(Value::Null);
        body["portraitGeneration"] = persona.portrait_generation.unwrap_or(Value::Null);
    }
    Ok(Json(body))
}

/// PUT /api/agent/persona
pub async fn put_persona(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<PutPersonaRequest>,
) -> Result<Json<Value>, HttpError> {
    require_life_enabled().await?;
    let user_id = require_site_owner(&claims, &db).await?;
    let previous_portrait = life::get_persona(&db)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[Agent persona] load before save failed");
            HttpError::from((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            ))
        })?
        .and_then(|persona| persona.portrait_asset_id);
    let portrait = match body.portrait_asset_id {
        None => life::PortraitUpdate::Keep,
        Some(None) => life::PortraitUpdate::Clear,
        Some(Some(raw)) => match sanitize_portrait_asset_id(&raw) {
            Some(cleaned) if cleaned.is_empty() => life::PortraitUpdate::Clear,
            Some(cleaned) => life::PortraitUpdate::Set(cleaned),
            None => {
                return Err(HttpError::from((
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": "Portrait must be a site asset",
                        "code": "portrait_not_site_asset"
                    })),
                )))
            }
        },
    };
    let visual_profile = body
        .visual_profile
        .as_ref()
        .map(sanitize_visual_profile)
        .transpose()?;
    let persona = body
        .persona
        .as_ref()
        .map(|value| sanitize_structured_persona(&body.name, value, visual_profile.as_ref()))
        .transpose()?;
    let contract = life::PersonaContractUpdate {
        persona: persona
            .map(life::JsonDocumentUpdate::Set)
            .unwrap_or(life::JsonDocumentUpdate::Clear),
        visual_profile: visual_profile
            .map(life::JsonDocumentUpdate::Set)
            .unwrap_or_default(),
        ..life::PersonaContractUpdate::default()
    };
    let saved = life::upsert_persona(
        &db,
        body.name,
        body.personality,
        portrait,
        contract,
        user_id,
    )
        .await
        .map_err(|error| {
            tracing::error!(%error, "[Agent persona] save failed");
            HttpError::from((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            ))
        })?;
    if previous_portrait != saved.portrait_asset_id {
        digital_life_rig::set_active_asset(&db, None)
            .await
            .map_err(|error| {
                tracing::error!(%error, "[Agent persona] stale rig invalidation failed");
                HttpError::from((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({ "error": "Database error" })),
                ))
            })?;
    }
    Ok(Json(json!({
        "name": saved.name,
        "personality": saved.personality,
        "persona": saved.persona_json,
        "visualProfile": saved.visual_profile,
        "portraitGeneration": saved.portrait_generation,
        "portraitAssetId": saved.portrait_asset_id,
        "hasCustomPersona": life::has_custom_persona(&saved),
    })))
}

/// DELETE /api/agent/persona
pub async fn delete_persona(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>, HttpError> {
    require_life_enabled().await?;
    let _user_id = require_site_owner(&claims, &db).await?;
    life::clear_persona(&db).await.map_err(|error| {
        tracing::error!(%error, "[Agent persona] clear failed");
        HttpError::from((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Database error" })),
        ))
    })?;
    digital_life_rig::set_active_asset(&db, None)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[Agent persona] stale rig invalidation failed");
            HttpError::from((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            ))
        })?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PutAddresseeRequest {
    pub do_not_disturb: bool,
}

/// PUT /api/agent/addressee — current speaker only. Never another person's state.
pub async fn put_addressee(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<PutAddresseeRequest>,
) -> Result<Json<Value>, HttpError> {
    require_life_enabled().await?;
    let user_id = parse_user_id_with_agent_access(&claims, &db).await?;
    if !life::is_logged_in_addressee(user_id) {
        return Err(HttpError::from((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Guests cannot change addressee state",
                "code": "login_required"
            })),
        )));
    }
    let state = life::set_do_not_disturb(&db, user_id, body.do_not_disturb)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[Agent addressee] save failed");
            HttpError::from((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            ))
        })?;
    Ok(Json(json!({
        "mood": state.mood,
        "activity": life::current_activity(&state),
        "doNotDisturb": state.do_not_disturb,
    })))
}

/// POST /api/agent/persona/signals
/// Distill spoken personality tags from the owner's latest reports. No visual assets.
pub async fn report_signals(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(request): Json<ReportSignalsRequest>,
) -> Result<Json<Value>, HttpError> {
    require_life_enabled().await?;
    let user_id = require_site_owner(&claims, &db).await?;
    require_persona_reports(&db, user_id).await?;
    if !request.consent {
        return Err(HttpError::from((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Explicit consent is required",
                "code": "consent_required"
            })),
        )));
    }
    let language = normalize_signals_language(&request.language);
    let distilled = life::report_dna::distill_report_dna(
        &db,
        user_id,
        language,
        request.regenerate,
    )
    .await
    .map_err(distill_error)?;
    Ok(Json(json!({
        "reportCount": distilled.report_count,
        "tags": distilled.tags,
        "aiDistilled": distilled.ai_distilled,
    })))
}

fn distill_error(error: life::report_dna::DistillReportDnaError) -> HttpError {
    match error {
        life::report_dna::DistillReportDnaError::Db(error) => {
            tracing::error!(%error, "[Agent persona] report DNA load failed");
            HttpError::from((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            ))
        }
        life::report_dna::DistillReportDnaError::AnalyzerUnavailable => HttpError::from((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Pro model is unavailable",
                "code": "pro_unavailable"
            })),
        )),
        life::report_dna::DistillReportDnaError::ProviderFailed
        | life::report_dna::DistillReportDnaError::EmptyResponse => HttpError::from((
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "error": "Failed to distill report signals",
                "code": "report_dna_failed"
            })),
        )),
    }
}

/// POST /api/agent/persona/name
/// Pro rolls one OC display name from selected tags + gender.
pub async fn suggest_name(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SuggestNameRequest>,
) -> Result<Json<Value>, HttpError> {
    require_life_enabled().await?;
    let user_id = require_site_owner(&claims, &db).await?;
    require_persona_reports(&db, user_id).await?;
    let language = normalize_signals_language(&body.language);
    let tags = life::report_dna::sanitize_onboarding_tags_for_language(&body.selected_tags, language);
    match life::onboarding_ai::suggest_display_name(
        &tags,
        &body.gender,
        body.avoid_name.as_deref(),
        language,
    )
    .await
    {
        Ok(name) => Ok(Json(json!({
            "name": name,
        }))),
        Err(life::onboarding_ai::OnboardingAiError::AnalyzerUnavailable) => Err(HttpError::from((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "error": "Pro model is unavailable",
                "code": "pro_unavailable"
            })),
        ))),
        Err(_) => Err(HttpError::from((
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "error": "Failed to suggest a name",
                "code": "name_suggest_failed"
            })),
        ))),
    }
}

/// POST /api/agent/persona/draft
/// Pro writes a structured character persona. No appearance, room, or clothes.
pub async fn draft_persona(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<DraftPersonaRequest>,
) -> Result<Json<Value>, HttpError> {
    require_life_enabled().await?;
    let user_id = require_site_owner(&claims, &db).await?;
    require_persona_reports(&db, user_id).await?;
    let language = normalize_signals_language(&body.language);
    let tags = life::report_dna::sanitize_onboarding_tags_for_language(&body.tags, language);
    let name = body.name.trim();
    let display = if name.is_empty() { "Arael" } else { name };
    let persona = match life::onboarding_ai::suggest_persona(
        display,
        language,
        &tags,
        &body.gender,
        &body.extra_requirements,
    )
    .await
    {
        Ok(value) => value,
        Err(life::onboarding_ai::OnboardingAiError::AnalyzerUnavailable) => {
            return Err(HttpError::from((
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({
                    "error": "Pro model is unavailable",
                    "code": "pro_unavailable"
                })),
            )))
        }
        Err(_) => {
            return Err(HttpError::from((
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": "Failed to draft a persona",
                    "code": "persona_draft_failed"
                })),
            )))
        }
    };
    Ok(Json(json!({
        "persona": persona,
    })))
}

/// Site assets only. The public face must not be able to point off-site, so a
/// scheme, host, or traversal is refused rather than quietly rewritten.
/// Accepts a same-origin path (`/uploads/face.png`) or a bare asset id.
fn sanitize_portrait_asset_id(raw: &str) -> Option<String> {
    let value = raw.trim();
    if value.is_empty() {
        return Some(String::new());
    }
    if value.len() > 512
        || value.contains(':')
        || value.contains("..")
        || value.starts_with("//")
        || value.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return None;
    }
    let bare_id = value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if value.starts_with('/') || bare_id {
        Some(value.to_string())
    } else {
        None
    }
}

fn sanitize_structured_persona(
    name: &str,
    value: &Value,
    visual_profile: Option<&Value>,
) -> Result<Value, HttpError> {
    let language = visual_profile
        .and_then(|profile| profile.get("language"))
        .and_then(Value::as_str)
        .unwrap_or("zh-CN");
    let outfit = visual_profile.and_then(|profile| profile.get("outfitDesign"));
    let fallback = myriad_digital_life::fallback_persona_draft(
        name,
        language,
        &[],
        outfit,
    );
    let persona = myriad_digital_life::sanitize_persona_draft(value, &fallback)
        .filter(myriad_digital_life::persona_draft_is_complete)
        .ok_or_else(|| {
            HttpError::from((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Structured persona is incomplete",
                    "code": "persona_contract_invalid"
                })),
            ))
        })?;
    Ok(persona)
}

fn sanitize_visual_profile(value: &Value) -> Result<Value, HttpError> {
    let source = value.as_object().ok_or_else(|| {
        HttpError::from((
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": "Visual profile must be an object",
                "code": "visual_profile_invalid"
            })),
        ))
    })?;
    let mut profile = Map::new();
    if let Some(gender) = source.get("gender").and_then(Value::as_str) {
        if !matches!(gender, "female" | "male" | "nonbinary" | "unspecified") {
            return Err(HttpError::from((
                StatusCode::BAD_REQUEST,
                Json(json!({
                    "error": "Visual profile gender is invalid",
                    "code": "visual_profile_invalid"
                })),
            )));
        }
        profile.insert("gender".into(), json!(gender));
    }
    if let Some(language) = source.get("language").and_then(Value::as_str) {
        profile.insert(
            "language".into(),
            json!(normalize_signals_language(language)),
        );
    }
    for (key, max_chars) in [("extraRequirements", 500), ("hairShape", 500)] {
        if let Some(text) = source.get(key).and_then(Value::as_str) {
            profile.insert(key.into(), json!(sanitize_visual_text(text, max_chars)?));
        }
    }
    if let Some(identity) = source.get("visualIdentity") {
        let identity = identity.as_object().ok_or_else(visual_profile_error)?;
        let mut sanitized = Map::new();
        for (key, max_chars) in [
            ("hairShape", 500),
            ("outfitConstruction", 1_200),
            ("heroAccessory", 500),
            ("paletteHint", 500),
        ] {
            if let Some(text) = identity.get(key).and_then(Value::as_str) {
                sanitized.insert(key.into(), json!(sanitize_visual_text(text, max_chars)?));
            }
        }
        profile.insert("visualIdentity".into(), Value::Object(sanitized));
    }
    if let Some(outfit) = source.get("outfitDesign") {
        if outfit.is_null() {
            profile.insert("outfitDesign".into(), Value::Null);
        } else {
            let outfit = outfit.as_object().ok_or_else(visual_profile_error)?;
            let mut sanitized = Map::new();
            for (key, max_chars) in [
                ("id", 80),
                ("titleZh", 120),
                ("eraCueZh", 240),
                ("designZh", 1_200),
                ("layersEn", 1_200),
                ("heroAccessoryZh", 500),
                ("paletteHintZh", 500),
            ] {
                if let Some(text) = outfit.get(key).and_then(Value::as_str) {
                    sanitized.insert(
                        key.into(),
                        json!(sanitize_visual_text(text, max_chars)?),
                    );
                }
            }
            if !["id", "titleZh", "designZh"]
                .iter()
                .all(|key| sanitized.get(*key).and_then(Value::as_str).is_some_and(|v| !v.is_empty()))
            {
                return Err(visual_profile_error());
            }
            profile.insert("outfitDesign".into(), Value::Object(sanitized));
        }
    }
    Ok(Value::Object(profile))
}

fn sanitize_visual_text(value: &str, max_chars: usize) -> Result<String, HttpError> {
    let value = value.trim();
    if value.chars().count() > max_chars || value.chars().any(char::is_control) {
        return Err(visual_profile_error());
    }
    Ok(value.to_string())
}

fn visual_profile_error() -> HttpError {
    HttpError::from((
        StatusCode::BAD_REQUEST,
        Json(json!({
            "error": "Visual profile is invalid",
            "code": "visual_profile_invalid"
        })),
    ))
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn draft_tags_use_onboarding_sanitize() {
        let tags = life::report_dna::sanitize_onboarding_tags(&[
            "  夜战  ".into(),
            "夜战".into(),
            "喜欢独立游戏".into(),
        ]);
        assert_eq!(tags, vec!["夜战".to_string(), "喜欢独立游戏".to_string()]);
    }

    #[test]
    fn portrait_accepts_site_assets_only() {
        assert_eq!(
            sanitize_portrait_asset_id(" /uploads/face.png "),
            Some("/uploads/face.png".to_string())
        );
        assert_eq!(
            sanitize_portrait_asset_id("asset_1-2.png"),
            Some("asset_1-2.png".to_string())
        );
        assert_eq!(sanitize_portrait_asset_id(""), Some(String::new()));
        assert_eq!(
            sanitize_portrait_asset_id("https://cdn.example.com/a.png"),
            None
        );
        assert_eq!(sanitize_portrait_asset_id("//cdn.example.com/a.png"), None);
        assert_eq!(sanitize_portrait_asset_id("javascript:alert(1)"), None);
        assert_eq!(sanitize_portrait_asset_id("/javascript:alert(1)"), None);
        assert_eq!(sanitize_portrait_asset_id("/uploads/../secret"), None);
        assert_eq!(sanitize_portrait_asset_id("face 1.png"), None);
    }

    #[test]
    fn absent_portrait_keeps_and_null_clears() {
        let keep: PutPersonaRequest =
            serde_json::from_value(json!({ "name": "瞳", "personality": "认真" })).expect("keep");
        assert!(keep.portrait_asset_id.is_none());

        let clear: PutPersonaRequest =
            serde_json::from_value(json!({ "name": "瞳", "portraitAssetId": null }))
                .expect("clear");
        assert_eq!(clear.portrait_asset_id, Some(None));

        let set: PutPersonaRequest =
            serde_json::from_value(json!({ "name": "瞳", "portraitAssetId": "/a.png" }))
                .expect("set");
        assert_eq!(set.portrait_asset_id, Some(Some("/a.png".to_string())));
    }

    #[test]
    fn visual_profile_keeps_generation_inputs_separate_from_spoken_persona() {
        let profile = sanitize_visual_profile(&json!({
            "gender": "nonbinary",
            "language": "zh-Hans",
            "extraRequirements": "金色眼睛",
        }))
        .expect("valid profile");
        assert_eq!(profile["language"], "zh-CN");
        assert_eq!(profile["extraRequirements"], "金色眼睛");

        let persona = sanitize_structured_persona(
            "瞳",
            &json!({
                "summary": "安静但对新事物有持续好奇心",
                "temperament": ["安静", "好奇"]
            }),
            Some(&profile),
        )
        .expect("valid persona");
        assert_eq!(persona["summary"], "安静但对新事物有持续好奇心");
        assert!(persona.get("gender").is_none());
    }

}
