//! Subject-private Tapp sandbox storage (validators + DB IO).
//!
//! Domain helpers for scheduler / agent paths that must not import
//! `crate::api::tapp_store`. HTTP handlers map [`TappStorageError`] to status codes.

use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection, EntityTrait,
    FromQueryResult, QueryFilter, Statement, TransactionTrait,
};
use serde_json::Value;

use crate::models::entities::tapp_storage;

/// Per-install soft quota for sandbox + host-managed keys combined.
pub const TAPP_STORAGE_QUOTA_BYTES: i64 = 5 * 1024 * 1024;

const HOST_STORAGE_KEY_PREFIXES: [&str; 4] =
    ["_settings.", "_component:", "_shortcut:", "_report:"];

/// Domain errors for storage validation and IO.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TappStorageError {
    InvalidKey(&'static str),
    Database,
    TooLarge,
}

impl TappStorageError {
    pub fn message(&self) -> String {
        match self {
            Self::InvalidKey(reason) => (*reason).to_string(),
            Self::Database => "Database error".to_string(),
            Self::TooLarge => "Storage value or quota exceeded".to_string(),
        }
    }
}

impl std::fmt::Display for TappStorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message())
    }
}

impl std::error::Error for TappStorageError {}

// ============ Storage access identities (install owner vs subject) ============

/// Resolve the two storage identities attached to a Tapp runtime.
///
/// Sandbox storage belongs to the current subject. Installation settings and
/// host-managed resources remain attached to the installation owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TappStorageAccess {
    pub owner_id: i32,
    pub subject_id: i32,
}

/// Domain errors for storage access resolution / installation writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TappStorageAccessError {
    /// JWT subject missing or not a positive authenticated user.
    Unauthenticated,
    /// Runtime grant subject does not match the authenticated subject.
    SubjectMismatch,
    /// Subject may read the install but cannot mutate host-managed resources.
    InstallationReadOnly,
}

impl TappStorageAccessError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Unauthenticated => "TAPP_STORAGE_UNAUTHENTICATED",
            Self::SubjectMismatch => "TAPP_STORAGE_SUBJECT_MISMATCH",
            Self::InstallationReadOnly => "TAPP_INSTALLATION_READ_ONLY",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            Self::Unauthenticated => "Authentication required for storage access",
            Self::SubjectMismatch => "Invalid runtime grant subject",
            Self::InstallationReadOnly => "Only the installation owner can modify this resource",
        }
    }

    pub fn status_hint(&self) -> u16 {
        match self {
            Self::Unauthenticated => 401,
            Self::SubjectMismatch | Self::InstallationReadOnly => 403,
        }
    }
}

impl std::fmt::Display for TappStorageAccessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

impl std::error::Error for TappStorageAccessError {}

impl TappStorageAccess {
    pub fn from_owner_and_subject(owner_id: i32, subject_id: i32) -> Self {
        Self {
            owner_id,
            subject_id,
        }
    }

    /// Build access from a validated runtime grant + authenticated subject id.
    ///
    /// `claims_subject_id` should be the JWT subject when authenticated and
    /// non-guest (`>= 0`). Guests and missing subjects yield
    /// [`TappStorageAccessError::Unauthenticated`].
    pub fn from_grant_and_subject(
        grant_owner_id: i32,
        grant_subject_id: i32,
        claims_subject_id: Option<i32>,
    ) -> Result<Self, TappStorageAccessError> {
        let subject_id = claims_subject_id.ok_or(TappStorageAccessError::Unauthenticated)?;
        if grant_subject_id != subject_id {
            return Err(TappStorageAccessError::SubjectMismatch);
        }
        Ok(Self::from_owner_and_subject(grant_owner_id, subject_id))
    }

    pub fn can_manage_installation(self) -> bool {
        self.subject_id == self.owner_id
    }

    pub fn require_installation_write(self) -> Result<(), TappStorageAccessError> {
        if self.can_manage_installation() {
            Ok(())
        } else {
            Err(TappStorageAccessError::InstallationReadOnly)
        }
    }

    pub fn installation_namespace(self) -> i32 {
        self.owner_id
    }

    pub fn private_storage_namespace(self) -> i32 {
        self.subject_id
    }
}

/// Installation settings may be written by the install owner or a current admin.
pub fn can_write_installation_settings(access: TappStorageAccess, is_admin: bool) -> bool {
    is_admin || access.can_manage_installation()
}

