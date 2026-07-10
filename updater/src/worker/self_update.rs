//! Updater 自我更新流程。Spec §14。
//!
//! 难点：updater 不能在自己运行的进程里 `docker compose up -d updater`，因为执行到一半
//! 自己就被 stop 掉了。解决：launch 一个 helper container（复用新版本 updater 镜像，自带
//! docker-ce-cli + docker-compose-plugin），让它在 updater 容器死亡之后继续执行 compose up。
//!
//! 流程：
//!   1. 拉 release manifest，校验目标 updater 镜像 digest
//!   2. docker pull 目标 updater 镜像
//!   3. 改 .env 把 UPDATER_TAG 替换成新 tag
//!   4. 启动 helper container（image = 新版 updater，entrypoint = sleep + compose up）
//!      - auto_remove = true
//!      - mounts: docker.sock + compose dir + env file
//!   5. 立即返回 helper container id；helper sleep 几秒后 compose up 自己（旧 updater）被替换
//!
//! 失败时不修改 .env，旧 updater 继续跑。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use bollard::models::{ContainerCreateBody, HostConfig};
use bollard::query_parameters::{CreateContainerOptions, StartContainerOptions};
use tracing::{info, warn};

use crate::env_file::EnvFile;
use crate::error::{Result, UpdaterError};
use crate::worker::Worker;

const HELPER_NAME_PREFIX: &str = "myriad-updater-self-update-";
/// 给当前 updater HTTP 响应一点时间再让 helper 接管。
const HELPER_STARTUP_DELAY_SECS: u32 = 5;

