//! 联邦 Actor 端点（Layer 2）
//!
//! 本地用户的 ActivityPub Actor 表示，以及远程 Actor 获取/缓存。

use axum::{extract::Path, http::StatusCode, Json};
use sea_orm::{ConnectionTrait, DatabaseBackend, DatabaseConnection, Statement};
use serde::Serialize;
use serde_json::json;

use crate::federation::types::*;

/// GET /users/{username}
///
/// 返回本地用户的 AP Actor 对象
/// Accept: application/activity+json 时返回 AP JSON
pub async fn get_actor(
    Path(username): Path<String>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let db = get_db()
        .await
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e}))))?;

    let base_url = get_base_url().await;

    // 查询用户 + 联邦密钥
    let user = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT u.id, u.username, u.display_name, u.avatar_url, u.bio,
                      fk.public_key_pem, fk.key_id
               FROM users u
               LEFT JOIN federation_keys fk ON fk.user_id = u.id
               WHERE u.username = $1
               LIMIT 1"#,
            [username.clone().into()],
        ))
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({"error": "Database query failed"})),
            )
        })?;

    let row = user.ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "User not found"})),
        )
    })?;

    let user_id: i32 = row.try_get("", "id").map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error": "Failed to read user ID"})),
        )
    })?;
    let display_name: Option<String> = row.try_get("", "display_name").ok();
    let avatar_url: Option<String> = row.try_get("", "avatar_url").ok();
    let bio: Option<String> = row.try_get("", "bio").ok();
    let public_key_pem: Option<String> = row.try_get("", "public_key_pem").ok();
    let fetched_key_id: Option<String> = row.try_get("", "key_id").ok();

    // 如果用户还没有联邦密钥，自动生成
    let (pub_key, kid) = match (public_key_pem, fetched_key_id) {
        (Some(pk), Some(ki)) => (pk, ki),
        _ => {
            // 自动为该用户生成密钥对
            generate_and_store_keys(&db, user_id, &base_url, &username)
                .await
                .map_err(|e| {
                    tracing::error!(
                        "Failed to generate federation keys for user {}: {}",
                        username,
                        e
                    );
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(json!({"error": "Failed to initialize federation identity"})),
                    )
                })?
        }
    };

    let actor_id = actor_url(&base_url, &username);
    let actor = Actor {
        context: build_context(),
        actor_type: "Person".to_string(),
        id: actor_id.clone(),
        preferred_username: username.clone(),
        name: display_name,
        summary: bio,
        url: Some(format!("{}/profile/{}", get_frontend_url().await, username)),
        inbox: inbox_url(&base_url, &username),
        outbox: outbox_url(&base_url, &username),
        followers: followers_url(&base_url, &username),
        following: following_url(&base_url, &username),
        public_key: ActorPublicKey {
            id: kid,
            owner: actor_id,
            public_key_pem: pub_key,
        },
        icon: avatar_url.map(|url| MediaObject {
            media_type: "Image".to_string(),
            mime_type: Some("image/png".to_string()),
            url,
        }),
        image: None,
        mfp_instance_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        mfp_tapp_capabilities: None,
        mfp_channels_url: Some(format!("{}/users/{}/channels", base_url, username)),
    };

    Ok((StatusCode::OK, Json(serde_json::to_value(actor).unwrap())))
}

/// GET /users/{username}/followers
///
/// Followers Collection
pub async fn get_followers(
    Path(username): Path<String>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let db = get_db()
        .await
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e}))))?;
    let base_url = get_base_url().await;

    // 验证用户存在
    let user = get_local_user(&db, &username).await?;
    let user_id: i32 = user.0;

    // 查询 follower 数量
    let count = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT COUNT(*) as count FROM federation_follows WHERE user_id = $1 AND direction = 'incoming' AND status = 'accepted'",
            [user_id.into()],
        ))
        .await
        .map_err(db_err)?
        .map(|r| r.try_get::<i64>("", "count").unwrap_or(0) as u64)
        .unwrap_or(0);

    let collection = OrderedCollection {
        context: build_ap_context(),
        collection_type: "OrderedCollection".to_string(),
        id: followers_url(&base_url, &username),
        total_items: count,
        first: if count > 0 {
            Some(format!("{}/users/{}/followers?page=1", base_url, username))
        } else {
            None
        },
        last: None,
    };

    Ok((
        StatusCode::OK,
        Json(serde_json::to_value(collection).unwrap()),
    ))
}

