//! OAuth Provider 注册中心
//!
//! 启动时根据 [`DynamicConfig`](crate::config::DynamicConfig) 装载 provider，
//! 配置变更时调用 [`ProviderRegistry::reload`] 重建。

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::{github::GithubProvider, oidc::OidcProvider, OAuthProvider, ProviderDescriptor};

pub static REGISTRY: Lazy<Arc<ProviderRegistry>> =
    Lazy::new(|| Arc::new(ProviderRegistry::new()));

pub struct ProviderRegistry {
    inner: RwLock<HashMap<String, Arc<dyn OAuthProvider>>>,
}

impl Default for ProviderRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ProviderRegistry {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
        }
    }

    /// 按 slug 取 provider
    pub async fn get(&self, slug: &str) -> Option<Arc<dyn OAuthProvider>> {
        self.inner.read().await.get(slug).cloned()
    }

    /// 列出当前已启用的 provider（用于前端 `/providers` 端点）
    pub async fn list(&self) -> Vec<ProviderDescriptor> {
        self.inner
            .read()
            .await
            .values()
            .map(|p| ProviderDescriptor::from(p.as_ref()))
            .collect()
    }

    /// 从 DynamicConfig 重建 provider 集合（启动时 + 配置变更时调用）
    ///
    /// 装载顺序：
    /// 1. `oauth_providers` 列表（kind="github" / "oidc"），优先
    /// 2. legacy `github_client_id`/`github_client_secret` 平铺字段（向后兼容；
    ///    若 (1) 中已经有 slug="github" 则跳过）
    pub async fn reload(&self) {
        use crate::GLOBAL_DYNAMIC_CONFIG;

        let config = GLOBAL_DYNAMIC_CONFIG.read().await;
        let mut new_map: HashMap<String, Arc<dyn OAuthProvider>> = HashMap::new();

        for entry in &config.oauth_providers {
            if !entry.enabled {
                continue;
            }
            if entry.slug.trim().is_empty() {
                tracing::warn!("OAuth provider with empty slug, skipping");
                continue;
            }
            if new_map.contains_key(&entry.slug) {
                tracing::warn!("duplicate OAuth provider slug '{}', skipping", entry.slug);
                continue;
            }
            match entry.kind.as_str() {
                "github" => {
                    if entry.client_id.is_empty() || entry.client_secret.is_empty() {
                        tracing::warn!(
                            "GitHub provider '{}' missing credentials; skipping",
                            entry.slug
                        );
                        continue;
                    }
                    let provider = GithubProvider::new(
                        entry.client_id.clone(),
                        entry.client_secret.clone(),
                    );
                    new_map.insert(entry.slug.clone(), Arc::new(provider));
                    tracing::info!("🔐 OAuth provider loaded: {} (github)", entry.slug);
                }
                "oidc" => {
                    if entry.client_id.is_empty() || entry.client_secret.is_empty() {
                        tracing::warn!(
                            "OIDC provider '{}' missing credentials; skipping",
                            entry.slug
                        );
                        continue;
                    }
                    let discovery = match entry.discovery_url.as_ref() {
                        Some(u) if !u.is_empty() => u.clone(),
                        _ => {
                            tracing::warn!(
                                "OIDC provider '{}' missing discovery_url; skipping",
                                entry.slug
                            );
                            continue;
                        }
                    };
                    let provider = OidcProvider::new(
                        entry.slug.clone(),
                        entry.display_name.clone(),
                        entry.icon_url.clone(),
                        entry.client_id.clone(),
                        entry.client_secret.clone(),
                        entry.scopes.clone(),
                        discovery,
                    );
                    new_map.insert(entry.slug.clone(), Arc::new(provider));
                    tracing::info!("🔐 OAuth provider loaded: {} (oidc)", entry.slug);
                }
                other => {
                    tracing::warn!(
                        "Unknown OAuth provider kind '{}' for slug '{}', skipping",
                        other,
                        entry.slug
                    );
                }
            }
        }

        // Legacy 兼容：旧的 github_client_id/secret 平铺字段
        // 仅当 entries 里没有 slug="github" 时才生效，避免冲突。
        if !new_map.contains_key("github") {
            if let (Some(cid), Some(csec)) = (
                config.github_client_id.as_ref().filter(|s| !s.is_empty()),
                config
                    .github_client_secret
                    .as_ref()
                    .filter(|s| !s.is_empty()),
            ) {
                let provider = GithubProvider::new(cid.clone(), csec.clone());
                new_map.insert("github".to_string(), Arc::new(provider));
                tracing::info!("🔐 OAuth provider loaded: github (from legacy fields)");
            }
        }

        drop(config);

        let mut guard = self.inner.write().await;
        *guard = new_map;
    }
}

/// 启动时初始化（main.rs 调用）
pub async fn init() {
    REGISTRY.reload().await;
}
