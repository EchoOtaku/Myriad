//! Phantasi 阅读 - AI 播客实体
//!
//! 存储 Phantasiai 功能生成的 AI 播客脚本

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// 播客对话项
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PodcastDialogue {
    /// 说话者：host_a 或 host_b
    pub speaker: String,
    /// 对话内容
    pub text: String,
}

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "phantasi_podcasts")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    /// 关联文章 ID（唯一）
    #[sea_orm(unique)]
    pub item_id: i32,
    /// 播客标题
    #[sea_orm(column_type = "Text")]
    pub title: String,
    /// 检测到的语言
    #[sea_orm(column_type = "String(StringLen::N(20))", nullable)]
    pub language: Option<String>,
    /// 对话列表（JSON 格式）
    #[sea_orm(column_type = "JsonBinary")]
    pub dialogues: Json,
    /// 预计时长（秒）
    pub estimated_duration: Option<i32>,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::phantasi_items::Entity",
        from = "Column::ItemId",
        to = "super::phantasi_items::Column::Id",
        on_delete = "Cascade"
    )]
    PhantasiItem,
}

impl Related<super::phantasi_items::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::PhantasiItem.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

impl Model {
    /// 解析对话列表
    pub fn get_dialogues(&self) -> Vec<PodcastDialogue> {
        serde_json::from_value(self.dialogues.clone()).unwrap_or_default()
    }
}

/// 播客响应（API 返回格式）
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PodcastResponse {
    pub success: bool,
    pub title: String,
    pub dialogues: Vec<PodcastDialogue>,
    pub language: Option<String>,
    pub estimated_duration: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_cache: Option<bool>,
}

impl From<Model> for PodcastResponse {
    fn from(m: Model) -> Self {
        let dialogues = m.get_dialogues();
        Self {
            success: true,
            title: m.title,
            dialogues,
            language: m.language,
            estimated_duration: m.estimated_duration.unwrap_or(60),
            from_cache: Some(true),
        }
    }
}