/// GET /users/{username}/following
///
/// Following Collection
pub async fn get_following(
    Path(username): Path<String>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<serde_json::Value>)> {
    let db = get_db()
        .await
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error": e}))))?;
    let base_url = get_base_url().await;

    let user = get_local_user(&db, &username).await?;
    let user_id: i32 = user.0;

    let count = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT COUNT(*) as count FROM federation_follows WHERE user_id = $1 AND direction = 'outgoing' AND status = 'accepted'",
            [user_id.into()],
        ))
        .await
        .map_err(db_err)?
        .map(|r| r.try_get::<i64>("", "count").unwrap_or(0) as u64)
        .unwrap_or(0);

    let collection = OrderedCollection {
        context: build_ap_context(),
        collection_type: "OrderedCollection".to_string(),
        id: following_url(&base_url, &username),
        total_items: count,
        first: if count > 0 {
            Some(format!("{}/users/{}/following?page=1", base_url, username))
        } else {
            None
        },
        last: None,
    };

    Ok((
        StatusCode::OK,
        Json(serde_json::to_value(collection).unwrap()),
    ))
}

/// 获取远程 Actor 信息（带缓存）
///
/// 如果缓存过期（>24h），重新从远程获取
pub async fn fetch_remote_actor(
    db: &DatabaseConnection,
    actor_url_str: &str,
) -> Result<RemoteActorInfo, String> {
    // 先查本地缓存
    let cached = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"SELECT id, actor_url, username, domain, display_name, avatar_url,
                      inbox_url, public_key_pem, public_key_id, mfp_version, last_fetched_at
               FROM federation_remote_actors
               WHERE actor_url = $1
               LIMIT 1"#,
            [actor_url_str.into()],
        ))
        .await
        .map_err(|e| format!("DB error: {}", e))?;

    if let Some(row) = cached {
        let last_fetched: Option<chrono::DateTime<chrono::FixedOffset>> =
            row.try_get("", "last_fetched_at").ok();
        let is_fresh = last_fetched
            .map(|t| chrono::Utc::now().signed_duration_since(t).num_hours() < 24)
            .unwrap_or(false);

        if is_fresh {
            return Ok(RemoteActorInfo {
                id: row.try_get("", "id").unwrap_or(0),
                actor_url: row.try_get("", "actor_url").unwrap_or_default(),
                username: row.try_get("", "username").ok(),
                domain: row.try_get("", "domain").unwrap_or_default(),
                display_name: row.try_get("", "display_name").ok(),
                inbox_url: row.try_get("", "inbox_url").unwrap_or_default(),
                public_key_pem: row.try_get("", "public_key_pem").ok(),
                public_key_id: row.try_get("", "public_key_id").ok(),
                mfp_version: row.try_get("", "mfp_version").ok(),
            });
        }
    }

    // 从远程获取 Actor JSON
    // SSRF 防护：阻止请求内网地址
    if is_internal_url(actor_url_str) {
        return Err(format!("Refused to fetch internal URL: {}", actor_url_str));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent(format!(
            "Myriad/{} (+{})",
            env!("CARGO_PKG_VERSION"),
            get_base_url().await
        ))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client
        .get(actor_url_str)
        .header("Accept", AP_CONTENT_TYPE)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch remote actor: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Remote actor returned status {}", resp.status()));
    }

    let actor_json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse actor JSON: {}", e))?;

    // 提取关键字段
    let domain = extract_domain(actor_url_str).unwrap_or_default();
    let username_val = actor_json["preferredUsername"]
        .as_str()
        .map(|s| s.to_string());
    let display_name = actor_json["name"].as_str().map(|s| s.to_string());
    let avatar_url = actor_json["icon"]["url"].as_str().map(|s| s.to_string());
    let summary = actor_json["summary"].as_str().map(|s| s.to_string());
    let remote_inbox = actor_json["inbox"].as_str().unwrap_or("").to_string();
    let outbox = actor_json["outbox"].as_str().map(|s| s.to_string());
    let shared_inbox = actor_json["endpoints"]["sharedInbox"]
        .as_str()
        .map(|s| s.to_string());

    // 验证 inbox URL 不指向内网（防止 SSRF 通过伪造 inbox）
    if !remote_inbox.is_empty() && is_internal_url(&remote_inbox) {
        return Err(format!(
            "Remote actor inbox points to internal URL: {}",
            remote_inbox
        ));
    }
    if let Some(ref si) = shared_inbox {
        if is_internal_url(si) {
            return Err(format!(
                "Remote actor shared inbox points to internal URL: {}",
                si
            ));
        }
    }
    let pk_pem = actor_json["publicKey"]["publicKeyPem"]
        .as_str()
        .map(|s| s.to_string());
    let pk_id = actor_json["publicKey"]["id"]
        .as_str()
        .map(|s| s.to_string());
    let mfp_ver = actor_json["myriad:instanceVersion"]
        .as_str()
        .map(|s| s.to_string());

    // Upsert 到缓存
    let actor_id = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            r#"INSERT INTO federation_remote_actors
                   (actor_url, username, domain, display_name, avatar_url, summary,
                    inbox_url, outbox_url, shared_inbox_url,
                    public_key_pem, public_key_id, mfp_version,
                    last_fetched_at, created_at, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW(), NOW())
               ON CONFLICT (actor_url) DO UPDATE SET
                   username = $2, display_name = $4, avatar_url = $5, summary = $6,
                   inbox_url = $7, outbox_url = $8, shared_inbox_url = $9,
                   public_key_pem = $10, public_key_id = $11, mfp_version = $12,
                   last_fetched_at = NOW(), updated_at = NOW()
               RETURNING id"#,
            [
                actor_url_str.into(),
                username_val.clone().into(),
                domain.clone().into(),
                display_name.clone().into(),
                avatar_url.into(),
                summary.into(),
                remote_inbox.clone().into(),
                outbox.into(),
                shared_inbox.into(),
                pk_pem.clone().into(),
                pk_id.clone().into(),
                mfp_ver.clone().into(),
            ],
        ))
        .await
        .map_err(|e| format!("Failed to cache remote actor: {}", e))?
        .map(|r| r.try_get::<i32>("", "id").unwrap_or(0))
        .unwrap_or(0);

    // 同时更新/创建实例记录
    let _ = upsert_instance(db, &domain, mfp_ver.as_deref()).await;

    Ok(RemoteActorInfo {
        id: actor_id,
        actor_url: actor_url_str.to_string(),
        username: username_val,
        domain,
        display_name,
        inbox_url: remote_inbox,
        public_key_pem: pk_pem,
        public_key_id: pk_id,
        mfp_version: mfp_ver,
    })
}

