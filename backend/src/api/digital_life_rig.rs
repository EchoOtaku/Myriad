//! Site-wide Anime2.5D face for Arael.
//!
//! Owner writes the compiled package. Guests read the same public atlas and
//! manifest. Hand artwork is one optional layer with bounded follow-through;
//! independently articulated limbs are outside this API contract.

use std::{
    collections::{HashMap, HashSet},
    sync::OnceLock,
};

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, Path, State},
    http::{header, HeaderValue, StatusCode},
    middleware::from_fn_with_state,
    response::Response,
    routing::{get, patch, post},
    Extension, Json, Router,
};
use myriad_digital_life::{
    build_character_asset_contract, build_character_visual_prompt,
    build_portrait_fallback_rig_with_generation, build_standard_face_rig_clips_for_semantics,
    character_asset_contract_fingerprint, compile_layered_rig, fallback_persona_draft,
    migrate_rig_manifest, validate_character_asset_source, CharacterVisualSlot, RigBone,
    RigClip, RigCompileSource,
    RigLayerSource, RigManifest, RigMotionProfile, RigOutfitProfile, RigSemanticAnchor,
    RigSemantics, RigSize, RigSpatialProfile, RigTexture, CHARACTER_ASSET_CONTRACT_VERSION,
    PORTRAIT_CANVAS_HEIGHT, PORTRAIT_CANVAS_WIDTH,
};
use sea_orm::DatabaseConnection;
use serde::Deserialize;
use serde_json::{json, Value};
use crate::{
    middleware::auth::Claims,
    services::{
        agent::life, digital_life_rig, image_generation, see_through,
        site_owner::site_owner_user_id,
    },
    state::AppState,
};

type ApiError = (StatusCode, Json<Value>);
type ApiResult<T> = Result<T, ApiError>;

const MAX_RIG_IMPORT_SOURCE_BYTES: usize = 2 * 1024 * 1024;
const MAX_RIG_IMPORT_ATLAS_BYTES: usize = 20 * 1024 * 1024;

pub fn create_routes(app_state: AppState) -> Router<AppState> {
    let owner = Router::new()
        .route("/", get(get_site_rig))
        .route("/motion-profile", patch(update_motion_profile))
        .route("/clips", patch(update_clips))
        .route("/migrate", post(migrate_site_rig))
        .route("/portrait", post(generate_portrait))
        .route("/see-through/status", get(get_see_through_status))
        .route("/see-through/token", patch(update_see_through_token))
        .route("/see-through/decompose", post(decompose_with_see_through))
        .route(
            "/import",
            post(import_site_rig).layer(DefaultBodyLimit::max(24 * 1024 * 1024)),
        )
        .route(
            "/import/preview",
            post(preview_site_rig).layer(DefaultBodyLimit::max(24 * 1024 * 1024)),
        )
        .route_layer(from_fn_with_state(
            app_state.clone(),
            crate::middleware::auth::auth_middleware,
        ));

    Router::new()
        .route("/active", get(get_active_rig))
        .route("/assets/{asset_id}", get(get_atlas))
        .merge(owner)
}

fn bad_request(message: &str) -> ApiError {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": message })))
}

fn not_found(message: &str) -> ApiError {
    (StatusCode::NOT_FOUND, Json(json!({ "error": message })))
}

fn internal_error(error: impl std::fmt::Display) -> ApiError {
    tracing::error!(%error, "digital life rig failed");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({ "error": "Internal server error" })),
    )
}

fn see_through_error(error: see_through::SeeThroughError) -> ApiError {
    use see_through::SeeThroughError;

    let (status, code, message) = match &error {
        SeeThroughError::NotConfigured => (
            StatusCode::PRECONDITION_REQUIRED,
            "see_through_token_required",
            "Configure a Hugging Face API token before using See-through",
        ),
        SeeThroughError::Busy => (
            StatusCode::CONFLICT,
            "see_through_busy",
            "A See-through decomposition is already running",
        ),
        SeeThroughError::InvalidInput(message) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": message, "code": "see_through_invalid_input" })),
            );
        }
        SeeThroughError::Authentication => (
            StatusCode::BAD_GATEWAY,
            "see_through_auth_failed",
            "Hugging Face rejected the configured API token",
        ),
        SeeThroughError::Quota | SeeThroughError::Rejected => (
            StatusCode::SERVICE_UNAVAILABLE,
            "see_through_quota_unavailable",
            "See-through ZeroGPU is unavailable; check the Hugging Face token and quota",
        ),
        SeeThroughError::Timeout => (
            StatusCode::GATEWAY_TIMEOUT,
            "see_through_timeout",
            "See-through inference timed out",
        ),
        SeeThroughError::Transport(_)
        | SeeThroughError::Upstream { .. }
        | SeeThroughError::InvalidOutput(_) => (
            StatusCode::BAD_GATEWAY,
            "see_through_upstream_failed",
            "See-through returned an invalid or unavailable result",
        ),
    };
    tracing::warn!(%error, code, "remote See-through request failed");
    (status, Json(json!({ "error": message, "code": code })))
}

