//! Manifest-scoped, online at-most-once Event V2 broker.
//!
//! Events are transient notifications, not a data transport or task queue.
//! Cross-Tapp data bodies must use the consent-gated Data Exchange API.

use std::{collections::HashSet, convert::Infallible, time::Duration};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    Extension, Json,
};
use chrono::Utc;
use futures::Stream;
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement, TransactionTrait};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    api::tapp_store::TappEventsManifest, middleware::auth::Claims,
    services::permission_service::TappPermission,
};

use super::{
    common::{authorize_tapp_permission, check_rate_limit, resolve_accessible_tapp},
    runtime_grant::RuntimeGrantContext,
    shared_registry::{self, RegistryIdentity},
};

type ApiError = (StatusCode, Json<Value>);

const MAX_EVENT_TOPIC_BYTES: usize = 128;
const MAX_INSTANCE_PAYLOAD_BYTES: usize = 64 * 1024;
const MAX_OWNER_METADATA_BYTES: usize = 8 * 1024;
const MAX_DEDUPE_KEY_BYTES: usize = 128;
const DEDUPE_TTL_SECONDS: i64 = 30;
const EVENT_CHANNEL_CAPACITY: usize = 64;
const EVENT_PRESENCE_NAMESPACE: &str = "event_presence";
const EVENT_DEDUPE_NAMESPACE: &str = "event_dedupe";
const EVENT_MAILBOX_CHANNEL: &str = "event_v2";

fn api_error(status: StatusCode, code: &str, message: impl Into<String>) -> ApiError {
    (
        status,
        Json(json!({
            "error": message.into(),
            "code": code
        })),
    )
}

fn valid_topic(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_EVENT_TOPIC_BYTES
        && !value.starts_with('.')
        && !value.ends_with('.')
        && !value.contains("..")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
}

fn valid_dedupe_key(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_DEDUPE_KEY_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b':'))
}

