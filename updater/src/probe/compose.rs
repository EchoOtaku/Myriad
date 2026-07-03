//! Probe the host's docker compose configuration.

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComposeProbe {
    /// Which command is invokable: "docker compose" (v2) or "docker-compose" (v1) or None.
    pub binary: Option<ComposeBinary>,
    pub compose_files: Vec<PathBuf>,
    /// True if compose.yaml/yml references `${MYRIAD_TAG}` (and friends) as required by spec.
    pub references_required_tag_vars: bool,
    pub project_name_pinned: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ComposeBinary {
    DockerComposeV2, // `docker compose`
    DockerComposeV1, // `docker-compose`
}

pub async fn probe(compose_dir: &Path) -> ComposeProbe {
    let binary = detect_binary().await;

    let mut files = Vec::new();
    for name in [
        "compose.yaml",
        "compose.yml",
        "docker-compose.yaml",
        "docker-compose.yml",
    ] {
        let p = compose_dir.join(name);
        if p.exists() {
            files.push(p);
        }
    }

    let mut refs_tag = false;
    for f in &files {
        if let Ok(s) = std::fs::read_to_string(f) {
            if s.contains("${MYRIAD_TAG}") || s.contains("$MYRIAD_TAG") {
                refs_tag = true;
                break;
            }
        }
    }

    let project_name_pinned = std::env::var("COMPOSE_PROJECT_NAME").is_ok()
        || files.iter().any(|f| {
            std::fs::read_to_string(f)
                .ok()
                .is_some_and(|s| s.lines().any(|l| l.trim_start().starts_with("name:")))
        });

    let error = if binary.is_none() {
        Some("neither `docker compose` (v2) nor `docker-compose` (v1) is available".into())
    } else if files.is_empty() {
        Some(format!(
            "no compose file found in {}; expected compose.yaml or docker-compose.yml",
            compose_dir.display()
        ))
    } else {
        None
    };

    ComposeProbe {
        binary,
        compose_files: files,
        references_required_tag_vars: refs_tag,
        project_name_pinned,
        error,
    }
}

async fn detect_binary() -> Option<ComposeBinary> {
    // Try v2 first.
    if let Ok(out) = Command::new("docker")
        .args(["compose", "version", "--short"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
    {
        if out.success() {
            return Some(ComposeBinary::DockerComposeV2);
        }
    }
    if let Ok(out) = Command::new("docker-compose")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
    {
        if out.success() {
            return Some(ComposeBinary::DockerComposeV1);
        }
    }
    None
}

impl ComposeBinary {
    /// Build a `Command` invoking the binary with `-p <project>` and the discovered compose file(s).
    pub fn command(&self, project: &str, files: &[PathBuf]) -> tokio::process::Command {
        let mut cmd = match self {
            ComposeBinary::DockerComposeV2 => {
                let mut c = Command::new("docker");
                c.arg("compose");
                c
            }
            ComposeBinary::DockerComposeV1 => Command::new("docker-compose"),
        };
        cmd.arg("-p").arg(project);
        for f in files {
            cmd.arg("-f").arg(f);
        }
        cmd
    }
}
