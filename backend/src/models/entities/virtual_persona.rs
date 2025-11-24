use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "virtual_persona")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    pub slot: i32,
    pub name: String,
    pub personality: String,
    pub appearance: String,
    pub hobbies: Json,
    pub life_style: String,
    pub visual_style: Option<String>,
    pub image_prompt: Option<String>,
    pub image_url: Option<String>,
    pub generated_at: DateTime,
    pub expires_at: Option<DateTime>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
