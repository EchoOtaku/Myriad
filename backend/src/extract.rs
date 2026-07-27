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
        let got = AuthedClaims::from_request_parts(&mut parts, &()).await.unwrap();
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
}
