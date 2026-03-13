//! 远程 Actor 缓存实体
//!
//! 存储来自远程实例的 ActivityPub Actor 信息

#![allow(dead_code)]

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federation_remote_actors")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(column_type = "Text")]
    pub actor_url: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub username: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub domain: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub display_name: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub avatar_url: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub summary: Option<String>,
    #[sea_orm(column_type = "Text")]
    pub inbox_url: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub outbox_url: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub shared_inbox_url: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub public_key_pem: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub public_key_id: Option<String>,
    pub software: Option<String>,
    pub mfp_version: Option<String>,
    #[sea_orm(column_type = "Json", nullable)]
    pub tapp_capabilities: Option<Json>,
    pub last_fetched_at: Option<DateTimeWithTimeZone>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
