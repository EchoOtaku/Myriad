//! Room E2E multi-party encryption.
use axum::{http::StatusCode, Json};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement, TransactionTrait};
use serde_json::json;

use crate::federation::types::*;

use super::helpers::*;
use super::types::*;

// Room E2E 多方加密

pub(crate) async fn jwt_secret_for_e2e_seal() -> String {
    let config = crate::GLOBAL_CONFIG.read().await;
    config.jwt_secret.clone()
}

/// 用任一本地成员密钥解密多方信封，供 WebSocket 广播展示（明文各收件人相同）。
pub(crate) async fn decrypt_room_payload_for_local_ws(
    db: &DatabaseConnection,
    room_id: &str,
    encrypted_payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let rows = db
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT actor_url FROM federation_room_members
               WHERE room_id = $1 AND is_local = true
                 AND COALESCE(membership_status, 'active') = 'active'"#,
            [room_id.into()],
        ))
        .await
        .map_err(|e| e.to_string())?;

    let mut last_err = "no local members with e2e keys".to_string();
    for row in rows {
        let actor: String = row.try_get("", "actor_url").unwrap_or_default();
        if actor.is_empty() {
            continue;
        }
        match load_member_e2e_keys(db, room_id, &actor).await {
            Ok((pk, sk)) => {
                match crate::federation::e2e::decrypt_json_for_recipient(
                    encrypted_payload,
                    &sk,
                    &pk,
                    room_id.as_bytes(),
                ) {
                    Ok(plain) => return Ok(plain),
                    Err(e) => last_err = e,
                }
            }
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

/// 从成员 custom_permissions 读取本地 E2E 密钥对
pub(crate) async fn load_member_e2e_keys(
    db: &DatabaseConnection,
    room_id: &str,
    actor_url: &str,
) -> Result<(String, String), String> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT custom_permissions FROM federation_room_members WHERE room_id = $1 AND actor_url = $2",
            [room_id.into(), actor_url.into()],
        ))
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Member row not found")?;

    let perms = row
        .try_get::<Option<serde_json::Value>>("", "custom_permissions")
        .ok()
        .flatten()
        .ok_or("No custom_permissions / e2e keys")?;
    let e2e = perms.get("e2e").ok_or("No e2e state on member")?;
    let pk = e2e
        .get("local_public_key")
        .and_then(|v| v.as_str())
        .ok_or("Missing local_public_key")?
        .to_string();
    let sk_stored = e2e
        .get("local_private_key")
        .and_then(|v| v.as_str())
        .ok_or("Missing local_private_key")?;
    let jwt_secret = jwt_secret_for_e2e_seal().await;
    let sk = crate::federation::e2e::unseal_private_key(sk_stored, &jwt_secret)?;
    Ok((pk, sk))
}

/// 收集房间已发布的对端公钥（不含 exclude_actor）
pub(crate) async fn collect_room_e2e_recipients(
    db: &DatabaseConnection,
    room_id: &str,
    exclude_actor: &str,
) -> Result<Vec<(String, String)>, String> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT shared_data_config FROM federation_rooms WHERE room_id = $1",
            [room_id.into()],
        ))
        .await
        .map_err(|e| e.to_string())?
        .ok_or("Room not found")?;

    let shared = row
        .try_get::<Option<serde_json::Value>>("", "shared_data_config")
        .ok()
        .flatten()
        .unwrap_or_else(|| json!({}));
    let published = shared
        .pointer("/e2e/published_keys")
        .and_then(|v| v.as_object())
        .ok_or("No published E2E keys on room; members must run key-exchange")?;

    let mut out = Vec::new();
    for (actor, pk_val) in published {
        if actor == exclude_actor {
            continue;
        }
        if let Some(pk) = pk_val.as_str() {
            crate::federation::e2e::validate_public_key_b64(pk)
                .map_err(|e| format!("bad key for {actor}: {e}"))?;
            out.push((actor.clone(), pk.to_string()));
        }
    }
    Ok(out)
}

const UPSERT_MEMBER_LOCAL_E2E_SQL: &str = r#"
UPDATE federation_room_members
SET custom_permissions = (
    CASE
        WHEN jsonb_typeof(custom_permissions::jsonb) = 'object'
            THEN custom_permissions::jsonb
        ELSE '{}'::jsonb
    END
    || jsonb_build_object(
        'e2e',
        CASE
            WHEN jsonb_typeof(custom_permissions::jsonb->'e2e') = 'object'
                THEN custom_permissions::jsonb->'e2e'
            ELSE '{}'::jsonb
        END
        || jsonb_build_object(
            'local_public_key', $3::text,
            'local_private_key', $4::text,
            'sealed', true,
            'algorithm', $5::text
        )
    )
)::json
WHERE room_id = $1 AND actor_url = $2
"#;