async fn require_life_enabled() -> ApiResult<()> {
    let enabled = crate::GLOBAL_DYNAMIC_CONFIG
        .read()
        .await
        .agent_life_enabled_resolved();
    if enabled {
        Ok(())
    } else {
        Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Agent life is disabled",
                "code": "agent_life_disabled"
            })),
        ))
    }
}

async fn require_owner(claims: &Claims, db: &DatabaseConnection) -> ApiResult<i32> {
    let owner = site_owner_user_id(db).await.map_err(internal_error)?;
    let user_id = claims.sub.parse::<i32>().map_err(|_| {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "Invalid user" })),
        )
    })?;
    if user_id != owner {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({
                "error": "Only the site owner can change Arael's face",
                "code": "site_owner_required"
            })),
        ));
    }
    Ok(user_id)
}

fn active_asset_id(config: &crate::config::DynamicConfig) -> Option<String> {
    config
        .agent_rig_asset_id
        .as_deref()
        .and_then(digital_life_rig::normalize_asset_id)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct MasterProvenance {
    asset_id: String,
    generation_fingerprint: Option<String>,
}

fn valid_generation_fingerprint(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|character| character.is_ascii_hexdigit())
}

fn portrait_generation_fingerprint(value: Option<&Value>) -> ApiResult<Option<String>> {
    let Some(document) = value else {
        return Ok(None);
    };
    let fingerprint = document
        .get("fingerprint")
        .and_then(Value::as_str)
        .filter(|value| valid_generation_fingerprint(value))
        .ok_or_else(|| internal_error("stored portrait generation contract is invalid"))?;
    Ok(Some(fingerprint.to_ascii_lowercase()))
}

async fn current_master(db: &DatabaseConnection) -> ApiResult<Option<MasterProvenance>> {
    let persona = life::get_persona(db).await.map_err(internal_error)?;
    let Some(persona) = persona else {
        return Ok(None);
    };
    let Some(asset_id) = persona.portrait_asset_id else {
        return Ok(None);
    };
    Ok(Some(MasterProvenance {
        asset_id,
        generation_fingerprint: portrait_generation_fingerprint(
            persona.portrait_generation.as_ref(),
        )?,
    }))
}

async fn require_master_match(
    db: &DatabaseConnection,
    source_master_asset_id: &str,
    source_generation_fingerprint: Option<&str>,
) -> ApiResult<MasterProvenance> {
    let stored = current_master(db)
        .await?
        .ok_or_else(|| not_found("Site portrait is missing"))?;
    let supplied_fingerprint = source_generation_fingerprint.map(str::to_ascii_lowercase);
    if stored.asset_id != source_master_asset_id
        || stored.generation_fingerprint != supplied_fingerprint
    {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": "Character master asset or generation contract changed before rig import",
                "code": "character_asset_provenance_changed"
            })),
        ));
    }
    Ok(stored)
}

fn manifest_matches_master(manifest: &RigManifest, master: &MasterProvenance) -> bool {
    manifest.validate().is_ok()
        && manifest.character_asset_contract_version == Some(CHARACTER_ASSET_CONTRACT_VERSION)
        && manifest.source_master_asset_id.as_deref() == Some(master.asset_id.as_str())
        && manifest.source_generation_fingerprint == master.generation_fingerprint
        && (manifest.canvas.width - PORTRAIT_CANVAS_WIDTH).abs() <= 0.0001
        && (manifest.canvas.height - PORTRAIT_CANVAS_HEIGHT).abs() <= 0.0001
}

fn rewrite_texture_urls(mut manifest: RigManifest, asset_id: &str) -> RigManifest {
    let url = digital_life_rig::public_atlas_url(asset_id);
    for texture in &mut manifest.textures {
        texture.url = url.clone();
    }
    manifest
}

