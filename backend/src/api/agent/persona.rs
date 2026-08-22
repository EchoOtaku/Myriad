//! Site persona — one personality, owner-writable.

use super::*;
use axum::{extract::State, Extension, Json};
use sea_orm::{DatabaseConnection, TransactionTrait};
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::error::HttpError;
use crate::middleware::auth::Claims;
use crate::services::site_owner::site_owner_user_id;
use crate::services::{agent::life, digital_life_rig};
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
    /// Absent preserves the document, explicit `null` clears it.
    #[serde(default, deserialize_with = "present_option")]
    pub persona: Option<Option<Value>>,
    /// Absent preserves the document, explicit `null` clears it.
    #[serde(default, deserialize_with = "present_option")]
    pub visual_profile: Option<Option<Value>>,
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SuggestVisualDesignRequest {
    #[serde(default)]
    pub visual_requirements: String,
    #[serde(default)]
    pub regenerate: bool,
    #[serde(default)]
    pub existing_visual_identity: Option<Value>,
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
    let transaction = db.begin().await.map_err(|error| {
        tracing::error!(%error, "[Agent persona] begin save transaction failed");
        HttpError::from((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Database error" })),
        ))
    })?;
    let previous = life::get_persona_on(&transaction)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[Agent persona] load before save failed");
            HttpError::from((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            ))
        })?;
    let previous_portrait = previous
        .as_ref()
        .and_then(|persona| persona.portrait_asset_id.clone());
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
    let visual_profile = match body.visual_profile.as_ref() {
        None => life::JsonDocumentUpdate::Keep,
        Some(None) => life::JsonDocumentUpdate::Clear,
        Some(Some(value)) => {
            let sanitized = sanitize_visual_profile(value)?;
            life::JsonDocumentUpdate::Set(merge_visual_profile(
                sanitized,
                previous
                    .as_ref()
                    .and_then(|persona| persona.visual_profile.as_ref()),
            ))
        }
    };
    let effective_visual_profile = match &visual_profile {
        life::JsonDocumentUpdate::Set(value) => Some(value),
        life::JsonDocumentUpdate::Clear => None,
        life::JsonDocumentUpdate::Keep => previous
            .as_ref()
            .and_then(|persona| persona.visual_profile.as_ref()),
    };
    let persona = match body.persona.as_ref() {
        None => life::JsonDocumentUpdate::Keep,
        Some(None) => life::JsonDocumentUpdate::Clear,
        Some(Some(value)) => life::JsonDocumentUpdate::Set(sanitize_structured_persona(
            &body.name,
            value,
            effective_visual_profile,
        )?),
    };
    let contract = life::PersonaContractUpdate {
        persona,
        visual_profile,
        ..life::PersonaContractUpdate::default()
    };
    let saved = life::upsert_persona_on(
        &transaction,
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
    let portrait_changed = previous_portrait != saved.portrait_asset_id;
    let cleared_asset = if portrait_changed {
        Some(
            digital_life_rig::persist_active_asset(&transaction, None)
                .await
                .map_err(|error| {
                    tracing::error!(%error, "[Agent persona] stale rig invalidation failed");
                    HttpError::from((
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({ "error": "Database error" })),
                    ))
                })?,
        )
    } else {
        None
    };
    transaction.commit().await.map_err(|error| {
        tracing::error!(%error, "[Agent persona] commit failed");
        HttpError::from((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Database error" })),
        ))
    })?;
    if let Some(asset_id) = cleared_asset {
        digital_life_rig::mirror_active_asset(asset_id).await;
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
    let transaction = db.begin().await.map_err(|error| {
        tracing::error!(%error, "[Agent persona] begin delete transaction failed");
        HttpError::from((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Database error" })),
        ))
    })?;
    life::clear_persona_on(&transaction).await.map_err(|error| {
        tracing::error!(%error, "[Agent persona] clear failed");
        HttpError::from((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Database error" })),
        ))
    })?;
    let cleared_asset = digital_life_rig::persist_active_asset(&transaction, None)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[Agent persona] stale rig invalidation failed");
            HttpError::from((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            ))
        })?;
    transaction.commit().await.map_err(|error| {
        tracing::error!(%error, "[Agent persona] delete commit failed");
        HttpError::from((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "error": "Database error" })),
        ))
    })?;
    digital_life_rig::mirror_active_asset(cleared_asset).await;
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

