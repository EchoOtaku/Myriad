//! Tapp AI playground: generation routes, types, and validation helpers/tests.
//!
//! `helpers` is nested under `types_generate` so validators stay private to
//! generation code while unit tests live with the helpers.

mod types_generate;

pub use types_generate::*;
