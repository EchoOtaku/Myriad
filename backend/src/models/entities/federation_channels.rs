//! 联邦 1:1 双向通道实体
//!
//! 支持文本聊天、文件传输、RPC 调用、数据交换

#![allow(dead_code)]

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federation_channels")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(column_type = "Text")]
    pub channel_id: String,
    pub user_id: i32,
    pub remote_actor_id: i32,
    /// text, file-transfer, rpc, data-exchange, stream
    pub channel_type: String,
    /// 关联的 Tapp ID
    pub tapp_id: Option<String>,
    /// pending, accepted, active, closed, rejected
    pub status: String,
    /// http, websocket
    pub transport: String,
    #[sea_orm(column_type = "Json", nullable)]
    pub properties: Option<Json>,
    /// local 或 remote
    pub initiated_by: String,
    pub last_activity_at: Option<DateTimeWithTimeZone>,
    pub created_at: DateTimeWithTimeZone,
    pub closed_at: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::federation_remote_actors::Entity",
        from = "Column::RemoteActorId",
        to = "super::federation_remote_actors::Column::Id"
    )]
    RemoteActor,
    #[sea_orm(has_many = "super::federation_channel_messages::Entity")]
    Messages,
    #[sea_orm(has_many = "super::federation_file_transfers::Entity")]
    FileTransfers,
}

impl Related<super::federation_remote_actors::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RemoteActor.def()
    }
}

impl Related<super::federation_channel_messages::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Messages.def()
    }
}

impl Related<super::federation_file_transfers::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::FileTransfers.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
