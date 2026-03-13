//! 联邦关注关系实体
//!
//! 记录本地用户与远程 Actor 之间的双向关注关系

#![allow(dead_code)]

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federation_follows")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    pub remote_actor_id: i32,
    /// outgoing = 我关注ta, incoming = ta关注我
    pub direction: String,
    /// pending, accepted, rejected
    pub status: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub activity_id: Option<String>,
    pub created_at: DateTimeWithTimeZone,
    pub accepted_at: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::federation_remote_actors::Entity",
        from = "Column::RemoteActorId",
        to = "super::federation_remote_actors::Column::Id"
    )]
    RemoteActor,
}

impl Related<super::federation_remote_actors::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::RemoteActor.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
