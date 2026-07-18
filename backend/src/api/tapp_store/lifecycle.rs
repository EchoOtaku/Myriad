use super::{
    current_is_admin, find_admin_user_id, get_admin_user_id, validate_tapp_id, ApiResponse,
};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseBackend, DatabaseConnection,
    EntityTrait, QueryFilter, QueryOrder, Set, Statement,
};
use serde::{Deserialize, Serialize};

use crate::middleware::auth::Claims;
use crate::models::entities::{tapp_user_activities, tapps};

/// 启动 Tapp
///
/// 权限模型（private-first，与 list/detail/runtime 一致）：
/// - 主体有同 `tapp_id` 的私有安装时：更新该私有行状态
/// - 否则站点主公开安装：管理员写库；非管理员只记活动（前端会话态）
/// - 普通用户可以启动自己临时安装的 Tapp
///
/// 所有用户启动 Tapp 时都会记录到 tapp_user_activities 表
pub(super) async fn start_tapp(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(tapp_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    validate_tapp_id(&tapp_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let admin_id = find_admin_user_id(&db).await?;
    let now = Utc::now().fixed_offset();
    let is_current_admin = current_is_admin(&claims).await;

    // Prefer the subject's private install when both private and public copies exist.
    if admin_id != Some(user_id) {
        let user_tapp = tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(user_id))
            .filter(tapps::Column::TappId.eq(&tapp_id))
            .one(&db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if let Some(tapp) = user_tapp {
            let mut active: tapps::ActiveModel = tapp.into();
            active.status = Set(tapps::TappStatus::Running);
            active.last_run_at = Set(Some(now));
            active.updated_at = Set(now);
            active
                .update(&db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            record_user_activity(&db, user_id, &tapp_id, now).await?;
            return Ok(Json(ApiResponse::success(())));
        }
    }

    // Pure-public session: non-owners may start without mutating the public row.
    if let Some(admin_id) = admin_id {
        let admin_tapp = tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(admin_id))
            .filter(tapps::Column::TappId.eq(&tapp_id))
            .one(&db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if let Some(tapp) = admin_tapp {
            if is_current_admin {
                let mut active: tapps::ActiveModel = tapp.into();
                active.status = Set(tapps::TappStatus::Running);
                active.last_run_at = Set(Some(now));
                active.updated_at = Set(now);
                active
                    .update(&db)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            }
            record_user_activity(&db, user_id, &tapp_id, now).await?;
            return Ok(Json(ApiResponse::success(())));
        }
    }

    Err(StatusCode::NOT_FOUND)
}

/// 记录用户 Tapp 使用活动
///
/// 使用 upsert 模式：如果记录存在则更新 last_run_at 和 run_count，否则插入新记录
async fn record_user_activity(
    db: &DatabaseConnection,
    user_id: i32,
    tapp_id: &str,
    now: chrono::DateTime<chrono::FixedOffset>,
) -> Result<(), StatusCode> {
    // One atomic upsert avoids duplicate-key failures when the same Tapp is
    // started concurrently from multiple tabs or backend replicas.
    db.execute(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"INSERT INTO tapp_user_activities
               (user_id, tapp_id, last_run_at, run_count)
           VALUES ($1, $2, $3, 1)
           ON CONFLICT (user_id, tapp_id) DO UPDATE SET
               last_run_at = EXCLUDED.last_run_at,
               run_count = tapp_user_activities.run_count + 1"#,
        vec![user_id.into(), tapp_id.into(), now.into()],
    ))
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(())
}

/// 停止 Tapp
///
/// 权限模型（private-first，与 list/detail/runtime 一致）：
/// - 主体有同 `tapp_id` 的私有安装时：更新该私有行状态并吊销 grant
/// - 否则站点主公开安装：管理员写库；非管理员只吊销自身 grant（不改公开行）
/// - 普通用户可以停止自己临时安装的 Tapp
pub(super) async fn stop_tapp(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Path(tapp_id): Path<String>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    validate_tapp_id(&tapp_id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let admin_id = find_admin_user_id(&db).await?;
    let is_current_admin = current_is_admin(&claims).await;

    // Prefer the subject's private install when both private and public copies exist.
    if admin_id != Some(user_id) {
        let user_tapp = tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(user_id))
            .filter(tapps::Column::TappId.eq(&tapp_id))
            .one(&db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if let Some(tapp) = user_tapp {
            let now = Utc::now().fixed_offset();
            let mut active: tapps::ActiveModel = tapp.into();
            active.status = Set(tapps::TappStatus::Installed);
            active.updated_at = Set(now);
            active
                .update(&db)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            crate::api::tapp_runtime::revoke_tapp_runtime_grants(user_id, &tapp_id).await;
            return Ok(Json(ApiResponse::success(())));
        }
    }

    // Pure-public session: non-owners stop without mutating the public row.
    if let Some(admin_id) = admin_id {
        let admin_tapp = tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(admin_id))
            .filter(tapps::Column::TappId.eq(&tapp_id))
            .one(&db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if let Some(tapp) = admin_tapp {
            if is_current_admin {
                let now = Utc::now().fixed_offset();
                let mut active: tapps::ActiveModel = tapp.into();
                active.status = Set(tapps::TappStatus::Installed);
                active.updated_at = Set(now);
                active
                    .update(&db)
                    .await
                    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
            }
            crate::api::tapp_runtime::revoke_tapp_runtime_grants(user_id, &tapp_id).await;
            return Ok(Json(ApiResponse::success(())));
        }
    }

    Err(StatusCode::NOT_FOUND)
}

/// 最近使用的 Tapp 响应项
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RecentTappItem {
    pub id: String,
    pub name: String,
    pub icon: Option<String>,
    pub icon_svg: Option<String>,
    pub theme_color: Option<String>,
    pub last_run_at: String,
    pub run_count: i32,
}

/// 获取最近使用的 Tapp 查询参数
#[derive(Debug, Deserialize)]
pub(super) struct GetRecentTappsQuery {
    /// 返回的最大数量，默认 10
    #[serde(default = "default_recent_limit")]
    limit: i32,
}

fn default_recent_limit() -> i32 {
    10
}

/// 获取当前用户最近使用的 Tapp 列表
///
/// 从 tapp_user_activities 表中获取，按 last_run_at 降序排列
pub(super) async fn get_recent_tapps(
    State(db): State<DatabaseConnection>,
    Extension(claims): Extension<Claims>,
    Query(query): Query<GetRecentTappsQuery>,
) -> Result<Json<ApiResponse<Vec<RecentTappItem>>>, StatusCode> {
    let user_id: i32 = claims.sub.parse().map_err(|_| StatusCode::UNAUTHORIZED)?;
    let limit = query.limit.clamp(1, 50) as u64; // 限制在 1-50 之间

    // 获取用户活动记录
    let activities = tapp_user_activities::Entity::find()
        .filter(tapp_user_activities::Column::UserId.eq(user_id))
        .order_by_desc(tapp_user_activities::Column::LastRunAt)
        .all(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Guests cannot start a Tapp and therefore have no activity rows. Return
    // an honest empty result without requiring a configured site owner.
    if activities.is_empty() {
        return Ok(Json(ApiResponse::success(Vec::new())));
    }

    let admin_id = get_admin_user_id(&db).await?;

    // 获取管理员的所有 Tapp（用于查找 Tapp 详情）
    let admin_tapps = tapps::Entity::find()
        .filter(tapps::Column::UserId.eq(admin_id))
        .all(&db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // 获取用户自己的临时 Tapp
    let user_tapps = if user_id != admin_id {
        tapps::Entity::find()
            .filter(tapps::Column::UserId.eq(user_id))
            .all(&db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    } else {
        Vec::new()
    };

    // 合并 Tapp 列表，建立 tapp_id -> tapp 映射
    let mut tapp_map: std::collections::HashMap<String, &tapps::Model> =
        std::collections::HashMap::new();
    for tapp in &admin_tapps {
        tapp_map.insert(tapp.tapp_id.clone(), tapp);
    }
    for tapp in &user_tapps {
        tapp_map.entry(tapp.tapp_id.clone()).or_insert(tapp);
    }

    // 构建响应
    let mut result: Vec<RecentTappItem> = Vec::new();
    for activity in activities {
        if result.len() >= limit as usize {
            break;
        }

        // 查找对应的 Tapp 详情
        if let Some(tapp) = tapp_map.get(&activity.tapp_id) {
            // 从 manifest 中提取 iconSvg
            let icon_svg = tapp
                .manifest
                .get("iconSvg")
                .and_then(|v| v.as_str())
                .map(String::from);

            result.push(RecentTappItem {
                id: activity.tapp_id.clone(),
                name: tapp.name.clone(),
                icon: tapp.icon.clone(),
                icon_svg,
                theme_color: tapp.theme_color.clone(),
                last_run_at: activity.last_run_at.to_rfc3339(),
                run_count: activity.run_count,
            });
        }
        // 如果 Tapp 已被卸载，跳过该记录
    }

    Ok(Json(ApiResponse::success(result)))
}
