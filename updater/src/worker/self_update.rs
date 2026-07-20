//! Updater 自我更新流程。Spec §14。
//!
//! 难点：updater 不能在自己的容器里重建自己。由独立 docker-guard 在返回响应后执行
//! 固定的 TCB 自替换：`docker compose up -d --no-deps docker-guard updater`。
//!
//! **双服务**：`docker-guard` 与 `updater` 共用 `UPDATER_TAG` 镜像，必须一起重建，
//! 否则 guard 二进制会落后于 tag。
//!
//! **直连 unix socket**：该次 compose 走 `unix:///var/run/docker.sock`（非 policy
//! proxy），因为 create 白名单不含 `docker-guard` 服务本身；这是固定 argv 的 TCB
//! 自替换，不是任意 Docker API。其余 updater 流量仍经 `DOCKER_HOST=tcp://docker-guard:2375`。
//!
//! 流程：
//!   1. 解析目标：优先 GitHub release.json 的 `images.updater`；GitHub 不可用 /
//!      404 / commit 频道 tip 时回退 Docker Hub `UPDATER_IMAGE:<tag>`（与
//!      backend/frontend / proxy 同一模式）
//!   2. docker pull 目标 updater 镜像（有 manifest 时校验 digest）
//!   3. 改 .env 把 UPDATER_TAG 替换成新 tag
//!   4. 请求 docker-guard 鉴权端点，延迟调度双服务重建（body 带 previous/target tag）
//!
//! 调度 HTTP 失败时本进程恢复 `.env`。若 helper 的 compose 失败，helper 会恢复
//! `UPDATER_TAG` 并写入 `state/self-update-last.json`。

use std::sync::Arc;

use tracing::{info, warn};

use crate::env_file::EnvFile;
use crate::error::{Result, UpdaterError};
use crate::release::GithubClient;
use crate::version::{DeployTag, DeployTagKind, UpdateMode};
use crate::worker::Worker;

struct SelfUpdateTarget {
    tag: String,
    image_ref: String,
    expected_digest: Option<String>,
    source: &'static str,
}

pub async fn run(worker: Arc<Worker>, actor: Option<String>) -> Result<SelfUpdateReport> {
    let resolved = resolve_self_update_target(worker.as_ref()).await?;
    info!(
        target = %resolved.tag,
        image = %resolved.image_ref,
        source = resolved.source,
        "self-update: resolved target"
    );

    info!(target = %resolved.tag, "self-update: pulling new updater image");
    let pulled_digest = worker
        .docker_pull_with_mirror(&resolved.image_ref)
        .await
        .map_err(|e| {
            UpdaterError::Precondition(format!(
                "pull updater {}: {e} (is the tag published on the registry / Docker Hub?)",
                resolved.image_ref
            ))
        })?;
    if let Some(expected) = &resolved.expected_digest {
        if !pulled_digest.ends_with(expected) && pulled_digest != *expected {
            return Err(UpdaterError::Precondition(format!(
                "updater digest mismatch: pulled {pulled_digest}, expected {expected}"
            )));
        }
    }

    // 修改 .env 的 UPDATER_TAG。若 guard 调度失败则恢复旧值，旧 updater 继续运行。
    info!(new_tag = %resolved.tag, "self-update: rewriting UPDATER_TAG in .env");
    let previous_tag = {
        let mut env = EnvFile::load(&worker.cli().env_file)?;
        let previous = env.get("UPDATER_TAG").unwrap_or_default().to_string();
        env.set("UPDATER_TAG", &resolved.tag)?;
        env.save()?;
        previous
    };

    if let Err(error) = schedule_guarded_recreate(&worker, &previous_tag, &resolved.tag).await {
        let mut env = EnvFile::load(&worker.cli().env_file)?;
        env.set("UPDATER_TAG", &previous_tag)?;
        env.save()?;
        return Err(error);
    }
    let actor_suffix = actor
        .as_deref()
        .map(|a| format!(" actor={a}"))
        .unwrap_or_default();
    let audit = format!(
        "audit: self_update_scheduled new_tag={} previous_tag={previous_tag} executor=docker-guard services=docker-guard,updater scheduled=true source={}{actor_suffix}",
        resolved.tag, resolved.source
    );
    worker.state().append_history(&audit)?;
    let _ = worker.state().append_audit(&audit);
    info!("self-update: docker guard scheduled docker-guard+updater replacement");

    Ok(SelfUpdateReport {
        helper_container_id: "docker-guard".into(),
        new_updater_tag: resolved.tag,
        previous_updater_tag: previous_tag,
        scheduled: true,
    })
}

async fn resolve_self_update_target(worker: &Worker) -> Result<SelfUpdateTarget> {
    // Commit/dev mode: follow Docker Hub immutable tips (dev-<sha>), not formal
    // GitHub release assets which may jump to a different channel version.
    if worker.effective_mode() == UpdateMode::Commit {
        info!("self-update: commit mode — resolving via Docker Hub tip");
        return resolve_self_update_via_dockerhub(worker).await;
    }

    match try_self_update_from_github(worker).await {
        Ok(Some(t)) => return Ok(t),
        Ok(None) => {
            warn!("self-update: GitHub release.json unavailable; falling back to Docker Hub");
        }
        Err(e) => return Err(e),
    }
    resolve_self_update_via_dockerhub(worker).await
}

