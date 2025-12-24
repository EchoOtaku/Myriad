//! Brew 阅读 - 用户自定义分类实体
//!
//! 存储用户创建的分类标签

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "brew_categories")]
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
    /// 创建时间
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