/// 远程 Actor 简要信息
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct RemoteActorInfo {
    pub id: i32,
    pub actor_url: String,
    pub username: Option<String>,
    pub domain: String,
    pub display_name: Option<String>,
    pub inbox_url: String,
    pub public_key_pem: Option<String>,
    pub public_key_id: Option<String>,
    pub mfp_version: Option<String>,
}

/// 本地登录用户的联邦身份摘要。
#[derive(Debug, Clone, Serialize)]
pub struct LocalFederationIdentity {
    pub username: String,
    pub domain: String,
    pub handle: String,
    pub acct: String,
    pub webfinger_resource: String,
    pub actor_url: String,
    pub inbox_url: String,
    pub outbox_url: String,
    pub followers_url: String,
    pub following_url: String,
    pub profile_url: String,
}

/// 构造当前用户可分享给远端的联邦身份。
pub async fn get_local_identity(username: &str) -> LocalFederationIdentity {
    let base_url = get_base_url().await;
    let frontend_url = get_frontend_url().await;
    let domain = extract_domain(&base_url).unwrap_or_else(|| base_url.clone());
    let acct = format!("{}@{}", username, domain);

    LocalFederationIdentity {
        username: username.to_string(),
        domain: domain.clone(),
        handle: format!("@{}", acct),
        acct: acct.clone(),
        webfinger_resource: format!("acct:{}", acct),
        actor_url: actor_url(&base_url, username),
        inbox_url: inbox_url(&base_url, username),
        outbox_url: outbox_url(&base_url, username),
        followers_url: followers_url(&base_url, username),
        following_url: following_url(&base_url, username),
        profile_url: format!("{}/profile/{}", frontend_url, username),
    }
}