pub fn validate_storage_key(key: &str) -> Result<(), &'static str> {
    if key.is_empty() {
        return Err("Key cannot be empty");
    }
    if key.len() > 256 {
        return Err("Key too long (max 256 characters)");
    }
    if key.starts_with('.') || key.ends_with('.') {
        return Err("Key cannot start or end with a dot");
    }
    if key.contains("..") {
        return Err("Key cannot contain consecutive dots");
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':'))
    {
        return Err(
            "Key contains invalid characters (only alphanumeric, underscore, hyphen, dot, colon allowed)",
        );
    }
    Ok(())
}

pub fn is_host_storage_key(key: &str) -> bool {
    key == "_settings"
        || HOST_STORAGE_KEY_PREFIXES
            .iter()
            .any(|prefix| key.starts_with(prefix))
}

/// Path segments that collide with fixed `/storage/{segment}` routes.
/// Sandbox keys must not equal these exact strings.
const RESERVED_STORAGE_ROUTE_KEYS: &[&str] = &["entries", "usage"];

pub fn is_reserved_storage_route_key(key: &str) -> bool {
    RESERVED_STORAGE_ROUTE_KEYS.contains(&key)
}

pub fn validate_sandbox_storage_key(key: &str) -> Result<(), &'static str> {
    validate_storage_key(key)?;
    if is_host_storage_key(key) {
        return Err("Key prefix is reserved for host-managed Tapp data");
    }
    if is_reserved_storage_route_key(key) {
        return Err(
            "Key is reserved for storage API routes (entries, usage); choose another name",
        );
    }
    Ok(())
}

pub fn validate_storage_value_size(value: &Value) -> Result<(), TappStorageError> {
    let size = serde_json::to_vec(value)
        .map_err(|_| TappStorageError::InvalidKey("Value is not serializable JSON"))?
        .len();
    if size > 1024 * 1024 {
        return Err(TappStorageError::TooLarge);
    }
    Ok(())
}

#[derive(FromQueryResult)]
struct StorageBytesRow {
    bytes: i64,
}

pub async fn storage_bytes(
    db: &impl ConnectionTrait,
    user_id: i32,
    tapp_id: &str,
) -> Result<i64, TappStorageError> {
    StorageBytesRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"SELECT COALESCE(SUM(octet_length(key) + octet_length(value::text)), 0)::BIGINT AS bytes
           FROM tapp_storage WHERE user_id = $1 AND tapp_id = $2"#,
        vec![user_id.into(), tapp_id.into()],
    ))
    .one(db)
    .await
    .map_err(|_| TappStorageError::Database)
    .map(|row| row.map_or(0, |row| row.bytes))
}

pub async fn read_storage_value(
    db: &DatabaseConnection,
    user_id: i32,
    tapp_id: &str,
    key: &str,
) -> Result<Value, TappStorageError> {
    let item = tapp_storage::Entity::find()
        .filter(tapp_storage::Column::UserId.eq(user_id))
        .filter(tapp_storage::Column::TappId.eq(tapp_id))
        .filter(tapp_storage::Column::Key.eq(key))
        .one(db)
        .await
        .map_err(|_| TappStorageError::Database)?;
    Ok(item.map_or(Value::Null, |item| item.value))
}

pub async fn write_storage_value(
    db: &DatabaseConnection,
    user_id: i32,
    tapp_id: &str,
    key: &str,
    value: Value,
) -> Result<(), TappStorageError> {
    let txn = db
        .begin()
        .await
        .map_err(|_| TappStorageError::Database)?;
    txn.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        vec![format!("tapp-storage:{user_id}:{tapp_id}").into()],
    ))
    .await
    .map_err(|_| TappStorageError::Database)?;

    #[derive(FromQueryResult)]
    struct ProjectedBytesRow {
        bytes: i64,
    }
    let projected = ProjectedBytesRow::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
SELECT (
    COALESCE(SUM(octet_length(key) + octet_length(value::text))
        FILTER (WHERE key <> $3), 0)
    + octet_length($3)
    + octet_length($4::jsonb::text)
)::BIGINT AS bytes
FROM tapp_storage
WHERE user_id = $1 AND tapp_id = $2
"#,
        vec![
            user_id.into(),
            tapp_id.into(),
            key.into(),
            value.clone().into(),
        ],
    ))
    .one(&txn)
    .await
    .map_err(|_| TappStorageError::Database)?
    .map_or(i64::MAX, |row| row.bytes);
    if projected > TAPP_STORAGE_QUOTA_BYTES {
        txn.rollback().await.ok();
        return Err(TappStorageError::TooLarge);
    }
    txn.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
INSERT INTO tapp_storage (tapp_id, user_id, key, value, created_at, updated_at)
VALUES ($1, $2, $3, $4, NOW(), NOW())
ON CONFLICT (user_id, tapp_id, key) DO UPDATE SET
    value = EXCLUDED.value,
    updated_at = NOW()
