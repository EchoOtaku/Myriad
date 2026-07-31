//! Role-aware Tapp catalog and detail queries.
//!
//! Projection lives in [`crate::services::tapp_catalog`]. This module only
//! resolves identity, loads install rows, and wraps domain DTOs in API envelopes.

use super::{
    current_is_admin, find_admin_user_id, find_visible_tapp, optional_authenticated_user_id,
    ApiResponse, TappDetail, TappListItem,
};
use axum::{
    extract::State,
    http::HeaderMap,
    Json,
};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::config::DynamicConfig;
use crate::middleware::auth::extract_optional_claims;
use crate::models::entities::tapps;
use crate::services::tapp_catalog::{
    catalog_install_flags, tapp_list_item_from_model,
};
use crate::services::tapp_context::role_for_optional_subject;
use crate::error::HttpError;
use myriad_error::AppError;

// Path-stable for parent module / manifest_tests (`super::tapp_detail_from_model`).
pub(super) use crate::services::tapp_catalog::tapp_detail_from_model;

pub(super) async fn list_tapps(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<TappListItem>>>, HttpError> {
    let claims = extract_optional_claims(&headers);
    let user_id = optional_authenticated_user_id(claims.as_ref());
    let admin_id = find_admin_user_id(&db).await?;
    let mut items = Vec::new();
    let mut seen_tapp_ids = HashSet::new();

    if let Some(user_id) = user_id {
        if Some(user_id) != admin_id {
            let user_tapps = tapps::Entity::find()
                .filter(tapps::Column::UserId.eq(user_id))
                .all(&db)
                .await
                .map_err(|_| HttpError(AppError::internal("Database error")))?;
            for tapp in user_tapps {
                seen_tapp_ids.insert(tapp.tapp_id.clone());
                let (is_temporary, is_admin_tapp) = catalog_install_flags(false);
                items.push(tapp_list_item_from_model(tapp, is_temporary, is_admin_tapp));
            }
        }
    }

    let admin_tapps = if let Some(admin_id) = admin_id {
        tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(admin_id))
            .all(&db)
            .await
            .map_err(|_| HttpError(AppError::internal("Database error")))?
    } else {
        Vec::new()
    };
    for tapp in admin_tapps {
        if !seen_tapp_ids.insert(tapp.tapp_id.clone()) {
            continue;
        }
        let (is_temporary, is_admin_tapp) = catalog_install_flags(true);
        items.push(tapp_list_item_from_model(tapp, is_temporary, is_admin_tapp));
    }
    Ok(Json(ApiResponse::success(items)))
}

pub(super) async fn list_tapp_details(
    State(db): State<DatabaseConnection>,
    State(dynamic_config): State<Arc<RwLock<DynamicConfig>>>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<TappDetail>>>, HttpError> {
    let claims = extract_optional_claims(&headers);
    let user_id = optional_authenticated_user_id(claims.as_ref());
    let is_admin = match claims.as_ref() {
        Some(claims) => current_is_admin(claims, &db).await,
        None => false,
    };
    let role = role_for_optional_subject(user_id, is_admin);
    let admin_id = find_admin_user_id(&db).await?;
    let admin_tapps = if let Some(admin_id) = admin_id {
        tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(admin_id))
            .all(&db)
            .await
            .map_err(|_| HttpError(AppError::internal("Database error")))?
    } else {
        Vec::new()
    };
    let user_tapps = if let Some(user_id) = user_id {
        if Some(user_id) != admin_id {
            tapps::Entity::find()
                .filter(tapps::Column::UserId.eq(user_id))
                .all(&db)
                .await
                .map_err(|_| HttpError(AppError::internal("Database error")))?
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    let mut seen = HashSet::new();
    let config = dynamic_config.read().await;
    let mut details = Vec::with_capacity(admin_tapps.len() + user_tapps.len());
    for tapp in user_tapps {
        seen.insert(tapp.tapp_id.clone());
        let (is_temporary, is_admin_tapp) = catalog_install_flags(false);
        details.push(tapp_detail_from_model(
            tapp,
            role,
            is_temporary,
            is_admin_tapp,
            &config,
        ));
    }
    for tapp in admin_tapps {
        if seen.insert(tapp.tapp_id.clone()) {
            let (is_temporary, is_admin_tapp) = catalog_install_flags(true);
            details.push(tapp_detail_from_model(
                tapp,
                role,
                is_temporary,
                is_admin_tapp,
                &config,
            ));
        }
    }
    Ok(Json(ApiResponse::success(details)))
}

pub(super) async fn get_tapp(
    State(db): State<DatabaseConnection>,
    State(dynamic_config): State<Arc<RwLock<DynamicConfig>>>,
    headers: HeaderMap,
    axum::extract::Path(tapp_id): axum::extract::Path<String>,
) -> Result<Json<ApiResponse<TappDetail>>, HttpError> {
    let claims = extract_optional_claims(&headers);
    let user_id = optional_authenticated_user_id(claims.as_ref());
    let is_admin = match claims.as_ref() {
        Some(claims) => current_is_admin(claims, &db).await,
        None => false,
    };
    let visible = find_visible_tapp(&db, user_id, &tapp_id)
        .await?
        .ok_or_else(|| HttpError(AppError::not_found("Not found")))?;
    let role = role_for_optional_subject(user_id, is_admin);
    let (is_temporary, is_admin_tapp) = catalog_install_flags(visible.is_site_owner);
    let config = dynamic_config.read().await;
    let detail = tapp_detail_from_model(
        visible.tapp,
        role,
        is_temporary,
        is_admin_tapp,
        &config,
    );
    Ok(Json(ApiResponse::success(detail)))
}
