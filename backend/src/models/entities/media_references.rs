//! 业务消费者对媒体资产的引用。无数据库级业务表外键；写路径必须自行维护。

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "media_references")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub asset_id: i32,
    #[sea_orm(column_type = "Text")]
    pub consumer_type: String,
    #[sea_orm(column_type = "Text")]
    pub consumer_id: String,
    #[sea_orm(column_type = "Text")]
    pub slot: String,
    pub requires_public: bool,
    pub expires_at: Option<DateTimeWithTimeZone>,
    pub created_at: DateTimeWithTimeZone,
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
