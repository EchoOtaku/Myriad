use super::validate_tapp_id;
use axum::http::StatusCode;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection, DbErr, EntityTrait,
    QueryFilter, Statement,
};

use crate::api::tapp_runtime::common as tapp_common;
use crate::api::tapp_runtime::RuntimeGrantContext;
use crate::middleware::auth::{ensure_current_admin, Claims};
use crate::models::entities::tapps;
use crate::services::permission_service::{TappPermission, TappPermissionService, UserRole};
use crate::GLOBAL_DYNAMIC_CONFIG;

/// 获取管理员用户 ID（委托给 tapp_runtime::common 的缓存版本）
pub(super) async fn get_admin_user_id(db: &DatabaseConnection) -> Result<i32, StatusCode> {
    tapp_common::get_admin_user_id(db)
        .await
        .map_err(|(status, _)| status)
}

pub(super) async fn find_admin_user_id(db: &DatabaseConnection) -> Result<Option<i32>, StatusCode> {
    tapp_common::find_admin_user_id(db)
        .await
        .map_err(|(status, _)| status)
}

/// One public-route lookup rule for details, code, resources and export.
///
/// When the authenticated subject has a private install of the same `tapp_id`,
/// that record wins so list/detail/runtime open the personal copy. Otherwise
/// fall back to the site-owner public install. Guests only see public installs.
/// A fresh database has no site owner yet and therefore returns `None`.
pub(super) struct VisibleTappInstallation {
    pub(super) tapp: tapps::Model,
    pub(super) is_site_owner: bool,
}

pub(super) async fn find_visible_tapp(
    db: &DatabaseConnection,
    user_id: Option<i32>,
    tapp_id: &str,
) -> Result<Option<VisibleTappInstallation>, StatusCode> {
    validate_tapp_id(tapp_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let site_owner_id = find_admin_user_id(db).await?;

    // Prefer the subject's private install when both private and public copies exist.
    if let Some(user_id) = user_id.filter(|user_id| Some(*user_id) != site_owner_id) {
        let tapp = tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(user_id))
            .filter(tapps::Column::TappId.eq(tapp_id))
            .one(db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if let Some(tapp) = tapp {
            return Ok(Some(VisibleTappInstallation {
                tapp,
                is_site_owner: false,
            }));
        }
    }

    if let Some(site_owner_id) = site_owner_id {
        let public_tapp = tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(site_owner_id))
            .filter(tapps::Column::TappId.eq(tapp_id))
            .one(db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        if let Some(tapp) = public_tapp {
            return Ok(Some(VisibleTappInstallation {
                tapp,
                is_site_owner: true,
            }));
        }
    }

    Ok(None)
}

/// Serialize every live-path or ownership mutation for one public Tapp ID.
///
/// The lock is global across owner namespaces so admin public installs and user
/// private installs of the same ID cannot race their conflict checks across replicas.
pub(super) async fn lock_tapp_lifecycle(
    db: &impl ConnectionTrait,
    tapp_id: &str,
) -> Result<(), DbErr> {
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        vec![format!("tapp-lifecycle:{tapp_id}").into()],
    ))
    .await?;
    Ok(())
}

pub(super) async fn current_is_admin(claims: &Claims) -> bool {
    ensure_current_admin(claims).await.is_ok()
}

pub(super) fn optional_authenticated_user_id(claims: Option<&Claims>) -> Option<i32> {
    claims
        .and_then(|claims| claims.sub.parse::<i32>().ok())
        .filter(|user_id| *user_id >= 0)
}

fn require_runtime_storage_grant(
    grant: &RuntimeGrantContext,
    tapp_id: &str,
) -> Result<(), StatusCode> {
    grant
        .require_tapp_id(tapp_id)
        .and_then(|_| grant.require(TappPermission::Storage))
        .map_err(|(status, _)| status)
}

