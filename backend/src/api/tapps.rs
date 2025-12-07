//! Tapp 应用管理 API
//!
//! 提供 Tapp 应用的安装、卸载、启动、停止等功能
//!
//! ## 权限模型 (v2.0)
//!
//! - **管理员**: 完全控制自己的 Tapp，内容对所有用户可见
//! - **普通用户**: 查看并运行管理员的 Tapp，可临时安装自己的 Tapp（退出登录后移除）
//! - **游客**: 只读访问管理员的 Tapp 内容
//!
//! 普通用户临时安装的 Tapp 权限限制为 basic 级别

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    middleware::from_fn_with_state,
    response::IntoResponse,
    routing::{delete, get, post},
    Extension, Json, Router,
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ColumnTrait, ConnectionTrait, DatabaseConnection,
    DbBackend, EntityTrait, QueryFilter, Set, Statement,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::fs;

use crate::middleware::auth::{auth_middleware, extract_optional_claims, Claims};
use crate::models::entities::{tapp_storage, tapp_store_sources, tapp_widgets, tapps};
use crate::services::permission_service::{TappPermission, TappPermissionService, UserRole};
use crate::GLOBAL_DYNAMIC_CONFIG;

/// 获取管理员用户 ID
/// 返回第一个 is_admin = true 的用户 ID
async fn get_admin_user_id(db: &DatabaseConnection) -> Result<i32, StatusCode> {
    let result = db
        .query_one(Statement::from_string(
            DbBackend::Postgres,
            "SELECT id FROM users WHERE is_admin = true LIMIT 1".to_string(),
        ))
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    result
        .try_get::<i32>("", "id")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// 🔒 验证用户对 Tapp 的访问权限
///
/// 安全校验规则：
/// - 管理员：可以访问所有 Tapp
/// - 普通用户：可以访问自己安装的 Tapp + 管理员的公开 Tapp
/// - 游客：只能访问管理员的公开 Tapp
///
/// 这确保了应用间的数据隔离，Tapp A 无法访问 Tapp B 的存储
async fn verify_tapp_ownership(
    db: &DatabaseConnection,
    user_id: i32,
    tapp_id: &str,
) -> Result<(), StatusCode> {
    // 获取管理员 ID
    let admin_id = get_admin_user_id(db).await?;

    // 游客（负数 ID）只能访问管理员的公开 Tapp
    let is_guest = user_id < 0;

    if is_guest {
        // 查找管理员安装的该 Tapp
        let admin_tapp = tapps::Entity::find()
            .filter(tapps::Column::TappId.eq(tapp_id))
            .filter(tapps::Column::UserId.eq(admin_id))
            .one(db)
            .await
            .map_err(|e| {
                tracing::error!("[TAPP] Database error in ownership verification: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

        if admin_tapp.is_none() {
            tracing::warn!(
                "[TAPP] Guest access denied - tapp_id: {} is not a public admin Tapp",
                tapp_id
            );
            return Err(StatusCode::FORBIDDEN);
        }

        return Ok(());
    }

    // 管理员可以访问所有 Tapp
    // 先检查用户是否是管理员
    let is_admin = db
        .query_one(Statement::from_string(
            DbBackend::Postgres,
            format!("SELECT is_admin FROM users WHERE id = {} LIMIT 1", user_id),
        ))
        .await
        .ok()
        .flatten()
        .and_then(|r| r.try_get::<bool>("", "is_admin").ok())
        .unwrap_or(false);

    if is_admin {
        return Ok(());
    }

    // 普通用户：检查自己拥有的 Tapp 或管理员的公开 Tapp
    let tapp = tapps::Entity::find()
        .filter(tapps::Column::TappId.eq(tapp_id))
        .filter(
            tapps::Column::UserId
                .eq(user_id)
                .or(tapps::Column::UserId.eq(admin_id)),
        )
        .one(db)
        .await
        .map_err(|e| {
            tracing::error!("[TAPP] Database error in ownership verification: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if tapp.is_none() {
        tracing::warn!(
            "[TAPP] Ownership verification failed - user_id: {}, tapp_id: {}",
            user_id,
            tapp_id
        );
        return Err(StatusCode::FORBIDDEN);
    }

    Ok(())
}

/// Tapp 数据存储目录
const TAPP_DATA_DIR: &str = "data/tapps";

/// API 响应
#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }
}

/// 错误响应便捷函数
fn api_error(message: impl Into<String>) -> Json<ApiResponse<()>> {
    Json(ApiResponse {
        success: false,
        data: None,
        error: Some(message.into()),
    })
}

/// Tapp 清单
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TappManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<TappAuthor>,
    pub main: String,
    pub permissions: Vec<String>,
    #[serde(default)]
    pub optional_permissions: Vec<String>,
    pub icon: Option<String>,
    pub theme_color: Option<String>,
    pub min_system_version: Option<String>,
    pub homepage: Option<String>,
    pub repository: Option<String>,
    pub widgets: Option<Vec<TappWidgetDef>>,
    #[serde(default)]
    pub has_page: bool,
    pub settings: Option<Vec<TappSettingDef>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TappAuthor {
    pub name: String,
    pub email: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TappWidgetDef {
    pub id: String,
    pub name: String,
    pub default_size: String,
    pub sizes: Vec<String>,
}

/// Tapp 设置项定义
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TappSettingDef {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub setting_type: String, // toggle | select | input | number | color
    pub description: Option<String>,
    pub default_value: Option<serde_json::Value>,
    pub options: Option<Vec<TappSettingOption>>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub placeholder: Option<String>,
}

/// Tapp 设置选项（用于 select 类型）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TappSettingOption {
    pub value: String,
    pub label: String,
}

/// Tapp 列表项
#[derive(Debug, Serialize)]
pub struct TappListItem {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub status: String,
    pub installed_at: String,
    pub last_run_at: Option<String>,
    /// 是否为临时安装（普通用户安装的 Tapp）
    #[serde(default)]
    pub is_temporary: bool,
    /// 是否为管理员的 Tapp（对所有用户可见）
    #[serde(default)]
    pub is_admin_tapp: bool,
}

/// Tapp 详情
#[derive(Debug, Serialize)]
pub struct TappDetail {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<serde_json::Value>,
    pub icon: Option<String>,
    pub theme_color: Option<String>,
    pub manifest: serde_json::Value,
    pub status: String,
    pub granted_permissions: Vec<String>,
    pub installed_at: String,
    pub last_run_at: Option<String>,
    /// 当前用户角色: "guest" | "user" | "admin"
    pub user_role: String,
    /// 是否为临时安装
    #[serde(default)]
    pub is_temporary: bool,
    /// 是否为管理员的 Tapp
    #[serde(default)]
    pub is_admin_tapp: bool,
}

/// 创建 Tapp 路由
///
/// 路由分为三类：
/// - 公开路由（游客可访问）：list_tapps, get_tapp, get_tapp_code, list_widgets, list_all_widgets, list_store_sources
/// - 认证路由（需要登录）：install, uninstall, start, stop, register_widget, storage 等
/// - 管理员路由（仅管理员）：add_store_source, update_store_source, delete_store_source
pub fn create_tapp_routes() -> Router<DatabaseConnection> {
    // 需要认证的路由
    let authenticated_routes = Router::new()
        .route("/install", post(install_tapp))
        .route("/install-file", post(install_tapp_file))
        .route("/cleanup-temporary", post(cleanup_temporary_tapps))
        .route("/:tapp_id", delete(uninstall_tapp))
        .route("/:tapp_id/start", post(start_tapp))
        .route("/:tapp_id/stop", post(stop_tapp))
        .route("/:tapp_id/widgets", post(register_widget))
        .route("/:tapp_id/widgets/:widget_id", delete(unregister_widget))
        .route("/:tapp_id/storage", get(list_storage_keys))
        .route("/:tapp_id/storage", delete(clear_storage))
        .route("/:tapp_id/storage/:key", get(get_storage))
        .route("/:tapp_id/storage/:key", post(set_storage))
        .route("/:tapp_id/storage/:key", delete(delete_storage))
        // 商店源管理（需要认证，API 内部检查管理员权限）
        .route("/store/sources", post(add_store_source))
        .route("/store/sources/:source_id", post(update_store_source))
        .route("/store/sources/:source_id", delete(delete_store_source))
        .route_layer(from_fn_with_state((), |req, next| async {
            auth_middleware(req, next).await
        }));

    // 公开路由（支持可选认证）
    let public_routes = Router::new()
        .route("/", get(list_tapps))
        .route("/widgets", get(list_all_widgets))
        .route("/store/sources", get(list_store_sources))
        .route("/:tapp_id", get(get_tapp))
        .route("/:tapp_id/code", get(get_tapp_code))
        .route("/:tapp_id/resources", get(get_tapp_resources))
        .route("/:tapp_id/export", get(export_tapp))
        .route("/:tapp_id/widgets", get(list_widgets));

    // 合并路由
    public_routes.merge(authenticated_routes)
}

/// 获取 Tapp 列表
///
/// 权限模型：
/// - 游客：只能看到管理员的 Tapp 列表（只读）
/// - 普通用户：看到管理员的 Tapp + 自己临时安装的 Tapp
/// - 管理员：看到自己的 Tapp（可管理）
async fn list_tapps(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<TappListItem>>>, StatusCode> {
    // 可选认证：游客也可以访问
    let claims = extract_optional_claims(&headers);
    let user_id: Option<i32> = claims.as_ref().and_then(|c| c.sub.parse().ok());
    let is_admin = claims.as_ref().map(|c| c.is_admin).unwrap_or(false);

    // 获取管理员用户 ID
    let admin_id = get_admin_user_id(&db).await?;

    let mut items: Vec<TappListItem> = Vec::new();

    // 1. 获取管理员的 Tapp 列表（所有人可见）
    let admin_tapps = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(admin_id))
        .all(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    for t in admin_tapps {
        items.push(TappListItem {
            id: t.tapp_id,
            name: t.name,
            version: t.version,
            description: t.description,
            icon: t.icon,
            status: format!("{:?}", t.status).to_lowercase(),
            installed_at: t.installed_at.to_rfc3339(),
            last_run_at: t.last_run_at.map(|dt| dt.to_rfc3339()),
            is_temporary: false,
            is_admin_tapp: true,
        });
    }

    // 2. 如果是已登录的普通用户，还要获取自己临时安装的 Tapp
    if let Some(uid) = user_id {
        if !is_admin && uid != admin_id {
            let user_tapps = tapps::Entity::find()
                .filter(tapps::Column::UserId.eq(uid))
                .all(&db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            for t in user_tapps {
                items.push(TappListItem {
                    id: t.tapp_id,
                    name: t.name,
                    version: t.version,
                    description: t.description,
                    icon: t.icon,
                    status: format!("{:?}", t.status).to_lowercase(),
                    installed_at: t.installed_at.to_rfc3339(),
                    last_run_at: t.last_run_at.map(|dt| dt.to_rfc3339()),
                    is_temporary: true, // 普通用户的 Tapp 都是临时的
                    is_admin_tapp: false,
                });
            }
        }
    }

    Ok(Json(ApiResponse::success(items)))
}

/// 从远程商店下载 Tapp 文件
///
/// 返回 (manifest, code, styles, page_template, widget_templates)
async fn fetch_from_store(
    db: &DatabaseConnection,
    store_source: &str,
    tapp_id: &str,
) -> Result<
    (
        TappManifest,
        String,
        Option<String>,
        Option<String>,
        Option<std::collections::HashMap<String, String>>,
    ),
    (StatusCode, Json<ApiResponse<()>>),
> {
    // 获取商店源信息
    let source = tapp_store_sources::Entity::find()
        .filter(
            tapp_store_sources::Column::Url
                .eq(store_source)
                .or(tapp_store_sources::Column::Id.eq(store_source.parse::<i32>().unwrap_or(-1))),
        )
        .one(db)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                api_error("Database error"),
            )
        })?
        .ok_or_else(|| (StatusCode::NOT_FOUND, api_error("Store source not found")))?;

    let base_url = source
        .url
        .trim_end_matches("/index.json")
        .trim_end_matches('/');
    let client = reqwest::Client::new();

    // 获取商店索引
    let index_url = format!("{}/index.json", base_url);
    let index_resp = client.get(&index_url).send().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            api_error(format!("Failed to fetch store index: {}", e)),
        )
    })?;

    if !index_resp.status().is_success() {
        return Err((
            StatusCode::BAD_GATEWAY,
            api_error("Failed to fetch store index"),
        ));
    }

    let index: serde_json::Value = index_resp.json().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            api_error(format!("Invalid store index format: {}", e)),
        )
    })?;

    // 在商店中查找指定的 Tapp
    let apps = index
        .get("apps")
        .and_then(|v| v.as_array())
        .ok_or_else(|| {
            (
                StatusCode::BAD_GATEWAY,
                api_error("Invalid store index: no apps array"),
            )
        })?;

    let app_info = apps
        .iter()
        .find(|app| app.get("id").and_then(|v| v.as_str()) == Some(tapp_id))
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                api_error(format!("Tapp {} not found in store", tapp_id)),
            )
        })?;

    let download = app_info.get("download").ok_or_else(|| {
        (
            StatusCode::BAD_GATEWAY,
            api_error("No download info in app"),
        )
    })?;

    // 下载 manifest.json
    let manifest_path = download
        .get("manifest")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (StatusCode::BAD_GATEWAY, api_error("No manifest path")))?;
    let manifest_url = format!("{}/{}", base_url, manifest_path);

    let manifest_resp = client.get(&manifest_url).send().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            api_error(format!("Failed to fetch manifest: {}", e)),
        )
    })?;

    let manifest: TappManifest = manifest_resp.json().await.map_err(|e| {
        (
            StatusCode::BAD_GATEWAY,
            api_error(format!("Invalid manifest: {}", e)),
        )
    })?;

    // 下载主代码
    let code_path = download
        .get("code")
        .and_then(|v| v.as_str())
        .ok_or_else(|| (StatusCode::BAD_GATEWAY, api_error("No code path")))?;
    let code_url = format!("{}/{}", base_url, code_path);

    let code = client
        .get(&code_url)
        .send()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                api_error(format!("Failed to fetch code: {}", e)),
            )
        })?
        .text()
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_GATEWAY,
                api_error(format!("Failed to read code: {}", e)),
            )
        })?;

    // 下载可选资源
    let mut styles_content: Option<String> = None;
    let mut page_template_content: Option<String> = None;
    let mut widget_templates: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    // 下载 CSS 样式
    if let Some(styles_path) = download.get("styles").and_then(|v| v.as_str()) {
        let styles_url = format!("{}/{}", base_url, styles_path);
        if let Ok(resp) = client.get(&styles_url).send().await {
            if resp.status().is_success() {
                if let Ok(content) = resp.text().await {
                    styles_content = Some(content);
                }
            }
        }
    }

    // 下载 Page 模板
    if let Some(page_path) = download.get("page_template").and_then(|v| v.as_str()) {
        let page_url = format!("{}/{}", base_url, page_path);
        if let Ok(resp) = client.get(&page_url).send().await {
            if resp.status().is_success() {
                if let Ok(content) = resp.text().await {
                    page_template_content = Some(content);
                }
            }
        }
    }

    // 下载 Widget 模板
    if let Some(templates) = download.get("widget_templates").and_then(|v| v.as_object()) {
        for (size, path) in templates {
            if let Some(template_path) = path.as_str() {
                let template_url = format!("{}/{}", base_url, template_path);
                if let Ok(resp) = client.get(&template_url).send().await {
                    if resp.status().is_success() {
                        if let Ok(content) = resp.text().await {
                            widget_templates.insert(size.clone(), content);
                        }
                    }
                }
            }
        }
    }

    let widget_templates_opt = if widget_templates.is_empty() {
        None
    } else {
        Some(widget_templates)
    };

    Ok((
        manifest,
        code,
        styles_content,
        page_template_content,
        widget_templates_opt,
    ))
}

