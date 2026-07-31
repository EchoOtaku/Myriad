//! Outbound federation delivery queue, user observability APIs, and dispatch helpers.
//!
//! Real module: [`queue_and_query`]. Classification/retry unit tests live in
//! [`dispatch_helpers`].

mod queue_and_query;

pub use queue_and_query::*;

#[cfg(test)]
mod dispatch_helpers;
