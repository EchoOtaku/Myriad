//! Tapp 存储实体定义

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Tapp 键值存储
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "tapp_storage")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,

    /// 所属 Tapp ID
    #[sea_orm(column_type = "String(StringLen::N(255))")]
    pub tapp_id: String,

    /// 所属用户 ID
    pub user_id: i32,

    /// 键名
    #[sea_orm(column_type = "String(StringLen::N(255))")]
    pub key: String,

    /// 值 (JSON)
    #[sea_orm(column_type = "Json")]
    pub value: serde_json::Value,

    /// 创建时间
    pub created_at: DateTimeWithTimeZone,

    /// 更新时间
    pub updated_at: DateTimeWithTimeZone,
}

// Ownership is `(user_id, tapp_id)`. Do not expose a misleading tapp_id-only
// SeaORM relation; callers must filter by both columns explicitly.
#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
