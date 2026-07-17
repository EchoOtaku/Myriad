//! Environment probe. Run at startup. Refuses to operate on environments we don't support
//! safely (named volumes, rootless docker, podman shim, missing compose binary, etc.).
//!
//! Probes are pure functions of the host environment plus a small set of paths from the CLI.
//! Result is serialized into `state/env-probe.json` so users can attach it to bug reports.

pub mod compose;
pub mod docker;
pub mod filesystem;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::Result;

pub struct ProbeInputs {
    pub state_dir: PathBuf,
    pub compose_dir: PathBuf,
    pub env_file: PathBuf,
    pub pgdata: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnvProbe {
    pub schema_version: u32,
    pub compose: compose::ComposeProbe,
    pub docker: docker::DockerProbe,
    pub pgdata: filesystem::PgdataProbe,
    pub env_file: filesystem::EnvFileProbe,
    #[serde(default)]
    pub fatal: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

impl EnvProbe {
    pub fn fatal_error(&self) -> Option<&str> {
        self.fatal.first().map(|s| s.as_str())
    }
    pub fn warnings(&self) -> impl Iterator<Item = &str> {
        self.warnings.iter().map(|s| s.as_str())
    }
}

pub async fn run_all(inputs: &ProbeInputs) -> Result<EnvProbe> {
    let mut fatal = Vec::new();
    let mut warnings = Vec::new();

    let compose = compose::probe(&inputs.compose_dir).await;
    if let Some(e) = &compose.error {
        fatal.push(format!("compose: {e}"));
    }
    if !compose.references_required_tag_vars {
        fatal.push(
            "compose file does not reference ${MYRIAD_TAG}; refusing to manage updates".into(),
        );
    }

    let docker_probe = docker::probe().await;
    if let Some(e) = &docker_probe.error {
        fatal.push(format!("docker: {e}"));
    }
    if docker_probe.rootless {
        fatal.push("rootless docker is not supported in M1".into());
    }
    if docker_probe.is_podman {
        fatal.push("podman is not supported in M1".into());
    }

    let pgdata = filesystem::probe_pgdata(&inputs.pgdata, &inputs.state_dir).await;
    if let Some(e) = &pgdata.error {
        fatal.push(format!("pgdata: {e}"));
    }
    if pgdata.is_named_volume {
        fatal.push(
            "pgdata appears to be a docker named volume; M1 requires a bind mount. \
             See docs/updater-spec.md §19 for migration steps."
                .into(),
        );
    }
    if !pgdata.exists {
        fatal.push(format!(
            "pgdata path {} does not exist inside the updater container; check volume mounts",
            inputs.pgdata.display()
        ));
    }

    let env_file = filesystem::probe_env_file(&inputs.env_file).await;
    if !env_file.exists {
        fatal.push(format!(
            ".env file {} not mounted into updater",
            inputs.env_file.display()
        ));
    } else if env_file.duplicate_keys {
        fatal.push(".env contains duplicate keys; refusing to manage".into());
    } else if !env_file.has_required_tag_vars {
        fatal.push(
            ".env is missing MYRIAD_TAG / PROXY_TAG / UPDATER_TAG; cannot perform updates".into(),
        );
    }

    if pgdata.cross_device {
        warnings.push(format!(
            "pgdata is on a different filesystem from {}/snapshots; rename rollback unavailable, falling back to copy",
            inputs.state_dir.display()
        ));
    }
    if let Some(skew) = docker_probe.daemon_time_skew_seconds {
        if skew.abs() > 300 {
            warnings.push(format!(
                "docker daemon clock skew is {skew}s; TLS or rate-limit issues may appear"
            ));
        }
    }

    Ok(EnvProbe {
        schema_version: 1,
        compose,
        docker: docker_probe,
        pgdata,
        env_file,
        fatal,
        warnings,
    })
}