"#,
        vec![tapp_id.into(), user_id.into(), key.into(), value.into()],
    ))
    .await
    .map_err(|_| TappStorageError::Database)?;
    txn.commit()
        .await
        .map_err(|_| TappStorageError::Database)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        can_write_installation_settings, is_host_storage_key, validate_sandbox_storage_key,
        validate_storage_key, validate_storage_value_size, TappStorageAccess,
        TappStorageAccessError,
    };
    use serde_json::json;

    #[test]
    fn sandbox_keys_reject_host_prefixes() {
        for key in [
            "_settings",
            "_settings.theme",
            "_component:x",
            "_shortcut:y",
            "_report:z",
        ] {
            assert!(validate_sandbox_storage_key(key).is_err(), "{key}");
            assert!(is_host_storage_key(key));
        }
        assert!(validate_sandbox_storage_key("user.preferences").is_ok());
        assert!(validate_storage_key("user.preferences").is_ok());
    }

    #[test]
    fn sandbox_keys_reject_route_reserved_names() {
        use super::is_reserved_storage_route_key;
        assert!(is_reserved_storage_route_key("entries"));
        assert!(is_reserved_storage_route_key("usage"));
        assert!(!is_reserved_storage_route_key("entries.v1"));
        assert!(!is_reserved_storage_route_key("my-usage"));
        for key in ["entries", "usage"] {
            let err = validate_sandbox_storage_key(key).expect_err(key);
            assert!(
                err.to_ascii_lowercase().contains("reserved"),
                "key={key} err={err}"
            );
        }
        assert!(validate_sandbox_storage_key("entries.v1").is_ok());
        assert!(validate_sandbox_storage_key("usage_stats").is_ok());
    }

    #[test]
    fn value_size_rejects_over_1mib() {
        let big = json!("x".repeat(1024 * 1024 + 8));
        assert!(validate_storage_value_size(&big).is_err());
        assert!(validate_storage_value_size(&json!({"ok": true})).is_ok());
    }

    #[test]
    fn private_storage_follows_subject_while_settings_follow_installation() {
        let viewer_of_admin = TappStorageAccess::from_owner_and_subject(1, 42);
        let second_viewer = TappStorageAccess::from_owner_and_subject(1, 43);
        assert_eq!(viewer_of_admin.private_storage_namespace(), 42);
        assert_eq!(second_viewer.private_storage_namespace(), 43);
        assert_eq!(viewer_of_admin.installation_namespace(), 1);
        assert_eq!(second_viewer.installation_namespace(), 1);
        assert!(!viewer_of_admin.can_manage_installation());
        assert!(viewer_of_admin.require_installation_write().is_err());

        let private_owner = TappStorageAccess::from_owner_and_subject(42, 42);
        assert_eq!(private_owner.private_storage_namespace(), 42);
        assert_eq!(private_owner.installation_namespace(), 42);
        assert!(private_owner.can_manage_installation());
        assert!(private_owner.require_installation_write().is_ok());

        let site_owner = TappStorageAccess::from_owner_and_subject(1, 1);
        assert_eq!(site_owner.private_storage_namespace(), 1);
        assert_eq!(site_owner.installation_namespace(), 1);
        assert!(site_owner.can_manage_installation());
    }

    #[test]
    fn installation_settings_allow_owner_or_current_admin_only() {
        let public_viewer = TappStorageAccess::from_owner_and_subject(1, 42);
        assert!(!can_write_installation_settings(public_viewer, false));
        assert!(can_write_installation_settings(public_viewer, true));

        let private_owner = TappStorageAccess::from_owner_and_subject(42, 42);
        assert!(can_write_installation_settings(private_owner, false));
    }

    #[test]
    fn grant_and_subject_resolution_rejects_mismatch() {
        assert_eq!(
            TappStorageAccess::from_grant_and_subject(1, 42, None).unwrap_err(),
            TappStorageAccessError::Unauthenticated
        );
        assert_eq!(
            TappStorageAccess::from_grant_and_subject(1, 42, Some(99)).unwrap_err(),
            TappStorageAccessError::SubjectMismatch
        );
        let access = TappStorageAccess::from_grant_and_subject(1, 42, Some(42)).unwrap();
        assert_eq!(access.installation_namespace(), 1);
        assert_eq!(access.private_storage_namespace(), 42);
    }

    #[test]
    fn installation_read_only_error_code() {
        assert_eq!(
            TappStorageAccessError::InstallationReadOnly.code(),
            "TAPP_INSTALLATION_READ_ONLY"
        );
        assert_eq!(
            TappStorageAccessError::InstallationReadOnly.status_hint(),
            403
        );
    }
}
