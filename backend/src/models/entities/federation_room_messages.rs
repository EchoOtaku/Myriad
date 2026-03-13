//! 房间消息实体
//!
//! N:N 房间中的消息，支持线程和表情反应

#![allow(dead_code)]

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federation_room_messages")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(column_type = "Text")]
    pub room_id: String,
    #[sea_orm(column_type = "Text")]
    pub message_id: String,
    #[sea_orm(column_type = "Text")]
    pub sender_actor: String,
    /// text, file, tapp-event, system, vote
    pub message_type: String,
    #[sea_orm(column_type = "Json")]
    pub payload: Json,
    #[sea_orm(column_type = "Text", nullable)]
    pub thread_id: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub reply_to: Option<String>,
    #[sea_orm(column_type = "Json")]
    pub reactions: Json,
    pub is_pinned: bool,
    pub is_encrypted: bool,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::federation_rooms::Entity",
        from = "Column::RoomId",
        to = "super::federation_rooms::Column::RoomId"
    )]
    Room,
}

impl Related<super::federation_rooms::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Room.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
