//! Thin wrapper over bollard for the few operations we need: pull, manifest inspect,
//! HTTP probe inside the container network.

use std::time::Duration;

use bollard::auth::DockerCredentials;
use bollard::query_parameters::CreateImageOptions;
use bollard::Docker;
use futures::StreamExt;
use tracing::debug;

use crate::error::{Result, UpdaterError};

pub struct DockerClient {
    inner: Docker,
}

impl DockerClient {
    pub async fn connect() -> Result<Self> {
        // bollard auto-detects via /var/run/docker.sock or DOCKER_HOST.
        let docker = Docker::connect_with_local_defaults()
            .map_err(|e| UpdaterError::Docker(format!("connect: {e}")))?;
        // Cheap liveness check.
        docker
            .ping()
            .await
            .map_err(|e| UpdaterError::Docker(format!("ping: {e}")))?;
        Ok(Self { inner: docker })
    }

    pub fn raw(&self) -> &Docker {
        &self.inner
    }

    /// Pull an image, streaming progress lines. Returns the resolved digest of the pulled image
    /// (read from `inspect` post-pull).
    pub async fn pull(&self, image_ref: &str, creds: Option<DockerCredentials>) -> Result<String> {
        let (image, tag) = parse_image_ref(image_ref);
        let opts = CreateImageOptions {
            from_image: Some(image.clone()),
            tag: Some(tag.clone()),
            ..Default::default()
        };
        let mut stream = self.inner.create_image(Some(opts), None, creds);
        while let Some(item) = stream.next().await {
            match item {
                Ok(info) => {
                    if let Some(status) = info.status {
                        debug!(image = %image_ref, %status, "pull progress");
                    }
                    if let Some(err) = info.error_detail {
                        let msg = err.message.unwrap_or_default();
                        return Err(UpdaterError::Docker(format!("pull {image_ref}: {msg}")));
                    }
                }
                Err(e) => return Err(UpdaterError::Docker(format!("pull stream: {e}"))),
            }
        }
        // Resolve digest via inspect.
        let inspect = self
            .inner
            .inspect_image(image_ref)
            .await
            .map_err(|e| UpdaterError::Docker(format!("inspect {image_ref}: {e}")))?;
        let digest = inspect
            .repo_digests
            .as_ref()
            .and_then(|v| v.first())
            .and_then(|s| s.split_once('@').map(|(_, d)| d.to_string()))
            .or(inspect.id)
            .ok_or_else(|| {
                UpdaterError::Docker(format!("could not determine digest for {image_ref}"))
            })?;
        Ok(digest)
    }

    /// Probe an HTTP endpoint inside the compose network by shelling out to a one-shot curl
    /// container attached to the same Docker network as the managed services.
    /// Returns (status_code, body_truncated_to_8k).
    pub async fn http_probe(&self, target: &str, timeout: Duration) -> Result<(u16, String)> {
        use bollard::container::LogOutput;
        use bollard::models::ContainerCreateBody;
        use bollard::query_parameters::{
            CreateContainerOptions, LogsOptions, StartContainerOptions, WaitContainerOptions,
        };
        let name = format!("myriad-probe-{}", uuid::Uuid::new_v4().simple());
        let cfg = ContainerCreateBody {
            image: Some("curlimages/curl:8.5.0".to_string()),
            cmd: Some(vec![
                "-sS".to_string(),
                "--max-time".to_string(),
                timeout.as_secs().to_string(),
                "-o".to_string(),
                "/dev/stderr".to_string(),
                "-w".to_string(),
                "%{http_code}".to_string(),
                target.to_string(),
            ]),
            host_config: Some(bollard::models::HostConfig {
                auto_remove: Some(true),
                network_mode: Some(compose_network_name()),
                ..Default::default()
            }),
            ..Default::default()
        };
        let created = self
            .inner
            .create_container(
                Some(CreateContainerOptions {
                    name: Some(name.clone()),
                    ..Default::default()
                }),
                cfg,
            )
            .await
            .map_err(|e| UpdaterError::Docker(format!("create probe: {e}")))?;
        self.inner
            .start_container(&created.id, None::<StartContainerOptions>)
            .await
            .map_err(|e| UpdaterError::Docker(format!("start probe: {e}")))?;
        let _ = self
            .inner
            .wait_container(&created.id, None::<WaitContainerOptions>)
            .collect::<Vec<_>>()
            .await;

        let mut stream = self.inner.logs(
            &created.id,
            Some(LogsOptions {
                stdout: true,
                stderr: true,
                ..Default::default()
            }),
        );
        let mut stdout = String::new();
        let mut stderr = String::new();
        while let Some(item) = stream.next().await {
            match item {
                Ok(LogOutput::StdOut { message }) => {
                    stdout.push_str(&String::from_utf8_lossy(&message));
                }
                Ok(LogOutput::StdErr { message }) => {
                    stderr.push_str(&String::from_utf8_lossy(&message));
                }
                _ => {}
            }
        }
        let code: u16 = stdout.trim().parse().unwrap_or(0);
        // Trim body.
        if stderr.len() > 8192 {
            stderr.truncate(8192);
        }
        Ok((code, stderr))
    }

