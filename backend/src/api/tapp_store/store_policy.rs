//! Store availability follows the server's federation egress gate.
use super::{ApiResponse, api_http_error};
use crate::error::HttpError;
use crate::services::federation_gate;
use axum::Json;
use axum::http::StatusCode;
use serde::Serialize;
use std::time::Duration;

fn check_permissions(permissions: &[String], federation_enabled: bool) -> Result<(), HttpError> {
    if !federation_enabled && permissions.iter().any(|p| p.starts_with("federation:")) {
        return Err(api_http_error(
            StatusCode::FORBIDDEN,
            "Federation apps cannot be downloaded or installed in this server's region",
        ));
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct StorePolicy {
    federation_enabled: bool,
}

pub(super) async fn get_store_policy() -> impl axum::response::IntoResponse {
    let federation_enabled = federation_gate::wait_until_resolved(Duration::from_secs(10)).await;
    (
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(ApiResponse::success(StorePolicy { federation_enabled })),
    )
}

/// Uses declarations, never the caller's selected approval subset. This is
/// installation eligibility; runtime grants remain independently filtered.
pub(super) async fn ensure_permissions_allowed(permissions: &[String]) -> Result<(), HttpError> {
    if !permissions.iter().any(|p| p.starts_with("federation:")) {
        return Ok(());
    }
    let enabled = federation_gate::wait_until_resolved(Duration::from_secs(10)).await;
    check_permissions(permissions, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::response::IntoResponse;

    #[test]
    fn closed_gate_rejects_declared_federation_even_without_approval() {
        for permission in ["federation:read", "federation:room", "federation:future"] {
            let error = check_permissions(&[permission.into()], false).unwrap_err();
            assert_eq!(error.into_response().status(), StatusCode::FORBIDDEN);
        }
    }

    #[test]
    fn server_location_decision_controls_install_eligibility() {
        use crate::services::server_location::unavailable_assessment;
        for (codes, allowed) in [
            (vec!["CN"], false),
            (vec!["JP", "CN"], false),
            (vec!["JP"], true),
            (vec!["HK"], true),
            (vec!["MO"], true),
            (vec!["TW"], true),
            (vec![], true),
        ] {
            let mut assessment = unavailable_assessment(false);
            assessment.country_codes = codes.into_iter().map(str::to_owned).collect();
            let (enabled, _) = federation_gate::decide(&assessment);
            assert_eq!(
                check_permissions(&["federation:read".into()], enabled).is_ok(),
                allowed
            );
        }
    }

    #[test]
    fn ordinary_apps_and_open_gate_are_unaffected() {
        assert!(check_permissions(&[], false).is_ok());
        assert!(check_permissions(&["network:fetch".into()], false).is_ok());
        assert!(check_permissions(&["federation:read".into()], true).is_ok());
    }
}