/// 统一安装 Tapp 的请求体
///
/// 支持两种安装来源：
/// 1. direct: 直接提供代码（本地示例、上传文件解析后）
/// 2. store: 从远程商店安装（后端下载）
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallTappRequest {
    /// 安装来源: "direct" | "store"
    source: String,

    // ===== direct 模式需要的字段 =====
    /// Tapp 清单（direct 模式必需）
    manifest: Option<TappManifest>,
    /// 主代码（direct 模式必需）
    code: Option<String>,
    /// CSS 样式（可选）
    styles: Option<String>,
    /// 页面 HTML 模板（可选）
    page_template: Option<String>,
    /// 小组件 HTML 模板（可选，按尺寸）
    widget_templates: Option<std::collections::HashMap<String, String>>,

    // ===== store 模式需要的字段 =====
    /// 商店源 URL 或 ID（store 模式必需）
    store_source: Option<String>,
    /// Tapp ID（store 模式必需）
    tapp_id: Option<String>,

    // ===== 通用字段 =====
    /// 授权的权限列表（可选，默认全部授权）
    permissions: Option<Vec<String>>,
}

/// 安装 Tapp（统一接口）
///
/// 支持两种安装来源：
/// - direct: 直接提供代码
/// - store: 从远程商店下载
async fn install_tapp(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<InstallTappRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<()>>)> {
    let user_id: i32 = claims
        .sub
        .parse()
        .map_err(|_| (StatusCode::UNAUTHORIZED, api_error("Invalid user")))?;

    // 根据来源获取 manifest 和代码
    let (manifest, code, styles, page_template, widget_templates) = match req.source.as_str() {
        "direct" => {
            // 直接安装：从请求中获取
            let manifest = req.manifest.ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    api_error("manifest is required for direct install"),
                )
            })?;
            let code = req.code.ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    api_error("code is required for direct install"),
                )
            })?;
            (
                manifest,
                code,
                req.styles,
                req.page_template,
                req.widget_templates,
            )
        }
        "store" => {
            // 从商店安装：下载文件
            let store_source = req.store_source.ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    api_error("storeSource is required for store install"),
                )
            })?;
            let tapp_id = req.tapp_id.ok_or_else(|| {
                (
                    StatusCode::BAD_REQUEST,
                    api_error("tappId is required for store install"),
                )
            })?;

            fetch_from_store(&db, &store_source, &tapp_id).await?
        }
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                api_error("Invalid source, must be 'direct' or 'store'"),
            ));
        }
    };

    // 检查是否已安装
    let existing = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(user_id))
        .filter(tapps::Column::TappId.eq(&manifest.id))
        .one(&db)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                api_error("Database error"),
            )
        })?;

    if existing.is_some() {
        return Err((StatusCode::CONFLICT, api_error("Tapp already installed")));
    }

    // 创建存储目录
    let user_dir = PathBuf::from(TAPP_DATA_DIR).join(user_id.to_string());
    let tapp_dir = user_dir.join(&manifest.id);
    fs::create_dir_all(&tapp_dir).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            api_error("Failed to create directory"),
        )
    })?;

    // 保存主代码文件
    let code_path = tapp_dir.join("main.js");
    fs::write(&code_path, &code).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            api_error("Failed to save code"),
        )
    })?;

    // 保存可选资源
    if let Some(styles) = &styles {
        let styles_path = tapp_dir.join("styles.css");
        let _ = fs::write(&styles_path, styles).await;
    }

    if let Some(page) = &page_template {
        let page_path = tapp_dir.join("page.html");
        let _ = fs::write(&page_path, page).await;
    }

    if let Some(templates) = &widget_templates {
        for (size, content) in templates {
            let widget_path = tapp_dir.join(format!("widget-{}.html", size));
            let _ = fs::write(&widget_path, content).await;
        }
    }

    // 保存 manifest.json
    let manifest_json = serde_json::to_string_pretty(&manifest).unwrap_or_default();
    let manifest_path = tapp_dir.join("manifest.json");
    fs::write(&manifest_path, &manifest_json)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                api_error("Failed to save manifest"),
            )
        })?;

    // 确定授权的权限
    let permissions = req.permissions.unwrap_or_default();
    let granted: Vec<String> = if permissions.is_empty() {
        manifest.permissions.clone()
    } else {
        manifest
            .permissions
            .iter()
            .filter(|p| permissions.contains(p))
            .cloned()
            .collect()
    };

    // 保存到数据库
    let now = Utc::now().fixed_offset();
    let tapp = tapps::ActiveModel {
        id: NotSet,
        tapp_id: Set(manifest.id.clone()),
        user_id: Set(user_id),
        name: Set(manifest.name.clone()),
        version: Set(manifest.version.clone()),
        description: Set(manifest.description.clone()),
        author: Set(manifest
            .author
            .as_ref()
            .map(|a| serde_json::to_value(a).unwrap())),
        icon: Set(manifest.icon.clone()),
        theme_color: Set(manifest.theme_color.clone()),
        manifest: Set(serde_json::to_value(&manifest).unwrap()),
        status: Set(tapps::TappStatus::Installed),
        granted_permissions: Set(serde_json::to_value(&granted).unwrap()),
        file_path: Set(manifest_path.to_string_lossy().to_string()),
        code_path: Set(code_path.to_string_lossy().to_string()),
        installed_at: Set(now),
        last_run_at: Set(None),
        updated_at: Set(now),
        error_message: Set(None),
    };

    let result = tapp.insert(&db).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            api_error(format!("Database error: {}", e)),
        )
    })?;

    // 普通用户安装的 Tapp 都是临时的
    let is_temporary = !claims.is_admin;

    Ok(Json(ApiResponse::success(TappListItem {
        id: result.tapp_id,
        name: result.name,
        version: result.version,
        description: result.description,
        icon: result.icon,
        status: "installed".to_string(),
        installed_at: result.installed_at.to_rfc3339(),
        last_run_at: None,
        is_temporary,
        is_admin_tapp: claims.is_admin,
    })))
}

