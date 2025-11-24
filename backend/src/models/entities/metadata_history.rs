use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "metadata_history")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub metadata_id: Option<i32>,
    pub user_id: i32,
    pub platform_name: String,
    pub changed_fields: Json,
    pub old_data: Option<Json>,
    pub new_data: Option<Json>,
    pub change_date: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::platform_metadata::Entity",
        from = "Column::MetadataId",
        to = "super::platform_metadata::Column::Id",
        on_delete = "Cascade"
    )]
    PlatformMetadata,
}

impl Related<super::platform_metadata::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::PlatformMetadata.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
