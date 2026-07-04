# OAuth 重构与第三方登录拓展计划

> Status: Draft · 2026-05-16
> Owner: Myriad core
> 关联模块: `backend/src/api/auth.rs`, `backend/src/api/auth_local.rs`, `backend/src/oauth_url_builder.rs`, `backend/migrations/001_initial_schema.rs`, `frontend/src/components/LoginForm.tsx`

## 1. 背景与目标

当前 Myriad 只支持 GitHub OAuth + 单一本地管理员账户。本计划目标：

1. 抽象出可拓展的 OAuth Provider 框架，支持 **通用 OIDC** 作为 P0 落地，可一次接入 Google/Microsoft/Authentik/Keycloak/Auth0 等所有兼容方。
2. 解除本地账号注册限制，允许多 local 用户、允许开放注册（开关控制）。
3. 取消 "绑定 GitHub = 禁用本地登录" 的强耦合，让本地登录与 OAuth identity 并存。
4. 全量切换数据模型到 `user_identities` 多对一表，旧字段保留作为兼容镜像。

## 2. 现状盘点

### 2.1 OAuth 相关

| 位置 | 现状 |
|---|---|
| `backend/src/api/oauth.rs` | 通用 OAuth handler，按 provider slug 路由 |
| `backend/src/services/oauth/github.rs` | 新 GitHub provider 实现，挂在 `/api/auth/oauth/github/*` |
| `backend/src/services/oauth/oidc.rs` | 通用 OIDC provider，实现 discovery、JWKS 验签和 userinfo |
| `backend/src/oauth_url_builder.rs` | 只保留 `SiteConfig` / 启动日志辅助 |
| `backend/src/config.rs` | `oauth_providers` 为主，`github_client_id` / `github_client_secret` 作为兼容镜像 |
| `backend/migrations/001_initial_schema.rs:116-152` | `users` 表硬编码 `github_id` `linked_github_id` `github_profile_url`；CHECK 约束 `auth_provider IN ('local','github')` |
| `frontend/src/components/LoginForm.tsx` | 从 `/api/auth/oauth/providers` 动态渲染登录方式 |

### 2.2 本地账号限制

| # | 限制位置 | 现行行为 |
|---|---|---|
| A1 | `auth_local.rs:73-104` `create_admin` | 全库只允许一个 local admin |
| A2 | `001_initial_schema.rs:222` `idx_local_admin` | `UNIQUE(auth_provider) WHERE auth_provider='local'` 硬限制全库只能 1 个 local 用户 |
| A3 | `001_initial_schema.rs:217` `check_admin_local_only` | `NOT is_admin OR auth_provider='local'` |
| A4 | 无 `/api/auth/register` 端点 | 普通用户只能从 GitHub OAuth 进入 |
| A5 | `auth.rs:407-421` link 流程 | 绑定 GitHub 后强制 `local_login_disabled=true` |
| A6 | `auth_local.rs:247-255` `local_login` | `local_login_disabled` 为 true 时拒绝登录 |
| A7 | `auth_local.rs:445-453` `change_password` | 同样被 `local_login_disabled` 拦截 |
| A8 | `idx_linked_github_id UNIQUE` | 一个 GitHub 账户只能绑到一个 user 上（**保留**） |

## 3. 总体策略

- 一次重构到位；旧 `/api/auth/github/*` 兼容层已删除，统一使用 `/api/auth/oauth/:slug/*`。
- 数据层：新增 `user_identities` 表为主权威源；`users.github_id` `linked_github_id` `github_profile_url` 降级为冗余镜像，PR #6 中 drop。
- Provider 模型：trait 化。GitHub 为内置硬编码 provider；OIDC 为配置驱动的动态 provider，支持多实例（slug 区分）。
- 本地账号：去掉数据库层硬限制，加 `allow_local_registration` 开关，提供后补密码 / 本地登录开关端点。

## 4. 数据模型

### 4.1 新表 `user_identities`

```text
id                SERIAL PK
user_id           INT NOT NULL REFERENCES users(id) ON DELETE CASCADE
provider          TEXT NOT NULL              -- "github" | "oidc:<slug>"
provider_user_id  TEXT NOT NULL              -- sub (OIDC) / id (GitHub)
provider_username TEXT
email             TEXT
email_verified    BOOLEAN
avatar_url        TEXT
profile_url       TEXT
raw_profile       JSONB
access_token      TEXT                       -- 加密（可选）
refresh_token     TEXT                       -- 加密（可选）
token_expires_at  TIMESTAMPTZ
is_primary        BOOLEAN DEFAULT false
linked_at         TIMESTAMPTZ DEFAULT NOW()
last_login_at     TIMESTAMPTZ

UNIQUE(provider, provider_user_id)
INDEX(user_id)
INDEX(provider, email)
```

### 4.2 数据回填

