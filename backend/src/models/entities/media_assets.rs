//! 站点上传/生成媒体目录。外链缓存不进这张表。

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "media_assets")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    /// `upload` | `generated`
    pub kind: String,
    #[sea_orm(column_type = "Text", unique)]
    pub url: String,
    #[sea_orm(column_type = "Text")]
    pub mime: String,
    #[sea_orm(column_type = "Text")]
    pub name: String,
    pub size: i64,
    pub created_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
