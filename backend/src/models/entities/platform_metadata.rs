use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "platform_metadata")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: String,
    pub platform_name: String,
    pub raw_data: Json,
    pub fetched_at: DateTimeWithTimeZone,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_many = "super::metadata_history::Entity")]
    MetadataHistory,
}

impl Related<super::metadata_history::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::MetadataHistory.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