const UPSERT_ROOM_PUBLISHED_KEY_SQL: &str = r#"
UPDATE federation_rooms
SET shared_data_config = (
    CASE
        WHEN jsonb_typeof(shared_data_config::jsonb) = 'object'
            THEN shared_data_config::jsonb
        ELSE '{}'::jsonb
    END
    || jsonb_build_object(
        'e2e',
        CASE
            WHEN jsonb_typeof(shared_data_config::jsonb->'e2e') = 'object'
                THEN shared_data_config::jsonb->'e2e'
            ELSE '{}'::jsonb
        END
        || jsonb_build_object(
            'published_keys',
            CASE
                WHEN jsonb_typeof(shared_data_config::jsonb #> '{e2e,published_keys}') = 'object'
                    THEN shared_data_config::jsonb #> '{e2e,published_keys}'
                ELSE '{}'::jsonb
            END
            || jsonb_build_object($2::text, $3::text),
            'algorithm', $4::text
        )
    )
)::json,
updated_at = NOW()
WHERE room_id = $1
RETURNING jsonb_object_length(
    CASE
        WHEN jsonb_typeof(shared_data_config::jsonb #> '{e2e,published_keys}') = 'object'
            THEN shared_data_config::jsonb #> '{e2e,published_keys}'
        ELSE '{}'::jsonb
    END
)::bigint AS published_key_count
"#;

async fn upsert_room_published_key<C: ConnectionTrait>(
    db: &C,
    room_id: &str,
    actor_url: &str,
    public_key: &str,
    algorithm: &str,
) -> Result<Option<usize>, sea_orm::DbErr> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            UPSERT_ROOM_PUBLISHED_KEY_SQL,
            [
                room_id.into(),
                actor_url.into(),
                public_key.into(),
                algorithm.into(),
            ],
        ))
        .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let published_key_count: i64 = row.try_get("", "published_key_count")?;
    Ok(Some(published_key_count.max(0) as usize))
}

struct PersistedLocalRoomE2eKey {
    public_key: String,
    published_key_count: usize,
    already_published: bool,
}

async fn persist_local_room_e2e_key(
    db: &DatabaseConnection,
    room_id: &str,
    local_actor: &str,
    jwt_secret: &str,
) -> Result<PersistedLocalRoomE2eKey, (StatusCode, Json<serde_json::Value>)> {
    let txn = db.begin().await.map_err(db_err)?;

    // All local initiators lock rows in the same order. The second caller then
    // reads and reuses the key pair committed by the first caller.
    let room_row = txn
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT shared_data_config FROM federation_rooms WHERE room_id = $1 FOR UPDATE",
            [room_id.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "Room not found"})),
            )
        })?;
    let shared = room_row
        .try_get::<Option<serde_json::Value>>("", "shared_data_config")
        .ok()
        .flatten()
        .unwrap_or_else(|| json!({}));

    let member_row = txn
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT custom_permissions, role,
                      COALESCE(membership_status, 'active') AS membership_status
               FROM federation_room_members
               WHERE room_id = $1 AND actor_url = $2
               FOR UPDATE"#,
            [room_id.into(), local_actor.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| not_active_member_err(None))?;

    let role: String = member_row
        .try_get("", "role")
        .unwrap_or_else(|_| "member".to_string());
    let membership_status: String = member_row
        .try_get("", "membership_status")
        .unwrap_or_else(|_| "active".to_string());
    if membership_status != "active" {
        return Err(not_active_member_err(Some((role, membership_status))));
    }
    if role == "observer" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Observers cannot publish E2E keys"})),
        ));
    }

    let perms = member_row
        .try_get::<Option<serde_json::Value>>("", "custom_permissions")
        .ok()
        .flatten()
        .unwrap_or_else(|| json!({}));
    let existing_pk = perms
        .pointer("/e2e/local_public_key")
        .and_then(|v| v.as_str())
        .map(str::to_owned);
    let existing_sk = perms
        .pointer("/e2e/local_private_key")
        .and_then(|v| v.as_str())
        .map(str::to_owned);

    let (public_key, sealed_sk) = if let (Some(pk), Some(sk_stored)) = (existing_pk, existing_sk) {
        match crate::federation::e2e::unseal_private_key(&sk_stored, jwt_secret) {
            Ok(_) => (pk, sk_stored),
            Err(_) => {
                let session = crate::federation::e2e::create_session(room_id);
                let sealed = crate::federation::e2e::seal_private_key(
                    &session.local_keypair.private_key,
                    jwt_secret,
                )
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({"error": format!("Failed to seal E2E key: {}", e)})),
                    )
                })?;
                (session.local_keypair.public_key, sealed)
            }
        }
    } else {
        let session = crate::federation::e2e::create_session(room_id);
        let sealed = crate::federation::e2e::seal_private_key(
            &session.local_keypair.private_key,
            jwt_secret,
        )
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": format!("Failed to seal E2E key: {}", e)})),
            )
        })?;
        (session.local_keypair.public_key, sealed)
    };

    let member_update = txn
        .execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            UPSERT_MEMBER_LOCAL_E2E_SQL,
            [
                room_id.into(),
                local_actor.into(),
                public_key.clone().into(),
                sealed_sk.into(),
                crate::federation::e2e::E2E_ALGORITHM.into(),
            ],
        ))
        .await
        .map_err(db_err)?;
    if member_update.rows_affected() != 1 {
        return Err(not_active_member_err(None));
    }

    let already_published = shared
        .pointer("/e2e/published_keys")
        .and_then(|v| v.get(local_actor))
        .and_then(|v| v.as_str())
        == Some(public_key.as_str());
    let published_key_count = upsert_room_published_key(
        &txn,
        room_id,
        local_actor,
        &public_key,
        crate::federation::e2e::E2E_ALGORITHM,
    )
    .await
    .map_err(db_err)?
    .ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Room not found"})),
        )
    })?;

    txn.commit().await.map_err(db_err)?;
    Ok(PersistedLocalRoomE2eKey {
        public_key,
        published_key_count,
        already_published,
    })
}

