//! HTTP API surface. Routes match docs/updater-spec.md §13.

pub mod auth;
pub mod routes;

use std::sync::Arc;

use axum::Router;

use crate::config::Config;
use crate::state::StateDir;
use crate::worker::Worker;

#[derive(Clone)]
pub struct ApiState {
    pub worker: Arc<Worker>,
    pub state: Arc<StateDir>,
    pub config: Config,
}

pub fn router(state: ApiState) -> Router {
    routes::build(state)
}
