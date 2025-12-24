//! Brew 阅读 - AI 注释实体
//!
//! 存储 Brewlia 功能生成的 AI 阅读辅助注释

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 注释类型
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, EnumIter, DeriveActiveEnum)]
#[sea_orm(rs_type = "String", db_type = "String(Some(20))")]
pub enum AnnotationType {
    /// 专业术语/难词
    #[sea_orm(string_value = "term")]
    Term,
    /// 代词指代（他/她/它、这个/那个）
    #[sea_orm(string_value = "reference")]
    Reference,
    /// 省略主语/隐含信息
    #[sea_orm(string_value = "implicit")]
    Implicit,
    /// 文化/背景知识
    #[sea_orm(string_value = "context")]
    Context,
    /// 缩写/简称
    #[sea_orm(string_value = "abbreviation")]
    Abbreviation,
}

impl Default for AnnotationType {
    fn default() -> Self {
        Self::Term
    }
}

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "brew_annotations")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    /// 关联文章 ID
    pub item_id: i32,
    /// 注释类型
    pub annotation_type: AnnotationType,
    /// 原词/短语（在文章中出现的文本）
    #[sea_orm(column_type = "Text")]
    pub term: String,
    /// 注释说明/释义
    #[sea_orm(column_type = "Text")]
    pub explanation: String,
    /// 在原文中的位置（字符偏移，可选）
    pub position: Option<i32>,
    /// 相关上下文（用于指代类型）
    #[sea_orm(column_type = "Text", nullable)]
    pub context_hint: Option<String>,
    /// 创建时间
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::brew_items::Entity",
        from = "Column::ItemId",
        to = "super::brew_items::Column::Id",
        on_delete = "Cascade"
    )]
    BrewItem,
}

impl Related<super::brew_items::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::BrewItem.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
