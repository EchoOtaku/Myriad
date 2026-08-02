# OAuth / 本地登录

当前实现（非计划稿）。配置入口：`/config` → 用户与 OAuth。

## 能力

- **本地账号**：管理员初始化后可开 `allow_local_registration`；支持多 local 用户、改密、禁用本地登录。
- **OAuth**：统一路由 `/api/auth/oauth/:slug/*`。内置 **GitHub**；可配置多个 **OIDC** provider（Authentik / Keycloak / Google / Microsoft 等兼容方）。
- **身份表**：`user_identities` 为权威绑定源（一个外部身份对应一个用户）。登录页从 `/api/auth/oauth/providers` 动态渲染可用方式。

## 关键代码

| 区域 | 路径 |
| --- | --- |
| OAuth HTTP | `backend/src/api/oauth.rs` |
| 本地认证 | `backend/src/api/auth_local.rs` |
| Provider 实现 | `backend/src/services/oauth/`（`github`、`oidc`） |
| 配置 | `backend/src/config.rs`（`oauth_providers`） |
| 前端登录 | `frontend/src/components/LoginForm.tsx` |
| 配置 UI | `frontend/src/components/config/OAuthConfigSection.tsx` |
| 迁移 | `backend/migrations/006_oauth_identities.rs` |

## 运维注意

- 生产务必配置 `JWT_SECRET`、正确的 `CORS_ORIGINS` / `BASE_URL`（回调 URL 依赖站点地址）。
- OIDC 需在 IdP 侧登记 redirect：`{BASE_URL}/api/auth/oauth/{slug}/callback`。
- GitHub 兼容字段若仍出现在旧配置里，以 `oauth_providers` 为准。
