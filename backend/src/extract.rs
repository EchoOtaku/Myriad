//! 请求提取器（axum `FromRequestParts`）
//!
//! # 为什么存在
//!
//! `main.rs` 里曾有 129 个 `*_wrapper` 函数，占了这个 7.5k 行文件的绝大部分。
//! 它们全是同一段样板：
//!
//! ```ignore
//! async fn get_config_wrapper() -> Response {
//!     let db_opt = DB_CONNECTION.read().await;
//!     match db_opt.as_ref() {
//!         Some(db) => api::config::get_config(State(db.clone())).await.into_response(),
//!         None => (SERVICE_UNAVAILABLE, Json(json!({"error": "Database not connected"}))).into_response(),
//!     }
//! }
//! ```
//!
//! 「从全局取 DB，取不到就 503」正是提取器的职责。把它写成 `FromRequestParts`
//! 之后，路由可以直接指向 `api::` 里的处理函数，样板整体消失。
//!
//! 数据库连接之所以放在全局 `RwLock` 而不是 axum `State`，是因为进程可能先以
//! CONFIG_MODE 启动（没有数据库），稍后才接上 —— 路由表在那之前就已经装好了。

use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::StatusCode;
use axum::Json;
use sea_orm::DatabaseConnection;
use serde_json::{json, Value};

use crate::middleware::auth::Claims;

/// 已连接的数据库。
///
/// 数据库不可用时以 503 短路，与旧 wrapper 的行为逐字一致。
#[derive(Debug)]
pub struct Db(pub DatabaseConnection);

impl<S: Send + Sync> FromRequestParts<S> for Db {
    type Rejection = (StatusCode, Json<Value>);

    async fn from_request_parts(_parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        crate::DB_CONNECTION
            .read()
            .await
            .clone()
            .map(Db)
            .ok_or_else(|| {
                (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({
                        "error": "Database not connected",
                        "message": "数据库未连接"
                    })),
                )
            })
    }
}

/// 认证中间件放进扩展的 JWT claims。
///
/// 仅在已挂 `auth_middleware` / `admin_middleware` 的路由上使用 —— 中间件负责
/// 验签，这里只是把结果取出来。没有中间件时缺失即 401，不会误放行。
#[derive(Debug)]
pub struct AuthedClaims(pub Claims);

impl<S: Send + Sync> FromRequestParts<S> for AuthedClaims {
    type Rejection = (StatusCode, Json<Value>);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<Claims>()
            .cloned()
            .map(AuthedClaims)
            .ok_or_else(|| {
                (
                    StatusCode::UNAUTHORIZED,
                    Json(json!({"error": "Not authenticated"})),
                )
            })
    }
}

/// 当前仍然是管理员的调用者。
///
/// # 为什么是提取器而不是删掉
///
/// 12 个处理函数原本在函数体里手写这段检查（`federation_admin_required` /
/// `verify_current_admin_from_headers`）。其中一半的路由已经挂了
/// `admin_middleware`，看起来是纯冗余；但**另一半没有** —— 那 6 个 ring 端点
/// 的路由只有 router 级的 `auth_middleware`（普通登录），函数体里那次检查
/// 是它们唯一的管理员防线。
///
/// 把检查搬进提取器同时解决两件事：
///
/// - 样板消失，且**要求写在函数签名里**，不会因为路由被挪动、重挂中间件
///   而悄悄丢掉（这个仓库刚出过同类问题：inbox 白名单加了、分派没加）。
/// - 与 `admin_middleware` 叠加时是幂等的，重复检查只是多一次数据库查询。
///
/// `ensure_current_admin` 不只看 JWT 里的 `is_admin`，还会回查数据库确认账号
/// **当前**仍是管理员 —— 防的是「降权之后旧 token 仍然生效」。
#[derive(Debug)]
pub struct AdminClaims(pub Claims);