pub async fn run(worker: Arc<Worker>) -> Result<SelfUpdateReport> {
    let cfg = worker.config();
    let gh = worker.github_client()?;

    info!("self-update: fetching latest release manifest");
    // Map commit-mode branch names (main/preview) onto release channels.
    let ch_name =
        crate::version::release_channel_name_for_self_update(&worker.effective_channel());
    let ch: crate::config::Channel = ch_name.parse().unwrap_or(cfg.channel);
    info!(channel = %ch, "self-update: using release channel");
    let rel = gh
        .latest_for_channel(ch)
        .await?
        .ok_or_else(|| UpdaterError::Precondition("channel has no releases".into()))?;
    let manifest = gh.fetch_manifest(&rel.tag_name).await?;

    let updater_img = manifest.image("updater").ok_or_else(|| {
        UpdaterError::Precondition("release manifest has no `updater` image".into())
    })?;

    let target_tag = manifest.version.as_str().to_string();
    info!(target = %target_tag, "self-update: pulling new updater image");

    let pulled_digest = worker.docker_pull_with_mirror(&updater_img.r#ref).await?;
    if !pulled_digest.ends_with(&updater_img.digest) && pulled_digest != updater_img.digest {
        return Err(UpdaterError::Precondition(format!(
            "updater digest mismatch: pulled {pulled_digest}, expected {}",
            updater_img.digest
        )));
    }

    // 修改 .env 的 UPDATER_TAG。失败时 helper 不会启动，旧 updater 继续运行。
    info!(new_tag = %target_tag, "self-update: rewriting UPDATER_TAG in .env");
    {
        let mut env = EnvFile::load(&worker.cli().env_file)?;
        env.set("UPDATER_TAG", &target_tag)?;
        env.save()?;
    }

    let helper_id = launch_helper(worker.clone(), &updater_img.r#ref).await?;
    worker.state().append_history(&format!(
        "self-update launched: new_tag={target_tag} helper={helper_id}"
    ))?;
    info!(helper_id = %helper_id, "self-update: helper container started — this updater will be replaced");

    Ok(SelfUpdateReport {
        helper_container_id: helper_id,
        new_updater_tag: target_tag,
    })
}

async fn launch_helper(worker: Arc<Worker>, helper_image: &str) -> Result<String> {
    let project = std::env::var("COMPOSE_PROJECT_NAME").unwrap_or_else(|_| "myriad".into());
    let name = format!("{HELPER_NAME_PREFIX}{}", uuid::Uuid::new_v4().simple());
    let compose_source = resolve_host_bind_source(&worker, &worker.cli().compose_dir).await?;
    let env_source = resolve_host_bind_source(&worker, &worker.cli().env_file).await?;

    // 用 host 网络省去网络配置（helper 只跟 docker.sock 交互，不需要业务网络）。
    let host_cfg = HostConfig {
        auto_remove: Some(true),
        network_mode: Some("host".into()),
        binds: Some(vec![
            "/var/run/docker.sock:/var/run/docker.sock".into(),
            format!("{}:/host/compose", compose_source.to_string_lossy()),
            format!("{}:/host/.env", env_source.to_string_lossy()),
        ]),
        ..Default::default()
    };

    let script = format!(
        // 1) 等待主 updater 把 HTTP 响应返回客户端
        // 2) docker compose up -d --no-deps updater（recreate 容器）
        //    --env-file 显式指向 .env 避免 compose 找不到
        "sleep {delay} && \
         cd /host/compose && \
         docker compose -p {project} --env-file /host/.env up -d --no-deps updater",
        delay = HELPER_STARTUP_DELAY_SECS,
        project = project,
    );

    let container_cfg = ContainerCreateBody {
        image: Some(helper_image.to_string()),
        entrypoint: Some(vec!["sh".into(), "-c".into()]),
        cmd: Some(vec![script]),
        host_config: Some(host_cfg),
        labels: Some(
            [
                ("myriad.role".to_string(), "self-update-helper".to_string()),
                ("myriad.project".to_string(), project.clone()),
            ]
            .into_iter()
            .collect(),
        ),
        ..Default::default()
    };

    let created = worker
        .docker()
        .raw()
        .create_container(
            Some(CreateContainerOptions {
                name: Some(name.clone()),
                ..Default::default()
            }),
            container_cfg,
        )
        .await
        .map_err(|e| UpdaterError::Docker(format!("create self-update helper: {e}")))?;

    if !created.warnings.is_empty() {
        for w in &created.warnings {
            warn!(warning = %w, "self-update helper create warning");
        }
    }

    worker
        .docker()
        .raw()
        .start_container(&created.id, None::<StartContainerOptions>)
        .await
        .map_err(|e| UpdaterError::Docker(format!("start self-update helper: {e}")))?;

    Ok(created.id)
}

async fn resolve_host_bind_source(worker: &Arc<Worker>, container_path: &Path) -> Result<PathBuf> {
    let container_id = current_container_id()?;
    let info = worker
        .docker()
        .raw()
        .inspect_container(&container_id, None)
        .await
        .map_err(|e| UpdaterError::Docker(format!("inspect current updater container: {e}")))?;

    let mut best: Option<(usize, PathBuf)> = None;
    for mount in info.mounts.unwrap_or_default() {
        let (Some(source), Some(destination)) = (mount.source, mount.destination) else {
            continue;
        };
        let destination = PathBuf::from(destination);
        if !container_path.starts_with(&destination) {
            continue;
        }
        let rel = container_path
            .strip_prefix(&destination)
            .unwrap_or_else(|_| Path::new(""));
        let score = destination.as_os_str().len();
        if best
            .as_ref()
            .is_none_or(|(best_score, _)| score > *best_score)
        {
            best = Some((score, PathBuf::from(source).join(rel)));
        }
    }

    best.map(|(_, source)| source).ok_or_else(|| {
        UpdaterError::Precondition(format!(
            "could not map container path {} to a host bind mount source; \
             self-update requires the updater compose/env paths to come from bind mounts",
            container_path.display()
        ))
    })
}

fn current_container_id() -> Result<String> {
    if let Ok(hostname) = std::env::var("HOSTNAME") {
        let hostname = hostname.trim();
        if !hostname.is_empty() {
            return Ok(hostname.to_string());
        }
    }

    let hostname = std::fs::read_to_string("/etc/hostname")?;
    let hostname = hostname.trim();
    if hostname.is_empty() {
        return Err(UpdaterError::Precondition(
            "could not determine current updater container id".into(),
        ));
    }
    Ok(hostname.to_string())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SelfUpdateReport {
    pub helper_container_id: String,
    pub new_updater_tag: String,
}
