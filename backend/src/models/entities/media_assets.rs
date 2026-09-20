//! 站点上传/生成媒体目录。外链缓存不进这张表。
//!
//! 新写入走 `services::media`。`url` 只是兼容输出，不再定位磁盘文件。

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "media_assets")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    /// `upload` | `generated` 兼容投影，不表达所有权。
    pub kind: String,
    #[sea_orm(column_type = "Text", unique)]
    pub url: String,
    #[sea_orm(column_type = "Text")]
    pub mime: String,
    #[sea_orm(column_type = "Text")]
    pub name: String,
    pub size: i64,
    pub created_at: DateTimeWithTimeZone,
    pub public_id: Option<Uuid>,
    #[sea_orm(column_type = "Text", nullable)]
    pub scope: Option<String>,
    pub owner_user_id: Option<i32>,
    pub created_by: Option<i32>,
    #[sea_orm(column_type = "Text", nullable, unique)]
    pub storage_key: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub state: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub exposure: Option<String>,
    pub first_published_at: Option<DateTimeWithTimeZone>,
    #[sea_orm(column_type = "Text", nullable)]
    pub source: Option<String>,
    pub derived_from_id: Option<i32>,
    #[sea_orm(column_type = "Text", nullable)]
    pub checksum_sha256: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub updated_at: Option<DateTimeWithTimeZone>,
    pub state_since: Option<DateTimeWithTimeZone>,
    pub references_complete: bool,
    pub write_token: Option<Uuid>,
    pub write_lease_until: Option<DateTimeWithTimeZone>,
    #[sea_orm(column_type = "Text", nullable)]
    pub producer_key: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