fn rig_motion_seed(source_master_asset_id: &str) -> u32 {
    let mut hash: u32 = 2166136261;
    for byte in source_master_asset_id.as_bytes() {
        hash ^= u32::from(*byte);
        hash = hash.wrapping_mul(16777619);
    }
    hash
}

async fn load_stored_manifest(asset_id: &str) -> ApiResult<RigManifest> {
    let bytes = digital_life_rig::read_manifest_bytes(asset_id)
        .await
        .map_err(|_| not_found("Active rig is missing"))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| bad_request(&format!("Stored rig is invalid: {error}")))
}

async fn package_identity_matches(asset_id: &str, manifest: &RigManifest) -> ApiResult<bool> {
    static VERIFIED_PACKAGES: OnceLock<tokio::sync::RwLock<HashSet<String>>> = OnceLock::new();
    let verified = VERIFIED_PACKAGES.get_or_init(Default::default);
    if verified.read().await.contains(asset_id) {
        return Ok(true);
    }
    let atlas_bytes = digital_life_rig::read_atlas_bytes(asset_id)
        .await
        .map_err(|_| not_found("Active rig atlas is missing"))?;
    let expected = digital_life_rig::package_id_for_manifest(&atlas_bytes, manifest)
        .map_err(internal_error)?;
    let matches = expected == asset_id;
    if matches {
        verified.write().await.insert(asset_id.to_string());
    }
    Ok(matches)
}

async fn persist_manifest_revision(
    db: &DatabaseConnection,
    current_asset_id: &str,
    manifest: RigManifest,
) -> ApiResult<(String, RigManifest)> {
    let atlas_bytes = digital_life_rig::read_atlas_bytes(current_asset_id)
        .await
        .map_err(internal_error)?;
    let asset_id = digital_life_rig::package_id_for_manifest(&atlas_bytes, &manifest)
        .map_err(internal_error)?;
    let manifest = rewrite_texture_urls(manifest, &asset_id);
    let json = serde_json::to_string_pretty(&manifest).map_err(internal_error)?;
    digital_life_rig::persist_package(&asset_id, &atlas_bytes, &json)
        .await
        .map_err(internal_error)?;
    require_master_match(
        db,
        manifest
            .source_master_asset_id
            .as_deref()
            .ok_or_else(|| bad_request("Rig source master is missing"))?,
        manifest.source_generation_fingerprint.as_deref(),
    )
    .await?;
    activate_asset(db, &asset_id).await?;
    Ok((asset_id, manifest))
}

async fn activate_asset(db: &DatabaseConnection, asset_id: &str) -> ApiResult<()> {
    digital_life_rig::set_active_asset(db, Some(asset_id))
        .await
        .map_err(internal_error)
}

pub(crate) async fn clear_active_asset(db: &DatabaseConnection) -> ApiResult<()> {
    digital_life_rig::set_active_asset(db, None)
        .await
        .map_err(internal_error)
}

