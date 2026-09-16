//! 友联 / 订阅申请。公开提交，工作台审核后才写入 phantasi_sources。

use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "phantasi_source_applications")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    /// `friend`：朋友们申请友联。有 feed_url 时通过后会建成可抓订阅。
    pub kind: String,
    /// pending / approved / rejected
    pub status: String,
    #[sea_orm(column_type = "Text")]
    pub site_name: String,
    #[sea_orm(column_type = "Text")]
    pub site_url: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub feed_url: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub description: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub message: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub applicant_name: Option<String>,
    #[sea_orm(column_type = "Text", nullable)]
    pub applicant_email: Option<String>,
    pub applicant_user_id: Option<i32>,
    #[sea_orm(column_type = "Text", nullable)]
    pub applicant_ip: Option<String>,
    pub result_source_id: Option<i32>,
    #[sea_orm(column_type = "Text", nullable)]
    pub review_note: Option<String>,
    pub reviewed_by: Option<i32>,
    pub reviewed_at: Option<DateTimeWithTimeZone>,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ApplicationResponse {
    pub id: i32,
    pub kind: String,
    pub status: String,
    pub site_name: String,
    pub site_url: String,
    pub feed_url: Option<String>,
    pub description: Option<String>,
    pub message: Option<String>,
    pub applicant_name: Option<String>,
    pub applicant_email: Option<String>,
    pub applicant_user_id: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applicant_ip: Option<String>,
    pub result_source_id: Option<i32>,
    pub review_note: Option<String>,
    pub reviewed_by: Option<i32>,
    pub reviewed_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub has_feed: bool,
}

impl ApplicationResponse {
    pub fn from_model(model: Model, include_ip: bool) -> Self {
        let has_feed = model
            .feed_url
            .as_deref()
            .is_some_and(|url| !url.trim().is_empty());
        Self {
            id: model.id,
            kind: model.kind,
            status: model.status,
            site_name: model.site_name,
            site_url: model.site_url,
            feed_url: model.feed_url,
            description: model.description,
            message: model.message,
            applicant_name: model.applicant_name,
            applicant_email: model.applicant_email,
            applicant_user_id: model.applicant_user_id,
            applicant_ip: if include_ip { model.applicant_ip } else { None },
            result_source_id: model.result_source_id,
            review_note: model.review_note,
            reviewed_by: model.reviewed_by,
            reviewed_at: model.reviewed_at.map(|at| at.timestamp_millis()),
            created_at: model.created_at.timestamp_millis(),
            updated_at: model.updated_at.timestamp_millis(),
            has_feed,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct CreateApplicationRequest {
    pub site_name: String,
    pub site_url: String,
    pub feed_url: Option<String>,
    pub description: Option<String>,
    pub message: Option<String>,
    pub applicant_name: Option<String>,
    pub applicant_email: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct ReviewApplicationRequest {
    pub review_note: Option<String>,
}
