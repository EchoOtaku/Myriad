//! 联邦 N:N 房间实体
//!
//! 多人持久化房间，支持 Tapp 协作

#![allow(dead_code)]

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federation_rooms")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(column_type = "Text")]
    pub room_id: String,
    pub name: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub description: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub avatar_url: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub owner_actor: String,
    #[sea_orm(column_type = "Text")]
    pub home_server: String,
    /// owner, democratic, open
    pub governance_type: String,
    #[sea_orm(column_type = "Json", nullable)]
    pub governance_config: Option<Json>,
    #[sea_orm(column_type = "Json", nullable)]
    pub enabled_tapps: Option<Json>,
    #[sea_orm(column_type = "Json", nullable)]
    pub shared_data_config: Option<Json>,
    /// fan-out, mesh
    pub distribution_strategy: String,
    pub max_members: i32,
    pub is_public: bool,
    /// admin-only, member-invite, open
    pub invite_policy: String,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::federation_room_members::Entity")]
    Members,
    #[sea_orm(has_many = "super::federation_room_messages::Entity")]
    Messages,
}

impl Related<super::federation_room_members::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Members.def()
    }
}

impl Related<super::federation_room_messages::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Messages.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
