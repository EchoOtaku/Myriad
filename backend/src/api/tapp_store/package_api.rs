//! Read-only installed package code, resources, assets and export endpoints.

use super::{
    append_directory_to_zip, find_visible_tapp, guess_asset_mime_type, installed_code_path,
    installed_tapp_dir, is_safe_path_component, optional_authenticated_user_id,
    read_tapp_text_resource, regular_resource_directory, regular_resource_path,
    validate_asset_path, TappManifest, WidgetTemplateContents, MAX_TAPP_ASSET_BYTES,
};
use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use sea_orm::DatabaseConnection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::fs;

use crate::middleware::auth::extract_optional_claims;

async fn visible_tapp(
    db: &DatabaseConnection,
    headers: &HeaderMap,
    tapp_id: &str,
) -> Result<crate::models::entities::tapps::Model, StatusCode> {
    let claims = extract_optional_claims(headers);
    let user_id = optional_authenticated_user_id(claims.as_ref());
    Ok(find_visible_tapp(db, user_id, tapp_id)
        .await?
        .ok_or(StatusCode::NOT_FOUND)?
        .tapp)
}

pub(super) async fn get_tapp_code(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(tapp_id): Path<String>,
) -> Result<String, StatusCode> {
    let tapp = visible_tapp(&db, &headers, &tapp_id).await?;
    fs::read_to_string(installed_code_path(&tapp)?)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

#[derive(Debug, Serialize)]
pub(super) struct TappResourcesResponse {
    code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    styles: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    widget_styles: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_styles: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    widget_css: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_css: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    widget_templates: Option<WidgetTemplateContents>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_template: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    css_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    i18n: Option<HashMap<String, serde_json::Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_modules: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_module_order: Option<Vec<String>>,
}

pub(super) async fn get_tapp_resources(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(tapp_id): Path<String>,
) -> Result<Json<TappResourcesResponse>, StatusCode> {
    let tapp = visible_tapp(&db, &headers, &tapp_id).await?;
    let tapp_dir = installed_tapp_dir(&tapp)?;
    let code = fs::read_to_string(installed_code_path(&tapp)?)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let manifest = tapp.manifest.clone();
    let css_mode = manifest
        .get("cssMode")
        .and_then(serde_json::Value::as_str)
        .map(String::from);
    let is_separated = css_mode.as_deref() == Some("separated");

    let styles = if let Some(path) = manifest.get("styles").and_then(serde_json::Value::as_str) {
        read_tapp_text_resource(&tapp_dir, path).await.ok()
    } else if !is_separated {
        read_tapp_text_resource(&tapp_dir, "styles.css").await.ok()
    } else {
        None
    };
    let widget_styles = if is_separated {
        let path = manifest
            .get("widgetStyles")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("widget.css");
        read_tapp_text_resource(&tapp_dir, path).await.ok()
    } else {
        None
    };
    let page_styles = if is_separated {
        let path = manifest
            .get("pageStyles")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("page.css");
        read_tapp_text_resource(&tapp_dir, path).await.ok()
    } else {
        None
    };
    let page_path = manifest
        .get("pageTemplate")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("page.html");
    let page_template = read_tapp_text_resource(&tapp_dir, page_path).await.ok();

    let mut widget_templates = WidgetTemplateContents::new();
    if let Some(widgets) = manifest
        .get("widgets")
        .and_then(serde_json::Value::as_array)
    {
        for widget in widgets {
            let Some(widget_id) = widget.get("id").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let mut templates = HashMap::new();
            if let Some(declared) = widget
                .get("templates")
                .and_then(serde_json::Value::as_object)
            {
                for (size, path) in declared {
                    if let Some(path) = path.as_str() {
                        if let Ok(content) = read_tapp_text_resource(&tapp_dir, path).await {
                            templates.insert(size.clone(), content);
                        }
                    }
                }
            }
            if !templates.is_empty() {
                widget_templates.insert(widget_id.to_string(), templates);
            }
        }
    }

    let widget_css = if is_separated {
        None
    } else {
        read_tapp_text_resource(&tapp_dir, "widget.css").await.ok()
    };
    let page_css = if is_separated {
        None
    } else {
        read_tapp_text_resource(&tapp_dir, "page.css").await.ok()
    };

    let i18n = if let Some(i18n_dir) = regular_resource_directory(&tapp_dir, "i18n") {
        let mut translations = HashMap::new();
        if let Ok(mut entries) = fs::read_dir(i18n_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if !entry.file_type().await.is_ok_and(|kind| kind.is_file())
                    || path.extension().and_then(|extension| extension.to_str()) != Some("json")
                {
                    continue;
                }
                let Some(filename) = entry.file_name().to_str().map(String::from) else {
                    continue;
                };
                if !is_safe_path_component(&filename) {
                    continue;
                }
                let Some(language) = filename.strip_suffix(".json") else {
                    continue;
                };
                let relative = format!("i18n/{filename}");
                if let Ok(content) = read_tapp_text_resource(&tapp_dir, &relative).await {
                    if let Ok(value) = serde_json::from_str(&content) {
                        translations.insert(language.to_string(), value);
                    }
                }
            }
        }
        (!translations.is_empty()).then_some(translations)
    } else {
        None
    };

    let page_module_order = manifest
        .get("pageModules")
        .and_then(serde_json::Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(String::from))
                .collect::<Vec<_>>()
        });
    let page_modules = if let Some(order) = &page_module_order {
        let mut modules = HashMap::new();
        for name in order {
            let relative = format!("page/{name}");
            let content = read_tapp_text_resource(&tapp_dir, &relative)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            modules.insert(name.clone(), content);
        }
        (!modules.is_empty()).then_some(modules)
    } else {
        None
    };

    Ok(Json(TappResourcesResponse {
        code,
        styles,
        widget_styles,
        page_styles,
        widget_css,
        page_css,
        widget_templates: (!widget_templates.is_empty()).then_some(widget_templates),
        page_template,
        css_mode,
        i18n,
        page_module_order: page_modules.as_ref().and(page_module_order),
        page_modules,
    }))
}

