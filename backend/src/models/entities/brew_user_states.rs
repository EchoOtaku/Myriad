//! Brew 阅读 - 用户阅读状态实体
//!
//! 存储用户的已读、收藏等状态，支持多用户同步

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "brew_user_states")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    /// 用户 ID
    pub user_id: i32,
    /// 文章 ID
    pub item_id: i32,
    /// 是否已读
    pub is_read: bool,
    /// 是否收藏
    pub is_starred: bool,
    /// 阅读时间
    pub read_at: Option<DateTimeWithTimeZone>,
    /// 阅读进度 (0.0 - 1.0)
    pub read_progress: Option<f32>,
    /// 收藏时间
    pub starred_at: Option<DateTimeWithTimeZone>,
    /// 用户笔记
    #[sea_orm(column_type = "Text", nullable)]
    pub notes: Option<String>,
    /// 更新时间
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::brew_items::Entity",
        from = "Column::ItemId",
        to = "super::brew_items::Column::Id"
    )]
    BrewItem,
}

impl Related<super::brew_items::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::BrewItem.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

/// 批量标记已读请求
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MarkAllReadRequest {
    /// 订阅源 ID（可选，不传则标记所有）
    pub source_id: Option<i32>,
    /// 分类（可选）
    pub category: Option<String>,
    /// 截止时间（可选，标记此时间之前的文章）
    pub before: Option<i64>,
}

/// 离线同步请求（批量状态更新）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyncStatesRequest {
    pub states: Vec<SyncStateItem>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyncStateItem {
    pub item_id: i32,
    pub is_read: Option<bool>,
    pub is_starred: Option<bool>,
    pub read_progress: Option<f32>,
    pub updated_at: i64,
}

/// 同步响应
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyncStatesResponse {
    pub synced: i32,
    pub conflicts: Vec<SyncConflict>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SyncConflict {
    pub item_id: i32,
    pub server_updated_at: i64,
    pub client_updated_at: i64,
}
