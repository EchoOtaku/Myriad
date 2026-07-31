//! Tapp ownership / install resolution for runtime, agent, and store paths.
//!
//! Lives in services so agent handlers, the scheduler engine, and install
//! namespace selection do not reach through `crate::api::*` for domain checks.
//! HTTP adapters in the API layer map [`TappAccessError`] to Axum responses
//! and re-export pure helpers ([`canonical_installation_owner_id`],
//! [`installation_conflict_owner_ids`], [`find_visible_tapp`],
//! [`lock_tapp_lifecycle`]) for path stability.

use once_cell::sync::Lazy;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection, DbErr, EntityTrait,
    QueryFilter, Statement,
};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use crate::models::entities::tapps;
use crate::services::permission_service::{TappPermission, UserRole};

/// Domain errors for Tapp access / ownership checks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TappAccessError {
    Database,
    NoAdmin,
    AccessDenied { is_guest: bool },
    PermissionNotGranted { permission: String },
}

impl TappAccessError {
    /// Short machine-oriented label (maps to JSON `error` in the API adapter).
    pub fn error_code(&self) -> &'static str {
        match self {
            Self::Database => "Database error",
            Self::NoAdmin => "No admin user found",
            Self::AccessDenied { .. } => "Access denied",
            Self::PermissionNotGranted { .. } => "Permission denied",
        }
    }

    /// Human-readable message suitable for agents and API `message` fields.
    pub fn message(&self) -> String {
        match self {
            Self::Database => "Database error".to_string(),
            Self::NoAdmin => "No admin user found".to_string(),
            Self::AccessDenied { is_guest: true } => {
                "This Tapp is not available for guest access".to_string()
            }
            Self::AccessDenied { is_guest: false } => {
                "You do not have permission to access this Tapp".to_string()
            }
            Self::PermissionNotGranted { permission } => {
                format!("Tapp was not granted '{permission}'")
            }
        }
    }
}

impl std::fmt::Display for TappAccessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for TappAccessError {}

/// Minimal single-value TTL cache (avoids depending on API-layer cache types).
struct SingleCache {
    value: Option<i32>,
    cached_at: Option<Instant>,
    ttl: Duration,
}

impl SingleCache {
    fn new(ttl: Duration) -> Self {
        Self {
            value: None,
            cached_at: None,
            ttl,
        }
    }

    fn get(&self) -> Option<i32> {
        if let (Some(value), Some(cached_at)) = (self.value, self.cached_at) {
            if cached_at.elapsed() < self.ttl {
                return Some(value);
            }
        }
        None
    }

    fn set(&mut self, value: i32) {
        self.value = Some(value);
        self.cached_at = Some(Instant::now());
    }
}

/// Admin / site-owner ID cache (60s TTL).
static ADMIN_ID_CACHE: Lazy<Arc<RwLock<SingleCache>>> =
    Lazy::new(|| Arc::new(RwLock::new(SingleCache::new(Duration::from_secs(60)))));

/// Optional site owner / admin id (cached). Fresh DBs before setup return `Ok(None)`.
pub async fn find_admin_user_id(
    db: &DatabaseConnection,
) -> Result<Option<i32>, TappAccessError> {
    {
        let cache = ADMIN_ID_CACHE.read().await;
        if let Some(id) = cache.get() {
            return Ok(Some(id));
        }
    }

    // Prefer durable site owner; fall back to first admin (legacy / pre-is_owner).
    // Same resolution as `site_owner_user_id`, but optional for pre-setup surfaces.
    let mut result = db
        .query_one(Statement::from_string(
            DatabaseBackend::Postgres,
            "SELECT id FROM users WHERE is_owner = true ORDER BY id ASC LIMIT 1".to_string(),
        ))
        .await
        .map_err(|e| {
            tracing::error!("[TAPP] Database error fetching owner ID: {}", e);
            TappAccessError::Database
        })?;

    if result.is_none() {
        result = db
            .query_one(Statement::from_string(
                DatabaseBackend::Postgres,
                "SELECT id FROM users WHERE is_admin = true ORDER BY id ASC LIMIT 1".to_string(),
            ))
            .await
            .map_err(|e| {
                tracing::error!("[TAPP] Database error fetching admin ID: {}", e);
                TappAccessError::Database
            })?;
    }

    let Some(result) = result else {
        return Ok(None);
    };

    let id = result.try_get::<i32>("", "id").map_err(|e| {
        tracing::error!("[TAPP] Error parsing admin ID: {}", e);
        TappAccessError::Database
    })?;

    {
        let mut cache = ADMIN_ID_CACHE.write().await;
        cache.set(id);
    }

    Ok(Some(id))
}

