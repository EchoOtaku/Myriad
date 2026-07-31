//! Compatibility re-export of the services-layer Tapp registry adapter.
//!
//! Implementation: workspace crate [`myriad_tapp_registry`] +
//! [`crate::services::tapp_registry::database`]. Prefer importing
//! `crate::services::tapp_registry` from services code.

pub use crate::services::tapp_registry::*;