/// 发起 Room E2E 密钥发布：生成本地密钥、登记到 published_keys、fan-out KeyExchange
pub async fn initiate_e2e_key_exchange(
    user_id: i32,
    username: &str,
    room_id: &str,
    db: &DatabaseConnection,
) -> Result<RoomE2eKeyExchangeResponse, (StatusCode, Json<serde_json::Value>)> {
    let base_url = get_base_url().await;
    let local_actor = actor_url(&base_url, username);

    // Alignment: pending invitees must not fan-out KeyExchange (remote may lack room row)
    let my_role = require_active_member_role(db, room_id, &local_actor).await?;
    if my_role == "observer" {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Observers cannot publish E2E keys"})),
        ));
    }
    let jwt_secret = jwt_secret_for_e2e_seal().await;
    let persisted = persist_local_room_e2e_key(db, room_id, &local_actor, &jwt_secret).await?;
    let public_key = persisted.public_key;
    let published_key_count = persisted.published_key_count;

    // Skip KeyExchange fan-out when this actor already published the same key
    // (re-initiate must not double-send to remotes / WS).
    if persisted.already_published {
        tracing::debug!(
            "[Room] E2E key already published for {} in room {} — skip fan-out",
            username,
            room_id
        );
        return Ok(RoomE2eKeyExchangeResponse {
            success: true,
            room_id: room_id.to_string(),
            public_key,
            algorithm: crate::federation::e2e::E2E_ALGORITHM.to_string(),
            published_key_count,
        });
    }

    // Fan-out KeyExchange activity after the persisted key transaction commits.
    let activity_id = generate_activity_id(&base_url);
    let kx_object = crate::federation::e2e::KeyExchangePayload::for_room(
        room_id,
        &public_key,
        Some(now_iso8601()),
    )
    .to_json();
    let kx_activity = json!({
        "@context": build_context(),
        "type": "myriad:KeyExchange",
        "id": &activity_id,
        "actor": &local_actor,
        "object": kx_object
    });

    let _ = fanout_to_remote_members(
        db,
        user_id,
        room_id,
        &activity_id,
        &kx_activity,
        "KeyExchange",
        "KeyExchange",
    )
    .await;

    crate::federation::ws_gateway::broadcast_to_room(
        room_id,
        &json!({
            "type": "key_exchange",
            "room_id": room_id,
            "from": local_actor,
            "publicKey": public_key,
            "algorithm": crate::federation::e2e::E2E_ALGORITHM,
            "published_key_count": published_key_count,
            "direction": "outbound"
        }),
    )
    .await;

    tracing::info!(
        "[Room] E2E key published for {} in room {} (published={})",
        username,
        room_id,
        published_key_count
    );

    Ok(RoomE2eKeyExchangeResponse {
        success: true,
        room_id: room_id.to_string(),
        public_key,
        algorithm: crate::federation::e2e::E2E_ALGORITHM.to_string(),
        published_key_count,
    })
}

