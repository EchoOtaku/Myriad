//! Site persona — one personality, owner-writable.

use super::*;
use axum::{extract::State, Extension, Json};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::HttpError;
use crate::middleware::auth::Claims;
use crate::services::agent::life;
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

    let Some(persona) = persona else {
        let mut body = json!({
            "name": "Arael",
            "portraitAssetId": null,
            "hasCustomPersona": false,
            "mood": mood,
            "activity": activity,
            "doNotDisturb": do_not_disturb,
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
    });
    if is_owner {
        body["personality"] = json!(persona.personality);
        body["name"] = json!(persona.name);
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
    let saved = life::upsert_persona(&db, body.name, body.personality, portrait, user_id)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[Agent persona] save failed");
            HttpError::from((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            ))
        })?;
    Ok(Json(json!({
        "name": saved.name,
        "personality": saved.personality,
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

/// GET /api/agent/persona/signals
/// Short personality tags from this person's stored reports. No visual assets.
pub async fn get_persona_signals(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>, HttpError> {
    require_life_enabled().await?;
    let user_id = parse_user_id_with_agent_access(&claims, &db).await?;
    let rows = crate::models::entities::platform_reports::Entity::find()
        .filter(crate::models::entities::platform_reports::Column::UserId.eq(user_id))
        .all(&db)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[Agent persona] signals load failed");
            HttpError::from((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "Database error" })),
            ))
        })?;

    let mut tags = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for row in &rows {
        collect_persona_tags(&row.report, &row.platform, &mut tags, &mut seen);
        if tags.len() >= 24 {
            break;
        }
    }

    Ok(Json(json!({
        "reportCount": rows.len(),
        "tags": tags,
    })))
}

/// POST /api/agent/persona/draft
/// Lite writes a personality paragraph from tags. No appearance, room, or clothes.
pub async fn draft_persona(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(body): Json<DraftPersonaRequest>,
) -> Result<Json<Value>, HttpError> {
    require_life_enabled().await?;
    let _user_id = require_site_owner(&claims, &db).await?;
    let tags = sanitize_draft_tags(&body.tags);
    let fallback = tags.join("、");
    let name = body.name.trim();
    let display = if name.is_empty() { "Arael" } else { name };
    if tags.is_empty() {
        return Ok(Json(json!({
            "personality": fallback,
            "source": "empty",
        })));
    }

    let Some(analyzer) =
        crate::services::ai::create_ai_analyzer_for_tier(crate::config::ModelTier::Lite).await
    else {
        return Ok(Json(json!({
            "personality": fallback,
            "source": "fallback",
        })));
    };
    let system = "根据词条写一段不超过200字的性格说明，用第二人称对这个生命说话时的口吻来写。\
不要写外形、立绘、房间、服装。不要输出 JSON，不要解释。";
    let prompt = format!("名字：{display}\n词条：{}", tags.join("、"));
    match analyzer.analyze_with_system(system, &prompt).await {
        Ok(raw) => {
            let text = sanitize_draft_text(&raw);
            if !is_usable_personality_draft(&text) {
                Ok(Json(json!({
                    "personality": fallback,
                    "source": "fallback",
                })))
            } else {
                Ok(Json(json!({
                    "personality": text,
                    "source": "lite",
                })))
            }
        }
        Err(_) => Ok(Json(json!({
            "personality": fallback,
            "source": "fallback",
        }))),
    }
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

fn sanitize_draft_tags(tags: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for tag in tags {
        let Some(label) = clip_persona_tag(tag) else {
            continue;
        };
        if !seen.insert(label.to_lowercase()) {
            continue;
        }
        out.push(label);
        if out.len() >= 24 {
            break;
        }
    }
    out
}

fn sanitize_draft_text(raw: &str) -> String {
    raw.trim()
        .trim_matches(|c| c == '"' || c == '“' || c == '”')
        .chars()
        .take(400)
        .collect()
}

fn is_usable_personality_draft(text: &str) -> bool {
    text.chars().count() >= 4 && !text.starts_with('{')
}

fn clip_persona_tag(raw: &str) -> Option<String> {
    let label: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let count = label.chars().count();
    if count < 2 {
        return None;
    }
    if count <= 40 {
        Some(label)
    } else {
        Some(label.chars().take(40).collect())
    }
}

fn collect_persona_tags(
    report: &Value,
    platform: &str,
    tags: &mut Vec<Value>,
    seen: &mut std::collections::HashSet<String>,
) {
    let Some(insights) = report.get("insights").and_then(Value::as_array) else {
        return;
    };
    for insight in insights {
        let Some(raw) = insight.as_str() else {
            continue;
        };
        let Some(label) = clip_persona_tag(raw) else {
            continue;
        };
        if !seen.insert(label.to_lowercase()) {
            continue;
        }
        tags.push(json!({
            "label": label,
            "source": platform,
        }));
        if tags.len() >= 24 {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clips_long_insights_instead_of_dropping_them() {
        let long = "一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十超出";
        let clipped = clip_persona_tag(long).expect("tag");
        assert_eq!(clipped.chars().count(), 40);
    }

    #[test]
    fn collects_unique_insights_as_tags() {
        let report = json!({
            "insights": ["夜战爱好者", "夜战爱好者", "x", "喜欢独立游戏"]
        });
        let mut tags = Vec::new();
        let mut seen = std::collections::HashSet::new();
        collect_persona_tags(&report, "steam", &mut tags, &mut seen);
        assert_eq!(tags.len(), 2);
        assert_eq!(tags[0]["label"], "夜战爱好者");
        assert_eq!(tags[0]["source"], "steam");
        assert_eq!(tags[1]["label"], "喜欢独立游戏");
    }

    #[test]
    fn draft_tags_dedupe_and_cap() {
        let tags = sanitize_draft_tags(&[
            "  夜战  ".into(),
            "夜战".into(),
            "x".into(),
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
    fn json_shaped_draft_is_rejected() {
        assert!(!is_usable_personality_draft("{\"a\":1}"));
        assert!(is_usable_personality_draft("话少，认真，对熟人会软一点。"));
    }
}
