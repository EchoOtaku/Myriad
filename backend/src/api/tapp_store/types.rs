use axum::Json;
use serde::Serialize;

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

/// 从 manifest JSON 提取 locales 对象（非对象值视为缺失）
pub(super) fn manifest_locales(manifest: &serde_json::Value) -> Option<serde_json::Value> {
    manifest.get("locales").filter(|v| v.is_object()).cloned()
}

/// 错误响应便捷函数
pub(super) fn api_error(message: impl Into<String>) -> Json<ApiResponse<()>> {
    Json(ApiResponse {
        success: false,
        data: None,
        error: Some(message.into()),
    })
}

/// Tapp 列表项
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TappListItem {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    /// 内联 SVG 图标代码（优先于 icon）
    pub icon_svg: Option<String>,
    /// manifest.locales 透传：语言标签 → { name?, description? }，供前端按语言解析
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locales: Option<serde_json::Value>,
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
