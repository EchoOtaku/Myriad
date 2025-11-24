use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "virtual_personas")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    pub slot: i32, // 0 或 1，支持两个人设
    pub name: String,
    pub personality: Option<String>,
    pub appearance: Option<String>,
    pub hobbies: Option<Json>, // JSON数组
    pub life_style: Option<String>,
    pub visual_style: Option<String>,
    pub image_prompt: Option<String>,
    pub image_url: Option<String>,
    pub created_at: DateTime,
    pub updated_at: DateTime,
    pub expires_at: Option<DateTime>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
