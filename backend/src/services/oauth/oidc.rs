//! 通用 OIDC Provider 实现
//!
//! 设计：
//! - **Discovery**: 启动时从 `discovery_url` 拉 `.well-known/openid-configuration`，
//!   缓存 24h（lazy 刷新）。
//! - **Token 交换**: 标准 OAuth2 `authorization_code` flow，POST 到 `token_endpoint`。
//! - **Profile**: 优先解析 `id_token` 的 claims；缺失字段再去 `userinfo_endpoint` 拉。
//! - **id_token 验证**: 通过 discovery 的 `jwks_uri` 拉取 JWKS，校验签名、
//!   `iss`、`aud`、`exp`、`sub` 和 `azp`。
//!
//! 详见 docs/oauth-refactor-plan.md §6.3

use async_trait::async_trait;
use jsonwebtoken::{
    decode, decode_header,
    jwk::{AlgorithmParameters, Jwk, JwkSet, PublicKeyUse},
    Algorithm, DecodingKey, Validation,
};
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
    jwks_uri: Option<String>,
    #[serde(default)]
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

    async fn fetch_jwks(&self, doc: &DiscoveryDoc) -> Result<JwkSet, String> {
        let jwks_uri = doc
            .jwks_uri
            .as_deref()
            .ok_or_else(|| "OIDC discovery missing 'jwks_uri'".to_string())?;
        let http = crate::services::http_client::get_global_client().await;
        let resp = http
            .get(jwks_uri)
            .send()
            .await
            .map_err(|e| format!("OIDC JWKS GET failed: {e:?}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("OIDC JWKS endpoint returned {status}: {body}"));
        }

        resp.json::<JwkSet>()
            .await
            .map_err(|e| format!("OIDC JWKS JSON parse failed: {e:?}"))
    }

    async fn verify_id_token(&self, id_token: &str) -> Result<serde_json::Value, String> {
        let doc = self.discovery().await?;
        let issuer = doc
            .issuer
            .as_deref()
            .ok_or_else(|| "OIDC discovery missing 'issuer'".to_string())?;
        let header =
            decode_header(id_token).map_err(|e| format!("OIDC id_token header invalid: {e}"))?;

        ensure_asymmetric_id_token_alg(header.alg)?;

        let jwks = self.fetch_jwks(&doc).await?;
        let jwk = select_jwk(&jwks, header.kid.as_deref())?;
        ensure_jwk_matches_id_token(jwk, header.alg)?;

        let key = DecodingKey::from_jwk(jwk)
            .map_err(|e| format!("OIDC JWK decoding key invalid: {e}"))?;
        let mut validation = Validation::new(header.alg);
        validation.set_audience(&[self.client_id.as_str()]);
        validation.set_issuer(&[issuer]);
        validation.set_required_spec_claims(&["exp", "iss", "aud", "sub"]);
        validation.validate_nbf = true;

        let data = decode::<serde_json::Value>(id_token, &key, &validation)
            .map_err(|e| format!("OIDC id_token verification failed: {e}"))?;
        validate_authorized_party(&data.claims, &self.client_id)?;
        Ok(data.claims)
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
        let id_token = tokens
            .id_token
            .as_deref()
            .ok_or_else(|| "OIDC token response missing 'id_token'".to_string())?;
        let id_claims = self.verify_id_token(id_token).await?;

        // 如果 id_token 没给齐档案，再去 userinfo
        let userinfo: serde_json::Value = match id_claims.get("email") {
            Some(_) => id_claims.clone(),
            _ => {
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
            }
        };

        if let (Some(id_sub), Some(userinfo_sub)) = (
            id_claims.get("sub").and_then(|v| v.as_str()),
            userinfo.get("sub").and_then(|v| v.as_str()),
        ) {
            if id_sub != userinfo_sub {
                return Err("OIDC userinfo 'sub' does not match id_token".to_string());
            }
        }

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
            .or_else(|| id_claims.get("preferred_username").and_then(|v| v.as_str()))
            .or_else(|| id_claims.get("name").and_then(|v| v.as_str()))
            .or_else(|| id_claims.get("email").and_then(|v| v.as_str()))
            .unwrap_or(&sub)
            .to_string();

        let email = userinfo
            .get("email")
            .and_then(|v| v.as_str())
            .or_else(|| id_claims.get("email").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        // email_verified: 优先 userinfo 显式声明，缺省 false（保守 — 不会触发自动 merge）
        let email_verified = userinfo
            .get("email_verified")
            .and_then(|v| v.as_bool())
            .or_else(|| id_claims.get("email_verified").and_then(|v| v.as_bool()))
            .unwrap_or(false);

        let avatar_url = userinfo
            .get("picture")
            .and_then(|v| v.as_str())
            .or_else(|| id_claims.get("picture").and_then(|v| v.as_str()))
            .map(|s| s.to_string());

        let profile_url = userinfo
            .get("profile")
            .and_then(|v| v.as_str())
            .or_else(|| id_claims.get("profile").and_then(|v| v.as_str()))
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

fn ensure_asymmetric_id_token_alg(alg: Algorithm) -> Result<(), String> {
    match alg {
        Algorithm::RS256
        | Algorithm::RS384
        | Algorithm::RS512
        | Algorithm::PS256
        | Algorithm::PS384
        | Algorithm::PS512
        | Algorithm::ES256
        | Algorithm::ES384
        | Algorithm::EdDSA => Ok(()),
        Algorithm::HS256 | Algorithm::HS384 | Algorithm::HS512 => Err(format!(
            "OIDC id_token algorithm {:?} is not accepted; configure provider for asymmetric signing",
            alg
        )),
    }
}

fn select_jwk<'a>(jwks: &'a JwkSet, kid: Option<&str>) -> Result<&'a Jwk, String> {
    if let Some(kid) = kid {
        return jwks
            .find(kid)
            .ok_or_else(|| format!("OIDC JWKS does not contain kid '{kid}'"));
    }

    let mut candidates = jwks
        .keys
        .iter()
        .filter(|jwk| !matches!(&jwk.algorithm, AlgorithmParameters::OctetKey(_)));
    match (candidates.next(), candidates.next()) {
        (Some(jwk), None) => Ok(jwk),
        (None, _) => Err("OIDC id_token missing 'kid' and JWKS has no asymmetric keys".to_string()),
        (Some(_), Some(_)) => {
            Err("OIDC id_token missing 'kid' and JWKS has multiple keys".to_string())
        }
    }
}

fn ensure_jwk_matches_id_token(jwk: &Jwk, alg: Algorithm) -> Result<(), String> {
    if let Some(key_use) = jwk.common.public_key_use.as_ref() {
        if key_use != &PublicKeyUse::Signature {
            return Err("OIDC JWK is not marked for signature use".to_string());
        }
    }

    if matches!(&jwk.algorithm, AlgorithmParameters::OctetKey(_)) {
        return Err("OIDC JWK uses a symmetric key, which is not accepted".to_string());
    }

    if let Some(key_alg) = jwk.common.key_algorithm.as_ref() {
        let key_alg = key_alg.to_string();
        let token_alg = format!("{:?}", alg);
        if key_alg != token_alg {
            return Err(format!(
                "OIDC JWK alg '{key_alg}' does not match id_token alg '{token_alg}'"
            ));
        }
    }

    Ok(())
}

fn validate_authorized_party(claims: &serde_json::Value, client_id: &str) -> Result<(), String> {
    let azp = claims.get("azp").and_then(|v| v.as_str());
    if let Some(azp) = azp {
        if azp != client_id {
            return Err("OIDC id_token 'azp' does not match client_id".to_string());
        }
    }

    let aud_count = match claims.get("aud") {
        Some(serde_json::Value::Array(values)) => values.len(),
        Some(_) => 1,
        None => 0,
    };
    if aud_count > 1 && azp.is_none() {
        return Err("OIDC id_token has multiple audiences but no 'azp'".to_string());
    }

    Ok(())
}