async fn compile_imported_rig(
    source: ImportRigSourceRequest,
    texture_url: String,
) -> ApiResult<(String, RigManifest)> {
    validate_character_asset_source(&source.bones, &source.layers)
        .map_err(|error| bad_request(&format!("Rig character asset preflight failed: {error}")))?;
    let source_master_asset_id = source.source_master_asset_id.clone();
    let clips = if source.clips.is_empty() {
        build_standard_face_rig_clips_for_semantics(&source.bones, source.semantics.as_ref())
            .map_err(|error| bad_request(&format!("Rig import needs motion clips: {error}")))?
    } else {
        source.clips
    };
    let manifest = tokio::task::spawn_blocking(move || {
        compile_layered_rig(RigCompileSource {
            rig_ir_version: source.rig_ir_version,
            character_asset_contract_version: Some(source.character_asset_contract_version),
            source_master_asset_id: Some(source.source_master_asset_id),
            source_generation_fingerprint: source.source_generation_fingerprint,
            canvas: source.canvas,
            textures: vec![RigTexture {
                id: source.atlas.id,
                url: texture_url,
                width: source.atlas.width,
                height: source.atlas.height,
            }],
            bones: source.bones,
            layers: source.layers,
            clips,
            default_clip: source.default_clip,
            motion_profile: source.motion_profile,
            outfit_profile: source.outfit_profile,
            semantic_anchors: source.semantic_anchors,
            semantics: source.semantics,
            spatial_profile: source.spatial_profile,
        })
    })
    .await
    .map_err(internal_error)?
    .map_err(|error| bad_request(&format!("Rig compilation failed: {error}")))?;
    let (manifest, _) = migrate_rig_manifest(manifest, rig_motion_seed(&source_master_asset_id))
        .map_err(|error| bad_request(&format!("Rig action library migration failed: {error}")))?;
    Ok((source_master_asset_id, manifest))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportRigAtlasRequest {
    id: String,
    width: u32,
    height: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportRigSourceRequest {
    #[serde(default)]
    rig_ir_version: Option<u16>,
    character_asset_contract_version: u16,
    source_master_asset_id: String,
    #[serde(default)]
    source_generation_fingerprint: Option<String>,
    canvas: RigSize,
    atlas: ImportRigAtlasRequest,
    bones: Vec<RigBone>,
    layers: Vec<RigLayerSource>,
    clips: Vec<RigClip>,
    default_clip: String,
    #[serde(default)]
    motion_profile: Option<RigMotionProfile>,
    #[serde(default)]
    outfit_profile: Option<RigOutfitProfile>,
    #[serde(default)]
    semantic_anchors: HashMap<String, RigSemanticAnchor>,
    #[serde(default)]
    semantics: Option<RigSemantics>,
    #[serde(default)]
    spatial_profile: Option<RigSpatialProfile>,
}

struct ParsedRigImport {
    source: ImportRigSourceRequest,
    atlas_bytes: Vec<u8>,
}

async fn parse_rig_import(mut multipart: Multipart) -> ApiResult<ParsedRigImport> {
    let mut source_bytes = None;
    let mut atlas_bytes = None;
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| bad_request(&format!("Invalid rig import body: {error}")))?
    {
        match field.name() {
            Some("source") if source_bytes.is_none() => {
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|error| bad_request(&format!("Invalid rig source: {error}")))?;
                if bytes.len() > MAX_RIG_IMPORT_SOURCE_BYTES {
                    return Err(bad_request("Rig source exceeds 2 MB"));
                }
                source_bytes = Some(bytes);
            }
            Some("atlas") if atlas_bytes.is_none() => {
                if field.content_type() != Some("image/png") {
                    return Err(bad_request("Rig atlas must be a PNG image"));
                }
                let bytes = field
                    .bytes()
                    .await
                    .map_err(|error| bad_request(&format!("Invalid rig atlas: {error}")))?;
                if bytes.len() > MAX_RIG_IMPORT_ATLAS_BYTES {
                    return Err(bad_request("Rig atlas exceeds 20 MB"));
                }
                atlas_bytes = Some(bytes.to_vec());
            }
            Some("source" | "atlas") => {
                return Err(bad_request("Rig import fields must not be duplicated"));
            }
            _ => return Err(bad_request("Rig import contains an unsupported field")),
        }
    }
    let mut source: ImportRigSourceRequest = serde_json::from_slice(
        source_bytes
            .as_deref()
            .ok_or_else(|| bad_request("Rig import is missing source metadata"))?,
    )
    .map_err(|error| bad_request(&format!("Invalid rig source metadata: {error}")))?;
    if let Some(fingerprint) = &mut source.source_generation_fingerprint {
        if !valid_generation_fingerprint(fingerprint) {
            return Err(bad_request(
                "Rig source generation fingerprint must be a SHA-256 hex digest",
            ));
        }
        fingerprint.make_ascii_lowercase();
    }
    let atlas_bytes = atlas_bytes.ok_or_else(|| bad_request("Rig import is missing atlas PNG"))?;
    let dimensions =
        digital_life_rig::png_dimensions(&atlas_bytes).map_err(|error| bad_request(&error))?;
    if dimensions != (source.atlas.width, source.atlas.height) {
        return Err(bad_request(
            "Rig atlas dimensions do not match source metadata",
        ));
    }
    if source.atlas.id.trim().is_empty()
        || source
            .layers
            .iter()
            .any(|layer| layer.texture_id != source.atlas.id)
    {
        return Err(bad_request("Rig atlas contract is invalid"));
    }
    Ok(ParsedRigImport {
        source,
        atlas_bytes,
    })
}