/// POST /api/agent/persona/visual-design
/// Pro turns the saved persona into one complete upper-body visual identity.
/// The suggestion is returned for owner review and is not persisted here.
pub async fn suggest_visual_design(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<SuggestVisualDesignRequest>,
) -> Result<Json<Value>, HttpError> {
    require_life_enabled().await?;
    let _user_id = require_site_owner(&claims, &db).await?;
    let persona = life::get_persona(&db)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[Agent persona] visual design load failed");
            HttpError::from((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            ))
        })?
        .ok_or_else(|| {
            HttpError::from((
                StatusCode::CONFLICT,
                Json(json!({
                    "error": "Save the persona before designing appearance",
                    "code": "persona_required"
                })),
            ))
        })?;
    let structured = persona.persona_json.as_ref().ok_or_else(|| {
        HttpError::from((
            StatusCode::CONFLICT,
            Json(json!({
                "error": "Structured persona is required before visual design",
                "code": "structured_persona_required"
            })),
        ))
    })?;
    if !myriad_digital_life::persona_draft_is_complete(structured) {
        return Err(HttpError::from((
            StatusCode::CONFLICT,
            Json(json!({
                "error": "Structured persona is incomplete",
                "code": "persona_contract_invalid"
            })),
        )));
    }
    let requirements = sanitize_visual_text(&body.visual_requirements, 500)?;
    let profile = persona.visual_profile.as_ref();
    let language = profile
        .and_then(|value| value.get("language"))
        .and_then(Value::as_str)
        .map(normalize_signals_language)
        .unwrap_or("zh-CN");
    let gender = profile
        .and_then(|value| value.get("gender"))
        .and_then(Value::as_str)
        .unwrap_or("unspecified");
    let explicit_existing = match body.existing_visual_identity.as_ref() {
        Some(value) => Some(
            myriad_digital_life::sanitize_upper_body_visual_identity(value).ok_or_else(|| {
                HttpError::from((
                    StatusCode::BAD_REQUEST,
                    Json(json!({
                        "error": "Existing visual identity is incomplete",
                        "code": "visual_identity_invalid"
                    })),
                ))
            })?,
        ),
        None => None,
    };
    let existing = body.regenerate.then(|| {
        explicit_existing
            .or_else(|| {
                profile
                    .and_then(|value| value.get("visualIdentity"))
                    .and_then(myriad_digital_life::sanitize_upper_body_visual_identity)
            })
            .unwrap_or(Value::Null)
    });
    let identity = match life::onboarding_ai::suggest_visual_design(
        persona.name.trim(),
        language,
        structured,
        gender,
        &requirements,
        existing.as_ref(),
        body.regenerate,
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
        Err(life::onboarding_ai::OnboardingAiError::LanguageMismatch) => {
            return Err(HttpError::from((
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": "Visual design did not match the interface language",
                    "code": "visual_design_language"
                })),
            )))
        }
        Err(_) => {
            return Err(HttpError::from((
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": "Failed to design upper-body appearance",
                    "code": "visual_design_failed"
                })),
            )))
        }
    };
    Ok(Json(json!({
        "visualIdentity": identity,
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
    let fallback = myriad_digital_life::fallback_persona_draft(name, language, &[]);
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
    for (key, max_chars) in [("extraRequirements", 500), ("personaExtraRequirements", 500)] {
        if let Some(text) = source.get(key).and_then(Value::as_str) {
            let text = sanitize_visual_text(text, max_chars)?;
            if !text.is_empty() {
                profile.insert(key.into(), json!(text));
            }
        }
    }
    if let Some(tags) = source.get("sourceTags").and_then(Value::as_array) {
        let tags = tags
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>();
        let tags = life::report_dna::sanitize_onboarding_tags(&tags);
        if !tags.is_empty() {
            profile.insert("sourceTags".into(), json!(tags));
        }
    }
    if let Some(identity) = source.get("visualIdentity") {
        let sanitized = myriad_digital_life::sanitize_upper_body_visual_identity(identity)
            .ok_or_else(visual_profile_error)?;
        profile.insert("visualIdentity".into(), sanitized);
    }
    Ok(Value::Object(profile))
}

fn merge_visual_profile(incoming: Value, previous: Option<&Value>) -> Value {
    let Some(previous) = previous.and_then(Value::as_object) else {
        return incoming;
    };
    let Some(target) = incoming.as_object() else {
        return incoming;
    };
    let mut merged = target.clone();
    for key in ["visualIdentity", "sourceTags", "personaExtraRequirements"] {
        if merged.get(key).is_none() {
            if let Some(value) = previous.get(key) {
                merged.insert(key.to_string(), value.clone());
            }
        }
    }
    Value::Object(merged)
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
        assert!(keep.persona.is_none());
        assert!(keep.visual_profile.is_none());

        let clear: PutPersonaRequest =
            serde_json::from_value(json!({ "name": "瞳", "portraitAssetId": null }))
                .expect("clear");
        assert_eq!(clear.portrait_asset_id, Some(None));

        let clear_contracts: PutPersonaRequest = serde_json::from_value(json!({
            "name": "瞳",
            "persona": null,
            "visualProfile": null
        }))
        .expect("clear contracts");
        assert_eq!(clear_contracts.persona, Some(None));
        assert_eq!(clear_contracts.visual_profile, Some(None));

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
            "visualIdentity": {
                "faceDesign": "成熟的鹅蛋脸与自然眉形",
                "eyeDesign": "金色多层虹膜与克制高光",
                "hairShape": "银灰齐颌短发与偏分刘海",
                "hairLayerPlan": "后发、刘海和左右侧发形成独立轮廓",
                "upperBodySilhouette": "紧凑肩线、清楚领口与胸前焦点",
                "outfitConstruction": "高领内搭叠短外套并止于高腰",
                "sleeveArmDesign": "左右袖片携局部前臂进入画面",
                "materialPlan": "哑光布料、银色金属与小面积宝石",
                "heroAccessory": "左胸星轨扣饰",
                "paletteHint": "雾蓝为主、银白为辅、金色点缀",
                "motif": "单一星轨弧线集中在胸前"
            }
        }))
        .expect("valid profile");
        assert_eq!(profile["language"], "zh-CN");
        assert_eq!(profile["extraRequirements"], "金色眼睛");
        assert!(myriad_digital_life::upper_body_visual_identity_is_complete(
            &profile["visualIdentity"]
        ));

        let kept = merge_visual_profile(
            sanitize_visual_profile(&json!({
                "gender": "female",
                "language": "zh-CN",
                "sourceTags": [" 慢热 ", "慢热", "嘴硬心软"]
            }))
            .expect("partial profile"),
            Some(&profile),
        );
        assert_eq!(kept["gender"], "female");
        assert_eq!(kept["sourceTags"], json!(["慢热", "嘴硬心软"]));
        assert_eq!(kept["visualIdentity"], profile["visualIdentity"]);
        assert!(kept.get("extraRequirements").is_none());
        assert!(kept.get("personaExtraRequirements").is_none());
    }

    #[test]
    fn visual_profile_keeps_persona_seeds() {
        let profile = sanitize_visual_profile(&json!({
            "gender": "male",
            "language": "en-US",
            "personaExtraRequirements": "quieter with strangers",
            "sourceTags": ["Night owl", "Clear boundaries"]
        }))
        .expect("seeds");
        assert_eq!(profile["personaExtraRequirements"], "quieter with strangers");
        assert_eq!(
            profile["sourceTags"],
            json!(["Night owl", "Clear boundaries"])
        );

        let persona = sanitize_structured_persona(
            "瞳",
            &json!({
                "summary": "安静但对新事物有持续好奇心",
                "temperament": ["安静", "好奇"],
                "likes": ["雨声"],
                "drives": ["理解彼此"],
                "socialStyle": "先听，再回应。",
                "speechStyle": "简洁但温和。"
            }),
            Some(&profile),
        )
        .expect("valid persona");
        assert_eq!(persona["summary"], "安静但对新事物有持续好奇心");
        assert!(persona.get("gender").is_none());
    }

}
