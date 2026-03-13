//! 房间成员实体
//!
//! 记录房间成员及其角色权限

#![allow(dead_code)]

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federation_room_members")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(column_type = "Text")]
    pub room_id: String,
    #[sea_orm(column_type = "Text")]
    pub actor_url: String,
    pub is_local: bool,
    pub local_user_id: Option<i32>,
    /// owner, admin, member, observer
    pub role: String,
    #[sea_orm(column_type = "Json", nullable)]
    pub custom_permissions: Option<Json>,
    pub joined_at: DateTimeWithTimeZone,
    #[sea_orm(column_type = "Text", nullable)]
    pub invited_by: Option<String>,
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
