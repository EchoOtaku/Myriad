//! Bounded MCP client runtime. No database, web framework or platform globals.
//! Hosts inject transport policy, gateway authentication and status reporting;
//! editable server definitions cannot choose gateway endpoints or credentials.
#![deny(tail_expr_drop_order)]
mod actor;
pub mod config;
pub mod connection;
pub mod http;
pub mod manager;
pub mod protocol;
pub mod server;
pub mod transport;

/// Report lifecycle transitions. Implementations must return immediately;
/// asynchronous notification delivery belongs to the embedding application.
pub type StatusReporter = std::sync::Arc<dyn Fn(String, bool) + Send + Sync>;

#[cfg(all(test, unix))]
mod test_support;
