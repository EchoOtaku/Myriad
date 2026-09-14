//! 管理员媒体目录：列出 / 上传 / 删除。联邦旧上传路径仍可写，并登记进目录。

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use sea_orm::DatabaseConnection;
use serde_json::json;

use crate::error::HttpError;
use crate::extract::AuthedClaims;
use crate::federation::content::store_federation_media;
use crate::middleware::auth::verify_current_admin_from_headers;
use crate::services::media_catalog::{
    MediaKind, RegisterMedia, delete_asset, list_assets, register,
};
use myriad_error::AppError;

fn media_http(status: StatusCode, error: impl Into<String>) -> HttpError {
    HttpError(AppError::from_status_u16(status.as_u16(), error.into()))
}

async fn require_admin(headers: &HeaderMap, db: &DatabaseConnection) -> Result<(), HttpError> {
    verify_current_admin_from_headers(headers, db)
        .await
        .map(|_| ())
        .map_err(|(status, body)| HttpError::from((status, body)))
}

/// GET /api/media
pub async fn list_media(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, HttpError> {
    require_admin(&headers, &db).await?;
    let items = list_assets(&db).await.map_err(|err| {
        tracing::error!(%err, "list media catalog");
        media_http(StatusCode::INTERNAL_SERVER_ERROR, "Failed to list media")
    })?;
    Ok(Json(json!({ "success": true, "items": items })))
}

/// POST /api/media
pub async fn upload_media(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    AuthedClaims(claims): AuthedClaims,
    multipart: axum::extract::Multipart,
) -> Result<Json<serde_json::Value>, HttpError> {
    require_admin(&headers, &db).await?;
    let user_id: i32 = claims
        .sub
        .parse()
        .map_err(|_| media_http(StatusCode::UNAUTHORIZED, "Invalid user ID"))?;
    let (filename, mime, bytes) = read_file_field(multipart).await?;
    let stored = store_federation_media(user_id, &filename, &mime, &bytes)
        .await
        .map_err(HttpError::from)?;
    let row = register(
        &db,
        RegisterMedia {
            kind: MediaKind::Upload,
            url: stored.url.clone(),
            mime: stored.media_type.clone(),
            name: stored.name.clone(),
            size: stored.size as i64,
        },
    )
    .await
    .map_err(|err| {
        tracing::error!(%err, "register uploaded media");
        media_http(StatusCode::INTERNAL_SERVER_ERROR, "Failed to store media")
    })?;
    Ok(Json(json!({
        "success": true,
        "item": crate::services::media_catalog::MediaAssetView {
            id: row.id,
            kind: row.kind,
            url: row.url,
            mime: row.mime,
            name: row.name,
            size: row.size,
            created_at: row.created_at.timestamp_millis(),
            references: vec![],
        },
    })))
}

/// DELETE /api/media/{id}
pub async fn delete_media(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, HttpError> {
    require_admin(&headers, &db).await?;
    match delete_asset(&db, id).await.map_err(|err| {
        tracing::error!(%err, "delete media catalog");
        media_http(StatusCode::INTERNAL_SERVER_ERROR, "Failed to delete media")
    })? {
        Ok(()) => Ok(Json(json!({ "success": true }))),
        Err(refs) if refs == ["missing"] => {
            Err(media_http(StatusCode::NOT_FOUND, "Media not found"))
        }
        Err(_refs) => Err(HttpError(
            AppError::conflict("This file is still in use and cannot be deleted.")
                .with_code("MEDIA_IN_USE"),
        )),
    }
}

async fn read_file_field(
    mut multipart: axum::extract::Multipart,
) -> Result<(String, String, Vec<u8>), HttpError> {
    let mut file_bytes = None;
    let mut filename = "upload.bin".to_string();
    let mut mime = "application/octet-stream".to_string();
    while let Ok(Some(field)) = multipart.next_field().await {
        if field.name().unwrap_or("") != "file" {
            continue;
        }
        if let Some(name) = field.file_name() {
            filename = name.to_string();
        }
        if let Some(ct) = field.content_type() {
            mime = ct.to_string();
        }
        file_bytes = Some(
            field
                .bytes()
                .await
                .map_err(|_| media_http(StatusCode::BAD_REQUEST, "Failed to read file field"))?
                .to_vec(),
        );
        break;
    }
    let bytes = file_bytes
        .ok_or_else(|| media_http(StatusCode::BAD_REQUEST, "Missing multipart field 'file'"))?;
    Ok((filename, mime, bytes))
}

#[cfg(test)]
mod tests {
    use crate::services::media_catalog::catalogs_cache_image;

    #[test]
    fn catalog_api_does_not_index_cache_image() {
        assert!(!catalogs_cache_image());
    }
}