fn dedupe_record_id(runtime_id: &str, key: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(runtime_id.as_bytes());
    digest.update([0]);
    digest.update(key.as_bytes());
    hex::encode(digest.finalize())
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EventScope {
    Instance,
    Owner,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventSource {
    tapp_id: String,
    runtime_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TappEventEnvelope {
    version: u8,
    event_id: String,
    topic: String,
    scope: EventScope,
    source: EventSource,
    payload: Value,
    occurred_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    dedupe_key: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishEventV2Request {
    topic: String,
    scope: EventScope,
    #[serde(default)]
    payload: Value,
    #[serde(default)]
    dedupe_key: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PublishEventRequest {
    pub tapp_id: String,
    pub event_type: String,
    pub payload: Value,
    pub target: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct OnlineSubscriber {
    subject_id: i32,
    owner_id: i32,
    tapp_id: String,
    topics: HashSet<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct DedupeRecord {
    request_hash: [u8; 32],
    event: TappEventEnvelope,
    expires_at: i64,
}

struct SubscriptionGuard {
    runtime_id: String,
}

impl Drop for SubscriptionGuard {
    fn drop(&mut self) {
        let runtime_id = self.runtime_id.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                if let Ok(db) = shared_registry::database().await {
                    let _ =
                        shared_registry::delete(&db, EVENT_PRESENCE_NAMESPACE, &runtime_id).await;
                }
            });
        }
    }
}

fn parse_event_manifest(manifest: &Value) -> Result<TappEventsManifest, ApiError> {
    manifest
        .get("events")
        .cloned()
        .ok_or_else(|| {
            api_error(
                StatusCode::FORBIDDEN,
                "EVENT_V2_NOT_DECLARED",
                "Tapp manifest does not declare Event V2",
            )
        })
        .and_then(|value| {
            serde_json::from_value(value).map_err(|_| {
                api_error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "INVALID_EVENT_V2_MANIFEST",
                    "Stored Tapp events declaration is invalid",
                )
            })
        })
}

fn payload_size(payload: &Value) -> Result<usize, ApiError> {
    serde_json::to_vec(payload)
        .map(|value| value.len())
        .map_err(|_| {
            api_error(
                StatusCode::BAD_REQUEST,
                "INVALID_EVENT_PAYLOAD",
                "Event payload cannot be serialized",
            )
        })
}

fn validate_owner_metadata(value: &Value, depth: usize, nodes: &mut usize) -> bool {
    if depth > 4 || *nodes > 64 {
        return false;
    }
    *nodes += 1;
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => true,
        Value::String(value) => value.len() <= 1_024,
        Value::Array(values) => {
            values.len() <= 32
                && values
                    .iter()
                    .all(|value| validate_owner_metadata(value, depth + 1, nodes))
        }
        Value::Object(values) => {
            values.len() <= 32
                && values.iter().all(|(key, value)| {
                    !matches!(
                        key.to_ascii_lowercase().as_str(),
                        "data" | "content" | "records" | "items" | "body" | "blob" | "bytes"
                    ) && validate_owner_metadata(value, depth + 1, nodes)
                })
        }
    }
}

fn validate_payload(scope: EventScope, payload: &Value) -> Result<(), ApiError> {
    let size = payload_size(payload)?;
    match scope {
        EventScope::Instance if size <= MAX_INSTANCE_PAYLOAD_BYTES => Ok(()),
        EventScope::Instance => Err(api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "EVENT_PAYLOAD_LIMIT",
            "Instance event payload exceeds 64 KiB",
        )),
        EventScope::Owner => {
            let mut nodes = 0;
            if size > MAX_OWNER_METADATA_BYTES
                || !payload.is_object()
                || !validate_owner_metadata(payload, 0, &mut nodes)
            {
                return Err(api_error(
                    StatusCode::BAD_REQUEST,
                    "OWNER_EVENT_METADATA_ONLY",
                    "Owner events accept only bounded status metadata; use one-shot Data Exchange for cross-Tapp data",
                ));
            }
            Ok(())
        }
    }
}

fn subject_can_publish_scope(subject_id: i32, scope: EventScope) -> bool {
    subject_id >= 0 || scope == EventScope::Instance
}

fn request_hash(request: &PublishEventV2Request) -> Result<[u8; 32], ApiError> {
    serde_json::to_vec(request)
        .map(|encoded| Sha256::digest(encoded).into())
        .map_err(|_| {
            api_error(
                StatusCode::BAD_REQUEST,
                "INVALID_EVENT_REQUEST",
                "Event request cannot be serialized",
            )
        })
}

async fn deliver_event(
    db: &impl ConnectionTrait,
    runtime: &RuntimeGrantContext,
    event: &TappEventEnvelope,
) -> Result<usize, ApiError> {
    let presences = shared_registry::list(
        db,
        EVENT_PRESENCE_NAMESPACE,
        match event.scope {
            EventScope::Instance => None,
            EventScope::Owner => Some(runtime.subject_id()),
        },
        None,
    )
    .await
    .map_err(|_| {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "EVENT_REGISTRY_UNAVAILABLE",
            "Event registry is unavailable",
        )
    })?;
    let mut delivered = 0usize;
    for presence in presences {
        let Ok(subscriber) = serde_json::from_value::<OnlineSubscriber>(presence.payload) else {
            continue;
        };
        let runtime_id = presence
            .runtime_id
            .as_deref()
            .unwrap_or(&presence.record_id);
        let addressed = subscriber.topics.contains(&event.topic)
            && match event.scope {
                EventScope::Instance => runtime_id == runtime.runtime_id(),
                // `subject_id` is the current user's data-owner space. Using
                // installation owner_id here would leak shared admin-Tapp
                // events across ordinary users.
                EventScope::Owner => subscriber.subject_id == runtime.subject_id(),
            };
        if !addressed {
            continue;
        }
        shared_registry::enqueue(
            db,
            EVENT_MAILBOX_CHANNEL,
            runtime_id,
            event,
            Utc::now().timestamp() + 30,
        )
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "EVENT_REGISTRY_UNAVAILABLE",
                "Event mailbox is unavailable",
            )
        })?;
        delivered += 1;
    }
    Ok(delivered)
}