#[derive(Debug, Deserialize)]
pub(super) struct GetTappAssetQuery {
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TappAssetResponse {
    path: String,
    mime_type: String,
    size: u64,
    base64: String,
}

pub(super) async fn get_tapp_asset(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(tapp_id): Path<String>,
    Query(query): Query<GetTappAssetQuery>,
) -> Result<Json<TappAssetResponse>, StatusCode> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let tapp = visible_tapp(&db, &headers, &tapp_id).await?;
    validate_asset_path(&query.path).map_err(|_| StatusCode::BAD_REQUEST)?;
    let manifest: TappManifest = serde_json::from_value(tapp.manifest.clone())
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let declared = manifest.assets.as_ref().ok_or(StatusCode::NOT_FOUND)?;
    if !declared.iter().any(|path| path == &query.path) {
        return Err(StatusCode::NOT_FOUND);
    }

    let tapp_dir = installed_tapp_dir(&tapp)?;
    let file_path = regular_resource_path(&tapp_dir, &query.path).ok_or(StatusCode::NOT_FOUND)?;
    let bytes = fs::read(file_path)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if bytes.len() as u64 > MAX_TAPP_ASSET_BYTES {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }
    Ok(Json(TappAssetResponse {
        path: query.path.clone(),
        mime_type: guess_asset_mime_type(&query.path).to_string(),
        size: bytes.len() as u64,
        base64: STANDARD.encode(bytes),
    }))
}

pub(super) async fn export_tapp(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(tapp_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    let tapp = visible_tapp(&db, &headers, &tapp_id).await?;
    let tapp_dir = installed_tapp_dir(&tapp)?;
    let filename = format!("{tapp_id}.tapp");
    let zip_data = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, std::io::Error> {
        use zip::write::SimpleFileOptions;
        use zip::ZipWriter;

        let mut zip = ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        if tapp_dir.is_dir() {
            append_directory_to_zip(&mut zip, &tapp_dir, &tapp_dir, options)?;
        }
        Ok(zip.finish()?.into_inner())
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok((
        [
            (header::CONTENT_TYPE.as_str(), "application/zip".to_string()),
            (
                header::CONTENT_DISPOSITION.as_str(),
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        zip_data,
    ))
}
