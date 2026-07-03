//! 通用 OIDC Provider 实现
//!
//! 设计：
//! - **Discovery**: 启动时从 `discovery_url` 拉 `.well-known/openid-configuration`，
//!   缓存 24h（lazy 刷新）。
//! - **Token 交换**: 标准 OAuth2 `authorization_code` flow，POST 到 `token_endpoint`。
//! - **Profile**: 优先解析 `id_token` 的 claims；缺失字段再去 `userinfo_endpoint` 拉。
//! - **id_token 验证**: 当前依赖 HTTPS + discovery 的信任链（与 Authentik / Keycloak / Auth0 等
//!   典型部署一致）。完整 JWKS 签名验证留待后续 PR（标 TODO）。
//!
//! 详见 docs/oauth-refactor-plan.md §6.3

use async_trait::async_trait;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

use super::{NormalizedProfile, OAuthProvider, ProviderKind, ProviderTokens};

const DISCOVERY_TTL: Duration = Duration::from_secs(24 * 3600);

/// OIDC discovery 文档（只保留我们用得到的字段）
#[derive(Debug, Clone, Deserialize)]
struct DiscoveryDoc {
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    userinfo_endpoint: Option<String>,
    #[serde(default)]
    #[allow(dead_code)] // 未来 JWKS 验签时启用
    jwks_uri: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    issuer: Option<String>,
}

#[derive(Debug)]
struct DiscoveryCache {
    doc: DiscoveryDoc,
    fetched_at: Instant,
}

pub struct OidcProvider {
    slug: String,
    display_name: String,
    icon: Option<String>,
    client_id: String,
    client_secret: String,
    scopes: Vec<String>,
    discovery_url: String,
    cache: Arc<RwLock<Option<DiscoveryCache>>>,
}

impl OidcProvider {
    pub fn new(
        slug: String,
        display_name: String,
        icon: Option<String>,
        client_id: String,
        client_secret: String,
        scopes: Vec<String>,
        discovery_url: String,
    ) -> Self {
        Self {
            slug,
            display_name,
            icon,
            client_id,
            client_secret,
            scopes,
            discovery_url,
            cache: Arc::new(RwLock::new(None)),
        }
    }

    async fn discovery(&self) -> Result<DiscoveryDoc, String> {
        {
            let guard = self.cache.read().await;
            if let Some(c) = guard.as_ref() {
                if c.fetched_at.elapsed() < DISCOVERY_TTL {
                    return Ok(c.doc.clone());
                }
            }
        }

        tracing::debug!("🔄 Refreshing OIDC discovery for {}", self.slug);
        let http = crate::services::http_client::get_global_client().await;
        let doc: DiscoveryDoc = http
            .get(&self.discovery_url)
            .send()
            .await
            .map_err(|e| format!("OIDC discovery GET failed: {e:?}"))?
            .json()
            .await
            .map_err(|e| format!("OIDC discovery JSON parse failed: {e:?}"))?;

        let mut guard = self.cache.write().await;
        *guard = Some(DiscoveryCache {
            doc: doc.clone(),
            fetched_at: Instant::now(),
        });
        Ok(doc)
    }

    fn scope_string(&self) -> String {
        if self.scopes.is_empty() {
            "openid email profile".to_string()
        } else if self.scopes.iter().any(|s| s == "openid") {
            self.scopes.join(" ")
        } else {
            // 必须包含 openid
            let mut s = vec!["openid".to_string()];
            s.extend(self.scopes.iter().cloned());
            s.join(" ")
        }
    }
}

#[async_trait]
impl OAuthProvider for OidcProvider {
    fn slug(&self) -> &str {
        &self.slug
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::Oidc
    }

    fn display_name(&self) -> &str {
        &self.display_name
    }

    fn icon(&self) -> Option<&str> {
        self.icon.as_deref()
    }