/// Resolve the two storage identities attached to a Tapp runtime.
///
/// Sandbox storage belongs to the current subject. Installation settings and
/// host-managed resources remain attached to the installation owner.
#[derive(Debug, Clone, Copy)]
pub(crate) struct TappStorageAccess {
    pub owner_id: i32,
    pub subject_id: i32,
}

impl TappStorageAccess {
    pub fn from_owner_and_subject(owner_id: i32, subject_id: i32) -> Self {
        Self {
            owner_id,
            subject_id,
        }
    }

    pub fn from_runtime_grant(
        grant: &RuntimeGrantContext,
        claims: &Claims,
    ) -> Result<Self, StatusCode> {
        let subject_id =
            optional_authenticated_user_id(Some(claims)).ok_or(StatusCode::UNAUTHORIZED)?;
        if grant.subject_id() != subject_id {
            return Err(StatusCode::FORBIDDEN);
        }
        Ok(Self::from_owner_and_subject(grant.owner_id(), subject_id))
    }

    pub fn can_manage_installation(self) -> bool {
        self.subject_id == self.owner_id
    }

    pub fn require_installation_write(self) -> Result<(), StatusCode> {
        if self.can_manage_installation() {
            Ok(())
        } else {
            Err(StatusCode::FORBIDDEN)
        }
    }

    pub fn installation_namespace(self) -> i32 {
        self.owner_id
    }

    pub fn private_storage_namespace(self) -> i32 {
        self.subject_id
    }
}

pub(super) fn can_write_installation_settings(access: TappStorageAccess, is_admin: bool) -> bool {
    is_admin || access.can_manage_installation()
}

/// Authorize sandbox storage for a Runtime-Grant route.
pub(super) async fn authorize_runtime_storage(
    db: &DatabaseConnection,
    claims: &Claims,
    grant: &RuntimeGrantContext,
    tapp_id: &str,
) -> Result<TappStorageAccess, StatusCode> {
    require_runtime_storage_grant(grant, tapp_id)?;
    authorize_tapp_permission(db, claims, tapp_id, TappPermission::Storage).await?;
    TappStorageAccess::from_runtime_grant(grant, claims)
}

pub(crate) fn installation_write_forbidden_error() -> (StatusCode, axum::Json<serde_json::Value>) {
    (
        StatusCode::FORBIDDEN,
        axum::Json(serde_json::json!({
            "error": "Read-only installation resource",
            "message": "Only the installation owner can modify this resource",
            "code": "TAPP_INSTALLATION_READ_ONLY"
        })),
    )
}

pub(super) async fn current_user_role(claims: &Claims) -> UserRole {
    if current_is_admin(claims).await {
        UserRole::Admin
    } else {
        UserRole::User
    }
}

pub(super) fn canonical_installation_owner_id(
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
/// - Guest: cannot install in practice; still scoped to the actor id only.
pub(super) fn installation_conflict_owner_ids(
    role: UserRole,
    actor_id: i32,
    site_owner_id: i32,
) -> Vec<i32> {
    match role {
        UserRole::Admin => vec![site_owner_id],
        UserRole::User | UserRole::Guest => vec![actor_id],
    }
}

pub(super) async fn require_current_admin(claims: &Claims) -> Result<(), StatusCode> {
    ensure_current_admin(claims)
        .await
        .map_err(|(status, _)| status)
}

pub(super) async fn filter_install_permissions(
    role: UserRole,
    permissions: Vec<String>,
) -> Vec<String> {
    let config = GLOBAL_DYNAMIC_CONFIG.read().await;
    let granted = TappPermissionService::filter_permissions_for_role(&config, role, &permissions);
    drop(config);
    granted
}

pub(super) async fn authorize_tapp_permission(
    db: &DatabaseConnection,
    claims: &Claims,
    tapp_id: &str,
    permission: TappPermission,
) -> Result<i32, StatusCode> {
    tapp_common::authorize_tapp_permission(db, claims, tapp_id, permission)
        .await
        .map_err(|(status, _)| status)
}
