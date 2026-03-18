//! Agent 会话实体
//!
//! 存储多轮对话会话，匹配 migration 004 的 agent_sessions 表

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "agent_sessions")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub user_id: i32,
    #[sea_orm(nullable)]
    pub title: Option<String>,
    #[sea_orm(column_type = "Json", nullable)]
    pub context: Option<Json>,
    pub message_count: i32,
    pub archived: bool,
    pub created_at: DateTimeWithTimeZone,
    pub last_active_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