    /// Inspect a container by name and return whether it is running.
    pub async fn is_running(&self, name: &str) -> Result<bool> {
        let info = self
            .inner
            .inspect_container(name, None)
            .await
            .map_err(|e| UpdaterError::Docker(format!("inspect {name}: {e}")))?;
        Ok(info.state.as_ref().and_then(|s| s.running).unwrap_or(false))
    }

    pub async fn ping(&self) -> Result<()> {
        self.inner
            .ping()
            .await
            .map(|_| ())
            .map_err(|e| UpdaterError::Docker(format!("ping: {e}")))?;
        Ok(())
    }

    /// Create an additional tag for an already-local image (does not pull).
    /// Used to pin last-known-good backend/frontend images so casual
    /// `docker image prune` does not remove the only rollback target.
    pub async fn tag_image(
        &self,
        source_ref: &str,
        target_repo: &str,
        target_tag: &str,
    ) -> Result<()> {
        use bollard::query_parameters::TagImageOptionsBuilder;
        let opts = TagImageOptionsBuilder::default()
            .repo(target_repo)
            .tag(target_tag)
            .build();
        self.inner
            .tag_image(source_ref, Some(opts))
            .await
            .map_err(|e| {
                UpdaterError::Docker(format!(
                    "tag {source_ref} → {target_repo}:{target_tag}: {e}"
                ))
            })?;
        Ok(())
    }

    /// True if the named image ref exists locally (inspect succeeds).
    pub async fn image_exists_local(&self, image_ref: &str) -> bool {
        self.inner.inspect_image(image_ref).await.is_ok()
    }
}

/// Split "registry/image:tag" into (image_without_tag, tag).
/// Falls back to tag = "latest" if absent; release preflight rejects latest for managed components.
fn parse_image_ref(s: &str) -> (String, String) {
    // We must avoid splitting on ":" inside the registry port (e.g. "host:5000/img:tag").
    // Strategy: split off everything after the last '/' first.
    let (prefix, last) = match s.rsplit_once('/') {
        Some((a, b)) => (Some(a), b),
        None => (None, s),
    };
    let (img_name, tag) = match last.split_once(':') {
        Some((n, t)) => (n.to_string(), t.to_string()),
        None => (last.to_string(), "latest".to_string()),
    };
    let full_image = match prefix {
        Some(p) => format!("{p}/{img_name}"),
        None => img_name,
    };
    (full_image, tag)
}

fn compose_network_name() -> String {
    compose_network_name_from_env(std::env::var("MYRIAD_DOCKER_NETWORK").ok())
}

fn compose_network_name_from_env(explicit_network: Option<String>) -> String {
    if let Some(name) = explicit_network {
        let trimmed = name.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    "myriad-net".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_image_basic() {
        assert_eq!(
            parse_image_ref("docker.io/foo/bar:v1.2.3"),
            ("docker.io/foo/bar".to_string(), "v1.2.3".to_string())
        );
    }

    #[test]
    fn parse_image_with_registry_port() {
        assert_eq!(
            parse_image_ref("host:5000/foo/bar:v1"),
            ("host:5000/foo/bar".to_string(), "v1".to_string())
        );
    }

    #[test]
    fn parse_image_no_tag() {
        assert_eq!(
            parse_image_ref("alpine"),
            ("alpine".to_string(), "latest".to_string())
        );
    }

    #[test]
    fn compose_network_defaults_to_explicit_compose_network_name() {
        assert_eq!(compose_network_name_from_env(None), "myriad-net");
    }

    #[test]
    fn compose_network_allows_explicit_override() {
        assert_eq!(
            compose_network_name_from_env(Some("external_net".to_string())),
            "external_net"
        );
    }
}