/// 安装 Tapp（上传 .tapp 文件）
///
/// 接收 multipart 文件上传，解压 ZIP 文件后安装
async fn install_tapp_file(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    mut multipart: axum::extract::Multipart,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiResponse<()>>)> {
    let user_id: i32 = claims
        .sub
        .parse()
        .map_err(|_| (StatusCode::UNAUTHORIZED, api_error("Invalid user")))?;

    // 读取上传的文件
    let mut file_data: Option<Vec<u8>> = None;
    let mut permissions: Vec<String> = Vec::new();

    while let Some(field) = multipart.next_field().await.map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            api_error("Failed to read multipart"),
        )
    })? {
        let name = field.name().unwrap_or("").to_string();

        if name == "file" {
            file_data = Some(
                field
                    .bytes()
                    .await
                    .map_err(|_| (StatusCode::BAD_REQUEST, api_error("Failed to read file")))?
                    .to_vec(),
            );
        } else if name == "permissions" {
            let text = field.text().await.map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    api_error("Failed to read permissions"),
                )
            })?;
            if let Ok(parsed) = serde_json::from_str::<Vec<String>>(&text) {
                permissions = parsed;
            }
        }
    }

    let file_data =
        file_data.ok_or_else(|| (StatusCode::BAD_REQUEST, api_error("No file uploaded")))?;

    // 解压 ZIP 文件
    let cursor = std::io::Cursor::new(&file_data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|_| {
        (
            StatusCode::BAD_REQUEST,
            api_error("Invalid .tapp file format"),
        )
    })?;

    // 读取 manifest.json
    let manifest_content = {
        let mut manifest_file = archive.by_name("manifest.json").map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                api_error("manifest.json not found in .tapp file"),
            )
        })?;
        let mut content = String::new();
        std::io::Read::read_to_string(&mut manifest_file, &mut content).map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                api_error("Failed to read manifest.json"),
            )
        })?;
        content
    };

    let manifest: TappManifest = serde_json::from_str(&manifest_content).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            api_error(format!("Invalid manifest.json: {}", e)),
        )
    })?;

    // 读取主代码
    let code = {
        // 先尝试 index.js
        let has_index_js = archive.by_name("index.js").is_ok();
        let code_file_name = if has_index_js { "index.js" } else { "main.js" };

        let mut code_file = archive.by_name(code_file_name).map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                api_error("No code file (index.js or main.js) found"),
            )
        })?;
        let mut content = String::new();
        std::io::Read::read_to_string(&mut code_file, &mut content).map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                api_error("Failed to read code file"),
            )
        })?;
        content
    };

    // 读取可选资源
    let styles = read_optional_file(&mut archive, "styles.css");
    let page_template = read_optional_file(&mut archive, "page.html");

    // 读取 widget 模板
    let mut widget_templates: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let file_names: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|f| f.name().to_string()))
        .collect();

    for name in file_names {
        if name.starts_with("widget-") && name.ends_with(".html") {
            let size = name.trim_start_matches("widget-").trim_end_matches(".html");
            if let Some(content) = read_optional_file(&mut archive, &name) {
                widget_templates.insert(size.to_string(), content);
            }
        }
    }

    // 检查是否已安装
    let existing = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(user_id))
        .filter(tapps::Column::TappId.eq(&manifest.id))
        .one(&db)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                api_error("Database error"),
            )
        })?;

    if existing.is_some() {
        return Err((StatusCode::CONFLICT, api_error("Tapp already installed")));
    }

    // 创建存储目录
    let user_dir = PathBuf::from(TAPP_DATA_DIR).join(user_id.to_string());
    let tapp_dir = user_dir.join(&manifest.id);
    fs::create_dir_all(&tapp_dir).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            api_error("Failed to create directory"),
        )
    })?;

    // 保存主代码文件
    let code_path = tapp_dir.join("main.js");
    fs::write(&code_path, &code).await.map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            api_error("Failed to save code"),
        )
    })?;

    // 保存可选资源
    if let Some(ref styles_content) = styles {
        let styles_path = tapp_dir.join("styles.css");
        let _ = fs::write(&styles_path, styles_content).await;
    }

    if let Some(ref page_content) = page_template {
        let page_path = tapp_dir.join("page.html");
        let _ = fs::write(&page_path, page_content).await;
    }

    for (size, content) in &widget_templates {
        let widget_path = tapp_dir.join(format!("widget-{}.html", size));
        let _ = fs::write(&widget_path, content).await;
    }

    // 保存 manifest.json
    let manifest_json = serde_json::to_string_pretty(&manifest).unwrap_or_default();
    let manifest_path = tapp_dir.join("manifest.json");
    fs::write(&manifest_path, &manifest_json)
        .await
        .map_err(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                api_error("Failed to save manifest"),
            )
        })?;

    // 确定授权的权限
    let granted: Vec<String> = if permissions.is_empty() {
        manifest.permissions.clone()
    } else {
        manifest
            .permissions
            .iter()
            .filter(|p| permissions.contains(p))
            .cloned()
            .collect()
    };

    // 保存到数据库
    let now = Utc::now().fixed_offset();
    let tapp = tapps::ActiveModel {
        id: NotSet,
        tapp_id: Set(manifest.id.clone()),
        user_id: Set(user_id),
        name: Set(manifest.name.clone()),
        version: Set(manifest.version.clone()),
        description: Set(manifest.description.clone()),
        author: Set(manifest
            .author
            .as_ref()
            .map(|a| serde_json::to_value(a).unwrap())),
        icon: Set(manifest.icon.clone()),
        theme_color: Set(manifest.theme_color.clone()),
        manifest: Set(serde_json::to_value(&manifest).unwrap()),
        status: Set(tapps::TappStatus::Installed),
        granted_permissions: Set(serde_json::to_value(&granted).unwrap()),
        file_path: Set(manifest_path.to_string_lossy().to_string()),
        code_path: Set(code_path.to_string_lossy().to_string()),
        installed_at: Set(now),
        last_run_at: Set(None),
        updated_at: Set(now),
        error_message: Set(None),
    };

    let result = tapp.insert(&db).await.map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            api_error(format!("Database error: {}", e)),
        )
    })?;

    // 普通用户安装的 Tapp 都是临时的
    let is_temporary = !claims.is_admin;

    Ok(Json(ApiResponse::success(TappListItem {
        id: result.tapp_id,
        name: result.name,
        version: result.version,
        description: result.description,
        icon: result.icon,
        status: "installed".to_string(),
        installed_at: result.installed_at.to_rfc3339(),
        last_run_at: None,
        is_temporary,
        is_admin_tapp: claims.is_admin,
    })))
}