pub async fn get_active_rig(crate::extract::Db(db): crate::extract::Db) -> ApiResult<Json<Value>> {
    let master = current_master(&db).await?;
    let asset_id = active_asset_id(&*crate::GLOBAL_DYNAMIC_CONFIG.read().await);
    if let (Some(asset_id), Some(master)) = (asset_id, master.as_ref()) {
        match load_stored_manifest(&asset_id).await {
            Ok(manifest) if manifest_matches_master(&manifest, master) => {
                if matches!(package_identity_matches(&asset_id, &manifest).await, Ok(true)) {
                    let manifest = rewrite_texture_urls(manifest, &asset_id);
                    return Ok(Json(json!({
                        "manifest": manifest,
                        "portraitUrl": master.asset_id,
                        "generationFingerprint": master.generation_fingerprint,
                        "assetId": asset_id,
                    })));
                }
                tracing::warn!(
                    %asset_id,
                    "active digital-life rig package identity is stale; serving portrait fallback"
                );
            }
            Ok(_) => tracing::warn!(
                %asset_id,
                "active digital-life rig provenance is stale; serving portrait fallback"
            ),
            Err(_) => tracing::warn!(
                %asset_id,
                "active digital-life rig package is unavailable; serving portrait fallback"
            ),
        }
    }
    if let Some(master) = master {
        return Ok(Json(json!({
            "manifest": build_portrait_fallback_rig_with_generation(
                &master.asset_id,
                master.generation_fingerprint.clone(),
            ),
            "portraitUrl": master.asset_id,
            "generationFingerprint": master.generation_fingerprint,
            "assetId": Value::Null,
        })));
    }
    Err(not_found("No site face is configured"))
}

pub async fn get_atlas(Path(asset_id): Path<String>) -> ApiResult<Response> {
    let asset_id = digital_life_rig::normalize_asset_id(&asset_id)
        .ok_or_else(|| bad_request("Invalid rig asset id"))?;
    let bytes = digital_life_rig::read_atlas_bytes(&asset_id)
        .await
        .map_err(|_| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "Rig atlas not found" })),
            )
        })?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, HeaderValue::from_static("image/png"))
        .header(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        )
        .body(Body::from(bytes))
        .map_err(internal_error)
}