/// Required site owner / admin id for control-plane paths that need setup complete.
pub async fn get_admin_user_id(db: &DatabaseConnection) -> Result<i32, TappAccessError> {
    find_admin_user_id(db)
        .await?
        .ok_or(TappAccessError::NoAdmin)
}

/// Verify the subject may access the given Tapp install (public owner and/or private copy).
pub async fn verify_tapp_ownership(
    db: &DatabaseConnection,
    user_id: i32,
    tapp_id: &str,
) -> Result<(), TappAccessError> {
    let admin_id = get_admin_user_id(db).await?;
    let is_guest = user_id < 0;
    let mut query = tapps::Entity::find()
        .filter(tapps::Column::TappId.eq(tapp_id))
        .filter(tapps::Column::UserId.eq(admin_id));
    if !is_guest && user_id != admin_id {
        query = tapps::Entity::find()
            .filter(tapps::Column::TappId.eq(tapp_id))
            .filter(
                tapps::Column::UserId
                    .eq(admin_id)
                    .or(tapps::Column::UserId.eq(user_id)),
            );
    }
    let tapp = query.one(db).await.map_err(|e| {
        tracing::error!("[TAPP] Database error in ownership verification: {}", e);
        TappAccessError::Database
    })?;

    if tapp.is_none() {
        return Err(TappAccessError::AccessDenied { is_guest });
    }

    Ok(())
}

/// Resolve the install record used to execute a Tapp for this subject.
///
/// Private install wins over site-owner public install when both exist.
pub async fn resolve_accessible_tapp(
    db: &DatabaseConnection,
    user_id: i32,
    tapp_id: &str,
) -> Result<tapps::Model, TappAccessError> {
    let admin_id = get_admin_user_id(db).await?;
    let mut owner_ids = vec![admin_id];
    if user_id >= 0 && user_id != admin_id {
        owner_ids.push(user_id);
    }
    let mut candidates = tapps::Entity::find()
        .filter(tapps::Column::TappId.eq(tapp_id))
        .filter(tapps::Column::UserId.is_in(owner_ids))
        .all(db)
        .await
        .map_err(|error| {
            tracing::error!(%error, "[TAPP] Failed to resolve accessible Tapp");
            TappAccessError::Database
        })?;
    candidates.sort_by_key(|tapp| tapp_owner_priority(tapp.user_id, user_id, admin_id));
    candidates
        .into_iter()
        .next()
        .ok_or(TappAccessError::AccessDenied {
            is_guest: user_id < 0,
        })
}

/// Verify the resolved install was granted each listed permission.
pub async fn verify_tapp_approved_permissions(
    db: &DatabaseConnection,
    user_id: i32,
    tapp_id: &str,
    permissions: &[TappPermission],
) -> Result<(), TappAccessError> {
    let tapp = resolve_accessible_tapp(db, user_id, tapp_id).await?;
    let approved_permissions = tapp
        .approved_permissions
        .as_array()
        .cloned()
        .unwrap_or_default();
    let missing_permission = permissions.iter().find(|permission| {
        !approved_permissions
            .iter()
            .any(|value| value.as_str() == Some(permission.as_str()))
    });
    if let Some(permission) = missing_permission {
        return Err(TappAccessError::PermissionNotGranted {
            permission: permission.as_str().to_string(),
        });
    }
    Ok(())
}

