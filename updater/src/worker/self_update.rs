//! Updater 自我更新流程。Spec §14。
//!
//! 难点：updater 不能在自己的容器里重建自己。由独立 docker guard 在返回响应后执行
//! `docker compose up -d updater`，所有 Docker API 请求仍经过 guard 的请求体策略。
//!
//! 流程：
//!   1. 拉 release manifest，校验目标 updater 镜像 digest
//!   2. docker pull 目标 updater 镜像
//!   3. 改 .env 把 UPDATER_TAG 替换成新 tag
//!   4. 请求 docker guard 延迟重建 updater
//!
//! 失败时不修改 .env，旧 updater 继续跑。

use std::sync::Arc;

use tracing::info;

use crate::env_file::EnvFile;
use crate::error::{Result, UpdaterError};
use crate::worker::Worker;

pub async fn run(worker: Arc<Worker>) -> Result<SelfUpdateReport> {
    let cfg = worker.config();
    let gh = worker.github_client()?;

    info!("self-update: fetching latest release manifest");
    // Map commit-mode branch names (main/preview) onto release channels.
    let ch_name = crate::version::release_channel_name_for_self_update(&worker.effective_channel());
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

    // 修改 .env 的 UPDATER_TAG。若 guard 调度失败则恢复旧值，旧 updater 继续运行。
    info!(new_tag = %target_tag, "self-update: rewriting UPDATER_TAG in .env");
    let previous_tag = {
        let mut env = EnvFile::load(&worker.cli().env_file)?;
        let previous = env.get("UPDATER_TAG").unwrap_or_default().to_string();
        env.set("UPDATER_TAG", &target_tag)?;
        env.save()?;
        previous
    };

    if let Err(error) = schedule_guarded_recreate(&worker).await {
        let mut env = EnvFile::load(&worker.cli().env_file)?;
        env.set("UPDATER_TAG", &previous_tag)?;
        env.save()?;
        return Err(error);
    }
    worker.state().append_history(&format!(
        "self-update scheduled: new_tag={target_tag} executor=docker-guard"
    ))?;
    info!("self-update: docker guard scheduled updater replacement");

    Ok(SelfUpdateReport {
        helper_container_id: "docker-guard".into(),
        new_updater_tag: target_tag,
    })
}

async fn schedule_guarded_recreate(worker: &Worker) -> Result<()> {
    let endpoint = std::env::var("DOCKER_GUARD_SELF_UPDATE_URL")
        .unwrap_or_else(|_| "http://docker-guard:2375/_myriad/self-update".into());
    let response = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| UpdaterError::Docker(format!("build docker guard client: {e}")))?
        .post(endpoint)
        .header("X-Update-Token", worker.config().update_token.expose())
        .send()
        .await
        .map_err(|e| UpdaterError::Docker(format!("schedule guarded self-update: {e}")))?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(UpdaterError::Docker(format!(
            "docker guard rejected self-update ({status}): {detail}"
        )));
    }
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SelfUpdateReport {
    pub helper_container_id: String,
    pub new_updater_tag: String,
}