async fn publish_v2(
    db: &DatabaseConnection,
    claims: &Claims,
    runtime: &RuntimeGrantContext,
    request: PublishEventV2Request,
) -> Result<Json<Value>, ApiError> {
    runtime.require(TappPermission::EventPublish)?;
    let user_id =
        authorize_tapp_permission(db, claims, runtime.tapp_id(), TappPermission::EventPublish)
            .await?;
    if !valid_topic(&request.topic) || request.topic.starts_with("system.") {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "INVALID_EVENT_TOPIC",
            "Tapp publishers cannot publish system or invalid topics",
        ));
    }
    if request
        .dedupe_key
        .as_deref()
        .is_some_and(|value| !valid_dedupe_key(value))
    {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "INVALID_EVENT_DEDUPE_KEY",
            "dedupeKey must use 1-128 safe ASCII characters",
        ));
    }
    if !subject_can_publish_scope(runtime.subject_id(), request.scope) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "GUEST_OWNER_EVENT_UNAVAILABLE",
            "Guest runtimes may only publish instance-scoped events",
        ));
    }
    validate_payload(request.scope, &request.payload)?;

    let tapp = resolve_accessible_tapp(db, user_id, runtime.tapp_id()).await?;
    let declaration = parse_event_manifest(&tapp.manifest)?;
    if !declaration.publish.contains(&request.topic) {
        return Err(api_error(
            StatusCode::FORBIDDEN,
            "EVENT_TOPIC_NOT_DECLARED",
            "Event publish topic is not declared by this Tapp",
        ));
    }
    check_rate_limit(user_id, runtime.tapp_id(), "event.v2.publish").await?;

    let hash = request_hash(&request)?;
    let dedupe_scope = request
        .dedupe_key
        .as_ref()
        .map(|key| dedupe_record_id(runtime.runtime_id(), key));
    let event = TappEventEnvelope {
        version: 2,
        event_id: format!("evt_{}", Uuid::new_v4().simple()),
        topic: request.topic,
        scope: request.scope,
        source: EventSource {
            tapp_id: runtime.tapp_id().to_string(),
            runtime_id: runtime.runtime_id().to_string(),
        },
        payload: request.payload,
        occurred_at: Utc::now().to_rfc3339(),
        dedupe_key: request.dedupe_key,
    };

    let delivered = if let Some(dedupe_scope) = dedupe_scope {
        // Serialize one runtime/dedupe key across every backend replica. The
        // mailbox writes and dedupe record commit together, so a retry cannot
        // observe a half-published event.
        let txn = db.begin().await.map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "EVENT_REGISTRY_UNAVAILABLE",
                "Event registry is unavailable",
            )
        })?;
        txn.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            vec![format!("tapp-event-dedupe:{dedupe_scope}").into()],
        ))
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "EVENT_REGISTRY_UNAVAILABLE",
                "Event registry is unavailable",
            )
        })?;
        if let Some(existing) =
            shared_registry::get::<DedupeRecord>(&txn, EVENT_DEDUPE_NAMESPACE, &dedupe_scope)
                .await
                .map_err(|_| {
                    api_error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "EVENT_REGISTRY_UNAVAILABLE",
                        "Event registry is unavailable",
                    )
                })?
        {
            txn.commit().await.ok();
            if existing.request_hash != hash {
                return Err(api_error(
                    StatusCode::CONFLICT,
                    "EVENT_DEDUPE_KEY_REUSED",
                    "dedupeKey was already used for a different event",
                ));
            }
            return Ok(Json(json!({
                "success": true,
                "accepted": true,
                "deduplicated": true,
                "delivered": 0,
                "event": existing.event,
            })));
        }

        let delivered = deliver_event(&txn, runtime, &event).await?;
        let expires_at = Utc::now().timestamp() + DEDUPE_TTL_SECONDS;
        shared_registry::put(
            &txn,
            EVENT_DEDUPE_NAMESPACE,
            &dedupe_scope,
            RegistryIdentity {
                subject_id: Some(runtime.subject_id()),
                owner_id: Some(runtime.owner_id()),
                tapp_id: Some(runtime.tapp_id()),
                runtime_id: Some(runtime.runtime_id()),
            },
            &DedupeRecord {
                request_hash: hash,
                event: event.clone(),
                expires_at,
            },
            expires_at,
        )
        .await
        .map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "EVENT_REGISTRY_UNAVAILABLE",
                "Event deduplication registry is unavailable",
            )
        })?;
        txn.commit().await.map_err(|_| {
            api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "EVENT_REGISTRY_UNAVAILABLE",
                "Event registry is unavailable",
            )
        })?;
        delivered
    } else {
        deliver_event(db, runtime, &event).await?
    };

    Ok(Json(json!({
        "success": true,
        "accepted": true,
        "deduplicated": false,
        "delivered": delivered,
        "event": event,
    })))
}

