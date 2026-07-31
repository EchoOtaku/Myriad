//! Site analytics intake and admin export/import.
//!
//! Real submodules: [`intake_helpers`] (collect/pageview + shared caches) and
//! [`admin_api`] (summary, visitor card, backup).

mod intake_helpers;
mod admin_api;

pub use intake_helpers::{collect, record_pageview};
pub use admin_api::{export_analytics, get_summary, get_visitor_card, import_analytics};

#[cfg(test)]
mod tests_inline;
