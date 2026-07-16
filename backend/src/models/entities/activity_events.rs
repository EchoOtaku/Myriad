use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "activity_events")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    #[sea_orm(unique)]
    pub metadata_history_id: i32,
    pub metadata_id: Option<i32>,
    pub user_id: i32,
    pub platform_name: String,
    pub event_type: String,
    pub title: String,
    pub changes: Json,
    pub change_count: i32,
    pub importance: i16,
    pub occurred_at: DateTime,
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::metadata_history::Entity",
        from = "Column::MetadataHistoryId",
        to = "super::metadata_history::Column::Id",
        on_delete = "Cascade"
    )]
    MetadataHistory,
}

impl Related<super::metadata_history::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::MetadataHistory.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
