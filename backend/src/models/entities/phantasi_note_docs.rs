//! 云端笔记文档。草稿和定时稿只活在这里，发布后才有 `phantasi_items`。

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "phantasi_note_docs")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    pub user_id: i32,
    /// 发布后才有。草稿 / 定时恒为 NULL。
    pub item_id: Option<i32>,
    #[sea_orm(column_type = "Text")]
    pub title: String,
    #[sea_orm(column_type = "Text")]
    pub content_md: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub topic: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub image: Option<String>,
    /// `draft` | `scheduled` | `published`
    pub status: String,
    pub scheduled_at: Option<DateTimeWithTimeZone>,
    /// 打算公开时用的发布时间；未发布也可先记着。
    pub published_at: Option<DateTimeWithTimeZone>,
    pub revision: i64,
    pub last_edited_by: Option<i32>,
    /// 到点发布失败时写给管理端看。成功就清空。
    #[sea_orm(column_type = "Text", nullable)]
    pub last_error: Option<String>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