    async fn build_auth_url(&self, state: &str, redirect_uri: &str) -> Result<String, String> {
        let doc = self.discovery().await?;
        let scope = self.scope_string();
        // 用 url crate 解析 + append query，避免 authorization_endpoint 本身带 ?param 时
        // 拼出 https://x?a=b?response_type=code 这种非法 URL
        let mut url = url::Url::parse(&doc.authorization_endpoint)
            .map_err(|e| format!("invalid authorization_endpoint: {e}"))?;
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &self.client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("scope", &scope)
            .append_pair("state", state);
        Ok(url.into())
    }

    async fn exchange_code(
        &self,
        code: &str,
        redirect_uri: &str,
    ) -> Result<ProviderTokens, String> {
        let doc = self.discovery().await?;
        let http = crate::services::http_client::get_global_client().await;

        let params = [
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", self.client_id.as_str()),
            ("client_secret", self.client_secret.as_str()),
        ];

        #[derive(Debug, Deserialize)]
        struct TokenResp {
            access_token: String,
            #[serde(default)]
            id_token: Option<String>,
        }

        let resp = http
            .post(&doc.token_endpoint)
            .header("Accept", "application/json")
            .form(&params)
            .send()
            .await
            .map_err(|e| format!("OIDC token POST failed: {e:?}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("OIDC token endpoint returned {status}: {body}"));
        }

        let token: TokenResp = resp
            .json()
            .await
            .map_err(|e| format!("OIDC token JSON parse failed: {e:?}"))?;

        Ok(ProviderTokens {
            access_token: token.access_token,
            id_token: token.id_token,
        })
    }

    async fn fetch_profile(&self, tokens: &ProviderTokens) -> Result<NormalizedProfile, String> {
        // 先解析 id_token（无验签 — TODO: PR #N 加 JWKS 验签）
        let id_claims: serde_json::Value = tokens
            .id_token
            .as_ref()
            .and_then(|t| decode_jwt_claims(t).ok())
            .unwrap_or(serde_json::Value::Null);

        // 如果 id_token 没给齐档案，再去 userinfo
        let userinfo: serde_json::Value =
            if id_claims.get("sub").is_some() && id_claims.get("email").is_some() {
                id_claims.clone()
            } else {
                let doc = self.discovery().await?;
                if let Some(url) = doc.userinfo_endpoint.as_ref() {
                    let http = crate::services::http_client::get_global_client().await;
                    http.get(url)
                        .bearer_auth(&tokens.access_token)
                        .send()
                        .await
                        .map_err(|e| format!("OIDC userinfo GET failed: {e:?}"))?
                        .json::<serde_json::Value>()
                        .await
                        .map_err(|e| format!("OIDC userinfo parse failed: {e:?}"))?
                } else {
                    id_claims.clone()
                }
            };

        let sub = userinfo
            .get("sub")
            .and_then(|v| v.as_str())
            .or_else(|| id_claims.get("sub").and_then(|v| v.as_str()))
            .ok_or_else(|| "OIDC profile missing 'sub'".to_string())?
            .to_string();

        let preferred_username = userinfo
            .get("preferred_username")
            .and_then(|v| v.as_str())
            .or_else(|| userinfo.get("name").and_then(|v| v.as_str()))
            .or_else(|| userinfo.get("email").and_then(|v| v.as_str()))
            .unwrap_or(&sub)
            .to_string();

        let email = userinfo
            .get("email")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        // email_verified: 优先 userinfo 显式声明，缺省 false（保守 — 不会触发自动 merge）
        let email_verified = userinfo
            .get("email_verified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let avatar_url = userinfo
            .get("picture")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let profile_url = userinfo
            .get("profile")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        Ok(NormalizedProfile {
            provider_user_id: sub,
            username: preferred_username,
            email,
            email_verified,
            avatar_url,
            profile_url,
            raw: userinfo,
        })
    }
}

/// 解析 JWT 的 claims 部分（中段），不验签
/// TODO: 后续 PR 引入 JWKS 验签
fn decode_jwt_claims(jwt: &str) -> Result<serde_json::Value, String> {
    let mut parts = jwt.split('.');
    let _header = parts.next().ok_or("missing JWT header")?;
    let payload = parts.next().ok_or("missing JWT payload")?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|e| format!("JWT base64 decode failed: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("JWT payload JSON parse failed: {e}"))
}
