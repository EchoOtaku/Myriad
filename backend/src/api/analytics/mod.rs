//! Site analytics intake and admin export/import.
//!
//! Real submodules: [`intake_helpers`] (collect/pageview + shared caches),
//! [`admin_api`] (summary, visitor card, backup), and [`ai_usage`] (AI cost ledger).

mod intake_helpers;
mod admin_api;
mod ai_usage;

pub use intake_helpers::{collect, record_pageview};
pub use admin_api::{export_analytics, get_summary, get_visitor_card, import_analytics};
pub use ai_usage::get_ai_usage_summary;

#[cfg(test)]
mod tests_inline;
