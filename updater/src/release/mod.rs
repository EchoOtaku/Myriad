//! release.json fetching, parsing, and validation.

pub mod cosign;
pub mod github;
pub mod manifest;

pub use cosign::{CosignPolicy, VerifyOutcome};
pub use github::GithubClient;
pub use manifest::{ImageRef, Manifest};