```sql
INSERT INTO user_identities (user_id, provider, provider_user_id, provider_username,
                              email, avatar_url, profile_url, raw_profile, is_primary, linked_at)
SELECT id, 'github', github_id::TEXT, username, email, avatar_url, github_profile_url,
       jsonb_build_object('bio', bio, 'location', location, 'company', company),
       (auth_provider = 'github'), created_at
FROM users WHERE github_id IS NOT NULL;

INSERT INTO user_identities (user_id, provider, provider_user_id, is_primary, linked_at)
SELECT id, 'github', linked_github_id::TEXT, false, updated_at
FROM users WHERE linked_github_id IS NOT NULL AND auth_provider = 'local';
```

### 4.3 约束调整

```sql
-- 解除全库只能 1 个 local 用户的限制
DROP INDEX IF EXISTS idx_local_admin;

-- admin 不再强制 local provider
ALTER TABLE users DROP CONSTRAINT IF EXISTS check_admin_local_only;

-- auth_provider 取值范围扩展
ALTER TABLE users DROP CONSTRAINT IF EXISTS check_auth_provider;
ALTER TABLE users ADD CONSTRAINT check_auth_provider
  CHECK (auth_provider IN ('local','github','oidc','federated'));

-- username 全局唯一（大小写不敏感）
-- 预处理：先把现有 LOWER(username) 冲突的账户加 _<id> 后缀
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(LOWER(username));
```

`idx_linked_github_id UNIQUE` 保留。

## 5. 配置层

### 5.1 新结构

```rust
pub struct OAuthProviderEntry {
    pub kind: String,            // "github" | "oidc"
    pub slug: String,            // 路由用，如 "google" / "company-sso"
    pub display_name: String,
    pub enabled: bool,
    pub client_id: String,
    pub client_secret: String,   // 存时加密
    pub scopes: Vec<String>,
    pub discovery_url: Option<String>,   // OIDC: .../.well-known/openid-configuration
    pub icon_url: Option<String>,
}

// DynamicConfig 新增
pub oauth_providers: Vec<OAuthProviderEntry>,
pub allow_local_registration: bool,   // 默认 false
```

### 5.2 兼容层

`DynamicConfig::load_from_db()` 检测旧 `github_client_id` / `github_client_secret`，自动包装为
`oauth_providers[kind="github", slug="github"]` 项；写入时双写直到下个 minor 版本。

## 6. Provider 抽象

### 6.1 目录结构

```text
backend/src/services/oauth/
  mod.rs          // OAuthProvider trait + NormalizedProfile + ProviderTokens
  github.rs       // GitHub 实现
  oidc.rs         // 通用 OIDC（基于 openidconnect crate）
  registry.rs     // ProviderRegistry：装载/热重载
  state.rs        // OAuth CSRF state store（从 auth.rs 抽出）
```

### 6.2 Trait

```rust
#[async_trait]
pub trait OAuthProvider: Send + Sync {
    fn slug(&self) -> &str;
    fn kind(&self) -> &str;                 // "github" | "oidc"
    fn display_name(&self) -> &str;
    fn icon(&self) -> Option<&str>;
    async fn build_auth_url(&self, state: &str, redirect_uri: &str) -> Result<String>;
    async fn exchange_code(&self, code: &str, redirect_uri: &str) -> Result<ProviderTokens>;
    async fn fetch_profile(&self, tokens: &ProviderTokens) -> Result<NormalizedProfile>;
}

pub struct NormalizedProfile {
    pub provider_user_id: String,
    pub username: String,
    pub email: Option<String>,
    pub email_verified: bool,
    pub avatar_url: Option<String>,
    pub profile_url: Option<String>,
    pub raw: serde_json::Value,
}
```

### 6.3 OIDC 实现要点

- 使用 `openidconnect = "3"` crate。
- 启动时 `CoreClient::from_provider_metadata(discovery)`，缓存 24h。
- `fetch_profile` 直接读 id_token claims（`sub` / `email` / `name` / `picture`）。
- `provider` 字段格式 `"oidc:<slug>"`，支持多 OIDC 实例共存。

## 7. API 端点

### 7.1 OAuth

```text
GET    /api/auth/oauth/providers              列出 enabled providers (公开)
GET    /api/auth/oauth/:slug/login            重定向到 provider 授权页
GET    /api/auth/oauth/:slug/callback         交换 code + 登录/创建用户
GET    /api/auth/oauth/:slug/link             绑定 (需 JWT + is_admin)
DELETE /api/auth/oauth/:slug/unlink/:id       解绑 (需 JWT + 拥有该 identity)
GET    /api/auth/identities                   当前用户所有 identities
```

### 7.2 本地账号（解禁后）

```text
POST   /api/setup/create-admin                首个 admin（保留，改为"检查任意 admin"）
POST   /api/auth/register                     公开注册（allow_local_registration 控制）  NEW
POST   /api/auth/login                        用户名密码登录（去掉 local_login_disabled 强拒）
POST   /api/auth/logout                       登出
POST   /api/auth/change-password              修改密码（去掉 local_login_disabled 强拒）
POST   /api/auth/me/set-password              首次设置密码（GitHub-only 用户）  NEW
PATCH  /api/auth/me/local-login               开关本地登录  NEW
POST   /api/admin/users                       admin 直接建本地号  NEW
```

