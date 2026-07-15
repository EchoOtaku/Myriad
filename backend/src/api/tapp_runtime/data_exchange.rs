//! One-shot, consent-gated data exchange between installed Tapps.
//!
//! Private Tapp storage is never exposed here. A requester and provider must
//! both declare the named contract in their manifests, and the host must
//! authorize every prepared request before a provider response can be consumed.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::time::Duration;
use uuid::Uuid;

use crate::api::tapp_store::{TappDataExchangeManifest, TappDataExport};

use super::{
    common::resolve_accessible_tapp,
    shared_registry::{self, RegistryIdentity},
    RuntimeGrantContext,
};

const PREPARED_REQUEST_TTL: Duration = Duration::from_secs(2 * 60);
const DATA_ACCESS_GRANT_TTL: Duration = Duration::from_secs(60);
const MAX_PURPOSE_LENGTH: usize = 500;
const MAX_PARAMS_BYTES: usize = 64 * 1024;
const MAX_PENDING_REQUESTS_PER_SUBJECT: usize = 32;
const MAX_ACTIVE_GRANTS_PER_SUBJECT: usize = 32;

const PREPARED_NAMESPACE: &str = "data_exchange_request";
const DATA_GRANT_NAMESPACE: &str = "data_exchange_grant";

#[derive(Debug, Clone, Deserialize, Serialize)]
struct PreparedRequest {
    request_id: String,
    requester_runtime_id: String,
    requester_tapp_id: String,
    provider_tapp_id: String,
    provider_owner_id: i32,
    subject_id: i32,
    export: TappDataExport,
    params: Value,
    purpose: String,
    request_hash: String,
    expires_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct StoredDataAccessGrant {
    grant_id: String,
    requester_runtime_id: String,
    requester_tapp_id: String,
    provider_tapp_id: String,
    provider_owner_id: i32,
    subject_id: i32,
    export: TappDataExport,
    params: Value,
    purpose: String,
    request_hash: String,
    expires_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareDataExchangeRequest {
    target_tapp_id: String,
    export_id: String,
    #[serde(default)]
    params: Value,
    purpose: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedDataExchangeResponse {
    request_id: String,
    requester_tapp_id: String,
    requester_name: String,
    provider_tapp_id: String,
    provider_owner_id: i32,
    provider_name: String,
    export_id: String,
    export_description: Option<String>,
    purpose: String,
    max_bytes: usize,
    max_records: Option<usize>,
    expires_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataAccessGrantResponse {
    version: u8,
    grant_id: String,
    token: String,
    request_id: String,
    provider_tapp_id: String,
    provider_owner_id: i32,
    export_id: String,
    params: Value,
    purpose: String,
    request_hash: String,
    max_bytes: usize,
    max_records: Option<usize>,
    expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsumeDataExchangeRequest {
    grant_token: String,
    response: Value,
}

type ApiError = (StatusCode, Json<Value>);

fn api_error(status: StatusCode, code: &str, message: impl Into<String>) -> ApiError {
    (
        status,
        Json(json!({
            "error": message.into(),
            "code": code
        })),
    )
}

fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn same_provider_scope(
    grant_subject_id: i32,
    grant_owner_id: i32,
    grant_tapp_id: &str,
    runtime_subject_id: i32,
    runtime_owner_id: i32,
    runtime_tapp_id: &str,
) -> bool {
    grant_subject_id == runtime_subject_id
        && grant_owner_id == runtime_owner_id
        && grant_tapp_id == runtime_tapp_id
}

fn new_token() -> String {
    format!("dxg_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

async fn take_data_access_grant(
    db: &DatabaseConnection,
    token: &str,
) -> Result<StoredDataAccessGrant, ApiError> {
    shared_registry::take(db, DATA_GRANT_NAMESPACE, &token_hash(token))
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "DATA_EXCHANGE_REGISTRY_UNAVAILABLE",
                "Data Exchange registry is unavailable",
            )
        })?
        .ok_or_else(|| {
            api_error(
                StatusCode::UNAUTHORIZED,
                "INVALID_DATA_ACCESS_GRANT",
                "Data Access Grant is missing, expired, consumed, or revoked",
            )
        })
}

fn parse_exchange_manifest(manifest: &Value) -> Result<TappDataExchangeManifest, ApiError> {
    let value = manifest.get("dataExchange").ok_or_else(|| {
        api_error(
            StatusCode::FORBIDDEN,
            "DATA_EXCHANGE_NOT_DECLARED",
            "Tapp manifest does not declare dataExchange",
        )
    })?;
    serde_json::from_value(value.clone()).map_err(|_| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "INVALID_DATA_EXCHANGE_MANIFEST",
            "Stored dataExchange manifest is invalid",
        )
    })
}

fn request_hash(
    requester_tapp_id: &str,
    provider_tapp_id: &str,
    export_id: &str,
    params: &Value,
    purpose: &str,
) -> Result<String, ApiError> {
    let encoded = serde_json::to_vec(&json!({
        "requesterTappId": requester_tapp_id,
        "providerTappId": provider_tapp_id,
        "exportId": export_id,
        "params": params,
        "purpose": purpose,
    }))
    .map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "INVALID_DATA_EXCHANGE_REQUEST",
            "Data Exchange request cannot be serialized",
        )
    })?;
    Ok(format!("sha256:{:x}", Sha256::digest(encoded)))
}