// ==================== 辅助函数 ====================

/// 为用户生成联邦密钥并存库
async fn generate_and_store_keys(
    db: &DatabaseConnection,
    user_id: i32,
    base_url: &str,
    username: &str,
) -> Result<(String, String), String> {
    let keypair = crate::federation::keys::KeyPair::generate()
        .map_err(|e| format!("Key generation failed: {}", e))?;

    let pub_pem = keypair
        .public_key_pem()
        .map_err(|e| format!("PEM encoding failed: {}", e))?;

    let jwt_secret = {
        let config = crate::GLOBAL_CONFIG.read().await;
        config.jwt_secret.clone()
    };

    let encrypted = keypair
        .encrypt_private_key(&jwt_secret)
        .map_err(|e| format!("Key encryption failed: {}", e))?;

    let kid = key_id(base_url, username);

    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_keys (user_id, public_key_pem, private_key_encrypted, key_id, algorithm, created_at)
           VALUES ($1, $2, $3, $4, 'RSA-SHA256', NOW())
           ON CONFLICT (user_id) DO UPDATE SET
               public_key_pem = $2, private_key_encrypted = $3, key_id = $4, rotated_at = NOW()"#,
        [
            user_id.into(),
            pub_pem.clone().into(),
            encrypted.into(),
            kid.clone().into(),
        ],
    ))
    .await
    .map_err(|e| format!("Failed to store keys: {}", e))?;

    Ok((pub_pem, kid))
}

/// Upsert 实例信息
async fn upsert_instance(
    db: &DatabaseConnection,
    domain: &str,
    mfp_version: Option<&str>,
) -> Result<(), String> {
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO federation_instances (domain, mfp_version, trust_level, last_seen_at, created_at)
           VALUES ($1, $2, 1, NOW(), NOW())
           ON CONFLICT (domain) DO UPDATE SET
               mfp_version = COALESCE($2, federation_instances.mfp_version),
               last_seen_at = NOW(), updated_at = NOW()"#,
        [domain.into(), mfp_version.into()],
    ))
    .await
    .map_err(|e| format!("Failed to upsert instance: {}", e))?;
    Ok(())
}

/// 获取本地用户 (id, username)
async fn get_local_user(
    db: &DatabaseConnection,
    username: &str,
) -> Result<(i32, String), (StatusCode, Json<serde_json::Value>)> {
    let row = db
        .query_one(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT id, username FROM users WHERE username = $1 LIMIT 1",
            [username.into()],
        ))
        .await
        .map_err(db_err)?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error": "User not found"})),
            )
        })?;

    Ok((
        row.try_get("", "id").unwrap_or(0),
        row.try_get("", "username").unwrap_or_default(),
    ))
}

async fn get_base_url() -> String {
    let config = crate::GLOBAL_CONFIG.read().await;
    config
        .base_url
        .clone()
        .unwrap_or_else(|| format!("http://{}:{}", config.server_host, config.server_port))
}

async fn get_frontend_url() -> String {
    let config = crate::GLOBAL_CONFIG.read().await;
    config.frontend_url.clone().unwrap_or_else(|| {
        config
            .base_url
            .clone()
            .unwrap_or_else(|| format!("http://{}:{}", config.server_host, config.server_port))
    })
}

async fn get_db() -> Result<DatabaseConnection, String> {
    let db_opt = crate::DB_CONNECTION.read().await;
    db_opt
        .clone()
        .ok_or_else(|| "Database not connected".to_string())
}
