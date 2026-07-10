//! OAuth CSRF state 内存存储
//!
//! 通用版本：state 中带 `provider_slug` 区分回调路由，
//! 同时支持 Login 和 LinkAccount 两种用途。
//!
//! 详见 docs/oauth-refactor-plan.md

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// state 有效期 10 分钟
pub const STATE_TTL: Duration = Duration::from_secs(600);
/// 防内存耗尽
const MAX_STATES: usize = 10_000;

#[derive(Debug, Clone, PartialEq)]
pub enum OAuthPurpose {
    Login,
    /// LinkAccount 时携带"当前已登录用户 id"
    LinkAccount(i32),
    /// 数据平台授权（如 Discord 同步）：写入平台 token，不登录/不绑 identity
    PlatformData {
        user_id: i32,
        platform: String,
    },
}

#[derive(Debug, Clone)]
pub struct StoredState {
    pub provider_slug: String,
    pub purpose: OAuthPurpose,
    pub created_at: Instant,
}

pub static OAUTH_STATES: Lazy<Arc<RwLock<HashMap<String, StoredState>>>> = Lazy::new(|| {
    let store: Arc<RwLock<HashMap<String, StoredState>>> = Arc::new(RwLock::new(HashMap::new()));
    let store_clone = store.clone();

    // 周期清理过期 state
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            let mut states = store_clone.write().await;
            let now = Instant::now();
            let before = states.len();
            states.retain(|_, s| now.duration_since(s.created_at) < STATE_TTL);
            let removed = before - states.len();
            if removed > 0 {
                tracing::debug!(
                    "🧹 OAuth state cleanup: removed {} expired, {} remain",
                    removed,
                    states.len()
                );
            }
        }
    });

    store
});

/// 写入 state（已带容量保护：超限时淘汰最旧）
pub async fn insert_state(state: String, stored: StoredState) {
    let mut states = OAUTH_STATES.write().await;
    if states.len() >= MAX_STATES {
        if let Some(oldest) = states
            .iter()
            .min_by_key(|(_, v)| v.created_at)
            .map(|(k, _)| k.clone())
        {
            states.remove(&oldest);
        }
    }
    states.insert(state, stored);
}

/// 一次性消费 state（验证后立即删除）
pub async fn consume_state(state: &str) -> Option<StoredState> {
    let mut states = OAUTH_STATES.write().await;
    let stored = states.remove(state)?;
    if Instant::now().duration_since(stored.created_at) >= STATE_TTL {
        return None;
    }
    Some(stored)
}
