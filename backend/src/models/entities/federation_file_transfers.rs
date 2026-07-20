//! 文件传输记录实体
//!
//! 通道内的文件传输状态跟踪

#![allow(dead_code)]

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federation_file_transfers")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    /// Channel (DM) transfers set a real id; room transfers use empty string + room_id.
    #[sea_orm(column_type = "Text")]
    pub channel_id: String,
    /// Group transfer scope (null for DM)
    #[sea_orm(column_type = "Text", nullable)]
    pub room_id: Option<String>,
    /// Local uploader user id (room outbound ACL)
    pub owner_user_id: Option<i32>,
    #[sea_orm(column_type = "Text")]
    pub transfer_id: String,
    #[sea_orm(column_type = "Text")]
    pub filename: String,
    pub file_size: i64,
    pub mime_type: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub checksum_sha256: Option<String>,
    /// outbound / inbound
    pub direction: String,
    /// pending, transferring, completed, failed, cancelled
    pub status: String,
    pub chunks_total: Option<i32>,
    pub chunks_completed: i32,
    #[sea_orm(column_type = "Text", nullable)]
    pub local_path: Option<String>,
    pub created_at: DateTimeWithTimeZone,
    pub completed_at: Option<DateTimeWithTimeZone>,
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
