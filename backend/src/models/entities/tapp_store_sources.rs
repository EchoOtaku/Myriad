//! Tapp 商店源实体定义

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Tapp 远程商店源
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "tapp_store_sources")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,

    /// 商店名称
    #[sea_orm(column_type = "String(StringLen::N(255))")]
    pub name: String,

    /// 商店描述
    #[sea_orm(column_type = "Text", nullable)]
    pub description: Option<String>,

    /// 商店 URL（index.json 的 URL）
    #[sea_orm(column_type = "Text")]
    pub url: String,

    pub enabled: bool,

    /// 是否为官方商店
    pub official: bool,

    #[sea_orm(column_type = "String(StringLen::N(100))", nullable)]
    pub icon: Option<String>,

    pub created_at: DateTimeWithTimeZone,

    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
