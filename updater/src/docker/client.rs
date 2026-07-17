//! Thin wrapper over bollard for the few operations we need: pull, manifest inspect,
//! HTTP probe inside the container network.

use std::time::Duration;

use bollard::auth::DockerCredentials;
use bollard::query_parameters::CreateImageOptions;
use bollard::Docker;
use futures::StreamExt;
use tracing::{debug, warn};

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

    /// Probe an HTTP endpoint reachable from the compose network.
    ///
    /// Strategy (in order — each is independent so one broken path cannot fail the update):
    /// 1. **Direct HTTP** from this process (updater is on `myriad-net`).
    /// 2. **`docker exec` wget/curl inside the target service container** (localhost — no DNS,
    ///    no extra images). Used when `service_hint` is `backend` / `frontend`.
    /// 3. **One-shot curl container** (pulls image if needed; never AutoRemove-before-logs).
    ///
    /// Returns `(status_code, body_truncated_to_8k)`.
    pub async fn http_probe(&self, target: &str, timeout: Duration) -> Result<(u16, String)> {
        self.http_probe_with_hint(target, timeout, None).await
    }

    /// Like [`http_probe`] but enables in-container exec for known services.
    pub async fn http_probe_with_hint(
        &self,
        target: &str,
        timeout: Duration,
        service_hint: Option<&str>,
    ) -> Result<(u16, String)> {
        let mut errors: Vec<String> = Vec::new();

        match direct_http_probe(target, timeout).await {
            Ok(result) if result.0 > 0 => return Ok(result),
            Ok((code, body)) => {
                errors.push(format!(
                    "direct HTTP returned code {code} body_len={}",
                    body.len()
                ));
            }
            Err(e) => errors.push(format!("direct: {e}")),
        }

        if let Some(hint) = service_hint {
            match self.http_probe_via_exec(hint, timeout).await {
                Ok(result) if result.0 > 0 => return Ok(result),
                Ok((code, body)) => {
                    errors.push(format!("exec/{hint} code {code} body_len={}", body.len()));
                }
                Err(e) => errors.push(format!("exec/{hint}: {e}")),
            }
        }

        match self.http_probe_via_curl_container(target, timeout).await {
            Ok(result) if result.0 > 0 => Ok(result),
            Ok((code, body)) => {
                errors.push(format!(
                    "curl-container code {code} body_len={}",
                    body.len()
                ));
                // Prefer returning a structured failure over Ok(0) so callers log usefully.
                if code == 0 {
                    Err(UpdaterError::Docker(format!(
                        "all probe paths failed for {target}: {}",
                        errors.join(" | ")
                    )))
                } else {
                    Ok((code, body))
                }
            }
            Err(e) => {
                errors.push(format!("curl-container: {e}"));
                Err(UpdaterError::Docker(format!(
                    "all probe paths failed for {target}: {}",
                    errors.join(" | ")
                )))
            }
        }
    }

    /// Probe backend/frontend by exec'ing wget/curl against localhost inside that container.
    async fn http_probe_via_exec(&self, service: &str, timeout: Duration) -> Result<(u16, String)> {
        let (names, url) = match service {
            "backend" => (
                ["myriad-backend", "backend"],
                "http://127.0.0.1:1103/health",
            ),
            "frontend" => (["myriad-frontend", "frontend"], "http://127.0.0.1:1102/"),
            other => {
                return Err(UpdaterError::Docker(format!(
                    "exec probe: unknown service hint {other}"
                )));
            }
        };

        let mut last_err = String::from("no container");
        for name in names {
            if !self.is_running(name).await.unwrap_or(false) {
                last_err = format!("{name} not running");
                continue;
            }
            // Prefer wget (present in backend/frontend images); fall back to curl/sh.
            let scripts = [
                format!(
                    "wget -qO- --timeout={} '{url}' 2>/dev/null || true",
                    timeout.as_secs().max(2)
                ),
                format!(
                    "curl -sS --max-time {} '{url}' 2>/dev/null || true",
                    timeout.as_secs().max(2)
                ),
            ];
            for script in scripts {
                match self.exec_capture(name, &["sh", "-c", &script]).await {
                    Ok(body) if !body.trim().is_empty() => {
                        // wget/curl success with body → treat as HTTP 200
                        let mut body = body;
                        if body.len() > 8192 {
                            body.truncate(8192);
                        }
                        return Ok((200, body));
                    }
                    Ok(_) => last_err = format!("{name}: empty body"),
                    Err(e) => last_err = format!("{name}: {e}"),
                }
            }
        }
        Err(UpdaterError::Docker(format!(
            "exec probe {service}: {last_err}"
        )))
    }

    /// Run a command in a container and capture combined stdout (truncated).
    pub async fn exec_capture(&self, container: &str, cmd: &[&str]) -> Result<String> {
        use bollard::container::LogOutput;
        use bollard::exec::{CreateExecOptions, StartExecOptions, StartExecResults};

        let exec = self
            .inner
            .create_exec(
                container,
                CreateExecOptions {
                    attach_stdout: Some(true),
                    attach_stderr: Some(true),
                    cmd: Some(cmd.iter().map(|s| s.to_string()).collect()),
                    ..Default::default()
                },
            )
            .await
            .map_err(|e| UpdaterError::Docker(format!("create_exec {container}: {e}")))?;

        let start = self
            .inner
            .start_exec(
                &exec.id,
                Some(StartExecOptions {
                    detach: false,
                    tty: false,
                    output_capacity: Some(16 * 1024),
                }),
            )
            .await
            .map_err(|e| UpdaterError::Docker(format!("start_exec {container}: {e}")))?;

        let mut out = String::new();
        match start {
            StartExecResults::Attached { mut output, .. } => {
                while let Some(item) = output.next().await {
                    match item {
                        Ok(LogOutput::StdOut { message }) | Ok(LogOutput::StdErr { message }) => {
                            out.push_str(&String::from_utf8_lossy(&message));
                        }
                        Ok(_) => {}
                        Err(e) => {
                            return Err(UpdaterError::Docker(format!("exec stream: {e}")));
                        }
                    }
                }
            }
            StartExecResults::Detached => {
                return Err(UpdaterError::Docker("exec returned detached".into()));
            }
        }
        if out.len() > 8192 {
            out.truncate(8192);
        }
        Ok(out)
    }

    /// Image reference the container was created with (e.g. `repo:dev-abc1234`).
    pub async fn container_image_ref(&self, name: &str) -> Result<String> {
        let info = self
            .inner
            .inspect_container(name, None)
            .await
            .map_err(|e| UpdaterError::Docker(format!("inspect {name}: {e}")))?;
        Ok(info.config.and_then(|c| c.image).unwrap_or_default())
    }

    /// Docker healthcheck status if defined: "healthy" | "unhealthy" | "starting" | …
    pub async fn container_health_status(&self, name: &str) -> Option<String> {
        let info = self.inner.inspect_container(name, None).await.ok()?;
        info.state?
            .health?
            .status
            .map(|s| s.to_string().to_ascii_lowercase())
    }

    async fn http_probe_via_curl_container(
        &self,
        target: &str,
        timeout: Duration,
    ) -> Result<(u16, String)> {
        use bollard::container::LogOutput;
        use bollard::models::ContainerCreateBody;
        use bollard::query_parameters::{
            CreateContainerOptions, LogsOptions, RemoveContainerOptions, StartContainerOptions,
            WaitContainerOptions,
        };

        const CURL_IMAGE: &str = "curlimages/curl:8.5.0";
        // Ensure image exists — create_container does not pull, and a missing image makes
        // every health tick fail for the full 300s deadline with no useful body.
        if !self.image_exists_local(CURL_IMAGE).await {
            debug!(image = CURL_IMAGE, "pulling probe curl image");
            let _ = self.pull(CURL_IMAGE, None).await.map_err(|e| {
                UpdaterError::Docker(format!(
                    "pull {CURL_IMAGE} for health probe failed: {e} \
                     (direct probe also failed; check updater is on the compose network)"
                ))
            })?;
        }

        let name = format!("myriad-probe-{}", uuid::Uuid::new_v4().simple());
        let cfg = ContainerCreateBody {
            image: Some(CURL_IMAGE.to_string()),
            cmd: Some(vec![
                "-sS".to_string(),
                "--max-time".to_string(),
                timeout.as_secs().to_string(),
                // Body on stdout, status code on last line via -w after body would mix —
                // keep code on stdout only and body on stderr (same as before).
                "-o".to_string(),
                "/dev/stderr".to_string(),
                "-w".to_string(),
                "%{http_code}".to_string(),
                target.to_string(),
            ]),
            host_config: Some(bollard::models::HostConfig {
                // CRITICAL: do not AutoRemove before we read logs (moby#44212 class race).
                auto_remove: Some(false),
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
        let id = created.id.clone();
        let result = async {
            self.inner
                .start_container(&id, None::<StartContainerOptions>)
                .await
                .map_err(|e| UpdaterError::Docker(format!("start probe: {e}")))?;
            let _ = self
                .inner
                .wait_container(&id, None::<WaitContainerOptions>)
                .collect::<Vec<_>>()
                .await;

            let mut stream = self.inner.logs(
                &id,
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
                    Ok(_) => {}
                    Err(e) => {
                        return Err(UpdaterError::Docker(format!("probe logs: {e}")));
                    }
                }
            }
            let code: u16 = stdout.trim().parse().unwrap_or(0);
            if stderr.len() > 8192 {
                stderr.truncate(8192);
            }
            Ok((code, stderr))
        }
        .await;

        // Best-effort cleanup regardless of probe outcome.
        let _ = self
            .inner
            .remove_container(
                &id,
                Some(RemoveContainerOptions {
                    force: true,
                    ..Default::default()
                }),
            )
            .await;

        result
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

    /// Stop a container by name; escalate to kill if still running.
    /// Used before pgdata restore so bind mounts are fully released.
    pub async fn force_stop_container(&self, name: &str) -> Result<()> {
        use bollard::query_parameters::{KillContainerOptionsBuilder, StopContainerOptionsBuilder};
        if !self.is_running(name).await.unwrap_or(false) {
            return Ok(());
        }
        let stop_opts = StopContainerOptionsBuilder::default().t(15).build();
        if let Err(e) = self.inner.stop_container(name, Some(stop_opts)).await {
            warn!(%name, err = %e, "docker stop failed; trying kill");
        }
        // Brief wait for graceful stop.
        for _ in 0..10 {
            if !self.is_running(name).await.unwrap_or(false) {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let kill_opts = KillContainerOptionsBuilder::default()
            .signal("SIGKILL")
            .build();
        self.inner
            .kill_container(name, Some(kill_opts))
            .await
            .map_err(|e| UpdaterError::Docker(format!("kill {name}: {e}")))?;
        Ok(())
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

/// Direct HTTP probe from the updater process (same Docker network as backend/frontend).
async fn direct_http_probe(target: &str, timeout: Duration) -> Result<(u16, String)> {
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(timeout.min(Duration::from_secs(5)))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| UpdaterError::Docker(format!("probe client: {e}")))?;
    let resp = client
        .get(target)
        .send()
        .await
        .map_err(|e| UpdaterError::Docker(format!("probe GET {target}: {e}")))?;
    let code = resp.status().as_u16();
    let mut body = resp
        .text()
        .await
        .map_err(|e| UpdaterError::Docker(format!("probe body: {e}")))?;
    if body.len() > 8192 {
        body.truncate(8192);
    }
    Ok((code, body))
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
