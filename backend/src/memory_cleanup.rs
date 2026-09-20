//! Process-owned reclamation, including workers that never receive HTTP requests.
use std::time::Duration;

pub(crate) struct MemoryCleanup(
    tokio::task::JoinHandle<()>,
    Option<tokio::task::JoinHandle<()>>,
);

impl Drop for MemoryCleanup {
    fn drop(&mut self) {
        self.0.abort();
        if let Some(upgrade) = &self.1 {
            upgrade.abort();
        }
    }
}

pub(crate) fn start(automatic_media_upgrade: bool) -> MemoryCleanup {
    let cleanup = tokio::spawn(async {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            reclaim().await;
        }
    });
    MemoryCleanup(
        cleanup,
        automatic_media_upgrade.then(crate::services::media::start_upgrade_worker),
    )
}

async fn reclaim() {
    use crate::services::{agent, ai_task_runtime, analyzer};
    crate::api::github_stars::cleanup_cache();
    crate::api::game_presence::cleanup_cache();
    analyzer::cleanup_shape_memo();
    crate::services::tapp_api_service::cleanup_response_cache().await;
    agent::consciousness::cleanup_attention();
    crate::api::merope_rig::cleanup_verified_packages().await;
    if tokio::time::timeout(
        Duration::from_secs(30),
        agent::executor::task_store::cleanup_retained_state(),
    )
    .await
    .is_err()
    {
        tracing::warn!("Agent memory cleanup persistence timed out");
    }
    crate::services::discord_bot::cleanup_channel_types().await;
    ai_task_runtime::cleanup_local_tasks().await;
    if let Ok(db) = crate::services::tapp_registry::database() {
        match tokio::time::timeout(
            Duration::from_secs(30),
            crate::services::media::maintain(&db),
        )
        .await
        {
            Ok(Ok(())) => {}
            Ok(Err(error)) => tracing::warn!(%error, "media maintenance failed"),
            Err(_) => tracing::warn!("media maintenance timed out"),
        }
    }
}