/// 从 ZIP 归档中读取可选文件
fn read_optional_file(
    archive: &mut zip::ZipArchive<std::io::Cursor<&Vec<u8>>>,
    name: &str,
) -> Option<String> {
    if let Ok(mut file) = archive.by_name(name) {
        let mut content = String::new();
        if std::io::Read::read_to_string(&mut file, &mut content).is_ok() {
            return Some(content);
        }
    }
    None
}

/// 获取 Tapp 详情
///
/// 权限模型：
/// - 游客：只能访问管理员的 Tapp（只读）
/// - 普通用户：可以访问管理员的 Tapp + 自己临时安装的 Tapp
async fn get_tapp(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(tapp_id): Path<String>,
) -> Result<Json<ApiResponse<TappDetail>>, StatusCode> {
    // 可选认证：游客也可以访问
    let claims = extract_optional_claims(&headers);
    let user_id: Option<i32> = claims.as_ref().and_then(|c| c.sub.parse().ok());
    let is_admin = claims.as_ref().map(|c| c.is_admin).unwrap_or(false);
    let admin_id = get_admin_user_id(&db).await?;

    // 先尝试从管理员的 Tapp 中查找
    let mut tapp = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(admin_id))
        .filter(tapps::Column::TappId.eq(&tapp_id))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut is_admin_tapp = tapp.is_some();
    let mut is_temporary = false;

    // 如果不是管理员的 Tapp，且用户已登录，尝试从用户自己的临时 Tapp 中查找
    if tapp.is_none() {
        if let Some(uid) = user_id {
            if uid != admin_id {
                tapp = tapps::Entity::find()
                    .filter(tapps::Column::UserId.eq(uid))
                    .filter(tapps::Column::TappId.eq(&tapp_id))
                    .one(&db)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

                if tapp.is_some() {
                    is_admin_tapp = false;
                    is_temporary = true;
                }
            }
        }
    }

    let tapp = tapp.ok_or(StatusCode::NOT_FOUND)?;

    let all_permissions: Vec<String> =
        serde_json::from_value(tapp.granted_permissions.clone()).unwrap_or_default();

    // 根据用户角色确定可用的权限级别
    let user_role = if is_admin {
        "admin"
    } else if user_id.is_some() {
        "user"
    } else {
        "guest"
    };

    // 将用户角色转换为 UserRole 枚举
    let role = match user_role {
        "admin" => UserRole::Admin,
        "user" => UserRole::User,
        _ => UserRole::Guest,
    };

    // 使用 TappPermissionService 根据配置动态过滤权限
    // 这会检查权限下放配置，而不是硬编码只允许 basic 权限
    let config = GLOBAL_DYNAMIC_CONFIG.read().await;
    let permissions: Vec<String> = all_permissions
        .into_iter()
        .filter(|p| {
            // 解析权限字符串
            if let Some(perm) = TappPermission::from_str(p) {
                // 使用权限服务检查用户是否有此权限
                TappPermissionService::check(&config, role, perm)
            } else {
                // 未知权限，默认不授予
                false
            }
        })
        .collect();
    drop(config); // 显式释放读锁

    Ok(Json(ApiResponse::success(TappDetail {
        id: tapp.tapp_id,
        name: tapp.name,
        version: tapp.version,
        description: tapp.description,
        author: tapp.author,
        icon: tapp.icon,
        theme_color: tapp.theme_color,
        manifest: tapp.manifest,
        status: format!("{:?}", tapp.status).to_lowercase(),
        granted_permissions: permissions,
        installed_at: tapp.installed_at.to_rfc3339(),
        last_run_at: tapp.last_run_at.map(|dt| dt.to_rfc3339()),
        user_role: user_role.to_string(),
        is_temporary,
        is_admin_tapp,
    })))
}

