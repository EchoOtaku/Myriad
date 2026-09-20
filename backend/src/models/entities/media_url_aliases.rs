//! 已登记的本站历史路径。禁止从任意请求 URL 反推磁盘位置。

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "media_url_aliases")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(column_type = "Text", unique)]
    pub local_path: String,
    pub asset_id: i32,
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
