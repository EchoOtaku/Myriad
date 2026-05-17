//! release.json fetching, parsing, and validation.

pub mod github;
pub mod manifest;

pub use github::GithubClient;
pub use manifest::{ImageRef, Manifest};