/// 处理 Room 的 myriad:KeyExchange：登记对方公钥到 shared_data_config
pub async fn handle_key_exchange(
    db: &DatabaseConnection,
    actor_url_str: &str,
    activity: &serde_json::Value,
) -> Result<(), String> {
    let object = activity.get("object").ok_or("Missing object")?;
    let room_id = object
        .get("room")
        .and_then(|v| v.as_str())
        .ok_or("Missing room")?;
    let public_key = object
        .get("publicKey")
        .and_then(|v| v.as_str())
        .ok_or("Missing publicKey")?;
    let algorithm = object
        .get("algorithm")
        .and_then(|v| v.as_str())
        .unwrap_or(crate::federation::e2e::E2E_ALGORITHM);

    crate::federation::e2e::validate_public_key_b64(public_key)
        .map_err(|e| format!("Invalid remote E2E public key: {e}"))?;

    // Room may not exist yet if RoomInvite is still in flight — ask peer to retry
    // (transient). Permanent not_found only after room row is known-absent and we
    // already completed invite handling (see ensure below).
    let room_exists = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT 1 FROM federation_rooms WHERE room_id = $1",
            [room_id.into()],
        ))
        .await
        .map_err(|e| e.to_string())?
        .is_some();
    if !room_exists {
        return Err(format!(
            "Room {room_id} not yet present; retry after RoomInvite"
        ));
    }

    // 发送方必须是成员（含 inviter/owner self-heal）
    ensure_room_message_sender_member(db, room_id, actor_url_str).await?;

    let published_key_count =
        upsert_room_published_key(db, room_id, actor_url_str, public_key, algorithm)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("not_found: Room {room_id} not found"))?;

    crate::federation::ws_gateway::broadcast_to_room(
        room_id,
        &json!({
            "type": "key_exchange",
            "room_id": room_id,
            "from": actor_url_str,
            "publicKey": public_key,
            "algorithm": algorithm,
            "published_key_count": published_key_count
        }),
    )
    .await;

    tracing::info!(
        "[Room] KeyExchange received in room {} from {} (published={})",
        room_id,
        actor_url_str,
        published_key_count
    );
    Ok(())
}

#[cfg(test)]
mod db_tests {
    use super::super::stickers::replace_room_stickers;
    use super::*;
    use sea_orm::{Database, DatabaseConnection};
    use sea_orm_migration::MigratorTrait;

    async fn test_database() -> Option<DatabaseConnection> {
        let database_url = std::env::var("ROOM_TEST_DATABASE_URL")
            .or_else(|_| std::env::var("NOTIFICATION_TEST_DATABASE_URL"))
            .or_else(|_| std::env::var("MYRIAD_SCHEMA_DRIFT_DB"));
        let Ok(database_url) = database_url else {
            return None;
        };
        let db = Database::connect(&database_url)
            .await
            .expect("connect room E2E test db");
        migration::Migrator::up(&db, None)
            .await
            .expect("migrator up");
        Some(db)
    }

