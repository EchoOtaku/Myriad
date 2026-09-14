//! 去中心化环成员关系实体
//!
//! Ring: 无中心服务器的 Gossip 协议环

#![allow(dead_code)]

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federation_ring_memberships")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(column_type = "Text")]
    pub ring_id: String,
    pub ring_name: Option<String>,
    /// tapp-store, phantasi-recommend, library-exchange, instance-directory
    pub ring_type: String,
    #[sea_orm(column_type = "Json", nullable)]
    pub gossip_config: Option<Json>,
    #[sea_orm(column_type = "Json", nullable)]
    pub known_peers: Option<Json>,
    pub last_sync_at: Option<DateTimeWithTimeZone>,
    pub joined_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
