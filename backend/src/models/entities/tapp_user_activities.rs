//! Tapp 用户活动记录实体定义
//!
//! 记录用户使用 Tapp 的历史，用于显示"最近使用"列表

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Tapp 用户活动记录实体
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "tapp_user_activities")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,

    /// 用户 ID
    pub user_id: i32,

    /// Tapp 唯一标识符 (如 com.example.my-app)
    #[sea_orm(column_type = "String(Some(255))")]
    pub tapp_id: String,

    /// 最后运行时间
    pub last_run_at: DateTimeWithTimeZone,

    /// 运行次数
    pub run_count: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