/// 获取 Tapp 代码
///
/// 权限模型：
/// - 游客：可以读取管理员的 Tapp 代码
/// - 普通用户：可以读取管理员的 Tapp 代码 + 自己临时安装的 Tapp 代码
async fn get_tapp_code(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(tapp_id): Path<String>,
) -> Result<String, StatusCode> {
    // 可选认证：游客也可以访问
    let claims = extract_optional_claims(&headers);
    let user_id: Option<i32> = claims.as_ref().and_then(|c| c.sub.parse().ok());
    let admin_id = get_admin_user_id(&db).await?;

    // 先尝试从管理员的 Tapp 中查找
    let mut tapp = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(admin_id))
        .filter(tapps::Column::TappId.eq(&tapp_id))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 如果不是管理员的 Tapp，且用户已登录，尝试从用户自己的临时 Tapp 中查找
    if tapp.is_none() {
        if let Some(uid) = user_id {
            if uid != admin_id {
                tapp = tapps::Entity::find()
                    .filter(tapps::Column::UserId.eq(uid))
                    .filter(tapps::Column::TappId.eq(&tapp_id))
                    .one(&db)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            }
        }
    }

    let tapp = tapp.ok_or(StatusCode::NOT_FOUND)?;

    let code = fs::read_to_string(&tapp.code_path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(code)
}

/// Tapp 资源响应
#[derive(Debug, Serialize)]
struct TappResourcesResponse {
    /// 主代码（index.js/main.js）
    code: String,
    /// 自定义 CSS 样式
    #[serde(skip_serializing_if = "Option::is_none")]
    styles: Option<String>,
    /// Widget HTML 模板（按尺寸）
    #[serde(skip_serializing_if = "Option::is_none")]
    widget_templates: Option<std::collections::HashMap<String, String>>,
    /// Page HTML 模板
    #[serde(skip_serializing_if = "Option::is_none")]
    page_template: Option<String>,
}

/// 获取 Tapp 完整资源（代码 + CSS + HTML 模板）
///
/// 支持混合渲染模式，返回所有相关资源文件
///
/// 权限模型与 get_tapp_code 相同
async fn get_tapp_resources(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(tapp_id): Path<String>,
) -> Result<Json<TappResourcesResponse>, StatusCode> {
    // 可选认证
    let claims = extract_optional_claims(&headers);
    let user_id: Option<i32> = claims.as_ref().and_then(|c| c.sub.parse().ok());
    let admin_id = get_admin_user_id(&db).await?;

    // 查找 Tapp（先管理员，再用户）
    let mut tapp = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(admin_id))
        .filter(tapps::Column::TappId.eq(&tapp_id))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if tapp.is_none() {
        if let Some(uid) = user_id {
            if uid != admin_id {
                tapp = tapps::Entity::find()
                    .filter(tapps::Column::UserId.eq(uid))
                    .filter(tapps::Column::TappId.eq(&tapp_id))
                    .one(&db)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            }
        }
    }

    let tapp = tapp.ok_or(StatusCode::NOT_FOUND)?;

    // 读取主代码
    let code = fs::read_to_string(&tapp.code_path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 获取 Tapp 目录（code_path 的父目录）
    let code_path = PathBuf::from(&tapp.code_path);
    let tapp_dir = code_path
        .parent()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    // 解析 manifest 获取资源文件路径
    let manifest: serde_json::Value = tapp.manifest.clone();

    // 读取自定义 CSS
    let styles = if let Some(styles_file) = manifest.get("styles").and_then(|v| v.as_str()) {
        let styles_path = tapp_dir.join(styles_file);
        fs::read_to_string(&styles_path).await.ok()
    } else {
        // 尝试默认位置
        let default_path = tapp_dir.join("styles.css");
        fs::read_to_string(&default_path).await.ok()
    };

    // 读取 Page HTML 模板
    let page_template =
        if let Some(page_file) = manifest.get("pageTemplate").and_then(|v| v.as_str()) {
            let page_path = tapp_dir.join(page_file);
            fs::read_to_string(&page_path).await.ok()
        } else {
            // 尝试默认位置
            let default_path = tapp_dir.join("page.html");
            fs::read_to_string(&default_path).await.ok()
        };

    // 读取 Widget HTML 模板
    let mut widget_templates: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    if let Some(widgets) = manifest.get("widgets").and_then(|v| v.as_array()) {
        for widget in widgets {
            if let Some(templates) = widget.get("templates").and_then(|v| v.as_object()) {
                for (size, template_file) in templates {
                    if let Some(file_path) = template_file.as_str() {
                        let full_path = tapp_dir.join(file_path);
                        if let Ok(content) = fs::read_to_string(&full_path).await {
                            widget_templates.insert(size.clone(), content);
                        }
                    }
                }
            }
        }
    }

    // 如果没有找到模板，尝试默认位置
    if widget_templates.is_empty() {
        for size in ["4x2", "4x4", "2x2", "2x4"] {
            let default_path = tapp_dir.join(format!("widget-{}.html", size));
            if let Ok(content) = fs::read_to_string(&default_path).await {
                widget_templates.insert(size.to_string(), content);
            }
        }
    }

    Ok(Json(TappResourcesResponse {
        code,
        styles,
        widget_templates: if widget_templates.is_empty() {
            None
        } else {
            Some(widget_templates)
        },
        page_template,
    }))
}

/// 导出 Tapp 为 .tapp 文件（ZIP 格式）
async fn export_tapp(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(tapp_id): Path<String>,
) -> Result<impl IntoResponse, StatusCode> {
    // 可选认证
    let claims = extract_optional_claims(&headers);
    let user_id: Option<i32> = claims.as_ref().and_then(|c| c.sub.parse().ok());
    let admin_id = get_admin_user_id(&db).await?;

    // 查找 Tapp（先管理员，再用户）
    let mut tapp = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(admin_id))
        .filter(tapps::Column::TappId.eq(&tapp_id))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if tapp.is_none() {
        if let Some(uid) = user_id {
            if uid != admin_id {
                tapp = tapps::Entity::find()
                    .filter(tapps::Column::UserId.eq(uid))
                    .filter(tapps::Column::TappId.eq(&tapp_id))
                    .one(&db)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            }
        }
    }

    let tapp = tapp.ok_or(StatusCode::NOT_FOUND)?;

    // 获取 Tapp 目录
    let code_path = PathBuf::from(&tapp.code_path);
    let tapp_dir = code_path
        .parent()
        .ok_or(StatusCode::INTERNAL_SERVER_ERROR)?;

    // 收集需要打包的文件
    let tapp_dir_owned = tapp_dir.to_path_buf();
    let tapp_id_clone = tapp_id.clone();

    let zip_data = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, std::io::Error> {
        use std::io::{Read, Write};
        use zip::write::SimpleFileOptions;
        use zip::ZipWriter;

        let buffer = Vec::new();
        let cursor = std::io::Cursor::new(buffer);
        let mut zip = ZipWriter::new(cursor);
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        // 要打包的文件列表
        let files_to_pack = [
            "manifest.json",
            "main.js",
            "styles.css",
            "page.html",
            "widget-2x2.html",
            "widget-2x4.html",
            "widget-4x2.html",
            "widget-4x4.html",
        ];

        for filename in files_to_pack {
            let file_path = tapp_dir_owned.join(filename);
            if file_path.exists() {
                let mut file = std::fs::File::open(&file_path)?;
                let mut content = Vec::new();
                file.read_to_end(&mut content)?;
                zip.start_file(filename, options)?;
                zip.write_all(&content)?;
            }
        }

        let cursor = zip.finish()?;
        Ok(cursor.into_inner())
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 返回 ZIP 文件
    let filename = format!("{}.tapp", tapp_id_clone);
    let disposition = format!("attachment; filename=\"{}\"", filename);
    Ok((
        [
            (header::CONTENT_TYPE.as_str(), "application/zip".to_string()),
            (header::CONTENT_DISPOSITION.as_str(), disposition),
        ],
        zip_data,
    ))
}