### 7.3 旧 GitHub 兼容层

旧 `/api/auth/github/{login,callback,link}` 和 `/api/auth/link-github` 已删除。
调用方应直接使用：

```text
GET /api/auth/oauth/github/login
GET /api/auth/oauth/github/callback
GET /api/auth/oauth/github/link
```

## 8. 核心逻辑：账户匹配策略

`find_or_create_user_from_identity()` 在通用 callback handler 内：

1. `user_identities.provider+provider_user_id` 命中 → 登录该 user。
2. 否则若 `email_verified=true` 且能匹配现有 `users.email` → 自动 link（**仅** verified 才允许，防钓鱼）。
3. 否则创建新 user (`auth_provider=oidc` 或 `github`) + identity。

LinkAccount 流程分流到 `find_or_create` 之前：state.purpose=LinkAccount 时直接写 identity 到指定 user_id，不再修改 `local_login_disabled`。

## 9. 本地登录开关端点细则

### 9.1 `PATCH /api/auth/me/local-login { enabled: bool }`

- 需要 JWT。
- `enabled=false` 时：要求用户至少有一个 OAuth identity（防止账户失联）。
- `enabled=true` 时：要求 `password_hash` 不为 NULL，否则返回 "请先设置密码"。

### 9.2 `POST /api/auth/me/set-password { new_password }`

- 需要 JWT。
- 要求当前 `password_hash` 为 NULL（已有密码走 change_password）。
- 设置后用户即可用 username+password 登录。

### 9.3 `local_login` 调整

去掉 `WHERE auth_provider='local'` 过滤，改为：

```sql
SELECT ... FROM users
WHERE LOWER(username)=LOWER($1) AND password_hash IS NOT NULL
```

保留 `local_login_disabled` 强拒（这是用户偏好，不是绑定副作用）。

## 10. 前端

| 位置 | 改动 |
|---|---|
| `LoginForm.tsx` | 拉 `/api/auth/oauth/providers` 动态渲染按钮；按 `allow_local_registration` 显示"注册"链接 |
| `RegisterForm.tsx` (新) | 复用 LoginForm 样式，调 `/api/auth/register` |
| 账户设置面板（新或合并） | ① 本地登录开关 ② 设置/修改密码 ③ identities 列表 + 解绑 |
| Admin 配置面板 | "允许公开注册"开关；OAuth provider CRUD（GitHub 内置 + OIDC 动态列表） |
| `AuthContext.tsx` / `/api/auth/me` | 返回值新增 `identities: [{provider, provider_username, linked_at}]` |

## 11. 提交切分

| PR | 范围 | 风险 |
|---|---|---|
| #1 | Migration: `user_identities` 表 + 回填 + 解禁约束 (`drop idx_local_admin` / `check_admin_local_only`) + username unique | 中（DB 改动） |
| #2 | `OAuthProvider` trait + GitHub 实现 + 通用 handler + 兼容层重定向 | 中（核心登录流） |
| #3 | OIDC provider + registry 热重载 | 低 |
| #4 | 本地注册端点 + 密码后补 + 本地登录开关端点 + 移除 link 副作用 | 中 |
| #5 | 前端 dynamic providers + 注册表单 + 账户面板 | 低 |
| #6 | 文档 + drop `users.github_id` / `linked_github_id` / `github_profile_url` 镜像列 | 极低（半年后） |

## 12. 测试 Checklist

- [ ] 老 GitHub-only 用户登录路径（兼容层重定向）。
- [ ] 本地 admin 绑定 GitHub → 用 GitHub 登录回到 admin（LinkAccount 流程）。
- [ ] 配置 OIDC provider（Authentik 或 logto demo）→ 首次登录自动建用户 + identity。
- [ ] 同一 email 在两个 verified provider → 自动合并到同一 user。
- [ ] 解绑唯一 identity 且无密码的 user → 拒绝。
- [ ] 开启 `allow_local_registration` 后能注册新本地账号。
- [ ] GitHub 用户走 `/api/auth/me/set-password` 后能用 username 本地登录。
- [ ] 已绑定 GitHub 的用户能继续本地登录（除非主动关闭 local_login）。
- [ ] 现有 `local_login_disabled=true` 的 admin 升级后保持原偏好，但 UI 提示可重新启用。

## 13. 兼容性注意

1. **username 冲突预处理**：加 unique 索引前扫现有数据，冲突方加 `_<id>` 后缀并 log。
2. **保留旧字段**：`users.github_id` / `linked_github_id` / `github_profile_url` 在 PR #1–#5 期间双写，PR #6 才 drop。
3. **`local_login_disabled` 语义反转**：从"绑定副作用"变为"用户偏好"。字段名不改，API 文档与配置面板需说明。
4. **环境变量 `GITHUB_CLIENT_ID/SECRET`**：保留为 fallback，DynamicConfig 优先。
