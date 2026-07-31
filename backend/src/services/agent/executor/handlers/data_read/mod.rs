//! Agent data-read capability handlers (platform, brew, RSSHub, catalog).
//!
//! Implementation lives in [`execute_platform_brew`] (formerly multi-file include! split).

mod execute_platform_brew;

pub use execute_platform_brew::*;
