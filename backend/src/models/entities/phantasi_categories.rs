//! Phantasi 阅读 - 用户自定义分类实体
//!
//! 存储用户创建的分类标签

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "phantasi_categories")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    /// 用户 ID
    pub user_id: i32,
    /// 分类名称
    pub name: String,
    /// 分类图标
    pub icon: Option<String>,
    /// 分类颜色
    pub color: Option<String>,
    /// 排序顺序
    pub sort_order: i32,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

/// 创建分类请求
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CreateCategoryRequest {
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
}

/// 更新分类请求
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpdateCategoryRequest {
    pub name: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
}

/// 公开读 / 管理工作台用的分类。不回创建者 user_id。
#[derive(Clone, Debug, Serialize)]
pub struct CategoryResponse {
    pub id: i32,
    pub name: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub sort_order: i32,
    pub created_at: i64,
}

impl From<Model> for CategoryResponse {
    fn from(m: Model) -> Self {
        Self {
            id: m.id,
            name: m.name,
            icon: m.icon,
            color: m.color,
            sort_order: m.sort_order,
            created_at: m.created_at.timestamp_millis(),
        }
    }
}