async fn try_self_update_from_github(worker: &Worker) -> Result<Option<SelfUpdateTarget>> {
    // Release mode: prefer GitHub release.json + signed digests; Hub is fallback only.
    let gh = match worker.github_client() {
        Ok(gh) => gh,
        Err(e) => {
            warn!(err = %e, "self-update: cannot build GitHub client");
            return Ok(None);
        }
    };

    let cfg = worker.config();
    let ch_name = crate::version::release_channel_name_for_self_update(&worker.effective_channel());
    let ch: crate::config::Channel = ch_name.parse().unwrap_or(cfg.channel);
    info!(channel = %ch, "self-update: looking up latest GitHub release for channel");

    let rel = match gh.latest_for_channel(ch).await {
        Ok(Some(r)) => r,
        Ok(None) => {
            warn!(channel = %ch, "self-update: channel has no GitHub releases");
            return Ok(None);
        }
        Err(e) if GithubClient::is_release_json_unavailable(&e) => {
            warn!(err = %e, "self-update: GitHub list releases failed");
            return Ok(None);
        }
        Err(e) => return Err(e),
    };

    let manifest = match gh.fetch_manifest(&rel.tag_name).await {
        Ok(m) => m,
        Err(e) if GithubClient::is_release_json_unavailable(&e) => {
            warn!(
                err = %e,
                tag = %rel.tag_name,
                "self-update: GitHub release.json unavailable"
            );
            return Ok(None);
        }
        Err(e) => return Err(e),
    };

    let updater_img = manifest.image("updater").ok_or_else(|| {
        UpdaterError::Precondition(format!(
            "release {} has no `updater` image in the manifest",
            rel.tag_name
        ))
    })?;

    Ok(Some(SelfUpdateTarget {
        tag: manifest.version.as_str().to_string(),
        image_ref: updater_img.r#ref.clone(),
        expected_digest: Some(updater_img.digest.clone()),
        source: "github",
    }))
}

async fn resolve_self_update_via_dockerhub(worker: &Worker) -> Result<SelfUpdateTarget> {
    let repo = worker.updater_image_repo()?;

    // Always list this component's tags. App `latest_available` may be a backend tip
    // that does not exist on myriad-updater yet — only reuse it when present here.
    let prefer_release = worker.effective_mode() == UpdateMode::Release;
    let tags = worker
        .dockerhub_client()?
        .list_immutable_tags(&repo, 25)
        .await?;
    let tag = if let Some(from_state) = tip_tag_from_state(worker)? {
        if tags.iter().any(|t| t.tag == from_state) {
            info!(
                tag = %from_state,
                "self-update: state tip exists on updater repo; using it"
            );
            from_state
        } else {
            let tip =
                crate::release::select_component_tip(&tags, prefer_release).ok_or_else(|| {
                    UpdaterError::Precondition(format!(
                        "Docker Hub has no immutable tags for {repo} (need dev-<sha> or vX.Y.Z); \
                         cannot self-update without GitHub release.json"
                    ))
                })?;
            info!(
                state_tip = %from_state,
                tag = %tip.tag,
                kind = tip.kind,
                "self-update: state tip missing on updater repo; selected component tip"
            );
            tip.tag.clone()
        }
    } else {
        let tip = crate::release::select_component_tip(&tags, prefer_release).ok_or_else(|| {
            UpdaterError::Precondition(format!(
                "Docker Hub has no immutable tags for {repo} (need dev-<sha> or vX.Y.Z); \
                 cannot self-update without GitHub release.json"
            ))
        })?;
        info!(
            tag = %tip.tag,
            kind = tip.kind,
            "self-update: selected tip from Docker Hub updater tags"
        );
        tip.tag.clone()
    };

    if tag == "latest" || tag.ends_with(":latest") {
        return Err(UpdaterError::Precondition(
            "updater image tag must be immutable (dev-<sha> or vX.Y.Z), got latest".into(),
        ));
    }

    Ok(SelfUpdateTarget {
        image_ref: format!("{repo}:{tag}"),
        tag,
        expected_digest: None,
        source: "dockerhub",
    })
}

fn tip_tag_from_state(worker: &Worker) -> Result<Option<String>> {
    let st = worker.state().read_updater()?;
    Ok(st
        .latest_available
        .as_ref()
        .map(|la| la.version.as_str().to_string())
        .filter(|t| DeployTag::parse(t).is_ok_and(|d| d.kind() != DeployTagKind::Branch)))
}

async fn schedule_guarded_recreate(
    worker: &Worker,
    previous_tag: &str,
    target_tag: &str,
) -> Result<()> {
    let endpoint = std::env::var("DOCKER_GUARD_SELF_UPDATE_URL")
        .unwrap_or_else(|_| "http://docker-guard:2375/_myriad/self-update".into());
    let response = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| UpdaterError::Docker(format!("build docker guard client: {e}")))?
        .post(endpoint)
        .header("X-Update-Token", worker.config().update_token.expose())
        .json(&serde_json::json!({
            "previous_tag": previous_tag,
            "target_tag": target_tag,
        }))
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
    pub previous_updater_tag: String,
    pub scheduled: bool,
}