fn rfc3339(timestamp: i64) -> String {
    chrono::DateTime::from_timestamp(timestamp, 0)
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

fn schema_type_matches(expected: &str, value: &Value) -> bool {
    match expected {
        "null" => value.is_null(),
        "boolean" => value.is_boolean(),
        "object" => value.is_object(),
        "array" => value.is_array(),
        "number" => value.is_number(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "string" => value.is_string(),
        _ => false,
    }
}

fn validate_number_bounds(
    schema: &Map<String, Value>,
    value: &Value,
    path: &str,
) -> Result<(), String> {
    let Some(number) = value.as_f64() else {
        return Ok(());
    };
    if let Some(minimum) = schema.get("minimum").and_then(Value::as_f64) {
        if number < minimum {
            return Err(format!("{path} is below minimum {minimum}"));
        }
    }
    if let Some(maximum) = schema.get("maximum").and_then(Value::as_f64) {
        if number > maximum {
            return Err(format!("{path} is above maximum {maximum}"));
        }
    }
    Ok(())
}

/// Validate the deliberately small, deterministic JSON Schema subset accepted
/// by Tapp manifests. Unsupported keywords are ignored; `$ref` is rejected at
/// install time so validation never performs file or network I/O.
fn validate_schema(schema: &Value, value: &Value, path: &str, depth: usize) -> Result<(), String> {
    if depth > 32 {
        return Err(format!("{path} exceeds schema nesting limit"));
    }
    let object = schema
        .as_object()
        .ok_or_else(|| format!("{path} has an invalid schema"))?;

    if let Some(constant) = object.get("const") {
        if value != constant {
            return Err(format!("{path} does not match const"));
        }
    }
    if let Some(allowed) = object.get("enum").and_then(Value::as_array) {
        if !allowed.iter().any(|candidate| candidate == value) {
            return Err(format!("{path} is not an allowed enum value"));
        }
    }
    if let Some(expected) = object.get("type") {
        let matches = match expected {
            Value::String(kind) => schema_type_matches(kind, value),
            Value::Array(kinds) => kinds
                .iter()
                .filter_map(Value::as_str)
                .any(|kind| schema_type_matches(kind, value)),
            _ => false,
        };
        if !matches {
            return Err(format!("{path} has the wrong JSON type"));
        }
    }

    if let Some(text) = value.as_str() {
        let length = text.chars().count() as u64;
        if object
            .get("minLength")
            .and_then(Value::as_u64)
            .is_some_and(|minimum| length < minimum)
        {
            return Err(format!("{path} is shorter than minLength"));
        }
        if object
            .get("maxLength")
            .and_then(Value::as_u64)
            .is_some_and(|maximum| length > maximum)
        {
            return Err(format!("{path} is longer than maxLength"));
        }
    }
    validate_number_bounds(object, value, path)?;

    if let Some(items) = value.as_array() {
        if object
            .get("minItems")
            .and_then(Value::as_u64)
            .is_some_and(|minimum| items.len() < minimum as usize)
        {
            return Err(format!("{path} has fewer than minItems"));
        }
        if object
            .get("maxItems")
            .and_then(Value::as_u64)
            .is_some_and(|maximum| items.len() > maximum as usize)
        {
            return Err(format!("{path} has more than maxItems"));
        }
        if let Some(item_schema) = object.get("items") {
            for (index, item) in items.iter().enumerate() {
                validate_schema(item_schema, item, &format!("{path}[{index}]"), depth + 1)?;
            }
        }
    }

    if let Some(map) = value.as_object() {
        if let Some(required) = object.get("required").and_then(Value::as_array) {
            for key in required.iter().filter_map(Value::as_str) {
                if !map.contains_key(key) {
                    return Err(format!("{path}.{key} is required"));
                }
            }
        }
        let properties = object.get("properties").and_then(Value::as_object);
        if let Some(properties) = properties {
            for (key, property_schema) in properties {
                if let Some(property) = map.get(key) {
                    validate_schema(
                        property_schema,
                        property,
                        &format!("{path}.{key}"),
                        depth + 1,
                    )?;
                }
            }
        }
        if object.get("additionalProperties") == Some(&Value::Bool(false)) {
            let empty = Map::new();
            let declared = properties.unwrap_or(&empty);
            if let Some(key) = map.keys().find(|key| !declared.contains_key(*key)) {
                return Err(format!("{path}.{key} is not declared"));
            }
        }
    }

    Ok(())
}

/// Shared deterministic JSON Schema subset used by Data Exchange and AI V2
/// structured output. Schema shape/size and `$ref` rejection are validated by
/// `tapp_store::validate_inline_data_schema` before this function is called.
pub(super) fn validate_inline_json_value(schema: &Value, value: &Value) -> Result<(), String> {
    validate_schema(schema, value, "$", 0)
}

/// POST /api/tapp/data-exchange/requests
pub async fn prepare_data_exchange(
    State(db): State<DatabaseConnection>,
    grant: RuntimeGrantContext,
    Json(request): Json<PrepareDataExchangeRequest>,
) -> Result<Json<PreparedDataExchangeResponse>, ApiError> {
    let purpose = request.purpose.trim().to_string();
    if purpose.is_empty() || purpose.len() > MAX_PURPOSE_LENGTH {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "INVALID_DATA_EXCHANGE_PURPOSE",
            format!("purpose must contain 1-{MAX_PURPOSE_LENGTH} bytes"),
        ));
    }
    let params_bytes = serde_json::to_vec(&request.params).map_err(|_| {
        api_error(
            StatusCode::BAD_REQUEST,
            "INVALID_DATA_EXCHANGE_PARAMS",
            "params cannot be serialized",
        )
    })?;
    if params_bytes.len() > MAX_PARAMS_BYTES {
        return Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "DATA_EXCHANGE_PARAMS_TOO_LARGE",
            format!("params exceed {MAX_PARAMS_BYTES} bytes"),
        ));
    }
    if request.target_tapp_id == grant.tapp_id() {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "DATA_EXCHANGE_SELF_REQUEST",
            "Use the Tapp's private API for same-Tapp data",
        ));
    }

    let requester = resolve_accessible_tapp(&db, grant.subject_id(), grant.tapp_id()).await?;
    if requester.user_id != grant.owner_id() {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "RUNTIME_GRANT_INSTALLATION_MISMATCH",
            "Runtime Grant no longer matches the installed Tapp",
        ));
    }
    let provider =
        resolve_accessible_tapp(&db, grant.subject_id(), &request.target_tapp_id).await?;

    let requester_exchange = parse_exchange_manifest(&requester.manifest)?;
    if !requester_exchange.imports.iter().any(|import| {
        import.tapp_id == request.target_tapp_id && import.export_id == request.export_id
    }) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "DATA_EXCHANGE_IMPORT_NOT_DECLARED",
            "Requester manifest does not declare this import",
        ));
    }
    let provider_exchange = parse_exchange_manifest(&provider.manifest)?;
    let export = provider_exchange
        .exports
        .into_iter()
        .find(|export| export.id == request.export_id)
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "DATA_EXCHANGE_EXPORT_NOT_DECLARED",
                "Provider manifest does not declare this export",
            )
        })?;

    let now = Utc::now().timestamp();
    let expires_at = now + PREPARED_REQUEST_TTL.as_secs() as i64;
    let request_id = format!("dxr_{}", Uuid::new_v4().simple());
    let request_hash = request_hash(
        grant.tapp_id(),
        &request.target_tapp_id,
        &request.export_id,
        &request.params,
        &purpose,
    )?;
    let prepared = PreparedRequest {
        request_id: request_id.clone(),
        requester_runtime_id: grant.runtime_id().to_string(),
        requester_tapp_id: grant.tapp_id().to_string(),
        provider_tapp_id: request.target_tapp_id,
        provider_owner_id: provider.user_id,
        subject_id: grant.subject_id(),
        export: export.clone(),
        params: request.params,
        purpose: purpose.clone(),
        request_hash,
        expires_at,
    };

    let pending = shared_registry::list(&db, PREPARED_NAMESPACE, Some(grant.subject_id()), None)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "DATA_EXCHANGE_REGISTRY_UNAVAILABLE",
                "Data Exchange registry is unavailable",
            )
        })?;
    if pending.len() >= MAX_PENDING_REQUESTS_PER_SUBJECT {
        return Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "DATA_EXCHANGE_PENDING_LIMIT",
            "Too many pending Data Exchange requests",
        ));
    }
    shared_registry::put(
        &db,
        PREPARED_NAMESPACE,
        &request_id,
        RegistryIdentity {
            subject_id: Some(grant.subject_id()),
            owner_id: Some(grant.owner_id()),
            tapp_id: Some(grant.tapp_id()),
            runtime_id: Some(grant.runtime_id()),
        },
        &prepared,
        expires_at,
    )
    .await
    .map_err(|_| {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "DATA_EXCHANGE_REGISTRY_UNAVAILABLE",
            "Data Exchange registry is unavailable",
        )
    })?;

    Ok(Json(PreparedDataExchangeResponse {
        request_id,
        requester_tapp_id: grant.tapp_id().to_string(),
        requester_name: requester.name,
        provider_tapp_id: provider.tapp_id,
        provider_owner_id: provider.user_id,
        provider_name: provider.name,
        export_id: export.id,
        export_description: export.description,
        purpose,
        max_bytes: export.max_bytes,
        max_records: export.max_records,
        expires_at: rfc3339(expires_at),
    }))
}

