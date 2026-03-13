//! 远程实例信息实体
//!
//! 存储已知的联邦实例信息及信任等级

#![allow(dead_code)]

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federation_instances")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(column_type = "Text")]
    pub domain: String,
    pub software: Option<String>,
    pub software_version: Option<String>,
    pub mfp_version: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub nodeinfo_url: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub shared_inbox_url: Option<String>,
    pub trust_level: i16,
    pub is_blocked: bool,
    #[sea_orm(column_type = "Text", nullable)]
    pub block_reason: Option<String>,
    pub total_users: Option<i32>,
    pub active_users_monthly: Option<i32>,
    pub open_registrations: Option<bool>,
    #[sea_orm(column_type = "Json", nullable)]
    pub tapp_capabilities: Option<Json>,
    pub last_seen_at: Option<DateTimeWithTimeZone>,
    pub last_success_at: Option<DateTimeWithTimeZone>,
    pub failure_count: i32,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
