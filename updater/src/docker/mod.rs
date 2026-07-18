//! Docker engine and compose interaction.

pub mod client;
pub mod compose;
pub mod guard;
pub mod self_update_helper;

pub use client::DockerClient;
pub use compose::ComposeRunner;

pub(crate) const ROLLBACK_IMAGE_TAG: &str = "myriad-rollback";