/// POST /api/tapp/data-exchange/requests/{request_id}/authorize
pub async fn authorize_data_exchange(
    State(db): State<DatabaseConnection>,
    grant: RuntimeGrantContext,
    Path(request_id): Path<String>,
) -> Result<Json<DataAccessGrantResponse>, ApiError> {
    let now = Utc::now().timestamp();
    let prepared = {
        let prepared =
            shared_registry::get::<PreparedRequest>(&db, PREPARED_NAMESPACE, &request_id)
                .await
                .map_err(|_| {
                    api_error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "DATA_EXCHANGE_REGISTRY_UNAVAILABLE",
                        "Data Exchange registry is unavailable",
                    )
                })?
                .ok_or_else(|| {
                    api_error(
                        StatusCode::NOT_FOUND,
                        "DATA_EXCHANGE_REQUEST_EXPIRED",
                        "Prepared Data Exchange request is missing or expired",
                    )
                })?;
        if prepared.subject_id != grant.subject_id()
            || prepared.requester_runtime_id != grant.runtime_id()
            || prepared.requester_tapp_id != grant.tapp_id()
        {
            return Err(api_error(
                StatusCode::FORBIDDEN,
                "DATA_EXCHANGE_REQUEST_MISMATCH",
                "Prepared request does not belong to this runtime",
            ));
        }
        if !shared_registry::delete(&db, PREPARED_NAMESPACE, &request_id)
            .await
            .map_err(|_| {
                api_error(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "DATA_EXCHANGE_REGISTRY_UNAVAILABLE",
                    "Data Exchange registry is unavailable",
                )
            })?
        {
            return Err(api_error(
                StatusCode::CONFLICT,
                "DATA_EXCHANGE_REQUEST_ALREADY_USED",
                "Prepared Data Exchange request was already consumed",
            ));
        }
        prepared
    };

    let token = new_token();
    let grant_id = format!("dxg_{}", Uuid::new_v4().simple());
    let expires_at = now + DATA_ACCESS_GRANT_TTL.as_secs() as i64;
    let stored = StoredDataAccessGrant {
        grant_id: grant_id.clone(),
        requester_runtime_id: prepared.requester_runtime_id.clone(),
        requester_tapp_id: prepared.requester_tapp_id.clone(),
        provider_tapp_id: prepared.provider_tapp_id.clone(),
        provider_owner_id: prepared.provider_owner_id,
        subject_id: prepared.subject_id,
        export: prepared.export.clone(),
        params: prepared.params.clone(),
        purpose: prepared.purpose.clone(),
        request_hash: prepared.request_hash.clone(),
        expires_at,
    };

    let grants = shared_registry::list(&db, DATA_GRANT_NAMESPACE, Some(grant.subject_id()), None)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "DATA_EXCHANGE_REGISTRY_UNAVAILABLE",
                "Data Exchange registry is unavailable",
            )
        })?;
    if grants.len() >= MAX_ACTIVE_GRANTS_PER_SUBJECT {
        return Err(api_error(
            StatusCode::TOO_MANY_REQUESTS,
            "DATA_ACCESS_GRANT_LIMIT",
            "Too many active one-shot Data Access Grants",
        ));
    }
    shared_registry::put(
        &db,
        DATA_GRANT_NAMESPACE,
        &token_hash(&token),
        RegistryIdentity {
            subject_id: Some(grant.subject_id()),
            owner_id: Some(prepared.provider_owner_id),
            tapp_id: Some(&prepared.provider_tapp_id),
            runtime_id: None,
        },
        &stored,
        expires_at,
    )
    .await
    .map_err(|_| {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "DATA_EXCHANGE_REGISTRY_UNAVAILABLE",
            "Data Exchange registry is unavailable",
        )
    })?;

    tracing::info!(
        grant_id = %grant_id,
        request_id = %prepared.request_id,
        requester_tapp_id = %prepared.requester_tapp_id,
        provider_tapp_id = %prepared.provider_tapp_id,
        export_id = %prepared.export.id,
        subject_id = prepared.subject_id,
        "[TAPP] One-shot Data Access Grant authorized"
    );

    Ok(Json(DataAccessGrantResponse {
        version: 1,
        grant_id,
        token,
        request_id: prepared.request_id,
        provider_tapp_id: prepared.provider_tapp_id,
        provider_owner_id: prepared.provider_owner_id,
        export_id: prepared.export.id,
        params: prepared.params,
        purpose: prepared.purpose,
        request_hash: prepared.request_hash,
        max_bytes: prepared.export.max_bytes,
        max_records: prepared.export.max_records,
        expires_at: rfc3339(expires_at),
    }))
}

