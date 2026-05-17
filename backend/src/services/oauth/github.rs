//! GitHub OAuth provider 实现
//!
//! 从 `api/auth.rs` 抽出，遵循 [`super::OAuthProvider`] trait。

use async_trait::async_trait;
use oauth2::{
    basic::BasicClient, AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken,
    RedirectUrl, Scope, TokenResponse, TokenUrl,
};
use serde::Deserialize;

use super::{NormalizedProfile, OAuthProvider, ProviderKind, ProviderTokens};

const GITHUB_AUTH_URL: &str = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";

#[derive(Debug, Deserialize)]
struct GitHubUser {
    id: i64,
    login: String,
    name: Option<String>,
    email: Option<String>,
    avatar_url: String,
    html_url: String,
    bio: Option<String>,
    location: Option<String>,
    company: Option<String>,
}

#[derive(Debug, Clone)]
pub struct GithubProvider {
    client_id: String,
    client_secret: String,
}

impl GithubProvider {
    pub fn new(client_id: String, client_secret: String) -> Self {
        Self {
            client_id,
            client_secret,
        }
    }
}

/// 构建一个完整端点设置的 oauth2 client。
/// 返回类型用 macro 隐藏 — `BasicClient` 的 typestate 泛型不便于显式书写。
macro_rules! build_github_client {
    ($self:expr, $redirect_uri:expr) => {{
        let auth_url =
            AuthUrl::new(GITHUB_AUTH_URL.to_string()).map_err(|e| e.to_string())?;
        let token_url =
            TokenUrl::new(GITHUB_TOKEN_URL.to_string()).map_err(|e| e.to_string())?;
        let redirect =
            RedirectUrl::new($redirect_uri.to_string()).map_err(|e| e.to_string())?;
        BasicClient::new(ClientId::new($self.client_id.clone()))
            .set_client_secret(ClientSecret::new($self.client_secret.clone()))
            .set_auth_uri(auth_url)
            .set_token_uri(token_url)
            .set_redirect_uri(redirect)
    }};
}

#[async_trait]
impl OAuthProvider for GithubProvider {
    fn slug(&self) -> &str {
        "github"
    }

    fn kind(&self) -> ProviderKind {
        ProviderKind::Github
    }

    fn display_name(&self) -> &str {
        "GitHub"
    }

    fn icon(&self) -> Option<&str> {
        Some("github")
    }

    async fn build_auth_url(&self, state: &str, redirect_uri: &str) -> Result<String, String> {
        let client = build_github_client!(self, redirect_uri);
        let (url, _csrf) = client
            .authorize_url(|| CsrfToken::new(state.to_string()))
            .add_scope(Scope::new("read:user".to_string()))
            .add_scope(Scope::new("user:email".to_string()))
            .url();
        Ok(url.to_string())
    }

    async fn exchange_code(
        &self,
        code: &str,
        redirect_uri: &str,
    ) -> Result<ProviderTokens, String> {
        let client = build_github_client!(self, redirect_uri);
        let http = reqwest::Client::new();
        let token = client
            .exchange_code(AuthorizationCode::new(code.to_string()))
            .request_async(&http)
            .await
            .map_err(|e| format!("GitHub token exchange failed: {e:?}"))?;

        Ok(ProviderTokens {
            access_token: token.access_token().secret().clone(),
            refresh_token: token.refresh_token().map(|t| t.secret().clone()),
            id_token: None,
            expires_in: token.expires_in().map(|d| d.as_secs()),
        })
    }

    async fn fetch_profile(&self, tokens: &ProviderTokens) -> Result<NormalizedProfile, String> {
        let http = crate::services::http_client::get_global_client().await;
        let user_url = format!(
            "{}/user",
            crate::services::http_client::GitHubApiUrl::get_api_base().await
        );

        let user: GitHubUser = http
            .get(user_url)
            .header("Authorization", format!("Bearer {}", tokens.access_token))
            .header("User-Agent", "Myriad-App")
            .send()
            .await
            .map_err(|e| format!("GitHub /user request failed: {e:?}"))?
            .json()
            .await
            .map_err(|e| format!("GitHub /user parse failed: {e:?}"))?;

        let raw = serde_json::json!({
            "id": user.id,
            "login": user.login,
            "name": user.name,
            "email": user.email,
            "avatar_url": user.avatar_url,
            "html_url": user.html_url,
            "bio": user.bio,
            "location": user.location,
            "company": user.company,
        });

        Ok(NormalizedProfile {
            provider_user_id: user.id.to_string(),
            username: user.login,
            email: user.email,
            email_verified: false, // GitHub /user 不返回 verified 标记；需走 /user/emails 才能判断
            avatar_url: Some(user.avatar_url),
            profile_url: Some(user.html_url),
            raw,
        })
    }
}