/// 启动 Tapp
///
/// 权限模型：
/// - 管理员可以启动自己的 Tapp（修改数据库状态）
/// - 普通用户可以启动管理员的 Tapp（不修改数据库，运行状态在前端维护）
/// - 普通用户可以启动自己临时安装的 Tapp
async fn start_tapp(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(tapp_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    let admin_id = get_admin_user_id(&db).await?;

    // 先尝试从管理员的 Tapp 中查找
    let admin_tapp = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(admin_id))
        .filter(tapps::Column::TappId.eq(&tapp_id))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some(tapp) = admin_tapp {
        // 管理员的 Tapp
        if claims.is_admin {
            // 管理员启动自己的 Tapp，更新数据库状态
            let now = Utc::now().fixed_offset();
            let mut active: tapps::ActiveModel = tapp.into();
            active.status = Set(tapps::TappStatus::Running);
            active.last_run_at = Set(Some(now));
            active.updated_at = Set(now);
            active
                .update(&db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
        // 普通用户启动管理员的 Tapp，不修改数据库（只读）
        return Ok(Json(ApiResponse::success(())));
    }

    // 尝试从用户自己的临时 Tapp 中查找
    if user_id != admin_id {
        let user_tapp = tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(user_id))
            .filter(tapps::Column::TappId.eq(&tapp_id))
            .one(&db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if let Some(tapp) = user_tapp {
            let now = Utc::now().fixed_offset();
            let mut active: tapps::ActiveModel = tapp.into();
            active.status = Set(tapps::TappStatus::Running);
            active.last_run_at = Set(Some(now));
            active.updated_at = Set(now);
            active
                .update(&db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            return Ok(Json(ApiResponse::success(())));
        }
    }

    Err(StatusCode::NOT_FOUND)
}

/// 停止 Tapp
///
/// 权限模型：
/// - 管理员可以停止自己的 Tapp（修改数据库状态）
/// - 普通用户可以停止管理员的 Tapp（不修改数据库，运行状态在前端维护）
/// - 普通用户可以停止自己临时安装的 Tapp
async fn stop_tapp(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(tapp_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    let admin_id = get_admin_user_id(&db).await?;

    // 先尝试从管理员的 Tapp 中查找
    let admin_tapp = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(admin_id))
        .filter(tapps::Column::TappId.eq(&tapp_id))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some(tapp) = admin_tapp {
        // 管理员的 Tapp
        if claims.is_admin {
            // 管理员停止自己的 Tapp，更新数据库状态
            let now = Utc::now().fixed_offset();
            let mut active: tapps::ActiveModel = tapp.into();
            active.status = Set(tapps::TappStatus::Installed);
            active.updated_at = Set(now);
            active
                .update(&db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }
        // 普通用户停止管理员的 Tapp，不修改数据库（只读）
        return Ok(Json(ApiResponse::success(())));
    }

    // 尝试从用户自己的临时 Tapp 中查找
    if user_id != admin_id {
        let user_tapp = tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(user_id))
            .filter(tapps::Column::TappId.eq(&tapp_id))
            .one(&db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if let Some(tapp) = user_tapp {
            let now = Utc::now().fixed_offset();
            let mut active: tapps::ActiveModel = tapp.into();
            active.status = Set(tapps::TappStatus::Installed);
            active.updated_at = Set(now);
            active
                .update(&db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            return Ok(Json(ApiResponse::success(())));
        }
    }

    Err(StatusCode::NOT_FOUND)
}

/// 卸载 Tapp
///
/// 权限模型：
/// - 管理员可以卸载自己的 Tapp
/// - 普通用户只能卸载自己临时安装的 Tapp，不能卸载管理员的 Tapp
async fn uninstall_tapp(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(tapp_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    let admin_id = get_admin_user_id(&db).await?;

    // 检查是否是管理员的 Tapp
    if let Some(tapp) = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(admin_id))
        .filter(tapps::Column::TappId.eq(&tapp_id))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    {
        // 这是管理员的 Tapp
        if !claims.is_admin {
            // 普通用户不能卸载管理员的 Tapp
            return Err(StatusCode::FORBIDDEN);
        }
        // 管理员可以卸载自己的 Tapp
        return do_uninstall_tapp(&db, &tapp).await;
    }

    // 尝试从用户自己的临时 Tapp 中查找
    let tapp = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(user_id))
        .filter(tapps::Column::TappId.eq(&tapp_id))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    do_uninstall_tapp(&db, &tapp).await
}

/// 执行卸载 Tapp 的具体操作
async fn do_uninstall_tapp(
    db: &DatabaseConnection,
    tapp: &tapps::Model,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let user_id = tapp.user_id;
    let tapp_id = &tapp.tapp_id;

    // 删除文件
    let tapp_dir = PathBuf::from(&tapp.file_path)
        .parent()
        .unwrap()
        .to_path_buf();
    let _ = fs::remove_dir_all(&tapp_dir).await;

    // 删除相关小组件
    tapp_widgets::Entity::delete_many()
        .filter(tapp_widgets::Column::UserId.eq(user_id))
        .filter(tapp_widgets::Column::TappId.eq(tapp_id))
        .exec(db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 删除存储数据
    tapp_storage::Entity::delete_many()
        .filter(tapp_storage::Column::UserId.eq(user_id))
        .filter(tapp_storage::Column::TappId.eq(tapp_id))
        .exec(db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 删除 Tapp 记录
    tapps::Entity::delete_by_id(tapp.id)
        .exec(db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse::success(())))
}

/// 清理用户的临时 Tapp（登出时调用）
///
/// 删除当前用户的所有临时安装的 Tapp
async fn cleanup_temporary_tapps(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<ApiResponse<i32>>, StatusCode> {
    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    let admin_id = get_admin_user_id(&db).await?;

    // 管理员没有临时 Tapp
    if user_id == admin_id {
        return Ok(Json(ApiResponse::success(0)));
    }

    // 获取用户的所有临时 Tapp
    let user_tapps = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(user_id))
        .all(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let count = user_tapps.len() as i32;

    // 删除每个 Tapp
    for tapp in &user_tapps {
        let _ = do_uninstall_tapp(&db, tapp).await;
    }

    Ok(Json(ApiResponse::success(count)))
}

/// 列出用户所有已注册的小组件（跨所有 Tapp）
///
/// 权限模型：
/// - 游客：只返回管理员的小组件
/// - 普通用户：返回管理员的小组件 + 用户临时安装的 Tapp 的小组件
async fn list_all_widgets(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
) -> Result<Json<ApiResponse<Vec<serde_json::Value>>>, StatusCode> {
    // 可选认证：游客也可以访问
    let claims = extract_optional_claims(&headers);
    let user_id: Option<i32> = claims.as_ref().and_then(|c| c.sub.parse().ok());
    let admin_id = get_admin_user_id(&db).await?;

    let mut items: Vec<serde_json::Value> = Vec::new();

    // 1. 获取管理员的小组件
    let admin_widgets = tapp_widgets::Entity::find()
        .filter(tapp_widgets::Column::UserId.eq(admin_id))
        .all(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    for w in admin_widgets {
        items.push(serde_json::json!({
            "id": w.widget_id,
            "tappId": w.tapp_id,
            "config": {
                "id": w.widget_id.strip_prefix(&format!("tapp.{}.", w.tapp_id)).unwrap_or(&w.widget_id),
                "name": w.name,
                "description": w.description,
                "icon": w.icon,
                "defaultSize": w.default_size,
                "sizes": w.sizes,
                "category": w.category,
                "configSchema": w.config,
            },
            "instanceCount": 0,
            "registeredAt": w.registered_at.to_rfc3339(),
            "isAdminWidget": true,
        }));
    }

    // 2. 如果是已登录的普通用户，还要获取自己临时安装的 Tapp 的小组件
    if let Some(uid) = user_id {
        if uid != admin_id {
            let user_widgets = tapp_widgets::Entity::find()
                .filter(tapp_widgets::Column::UserId.eq(uid))
                .all(&db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            for w in user_widgets {
                items.push(serde_json::json!({
                    "id": w.widget_id,
                    "tappId": w.tapp_id,
                    "config": {
                        "id": w.widget_id.strip_prefix(&format!("tapp.{}.", w.tapp_id)).unwrap_or(&w.widget_id),
                        "name": w.name,
                        "description": w.description,
                        "icon": w.icon,
                        "defaultSize": w.default_size,
                        "sizes": w.sizes,
                        "category": w.category,
                        "configSchema": w.config,
                    },
                    "instanceCount": 0,
                    "registeredAt": w.registered_at.to_rfc3339(),
                    "isAdminWidget": false,
                }));
            }
        }
    }

    Ok(Json(ApiResponse::success(items)))
}

/// 列出指定 Tapp 的小组件
///
/// 权限模型：
/// - 游客：可以查看管理员的 Tapp 小组件
/// - 普通用户：可以查看管理员的 Tapp 小组件 + 自己临时安装的 Tapp 小组件
async fn list_widgets(
    State(db): State<DatabaseConnection>,
    headers: HeaderMap,
    Path(tapp_id): Path<String>,
) -> Result<Json<ApiResponse<Vec<serde_json::Value>>>, StatusCode> {
    // 可选认证：游客也可以访问
    let claims = extract_optional_claims(&headers);
    let user_id: Option<i32> = claims.as_ref().and_then(|c| c.sub.parse().ok());
    let admin_id = get_admin_user_id(&db).await?;

    // 先尝试从管理员的小组件中查找
    let mut widgets = tapp_widgets::Entity::find()
        .filter(tapp_widgets::Column::UserId.eq(admin_id))
        .filter(tapp_widgets::Column::TappId.eq(&tapp_id))
        .all(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 如果不是管理员的 Tapp，且用户已登录，尝试从用户自己的临时 Tapp 中查找
    if widgets.is_empty() {
        if let Some(uid) = user_id {
            if uid != admin_id {
                widgets = tapp_widgets::Entity::find()
                    .filter(tapp_widgets::Column::UserId.eq(uid))
                    .filter(tapp_widgets::Column::TappId.eq(&tapp_id))
                    .all(&db)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            }
        }
    }

    let items: Vec<serde_json::Value> = widgets
        .into_iter()
        .map(|w| {
            serde_json::json!({
                "id": w.widget_id,
                "tappId": w.tapp_id,
                "config": {
                    "id": w.widget_id.strip_prefix(&format!("tapp.{}.", w.tapp_id)).unwrap_or(&w.widget_id),
                    "name": w.name,
                    "description": w.description,
                    "icon": w.icon,
                    "defaultSize": w.default_size,
                    "sizes": w.sizes,
                    "category": w.category,
                    "configSchema": w.config,
                },
                "instanceCount": 0,
                "registeredAt": w.registered_at.to_rfc3339(),
            })
        })
        .collect();

    Ok(Json(ApiResponse::success(items)))
}

/// 注册小组件请求
#[derive(Debug, Deserialize)]
pub struct RegisterWidgetRequest {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    pub default_size: String,
    pub sizes: Vec<String>,
    pub category: Option<String>,
    #[serde(default)]
    pub config: serde_json::Value,
}

/// 注册小组件
async fn register_widget(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(tapp_id): Path<String>,
    Json(req): Json<RegisterWidgetRequest>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;

    // 验证 Tapp 存在
    let _tapp = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(user_id))
        .filter(tapps::Column::TappId.eq(&tapp_id))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    let widget_id = format!("tapp.{}.{}", tapp_id, req.id);
    let now = Utc::now().fixed_offset();

    // 检查是否已存在
    let existing = tapp_widgets::Entity::find()
        .filter(tapp_widgets::Column::UserId.eq(user_id))
        .filter(tapp_widgets::Column::WidgetId.eq(&widget_id))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some(item) = existing {
        // 更新现有
        let mut active: tapp_widgets::ActiveModel = item.into();
        active.name = Set(req.name.clone());
        active.description = Set(req.description.clone());
        active.icon = Set(req.icon.clone());
        active.default_size = Set(req.default_size.clone());
        active.sizes = Set(serde_json::to_value(&req.sizes).unwrap());
        active.category = Set(req.category.clone());
        active.config = Set(req.config.clone());
        active
            .update(&db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        // 创建新的
        let widget = tapp_widgets::ActiveModel {
            id: NotSet,
            widget_id: Set(widget_id.clone()),
            tapp_id: Set(tapp_id.clone()),
            user_id: Set(user_id),
            name: Set(req.name.clone()),
            description: Set(req.description.clone()),
            icon: Set(req.icon.clone()),
            default_size: Set(req.default_size.clone()),
            sizes: Set(serde_json::to_value(&req.sizes).unwrap()),
            category: Set(req.category.clone()),
            config: Set(req.config.clone()),
            registered_at: Set(now),
        };
        widget
            .insert(&db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    Ok(Json(ApiResponse::success(serde_json::json!({
        "id": widget_id,
        "tappId": tapp_id,
        "name": req.name,
    }))))
}

/// 注销小组件
async fn unregister_widget(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path((tapp_id, widget_id)): Path<(String, String)>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    let full_widget_id = if widget_id.starts_with("tapp.") {
        widget_id
    } else {
        format!("tapp.{}.{}", tapp_id, widget_id)
    };

    tapp_widgets::Entity::delete_many()
        .filter(tapp_widgets::Column::UserId.eq(user_id))
        .filter(tapp_widgets::Column::WidgetId.eq(&full_widget_id))
        .exec(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse::success(())))
}

/// 验证存储 key 格式（防止路径遍历攻击）
///
/// 规则：
/// - 只允许字母、数字、下划线、连字符、点
/// - 不允许连续的点（..）
/// - 不允许以点开头或结尾
/// - 长度限制 1-256 字符
fn validate_storage_key(key: &str) -> Result<(), &'static str> {
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
    // 只允许安全字符
    let valid = key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.');
    if !valid {
        return Err(
            "Key contains invalid characters (only alphanumeric, underscore, hyphen, dot allowed)",
        );
    }
    Ok(())
}

/// 列出存储键
async fn list_storage_keys(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(tapp_id): Path<String>,
) -> Result<Json<ApiResponse<Vec<String>>>, StatusCode> {
    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;

    // 🔒 安全校验：验证用户对 Tapp 的访问权限
    verify_tapp_ownership(&db, user_id, &tapp_id).await?;

    let items = tapp_storage::Entity::find()
        .filter(tapp_storage::Column::UserId.eq(user_id))
        .filter(tapp_storage::Column::TappId.eq(&tapp_id))
        .all(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let keys: Vec<String> = items.into_iter().map(|i| i.key).collect();

    Ok(Json(ApiResponse::success(keys)))
}

/// 获取存储值
async fn get_storage(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path((tapp_id, key)): Path<(String, String)>,
) -> Result<Json<ApiResponse<serde_json::Value>>, StatusCode> {
    // 🔒 安全校验：验证 key 格式
    if let Err(_e) = validate_storage_key(&key) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;

    // 🔒 安全校验：验证用户对 Tapp 的访问权限
    verify_tapp_ownership(&db, user_id, &tapp_id).await?;

    let item = tapp_storage::Entity::find()
        .filter(tapp_storage::Column::UserId.eq(user_id))
        .filter(tapp_storage::Column::TappId.eq(&tapp_id))
        .filter(tapp_storage::Column::Key.eq(&key))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    match item {
        Some(i) => Ok(Json(ApiResponse::success(i.value))),
        None => Ok(Json(ApiResponse::success(serde_json::Value::Null))),
    }
}

/// 设置存储值
async fn set_storage(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path((tapp_id, key)): Path<(String, String)>,
    Json(value): Json<serde_json::Value>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    // 🔒 安全校验：验证 key 格式
    if let Err(_e) = validate_storage_key(&key) {
        return Err(StatusCode::BAD_REQUEST);
    }

    // 🔒 安全校验：限制值大小（1MB）
    let value_str = serde_json::to_string(&value).unwrap_or_default();
    if value_str.len() > 1024 * 1024 {
        return Err(StatusCode::PAYLOAD_TOO_LARGE);
    }

    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;

    // 🔒 安全校验：验证用户对 Tapp 的访问权限
    verify_tapp_ownership(&db, user_id, &tapp_id).await?;

    let now = Utc::now().fixed_offset();

    let existing = tapp_storage::Entity::find()
        .filter(tapp_storage::Column::UserId.eq(user_id))
        .filter(tapp_storage::Column::TappId.eq(&tapp_id))
        .filter(tapp_storage::Column::Key.eq(&key))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if let Some(item) = existing {
        let mut active: tapp_storage::ActiveModel = item.into();
        active.value = Set(value);
        active.updated_at = Set(now);
        active
            .update(&db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    } else {
        let item = tapp_storage::ActiveModel {
            id: NotSet,
            tapp_id: Set(tapp_id),
            user_id: Set(user_id),
            key: Set(key),
            value: Set(value),
            created_at: Set(now),
            updated_at: Set(now),
        };
        item.insert(&db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }

    Ok(Json(ApiResponse::success(())))
}

/// 删除存储值
async fn delete_storage(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path((tapp_id, key)): Path<(String, String)>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    // 🔒 安全校验：验证 key 格式
    if let Err(_e) = validate_storage_key(&key) {
        return Err(StatusCode::BAD_REQUEST);
    }

    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;

    // 🔒 安全校验：验证用户对 Tapp 的访问权限
    verify_tapp_ownership(&db, user_id, &tapp_id).await?;

    tapp_storage::Entity::delete_many()
        .filter(tapp_storage::Column::UserId.eq(user_id))
        .filter(tapp_storage::Column::TappId.eq(&tapp_id))
        .filter(tapp_storage::Column::Key.eq(&key))
        .exec(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse::success(())))
}

/// 清除所有存储
async fn clear_storage(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(tapp_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;

    // 🔒 安全校验：验证用户对 Tapp 的访问权限
    verify_tapp_ownership(&db, user_id, &tapp_id).await?;

    tapp_storage::Entity::delete_many()
        .filter(tapp_storage::Column::UserId.eq(user_id))
        .filter(tapp_storage::Column::TappId.eq(&tapp_id))
        .exec(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse::success(())))
}

// ==================== 商店源管理 API ====================

/// 商店源响应
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreSourceResponse {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
    pub url: String,
    pub enabled: bool,
    pub official: bool,
    pub icon: Option<String>,
}

/// 添加商店源请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddStoreSourceRequest {
    pub name: String,
    pub description: Option<String>,
    pub url: String,
    pub enabled: Option<bool>,
    pub icon: Option<String>,
}

/// 更新商店源请求
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStoreSourceRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub url: Option<String>,
    pub enabled: Option<bool>,
    pub icon: Option<String>,
}

/// 获取商店源列表（公开 API）
async fn list_store_sources(
    State(db): State<DatabaseConnection>,
) -> Result<Json<ApiResponse<Vec<StoreSourceResponse>>>, StatusCode> {
    let sources = tapp_store_sources::Entity::find()
        .all(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let items: Vec<StoreSourceResponse> = sources
        .into_iter()
        .map(|s| StoreSourceResponse {
            id: s.id,
            name: s.name,
            description: s.description,
            url: s.url,
            enabled: s.enabled,
            official: s.official,
            icon: s.icon,
        })
        .collect();

    Ok(Json(ApiResponse::success(items)))
}

/// 添加商店源（仅管理员）
async fn add_store_source(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<AddStoreSourceRequest>,
) -> Result<Json<ApiResponse<StoreSourceResponse>>, StatusCode> {
    // 检查管理员权限
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    // 检查 URL 是否已存在
    let existing = tapp_store_sources::Entity::find()
        .filter(tapp_store_sources::Column::Url.eq(&req.url))
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if existing.is_some() {
        return Err(StatusCode::CONFLICT);
    }

    let now = Utc::now().fixed_offset();
    let source = tapp_store_sources::ActiveModel {
        id: NotSet,
        name: Set(req.name),
        description: Set(req.description),
        url: Set(req.url),
        enabled: Set(req.enabled.unwrap_or(true)),
        official: Set(false), // 用户添加的源不是官方的
        icon: Set(req.icon),
        created_at: Set(now),
        updated_at: Set(now),
    };

    let result = source
        .insert(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse::success(StoreSourceResponse {
        id: result.id,
        name: result.name,
        description: result.description,
        url: result.url,
        enabled: result.enabled,
        official: result.official,
        icon: result.icon,
    })))
}

/// 更新商店源（仅管理员）
async fn update_store_source(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(source_id): Path<i32>,
    Json(req): Json<UpdateStoreSourceRequest>,
) -> Result<Json<ApiResponse<StoreSourceResponse>>, StatusCode> {
    // 检查管理员权限
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    // 获取现有源
    let source = tapp_store_sources::Entity::find_by_id(source_id)
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    // 官方源不能修改 URL
    if source.official && req.url.is_some() {
        return Err(StatusCode::FORBIDDEN);
    }

    let now = Utc::now().fixed_offset();
    let mut active: tapp_store_sources::ActiveModel = source.into();

    if let Some(name) = req.name {
        active.name = Set(name);
    }
    if let Some(description) = req.description {
        active.description = Set(Some(description));
    }
    if let Some(url) = req.url {
        active.url = Set(url);
    }
    if let Some(enabled) = req.enabled {
        active.enabled = Set(enabled);
    }
    if let Some(icon) = req.icon {
        active.icon = Set(Some(icon));
    }
    active.updated_at = Set(now);

    let result = active
        .update(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse::success(StoreSourceResponse {
        id: result.id,
        name: result.name,
        description: result.description,
        url: result.url,
        enabled: result.enabled,
        official: result.official,
        icon: result.icon,
    })))
}

/// 删除商店源（仅管理员）
async fn delete_store_source(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(source_id): Path<i32>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    // 检查管理员权限
    if !claims.is_admin {
        return Err(StatusCode::FORBIDDEN);
    }

    // 获取源信息
    let source = tapp_store_sources::Entity::find_by_id(source_id)
        .one(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;

    // 不能删除官方源
    if source.official {
        return Err(StatusCode::FORBIDDEN);
    }

    tapp_store_sources::Entity::delete_by_id(source_id)
        .exec(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(ApiResponse::success(())))
}