/// DELETE /api/tapp/data-exchange/requests/{request_id}
pub async fn cancel_data_exchange(
    State(db): State<DatabaseConnection>,
    grant: RuntimeGrantContext,
    Path(request_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let request = shared_registry::get::<PreparedRequest>(&db, PREPARED_NAMESPACE, &request_id)
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "DATA_EXCHANGE_REGISTRY_UNAVAILABLE",
                "Data Exchange registry is unavailable",
            )
        })?;
    let belongs = request.as_ref().is_some_and(|request| {
        request.subject_id == grant.subject_id()
            && request.requester_runtime_id == grant.runtime_id()
            && request.requester_tapp_id == grant.tapp_id()
    });
    if belongs {
        let _ = shared_registry::delete(&db, PREPARED_NAMESPACE, &request_id).await;
    }
    Ok(Json(json!({ "success": true, "cancelled": belongs })))
}

/// POST /api/tapp/data-exchange/consume
pub async fn consume_data_exchange(
    State(db): State<DatabaseConnection>,
    provider_grant: RuntimeGrantContext,
    Json(request): Json<ConsumeDataExchangeRequest>,
) -> Result<Json<Value>, ApiError> {
    // Removal happens before any payload validation: success and failure both
    // exhaust the one-shot token and make replay impossible.
    let grant = take_data_access_grant(&db, &request.grant_token).await?;

    if !same_provider_scope(
        grant.subject_id,
        grant.provider_owner_id,
        &grant.provider_tapp_id,
        provider_grant.subject_id(),
        provider_grant.owner_id(),
        provider_grant.tapp_id(),
    ) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "DATA_ACCESS_PROVIDER_MISMATCH",
            "Data Access Grant does not belong to this provider runtime",
        ));
    }

    let encoded = serde_json::to_vec(&request.response).map_err(|_| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "DATA_EXCHANGE_RESPONSE_INVALID",
            "Provider response cannot be serialized",
        )
    })?;
    if encoded.len() > grant.export.max_bytes {
        return Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "DATA_EXCHANGE_RESPONSE_TOO_LARGE",
            format!(
                "Provider response is {} bytes; maximum is {}",
                encoded.len(),
                grant.export.max_bytes
            ),
        ));
    }
    if let (Some(limit), Some(records)) = (grant.export.max_records, request.response.as_array()) {
        if records.len() > limit {
            return Err(api_error(
                StatusCode::UNPROCESSABLE_ENTITY,
                "DATA_EXCHANGE_RECORD_LIMIT",
                format!(
                    "Provider response contains {} records; maximum is {limit}",
                    records.len()
                ),
            ));
        }
    }
    validate_schema(&grant.export.schema, &request.response, "$", 0).map_err(|message| {
        api_error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "DATA_EXCHANGE_SCHEMA_MISMATCH",
            message,
        )
    })?;

    tracing::info!(
        grant_id = %grant.grant_id,
        requester_runtime_id = %grant.requester_runtime_id,
        requester_tapp_id = %grant.requester_tapp_id,
        provider_tapp_id = %grant.provider_tapp_id,
        export_id = %grant.export.id,
        request_hash = %grant.request_hash,
        purpose_bytes = grant.purpose.len(),
        params_bytes = serde_json::to_vec(&grant.params).map_or(0, |value| value.len()),
        response_bytes = encoded.len(),
        subject_id = grant.subject_id,
        "[TAPP] One-shot Data Exchange completed"
    );

    Ok(Json(json!({
        "success": true,
        "data": request.response,
        "grantId": grant.grant_id,
        "requestHash": grant.request_hash
    })))
}