/// Priority for install selection: 0 = subject's private, 1 = site admin public, 2 = other.
pub fn tapp_owner_priority(owner_id: i32, user_id: i32, admin_id: i32) -> u8 {
    if user_id >= 0 && owner_id == user_id {
        0
    } else if owner_id == admin_id {
        1
    } else {
        2
    }
}

/// Canonical install-owner namespace for a new or updated installation.
///
/// Admins always operate the site-owner public namespace (`site_owner_id`);
/// users and guests write under their own actor id (private install).
pub fn canonical_installation_owner_id(
    role: UserRole,
    actor_id: i32,
    site_owner_id: i32,
) -> i32 {
    if role == UserRole::Admin {
        site_owner_id
    } else {
        actor_id
    }
}

/// Owner namespaces that block a new install for this actor/role.
///
/// Public and private installations may coexist. Each actor conflicts only
/// with the namespace they are allowed to mutate, preventing a private user
/// from reserving an ID and blocking a later site-owner publication.
/// Guest: cannot install in practice; still scoped to the actor id only.
pub fn installation_conflict_owner_ids(
    role: UserRole,
    actor_id: i32,
    site_owner_id: i32,
) -> Vec<i32> {
    match role {
        UserRole::Admin => vec![site_owner_id],
        UserRole::User | UserRole::Guest => vec![actor_id],
    }
}

/// Parse a JWT `sub` claim into an authenticated non-guest user id.
///
/// Guests (`sub < 0`), missing, and non-numeric subjects yield `None`.
pub fn parse_authenticated_subject_id(sub: &str) -> Option<i32> {
    sub.parse::<i32>().ok().filter(|user_id| *user_id >= 0)
}

/// Private-install owner id to query before falling back to the public install.
///
/// Returns `None` for guests, unauthenticated callers, or when the subject is
/// already the site owner (public namespace is authoritative for them).
pub fn private_install_lookup_user_id(
    user_id: Option<i32>,
    site_owner_id: Option<i32>,
) -> Option<i32> {
    user_id.filter(|user_id| Some(*user_id) != site_owner_id)
}

/// One public-route lookup result for details, code, resources and export.
///
/// When the authenticated subject has a private install of the same `tapp_id`,
/// that record wins so list/detail/runtime open the personal copy. Otherwise
/// fall back to the site-owner public install. Guests only see public installs.
/// A fresh database has no site owner yet and therefore returns `None`.
#[derive(Debug, Clone)]
pub struct VisibleTappInstallation {
    pub tapp: tapps::Model,
    pub is_site_owner: bool,
}

impl VisibleTappInstallation {
    pub fn private(tapp: tapps::Model) -> Self {
        Self {
            tapp,
            is_site_owner: false,
        }
    }

    pub fn public(tapp: tapps::Model) -> Self {
        Self {
            tapp,
            is_site_owner: true,
        }
    }
}

/// Resolve the install visible on public store/code routes for this subject.
///
/// Callers must validate `tapp_id` shape at the HTTP edge (BAD_REQUEST). This
/// function only performs ownership-scoped DB lookups.
pub async fn find_visible_tapp(
    db: &DatabaseConnection,
    user_id: Option<i32>,
    tapp_id: &str,
) -> Result<Option<VisibleTappInstallation>, TappAccessError> {
    let site_owner_id = find_admin_user_id(db).await?;

    // Prefer the subject's private install when both private and public copies exist.
    if let Some(private_user_id) = private_install_lookup_user_id(user_id, site_owner_id) {
        let tapp = tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(private_user_id))
            .filter(tapps::Column::TappId.eq(tapp_id))
            .one(db)
            .await
            .map_err(|e| {
                tracing::error!(%e, "[TAPP] Database error in find_visible_tapp (private)");
                TappAccessError::Database
            })?;
        if let Some(tapp) = tapp {
            return Ok(Some(VisibleTappInstallation::private(tapp)));
        }
    }

    if let Some(site_owner_id) = site_owner_id {
        let public_tapp = tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(site_owner_id))
            .filter(tapps::Column::TappId.eq(tapp_id))
            .one(db)
            .await
            .map_err(|e| {
                tracing::error!(%e, "[TAPP] Database error in find_visible_tapp (public)");
                TappAccessError::Database
            })?;
        if let Some(tapp) = public_tapp {
            return Ok(Some(VisibleTappInstallation::public(tapp)));
        }
    }

    Ok(None)
}

