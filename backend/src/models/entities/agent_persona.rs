//! Site-wide Agent persona (name / personality / portrait). One row, id = "site".

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "agent_persona")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub name: String,
    pub personality: String,
    #[sea_orm(column_type = "Json", nullable)]
    pub persona_json: Option<Json>,
    #[sea_orm(column_type = "Json", nullable)]
    pub visual_profile: Option<Json>,
    #[sea_orm(nullable)]
    pub portrait_asset_id: Option<String>,
    #[sea_orm(column_type = "Json", nullable)]
    pub portrait_generation: Option<Json>,
    #[sea_orm(nullable)]
    pub updated_by: Option<i32>,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
