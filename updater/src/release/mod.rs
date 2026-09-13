//! release.json fetching, parsing, and validation.

pub mod cosign;
pub mod dockerhub;
pub mod github;
pub mod manifest;

pub use cosign::{CosignPolicy, VerifyOutcome};
pub use dockerhub::{
    CommitUpgradeDirection, ComponentTag, DockerBuild, DockerHubClient, commit_upgrade_direction,
    commit_upgrade_direction_ex, is_cross_kind_deploy, pushed_at_for_tag, same_commit_identity,
    same_deploy_identity, select_component_tip, select_dev_channel_tip, select_dev_channel_tip_for,
};
pub use github::{
    CommitInfo, CommitRelation, Freshness, GithubClient, Release, deploy_tag_to_git_ref,
};
pub use manifest::{ImageRef, Manifest};