/// Advisory lock key for lifecycle mutations on one public Tapp ID.
pub fn tapp_lifecycle_lock_key(tapp_id: &str) -> String {
    format!("tapp-lifecycle:{tapp_id}")
}

/// Serialize every live-path or ownership mutation for one public Tapp ID.
///
/// The lock is global across owner namespaces so admin public installs and user
/// private installs of the same ID cannot race their conflict checks across replicas.
pub async fn lock_tapp_lifecycle(
    db: &impl ConnectionTrait,
    tapp_id: &str,
) -> Result<(), DbErr> {
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        vec![tapp_lifecycle_lock_key(tapp_id).into()],
    ))
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_installation_owner_id, installation_conflict_owner_ids,
        parse_authenticated_subject_id, private_install_lookup_user_id, tapp_lifecycle_lock_key,
        tapp_owner_priority,
    };
    use crate::services::permission_service::UserRole;

    #[test]
    fn private_install_precedes_same_id_admin_tapp() {
        assert_eq!(tapp_owner_priority(42, 42, 1), 0);
        assert_eq!(tapp_owner_priority(1, 42, 1), 1);
        assert_eq!(tapp_owner_priority(99, 42, 1), 2);
        assert_eq!(tapp_owner_priority(1, -1, 1), 1);
        assert_eq!(tapp_owner_priority(99, -1, 1), 2);
    }

    #[test]
    fn every_admin_operates_the_canonical_public_owner_namespace() {
        assert_eq!(canonical_installation_owner_id(UserRole::Admin, 9, 1), 1);
        assert_eq!(canonical_installation_owner_id(UserRole::User, 9, 1), 9);
        assert_eq!(canonical_installation_owner_id(UserRole::Guest, -9, 1), -9);
    }

    #[test]
    fn public_and_private_installations_only_conflict_with_their_own_namespace() {
        // Publishing cannot be blocked by another user's private copy.
        assert_eq!(
            installation_conflict_owner_ids(UserRole::Admin, 9, 1),
            vec![1]
        );
        assert_eq!(
            installation_conflict_owner_ids(UserRole::User, 42, 1),
            vec![42]
        );
        assert_eq!(
            installation_conflict_owner_ids(UserRole::Guest, -5, 1),
            vec![-5]
        );
    }

    #[test]
    fn authenticated_subject_id_rejects_guests_and_junk() {
        assert_eq!(parse_authenticated_subject_id("42"), Some(42));
        assert_eq!(parse_authenticated_subject_id("0"), Some(0));
        assert_eq!(parse_authenticated_subject_id("-1"), None);
        assert_eq!(parse_authenticated_subject_id("guest"), None);
        assert_eq!(parse_authenticated_subject_id(""), None);
    }

    #[test]
    fn private_install_lookup_skips_site_owner_and_guests() {
        assert_eq!(
            private_install_lookup_user_id(Some(42), Some(1)),
            Some(42)
        );
        // Site owner reads public namespace only (no private self-query branch).
        assert_eq!(private_install_lookup_user_id(Some(1), Some(1)), None);
        assert_eq!(private_install_lookup_user_id(None, Some(1)), None);
        // Pre-setup: no site owner yet — authenticated subject still may have private.
        assert_eq!(
            private_install_lookup_user_id(Some(42), None),
            Some(42)
        );
    }

    #[test]
    fn lifecycle_lock_key_is_id_scoped() {
        assert_eq!(
            tapp_lifecycle_lock_key("demo.clock"),
            "tapp-lifecycle:demo.clock"
        );
    }
}
