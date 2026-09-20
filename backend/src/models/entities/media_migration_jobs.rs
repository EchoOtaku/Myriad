//! 有界媒体迁移进度。不要把整个目录 JSON 塞进 configurations。

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "media_migration_jobs")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(column_type = "Text")]
    pub source_kind: String,
    #[sea_orm(column_type = "Text")]
    pub source_key: String,
    pub asset_id: Option<i32>,
    #[sea_orm(column_type = "Text")]
    pub copy_state: String,
    #[sea_orm(column_type = "Text")]
    pub verify_state: String,
    #[sea_orm(column_type = "Text")]
    pub switch_state: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub error_code: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub cursor: Option<String>,
    pub batch_version: i32,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::media_assets::Entity",
        from = "Column::AssetId",
        to = "super::media_assets::Column::Id"
    )]
    Asset,
}

impl ActiveModelBehavior for ActiveModel {}