    #[tokio::test]
    async fn concurrent_room_e2e_updates_reuse_key_and_preserve_json_when_db_provided() {
        let Some(db) = test_database().await else {
            return;
        };
        let suffix = uuid::Uuid::new_v4().simple().to_string();
        let room_id = format!("rm_atomic_{suffix}");
        let local_actor = format!("https://local.example/users/{suffix}");
        let room_seed = json!({
            "sentinel": "room",
            "stickers": [{"id": "old"}],
            "e2e": {
                "sentinel": "room-e2e",
                "published_keys": {}
            }
        });
        let member_seed = json!({
            "sentinel": "member",
            "e2e": {"sentinel": "member-e2e"}
        });

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_rooms
                   (room_id, name, owner_actor, home_server, shared_data_config)
               VALUES ($1, $2, $3, $4, $5)"#,
            [
                room_id.clone().into(),
                "Atomic E2E test".into(),
                local_actor.clone().into(),
                "local.example".into(),
                room_seed.into(),
            ],
        ))
        .await
        .expect("insert room");
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_room_members
                   (room_id, actor_url, is_local, role, custom_permissions, membership_status)
               VALUES ($1, $2, true, 'owner', $3, 'active')"#,
            [
                room_id.clone().into(),
                local_actor.clone().into(),
                member_seed.into(),
            ],
        ))
        .await
        .expect("insert member");

        let (first, second) = tokio::join!(
            persist_local_room_e2e_key(&db, &room_id, &local_actor, "test-jwt-secret"),
            persist_local_room_e2e_key(&db, &room_id, &local_actor, "test-jwt-secret"),
        );
        let first = first.expect("first local key persistence");
        let second = second.expect("second local key persistence");
        assert_eq!(first.public_key, second.public_key);
        assert_eq!(first.published_key_count, 1);
        assert_eq!(second.published_key_count, 1);
        assert_ne!(first.already_published, second.already_published);

        let remote_a = format!("https://peer-a.example/users/{suffix}");
        let remote_b = format!("https://peer-b.example/users/{suffix}");
        let remote_a_key = crate::federation::e2e::create_session(&room_id)
            .local_keypair
            .public_key;
        let remote_b_key = crate::federation::e2e::create_session(&room_id)
            .local_keypair
            .public_key;
        let stickers = json!([{
            "id": "new",
            "data": "data:image/png;base64,QQ==",
            "actor": local_actor,
            "created_at": "2026-01-01T00:00:00Z"
        }]);
        let (key_a_count, key_b_count, stickers_updated) = tokio::join!(
            upsert_room_published_key(
                &db,
                &room_id,
                &remote_a,
                &remote_a_key,
                crate::federation::e2e::E2E_ALGORITHM,
            ),
            upsert_room_published_key(
                &db,
                &room_id,
                &remote_b,
                &remote_b_key,
                crate::federation::e2e::E2E_ALGORITHM,
            ),
            replace_room_stickers(&db, &room_id, &stickers),
        );
        let key_a_count = key_a_count
            .expect("upsert peer A key")
            .expect("room exists");
        let key_b_count = key_b_count
            .expect("upsert peer B key")
            .expect("room exists");
        assert!(stickers_updated.expect("replace stickers"));
        assert_eq!(key_a_count.max(key_b_count), 3);

        let room_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "SELECT shared_data_config FROM federation_rooms WHERE room_id = $1",
                [room_id.clone().into()],
            ))
            .await
            .expect("query room")
            .expect("room row");
        let shared = room_row
            .try_get::<Option<serde_json::Value>>("", "shared_data_config")
            .expect("shared_data_config")
            .expect("shared config value");
        assert_eq!(shared.get("sentinel"), Some(&json!("room")));
        assert_eq!(shared.pointer("/e2e/sentinel"), Some(&json!("room-e2e")));
        assert_eq!(shared.get("stickers"), Some(&stickers));
        assert_eq!(
            shared
                .pointer("/e2e/published_keys")
                .and_then(|keys| keys.get(&local_actor)),
            Some(&json!(first.public_key))
        );
        assert_eq!(
            shared
                .pointer("/e2e/published_keys")
                .and_then(|keys| keys.get(&remote_a)),
            Some(&json!(remote_a_key))
        );
        assert_eq!(
            shared
                .pointer("/e2e/published_keys")
                .and_then(|keys| keys.get(&remote_b)),
            Some(&json!(remote_b_key))
        );

        let member_row = db
            .query_one(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                r#"SELECT custom_permissions FROM federation_room_members
                   WHERE room_id = $1 AND actor_url = $2"#,
                [room_id.clone().into(), local_actor.clone().into()],
            ))
            .await
            .expect("query member")
            .expect("member row");
        let permissions = member_row
            .try_get::<Option<serde_json::Value>>("", "custom_permissions")
            .expect("custom_permissions")
            .expect("permissions value");
        assert_eq!(permissions.get("sentinel"), Some(&json!("member")));
        assert_eq!(
            permissions.pointer("/e2e/sentinel"),
            Some(&json!("member-e2e"))
        );
        assert_eq!(
            permissions.pointer("/e2e/local_public_key"),
            Some(&json!(second.public_key))
        );

        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "DELETE FROM federation_room_members WHERE room_id = $1",
            [room_id.clone().into()],
        ))
        .await
        .expect("delete test members");
        db.execute(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "DELETE FROM federation_rooms WHERE room_id = $1",
            [room_id.into()],
        ))
        .await
        .expect("delete test room");
    }
}