pub async fn get_site_rig(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
) -> ApiResult<Json<Value>> {
    require_life_enabled().await?;
    require_owner(&claims, &db).await?;
    get_active_rig(crate::extract::Db(db)).await
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateSeeThroughTokenRequest {
    token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SeeThroughDecomposeRequest {
    source_master_asset_id: String,
    #[serde(default)]
    source_generation_fingerprint: Option<String>,
    #[serde(default)]
    resolution: Option<u16>,
    #[serde(default)]
    seed: Option<u16>,
    #[serde(default)]
    split_arms_and_legs: Option<bool>,
}

pub async fn get_see_through_status(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
) -> ApiResult<Json<Value>> {
    require_life_enabled().await?;
    require_owner(&claims, &db).await?;
    let token_configured = {
        let config = crate::GLOBAL_DYNAMIC_CONFIG.read().await;
        see_through::configured_hf_token(&config).is_some()
    };
    Ok(Json(json!({
        "provider": see_through::SPACE_NAME,
        "tokenConfigured": token_configured,
        "defaultResolution": see_through::DecomposeOptions::default().resolution,
        "splitArmsAndLegs": true,
    })))
}

pub async fn update_see_through_token(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<UpdateSeeThroughTokenRequest>,
) -> ApiResult<Json<Value>> {
    require_life_enabled().await?;
    require_owner(&claims, &db).await?;
    let token = see_through::validate_hf_token(&payload.token).map_err(see_through_error)?;
    crate::services::config_service::ConfigService::new(db)
        .update_config("see_through_hf_token", json!(token.clone()))
        .await
        .map_err(internal_error)?;
    crate::GLOBAL_DYNAMIC_CONFIG
        .write()
        .await
        .see_through_hf_token = Some(token);
    Ok(Json(json!({
        "provider": see_through::SPACE_NAME,
        "tokenConfigured": true,
    })))
}

pub async fn decompose_with_see_through(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<SeeThroughDecomposeRequest>,
) -> ApiResult<Response> {
    require_life_enabled().await?;
    require_owner(&claims, &db).await?;
    let source_generation_fingerprint = payload
        .source_generation_fingerprint
        .as_deref()
        .map(str::to_ascii_lowercase);
    if source_generation_fingerprint
        .as_deref()
        .is_some_and(|value| !valid_generation_fingerprint(value))
    {
        return Err(bad_request(
            "Source generation fingerprint must be a SHA-256 hex digest",
        ));
    }
    let master = require_master_match(
        &db,
        &payload.source_master_asset_id,
        source_generation_fingerprint.as_deref(),
    )
    .await?;
    let token = {
        let config = crate::GLOBAL_DYNAMIC_CONFIG.read().await;
        see_through::configured_hf_token(&config)
    }
    .ok_or_else(|| see_through_error(see_through::SeeThroughError::NotConfigured))?;
    let (image, media_type) = crate::services::image_cache::ImageCacheService::new()
        .read_local_public_url(&master.asset_id)
        .await
        .map_err(|_| {
            bad_request("The current master portrait is not available in the site image cache")
        })?;
    let defaults = see_through::DecomposeOptions::default();
    let options = see_through::DecomposeOptions {
        resolution: payload.resolution.unwrap_or(defaults.resolution),
        seed: payload.seed.unwrap_or(defaults.seed),
        split_arms_and_legs: payload
            .split_arms_and_legs
            .unwrap_or(defaults.split_arms_and_legs),
    }
    .validate()
    .map_err(see_through_error)?;
    let client = see_through::SeeThroughClient::new(token)
        .await
        .map_err(see_through_error)?;
    let output = client
        .decompose(image, &media_type, options)
        .await
        .map_err(see_through_error)?;

    // Inference can take minutes. Never hand a result back as current if the
    // master changed while the remote job was running.
    require_master_match(
        &db,
        &payload.source_master_asset_id,
        source_generation_fingerprint.as_deref(),
    )
    .await?;

    let event_header = HeaderValue::from_str(&output.event_id).map_err(internal_error)?;
    let filename = format!(
        "see-through-{}.psd",
        output.event_id.chars().take(12).collect::<String>()
    );
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_static("image/vnd.adobe.photoshop"),
        )
        .header(
            header::CONTENT_DISPOSITION,
            HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
                .map_err(internal_error)?,
        )
        .header(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store, private"),
        )
        .header("x-see-through-event-id", event_header)
        .body(Body::from(output.psd))
        .map_err(internal_error)
}

pub async fn preview_site_rig(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    require_life_enabled().await?;
    require_owner(&claims, &db).await?;
    let ParsedRigImport { source, .. } = parse_rig_import(multipart).await?;
    require_master_match(
        &db,
        &source.source_master_asset_id,
        source.source_generation_fingerprint.as_deref(),
    )
    .await?;
    let (_, manifest) = compile_imported_rig(source, "preview://rig-atlas".to_owned()).await?;
    Ok(Json(json!({ "manifest": manifest, "persisted": false })))
}

pub async fn import_site_rig(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    multipart: Multipart,
) -> ApiResult<Json<Value>> {
    require_life_enabled().await?;
    require_owner(&claims, &db).await?;
    let ParsedRigImport {
        source,
        atlas_bytes,
    } = parse_rig_import(multipart).await?;
    let source_master_asset_id = source.source_master_asset_id.clone();
    let source_generation_fingerprint = source.source_generation_fingerprint.clone();
    require_master_match(
        &db,
        &source_master_asset_id,
        source_generation_fingerprint.as_deref(),
    )
    .await?;
    let (_, manifest) = compile_imported_rig(source, "asset://atlas".to_owned()).await?;
    let asset_id = digital_life_rig::package_id_for_manifest(&atlas_bytes, &manifest)
        .map_err(internal_error)?;
    let manifest = rewrite_texture_urls(manifest, &asset_id);
    let json = serde_json::to_string_pretty(&manifest).map_err(internal_error)?;
    digital_life_rig::persist_package(&asset_id, &atlas_bytes, &json)
        .await
        .map_err(internal_error)?;
    // Portrait/persona writes can race a long compile. Never activate a rig
    // whose provenance stopped being current while the package was built.
    require_master_match(
        &db,
        &source_master_asset_id,
        source_generation_fingerprint.as_deref(),
    )
    .await?;
    activate_asset(&db, &asset_id).await?;
    Ok(Json(json!({ "manifest": manifest, "assetId": asset_id })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateMotionProfileRequest {
    motion_profile: RigMotionProfile,
}

pub async fn update_motion_profile(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(request): Json<UpdateMotionProfileRequest>,
) -> ApiResult<Json<Value>> {
    require_life_enabled().await?;
    require_owner(&claims, &db).await?;
    let asset_id = active_asset_id(&*crate::GLOBAL_DYNAMIC_CONFIG.read().await)
        .ok_or_else(|| not_found("Active rig is missing"))?;
    let mut manifest = load_stored_manifest(&asset_id).await?;
    let master = current_master(&db)
        .await?
        .ok_or_else(|| not_found("Site portrait is missing"))?;
    if !manifest_matches_master(&manifest, &master) {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": "Active rig provenance is stale",
                "code": "character_asset_provenance_changed"
            })),
        ));
    }
    if !package_identity_matches(&asset_id, &manifest).await? {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": "Active rig package predates immutable package identity; migrate or re-import it",
                "code": "rig_package_migration_required"
            })),
        ));
    }
    manifest.motion_profile = Some(request.motion_profile);
    manifest
        .validate()
        .map_err(|error| bad_request(&format!("Invalid motion profile: {error}")))?;
    let (asset_id, manifest) = persist_manifest_revision(&db, &asset_id, manifest).await?;
    Ok(Json(json!({
        "manifest": manifest,
        "assetId": asset_id,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateClipsRequest {
    clips: Vec<RigClip>,
}

pub async fn update_clips(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(request): Json<UpdateClipsRequest>,
) -> ApiResult<Json<Value>> {
    require_life_enabled().await?;
    require_owner(&claims, &db).await?;
    let asset_id = active_asset_id(&*crate::GLOBAL_DYNAMIC_CONFIG.read().await)
        .ok_or_else(|| not_found("Active rig is missing"))?;
    let mut manifest = load_stored_manifest(&asset_id).await?;
    let master = current_master(&db)
        .await?
        .ok_or_else(|| not_found("Site portrait is missing"))?;
    if !manifest_matches_master(&manifest, &master) {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": "Active rig provenance is stale",
                "code": "character_asset_provenance_changed"
            })),
        ));
    }
    if !package_identity_matches(&asset_id, &manifest).await? {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": "Active rig package predates immutable package identity; migrate or re-import it",
                "code": "rig_package_migration_required"
            })),
        ));
    }
    manifest.clips = request.clips;
    manifest
        .validate()
        .map_err(|error| bad_request(&format!("Invalid rig clips: {error}")))?;
    let (asset_id, manifest) = persist_manifest_revision(&db, &asset_id, manifest).await?;
    Ok(Json(json!({
        "manifest": manifest,
        "assetId": asset_id,
    })))
}