impl<S: Send + Sync> FromRequestParts<S> for AdminClaims {
    type Rejection = (StatusCode, Json<Value>);

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let AuthedClaims(claims) = AuthedClaims::from_request_parts(parts, state).await?;
        crate::middleware::auth::ensure_current_admin(&claims).await?;
        Ok(AdminClaims(claims))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;

    fn parts_with<T: Clone + Send + Sync + 'static>(ext: Option<T>) -> Parts {
        let mut req = Request::builder().body(()).unwrap();
        if let Some(v) = ext {
            req.extensions_mut().insert(v);
        }
        req.into_parts().0
    }

    fn claims(sub: &str) -> Claims {
        Claims {
            sub: sub.to_string(),
            username: "tester".into(),
            is_admin: false,
            exp: 0,
            iat: 0,
        }
    }

    #[tokio::test]
    async fn authed_claims_reads_middleware_extension() {
        let mut parts = parts_with(Some(claims("42")));
        let got = AuthedClaims::from_request_parts(&mut parts, &())
            .await
            .unwrap();
        assert_eq!(got.0.sub, "42");
    }

    #[tokio::test]
    async fn authed_claims_rejects_when_middleware_absent() {
        // 路由漏挂认证中间件时必须 401，绝不能放行
        let mut parts = parts_with::<Claims>(None);
        let err = AuthedClaims::from_request_parts(&mut parts, &())
            .await
            .unwrap_err();
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn db_extractor_503s_when_disconnected() {
        // 全局连接在单测里始终是 None（没有启动过服务）
        let mut parts = parts_with::<Claims>(None);
        let err = Db::from_request_parts(&mut parts, &()).await.unwrap_err();
        assert_eq!(err.0, StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn admin_claims_rejects_when_middleware_absent() {
        // 路由漏挂认证中间件 → 401，绝不放行
        let mut parts = parts_with::<Claims>(None);
        let err = AdminClaims::from_request_parts(&mut parts, &())
            .await
            .unwrap_err();
        assert_eq!(err.0, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn admin_claims_rejects_non_admin_before_touching_the_db() {
        // is_admin=false 在回查数据库之前就短路 —— 这条不依赖数据库可用
        let mut parts = parts_with(Some(claims("42")));
        let err = AdminClaims::from_request_parts(&mut parts, &())
            .await
            .unwrap_err();
        assert_eq!(err.0, StatusCode::FORBIDDEN);
    }

    /// 每个管理端点的签名里都必须带 `AdminClaims`。
    ///
    /// 对 6 个 ring 端点这是**唯一**的管理员防线（它们的路由只有 router 级
    /// `auth_middleware`）；对站点管理端点它与 `admin_middleware` 叠加，
    /// 保证路由被重挂时防护不会随之消失。
    ///
    /// 降级成 `AuthedClaims` 会把这些能力开放给任何登录用户。
    #[test]
    fn admin_endpoints_keep_the_admin_extractor() {
        let src = include_str!("main.rs");
        for handler in [
            // 路由只有 auth_middleware —— AdminClaims 是唯一防线
            "federation_create_ring",
            "federation_add_ring_peer",
            "federation_remove_ring_peer",
            "federation_leave_ring",
            "federation_trigger_ring_sync",
            "federation_update_trust_policy",
            // 路由有 admin_middleware —— AdminClaims 是纵深防御
            "export_settings",
            "update_config",
            "restore_settings",
            "preview_settings_restore",
            "change_site_domain",
            "admin_federation_domain_move",
        ] {
            let sig = src
                .split(&format!("async fn {handler}("))
                .nth(1)
                .unwrap_or_else(|| panic!("{handler} not found"));
            let params = sig.split(") -> Response").next().unwrap();
            assert!(
                params.contains("AdminClaims"),
                "{handler} must take AdminClaims; downgrading to AuthedClaims would \
                 expose an administrative capability to any logged-in user"
            );
        }
    }
}
