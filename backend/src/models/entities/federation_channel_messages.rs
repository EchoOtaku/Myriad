//! 通道消息实体
//!
//! 1:1 通道内的消息记录

#![allow(dead_code)]

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federation_channel_messages")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(column_type = "Text")]
    pub channel_id: String,
    #[sea_orm(column_type = "Text")]
    pub message_id: String,
    #[sea_orm(column_type = "Text")]
    pub sender_actor: String,
    /// text, file-meta, rpc-request, rpc-response, system
    pub message_type: String,
    #[sea_orm(column_type = "Json")]
    pub payload: Json,
    #[sea_orm(column_type = "Text", nullable)]
    pub reply_to: Option<String>,
    pub is_encrypted: bool,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::federation_channels::Entity",
        from = "Column::ChannelId",
        to = "super::federation_channels::Column::ChannelId"
    )]
    Channel,
}

impl Related<super::federation_channels::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Channel.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