/// POST /api/tapp/events/v2/publish
pub async fn publish_event_v2(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime: RuntimeGrantContext,
    Json(request): Json<PublishEventV2Request>,
) -> Result<Json<Value>, ApiError> {
    publish_v2(&db, &claims, &runtime, request).await
}

/// GET /api/tapp/events/v2/stream
pub async fn stream_events_v2(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime: RuntimeGrantContext,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, ApiError> {
    runtime.require(TappPermission::EventSubscribe)?;
    let user_id = authorize_tapp_permission(
        &db,
        &claims,
        runtime.tapp_id(),
        TappPermission::EventSubscribe,
    )
    .await?;
    let tapp = resolve_accessible_tapp(&db, user_id, runtime.tapp_id()).await?;
    let declaration = parse_event_manifest(&tapp.manifest)?;
    let topics = declaration.subscribe.into_iter().collect::<HashSet<_>>();
    let presence = OnlineSubscriber {
        subject_id: runtime.subject_id(),
        owner_id: runtime.owner_id(),
        tapp_id: runtime.tapp_id().to_string(),
        topics: topics.clone(),
    };
    shared_registry::put(
        &db,
        EVENT_PRESENCE_NAMESPACE,
        runtime.runtime_id(),
        RegistryIdentity {
            subject_id: Some(runtime.subject_id()),
            owner_id: Some(runtime.owner_id()),
            tapp_id: Some(runtime.tapp_id()),
            runtime_id: Some(runtime.runtime_id()),
        },
        &presence,
        runtime.expires_at(),
    )
    .await
    .map_err(|_| {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "EVENT_REGISTRY_UNAVAILABLE",
            "Event subscription registry is unavailable",
        )
    })?;
    let guard = SubscriptionGuard {
        runtime_id: runtime.runtime_id().to_string(),
    };
    let expires_in = (runtime.expires_at() - Utc::now().timestamp()).max(1) as u64;
    let ready = json!({
        "runtimeId": runtime.runtime_id(),
        "tappId": runtime.tapp_id(),
        "topics": topics,
        "delivery": "online-at-most-once",
    });
    let stream = async_stream::stream! {
        let _guard = guard;
        yield Ok(Event::default().event("ready").json_data(ready).unwrap_or_default());
        let deadline = tokio::time::sleep(Duration::from_secs(expires_in));
        tokio::pin!(deadline);
        let mut poll = tokio::time::interval(Duration::from_millis(250));
        poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = &mut deadline => {
                    yield Ok(Event::default().event("grant-expired").data("reconnect"));
                    break;
                }
                _ = poll.tick() => {
                    let events = shared_registry::drain::<TappEventEnvelope>(
                        &db,
                        EVENT_MAILBOX_CHANNEL,
                        runtime.runtime_id(),
                        EVENT_CHANNEL_CAPACITY as i64,
                    ).await.unwrap_or_default();
                    for event in events {
                        yield Ok(Event::default().event("event").json_data(event).unwrap_or_default());
                    }
                }
            }
        }
    };
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

/// V1 migration adapter. Only explicit `target = self` is retained and maps
/// to Event V2 instance scope; free-form targets and the old implicit `all`
/// behavior are rejected.
pub async fn publish_event(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    runtime: RuntimeGrantContext,
    Json(request): Json<PublishEventRequest>,
) -> Result<Json<Value>, ApiError> {
    runtime.require_tapp_id(&request.tapp_id)?;
    if request.target.as_deref() != Some("self") {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "UNSUPPORTED_LEGACY_EVENT_TARGET",
            "Legacy event publish only supports target=self; use Event V2 scope",
        ));
    }
    publish_v2(
        &db,
        &claims,
        &runtime,
        PublishEventV2Request {
            topic: request.event_type,
            scope: EventScope::Instance,
            payload: request.payload,
            dedupe_key: None,
        },
    )
    .await
}