pub async fn migrate_site_rig(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
) -> ApiResult<Json<Value>> {
    require_life_enabled().await?;
    require_owner(&claims, &db).await?;
    let asset_id = active_asset_id(&*crate::GLOBAL_DYNAMIC_CONFIG.read().await)
        .ok_or_else(|| not_found("Active rig is missing"))?;
    let master = current_master(&db)
        .await?
        .ok_or_else(|| not_found("Site portrait is missing"))?;
    let stored = load_stored_manifest(&asset_id).await?;
    if !manifest_matches_master(&stored, &master) {
        return Err((
            StatusCode::CONFLICT,
            Json(json!({
                "error": "Active rig provenance is stale",
                "code": "character_asset_provenance_changed"
            })),
        ));
    }
    let package_migrated = !package_identity_matches(&asset_id, &stored).await?;
    let (manifest, migrated) = migrate_rig_manifest(stored, rig_motion_seed(&master.asset_id))
        .map_err(|error| bad_request(&format!("Stored rig cannot be migrated: {error}")))?;
    let migrated = migrated || package_migrated;
    let (asset_id, manifest) = if migrated {
        persist_manifest_revision(&db, &asset_id, manifest).await?
    } else {
        (asset_id.clone(), rewrite_texture_urls(manifest, &asset_id))
    };
    Ok(Json(json!({
        "manifest": manifest,
        "assetId": asset_id,
        "migrated": migrated
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeneratePortraitRequest {
    #[serde(default)]
    prompt: Option<String>,
}

pub async fn generate_portrait(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(request): Json<GeneratePortraitRequest>,
) -> ApiResult<Json<Value>> {
    require_life_enabled().await?;
    let user_id = require_owner(&claims, &db).await?;
    let persona = life::get_persona(&db).await.map_err(internal_error)?;
    let name = persona
        .as_ref()
        .map(|row| row.name.trim())
        .filter(|name| !name.is_empty())
        .unwrap_or("Arael");
    let additional_requirements = request
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    let visual_profile = persona
        .as_ref()
        .and_then(|row| row.visual_profile.clone())
        .unwrap_or_else(|| json!({
            "gender": "unspecified",
            "language": "zh-CN"
        }));
    let structured_persona = persona_for_visual_generation(persona.as_ref(), name);
    let slot = CharacterVisualSlot::Master;
    let generation_contract = build_character_asset_contract(
        name,
        &structured_persona,
        &visual_profile,
        slot,
        additional_requirements.as_deref(),
    );
    let contract_fingerprint = character_asset_contract_fingerprint(&generation_contract);
    let prompt = build_character_visual_prompt(
        name,
        &structured_persona,
        &visual_profile,
        slot,
        additional_requirements.as_deref(),
    );
    let (width, height) = slot.dimensions();
    let dynamic = crate::GLOBAL_DYNAMIC_CONFIG.read().await.clone();
    let config = image_generation::config_from_dynamic(&dynamic).map_err(|error| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": error.to_string() })),
        )
    })?;
    let generated = image_generation::generate_image(&config, &prompt, width, height, None)
        .await
        .map_err(|error| {
            (
                StatusCode::BAD_GATEWAY,
                Json(json!({ "error": error.to_string() })),
            )
        })?;
    let url = image_generation::persist_generated(&generated)
        .await
        .map_err(|error| bad_request(&error.to_string()))?;
    let name = persona
        .as_ref()
        .map(|row| row.name.clone())
        .unwrap_or_default();
    let personality = persona
        .as_ref()
        .map(|row| row.personality.clone())
        .unwrap_or_default();
    let saved = life::upsert_persona(
        &db,
        name,
        personality,
        life::PortraitUpdate::Set(url.clone()),
        life::PersonaContractUpdate {
            portrait_generation: life::JsonDocumentUpdate::Set(json!({
                "fingerprint": contract_fingerprint,
                "contract": generation_contract,
            })),
            ..life::PersonaContractUpdate::default()
        },
        user_id,
    )
    .await
    .map_err(internal_error)?;
    // New master pixels invalidate the compiled atlas — settings must re-import.
    clear_active_asset(&db).await?;
    Ok(Json(json!({
        "portraitUrl": saved.portrait_asset_id,
        "portraitAssetId": saved.portrait_asset_id,
        "characterAssetContractVersion": CHARACTER_ASSET_CONTRACT_VERSION,
        "generationFingerprint": contract_fingerprint,
    })))
}

fn persona_for_visual_generation(
    persona: Option<&crate::models::entities::agent_persona::Model>,
    name: &str,
) -> Value {
    if let Some(structured) = persona.and_then(|row| row.persona_json.clone()) {
        return structured;
    }
    let mut fallback = fallback_persona_draft(name, "zh-CN", &[], None);
    if let Some(personality) = persona
        .map(|row| row.personality.trim())
        .filter(|value| !value.is_empty())
    {
        fallback["summary"] = json!(personality);
    }
    fallback
}

#[cfg(test)]
mod portrait_contract_tests {
    use super::*;

    #[test]
    fn legacy_personality_is_not_dropped_from_portrait_contract() {
        let row = crate::models::entities::agent_persona::Model {
            id: "site".into(),
            name: "瞳".into(),
            personality: "安静、认真，也喜欢新事物".into(),
            persona_json: None,
            visual_profile: None,
            portrait_asset_id: None,
            portrait_generation: None,
            updated_by: None,
            updated_at: chrono::Utc::now().into(),
        };
        let persona = persona_for_visual_generation(Some(&row), "瞳");
        assert_eq!(persona["summary"], "安静、认真，也喜欢新事物");
    }

    #[test]
    fn active_manifest_must_match_master_contract_and_generation() {
        let fingerprint = "a".repeat(64);
        let master = MasterProvenance {
            asset_id: "/master.png".to_string(),
            generation_fingerprint: Some(fingerprint.clone()),
        };
        let mut manifest = build_portrait_fallback_rig_with_generation(
            "/master.png",
            Some(fingerprint),
        );
        assert!(manifest_matches_master(&manifest, &master));

        manifest.source_generation_fingerprint = Some("b".repeat(64));
        assert!(!manifest_matches_master(&manifest, &master));
        manifest.source_generation_fingerprint = master.generation_fingerprint.clone();
        manifest.canvas.height = 1.0;
        assert!(!manifest_matches_master(&manifest, &master));
    }
}
