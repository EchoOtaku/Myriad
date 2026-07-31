//! Shared error surface for Myriad.
//!
//! # Why this crate exists
//!
//! Backend historically mixed `StatusCode` + ad-hoc `String` / JSON across API
//! and services. Putting a small, web-framework-free `AppError` here lets
//! `services` and future domain crates share one type without depending on
//! `api` (layering) or on Axum.
//!
//! # Modules
//!
//! - [`error`] — [`AppError`] / [`ErrorBody`]
//! - [`redact`] — [`redact::redact_secrets`] for logs and error bodies

pub mod error;
pub mod redact;

pub use error::{AppError, ErrorBody};
pub use redact::redact_secrets;
