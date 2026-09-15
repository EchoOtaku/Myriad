//! Agent data-read capability handlers (platform, phantasi, RSSHub, catalog).

mod catalog;
mod config_time_auth;
mod execute;
mod extras_platform;
mod pages;
mod permission;
mod phantasi;
mod phantasi_generate;
mod platform;
mod rsshub;
mod search;

pub use execute::execute;
