//! 联邦密钥对实体
//!
//! RSA-SHA256 密钥对，私钥通过 AES-256-GCM 加密存储

#![allow(dead_code)]

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "federation_keys")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    #[sea_orm(column_type = "Text")]
    pub public_key_pem: String,
    #[sea_orm(column_type = "Text")]
    pub private_key_encrypted: String,
    #[sea_orm(column_type = "Text")]
    pub key_id: String,
    pub algorithm: String,
    pub created_at: DateTimeWithTimeZone,
    pub rotated_at: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