#[cfg(test)]
mod tests {
    use super::{same_provider_scope, token_hash, validate_schema};
    use serde_json::json;

    #[test]
    fn validates_declared_object_shape() {
        let schema = json!({
            "type": "object",
            "required": ["title", "tracks"],
            "properties": {
                "title": { "type": "string", "maxLength": 20 },
                "tracks": {
                    "type": "array",
                    "maxItems": 2,
                    "items": {
                        "type": "object",
                        "required": ["id"],
                        "properties": { "id": { "type": "string" } },
                        "additionalProperties": false
                    }
                }
            },
            "additionalProperties": false
        });

        assert!(validate_schema(
            &schema,
            &json!({"title": "Now", "tracks": [{"id": "1"}]}),
            "$",
            0
        )
        .is_ok());
        assert!(validate_schema(
            &schema,
            &json!({"title": "Now", "tracks": [{"id": "1", "secret": true}]}),
            "$",
            0
        )
        .is_err());
    }

    #[test]
    fn data_access_tokens_are_stored_as_hashes() {
        let hash = token_hash("dxg_secret");
        assert_eq!(hash.len(), 64);
        assert_eq!(hash, token_hash("dxg_secret"));
        assert_ne!(hash, token_hash("dxg_other"));
    }

    #[test]
    fn data_access_grant_scope_includes_provider_owner() {
        assert!(same_provider_scope(
            42,
            1,
            "com.example.provider",
            42,
            1,
            "com.example.provider",
        ));
        assert!(!same_provider_scope(
            42,
            1,
            "com.example.provider",
            42,
            42,
            "com.example.provider",
        ));
    }
}
