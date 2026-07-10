//! release.json fetching, parsing, and validation.

pub mod cosign;
pub mod github;
pub mod manifest;

pub use cosign::{CosignPolicy, VerifyOutcome};
pub use github::{
    deploy_tag_to_git_ref, CommitInfo, CommitRelation, Freshness, GithubClient, Release,
};
pub use manifest::{ImageRef, Manifest};
