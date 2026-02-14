//! Agent 任务实体
//!
//! 用于持久化存储 Agent 任务状态，支持：
//! - 任务状态恢复
//! - 动态步骤保存
//! - 跨重启持久化

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "agent_tasks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub user_id: i32,
    pub recipe_id: String,
    pub status: String,
    pub current_step: i32,
    #[sea_orm(column_type = "Json")]
    pub step_results: Json,
    #[sea_orm(column_type = "Json", nullable)]
    pub execution_context: Option<Json>,
    #[sea_orm(column_type = "Json", nullable)]
    pub pending_question: Option<Json>,
    pub progress: i16,
    #[sea_orm(column_type = "Text", nullable)]
    pub error: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub original_request: Option<String>,
    pub started_at: DateTimeWithTimeZone,
    pub completed_at: Option<DateTimeWithTimeZone>,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
