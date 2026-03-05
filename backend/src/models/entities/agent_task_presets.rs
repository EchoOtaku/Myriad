//! Agent 任务预设实体
//!
//! 用于存储用户的任务预设和对话历史：
//! - history: 最近使用的任务历史（最多保留 20 条）
//! - favorite: 用户收藏的任务（永久保存，除非手动删除）
//!
//! 支持两种操作模式：
//! - 重新运行：使用 input + parsed_steps 执行新任务
//! - 继续对话：加载 conversation_data 上下文继续对话

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "agent_task_presets")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    #[sea_orm(column_type = "Text")]
    pub input: String,
    /// 预设类型: 'favorite' 或 'history'
    #[sea_orm(column_type = "String(StringLen::N(16))")]
    pub preset_type: String,
    /// 解析后的步骤（JSON 格式）
    #[sea_orm(column_type = "Json", nullable)]
    pub parsed_steps: Option<Json>,
    /// 意图摘要
    #[sea_orm(column_type = "String(StringLen::N(255))", nullable)]
    pub intent_summary: Option<String>,
    /// 最后使用时间
    pub last_used_at: DateTimeWithTimeZone,
    /// 使用次数
    pub use_count: i32,
    /// 创建时间
    pub created_at: DateTimeWithTimeZone,
    /// 对话标题（自动生成或用户设置）
    #[sea_orm(column_type = "String(StringLen::N(255))", nullable)]
    pub title: Option<String>,
    /// 对话历史数据（JSON 格式）
    /// 存储消息列表：[{role, content, metadata?, created_at}]
    #[sea_orm(column_type = "Json", nullable)]
    pub conversation_data: Option<Json>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