#[derive(Debug, Deserialize)]
pub struct UpdateSubscriptionsRequest {
    pub subscriptions: Vec<String>,
}

/// Legacy subscription persistence is deliberately removed: Manifest V2 is
/// the only subscription declaration and online streams are runtime state.
pub async fn get_event_subscriptions(
    _runtime: RuntimeGrantContext,
    Path(_tapp_id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    Err(api_error(
        StatusCode::GONE,
        "LEGACY_EVENT_SUBSCRIPTIONS_REMOVED",
        "Persistent event subscriptions were removed; declare events.subscribe in the manifest",
    ))
}

pub async fn update_event_subscriptions(
    _runtime: RuntimeGrantContext,
    Path(_tapp_id): Path<String>,
    Json(request): Json<UpdateSubscriptionsRequest>,
) -> Result<Json<Value>, ApiError> {
    let _ = request.subscriptions;
    Err(api_error(
        StatusCode::GONE,
        "LEGACY_EVENT_SUBSCRIPTIONS_REMOVED",
        "Persistent event subscriptions were removed; declare events.subscribe in the manifest",
    ))
}

pub(super) async fn disconnect_runtime_events(runtime_id: &str) -> bool {
    match shared_registry::database().await {
        Ok(db) => shared_registry::delete(&db, EVENT_PRESENCE_NAMESPACE, runtime_id)
            .await
            .unwrap_or(false),
        Err(_) => false,
    }
}

pub(super) async fn disconnect_tapp_events(subject_id: i32, tapp_id: &str) -> usize {
    match shared_registry::database().await {
        Ok(db) => shared_registry::delete_matching(
            &db,
            EVENT_PRESENCE_NAMESPACE,
            Some(subject_id),
            Some(tapp_id),
            None,
        )
        .await
        .unwrap_or(0) as usize,
        Err(_) => 0,
    }
}

pub(super) async fn disconnect_all_tapp_events(tapp_id: &str) -> usize {
    match shared_registry::database().await {
        Ok(db) => shared_registry::delete_matching(
            &db,
            EVENT_PRESENCE_NAMESPACE,
            None,
            Some(tapp_id),
            None,
        )
        .await
        .unwrap_or(0) as usize,
        Err(_) => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        dedupe_record_id, subject_can_publish_scope, valid_topic, validate_payload, EventScope,
    };
    use serde_json::json;

    #[test]
    fn validates_namespaced_topics() {
        assert!(valid_topic("tapp.com.example.player.track.changed"));
        assert!(valid_topic("system.theme.changed"));
        assert!(!valid_topic("tapp..changed"));
        assert!(!valid_topic("tapp/bad"));
    }

    #[test]
    fn owner_events_reject_data_bodies() {
        assert!(validate_payload(
            EventScope::Owner,
            &json!({ "status": "changed", "revision": 3 })
        )
        .is_ok());
        assert!(
            validate_payload(EventScope::Owner, &json!({ "items": [{ "secret": true }] })).is_err()
        );
    }

    #[test]
    fn guest_subjects_cannot_broadcast_owner_events() {
        assert!(subject_can_publish_scope(-42, EventScope::Instance));
        assert!(!subject_can_publish_scope(-42, EventScope::Owner));
        assert!(subject_can_publish_scope(42, EventScope::Owner));
    }

    #[test]
    fn event_dedupe_record_ids_are_bounded_and_runtime_scoped() {
        let key = "x".repeat(128);
        let id = dedupe_record_id("rt_0123456789abcdef0123456789abcdef", &key);

        assert_eq!(id.len(), 64);
        assert_eq!(
            id,
            dedupe_record_id("rt_0123456789abcdef0123456789abcdef", &key)
        );
        assert_ne!(id, dedupe_record_id("rt_other", &key));
    }
}
