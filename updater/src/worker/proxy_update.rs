//! Manual proxy image upgrade (spec §12.3).
//!
//! Proxy is not part of the automatic business update path. Operators trigger this
//! when a release ships a newer `images.proxy` (or when `PROXY_TAG` lags). Flow:
//!   1. Resolve target from latest channel release manifest (or explicit tag)
//!   2. Pull proxy image and verify digest when present in manifest
//!   3. Rewrite `.env` `PROXY_TAG`
//!   4. `docker compose up -d --no-deps proxy` via the policy docker-guard
//!
//! Brief downtime (<10s) is expected while the edge container recreates.

use std::sync::Arc;

use tracing::info;

use crate::env_file::EnvFile;
use crate::error::{Result, UpdaterError};
use crate::worker::Worker;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProxyUpdateReport {
    pub previous_proxy_tag: String,
    pub new_proxy_tag: String,
    pub image_ref: String,
    pub pulled_digest: String,
}

/// Upgrade the `proxy` service to the proxy image from the latest release for
/// the current channel (or to `explicit_tag` when provided).
pub async fn run(
    worker: Arc<Worker>,
    actor: Option<String>,
    explicit_tag: Option<String>,
) -> Result<ProxyUpdateReport> {
    let cfg = worker.config();
    let gh = worker.github_client()?;

    let ch_name = crate::version::release_channel_name_for_self_update(&worker.effective_channel());
    let ch: crate::config::Channel = ch_name.parse().unwrap_or(cfg.channel);
    info!(channel = %ch, "proxy-update: using release channel");

    let (target_tag, image_ref, expected_digest) = if let Some(tag) = explicit_tag {
        // Explicit tag: still require a manifest so we can pin digest when available.
        let manifest = gh.fetch_manifest(&tag).await?;
        let proxy = manifest.image("proxy").ok_or_else(|| {
            UpdaterError::Precondition(format!(
                "release {tag} has no `proxy` image in the manifest"
            ))
        })?;
        (
            manifest.version.as_str().to_string(),
            proxy.r#ref.clone(),
            proxy.digest.clone(),
        )
    } else {
        let rel = gh
            .latest_for_channel(ch)
            .await?
            .ok_or_else(|| UpdaterError::Precondition("channel has no releases".into()))?;
        let manifest = gh.fetch_manifest(&rel.tag_name).await?;
        let proxy = manifest.image("proxy").ok_or_else(|| {
            UpdaterError::Precondition("release manifest has no `proxy` image".into())
        })?;
        (
            manifest.version.as_str().to_string(),
            proxy.r#ref.clone(),
            proxy.digest.clone(),
        )
    };

    // Skip no-op when PROXY_TAG already matches and digest is already local.
    let previous_tag = {
        let env = EnvFile::load(&worker.cli().env_file)?;
        env.get("PROXY_TAG").unwrap_or_default().to_string()
    };
    if previous_tag == target_tag {
        info!(tag = %target_tag, "proxy-update: PROXY_TAG already at target; still recreating container");
    }

    info!(target = %target_tag, image = %image_ref, "proxy-update: pulling proxy image");
    let pulled_digest = worker.docker_pull_with_mirror(&image_ref).await?;
    if !pulled_digest.ends_with(&expected_digest) && pulled_digest != expected_digest {
        return Err(UpdaterError::Precondition(format!(
            "proxy digest mismatch: pulled {pulled_digest}, expected {expected_digest}"
        )));
    }

    info!(new_tag = %target_tag, "proxy-update: rewriting PROXY_TAG in .env");
    {
        let mut env = EnvFile::load(&worker.cli().env_file)?;
        env.set("PROXY_TAG", &target_tag)?;
        env.save()?;
    }

    let compose = crate::worker::update::build_compose_runner_pub(&worker).await?;
    let up = compose.up_detached(&["proxy"]).await?;
    if !up.ok() {
        // Restore previous tag so a failed recreate does not leave .env advanced.
        let mut env = EnvFile::load(&worker.cli().env_file)?;
        env.set("PROXY_TAG", &previous_tag)?;
        env.save()?;
        return Err(UpdaterError::Internal(anyhow::anyhow!(
            "compose up proxy failed: {}",
            up.error_summary()
        )));
    }

    let actor_suffix = actor
        .as_deref()
        .map(|a| format!(" actor={a}"))
        .unwrap_or_default();
    let audit = format!(
        "audit: proxy_update previous_tag={previous_tag} new_tag={target_tag} image={image_ref} digest={pulled_digest}{actor_suffix}"
    );
    worker.state().append_history(&audit)?;
    let _ = worker.state().append_audit(&audit);
    info!(%target_tag, "proxy-update: proxy recreated");

    Ok(ProxyUpdateReport {
        previous_proxy_tag: previous_tag,
        new_proxy_tag: target_tag,
        image_ref,
        pulled_digest,
    })
}
