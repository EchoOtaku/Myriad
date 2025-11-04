# Myriad 单一本地管理员系统重构完成报告

## 概述

已成功将 Myriad 系统重构为单一本地管理员模式,GitHub OAuth 改为可选功能。

## 完成的任务

### 1. 数据库迁移 ✅

- **文件**: `backend/migrations/010_add_local_auth.rs`
- **变更**:
  - 添加 `password_hash` 字段 (VARCHAR(255), NULLABLE)
  - 添加 `auth_provider` 字段 (VARCHAR(20), DEFAULT 'github')
  - 添加 `linked_github_id` 字段 (BIGINT, UNIQUE, NULLABLE)
  - 添加 `local_login_disabled` 字段 (BOOLEAN, DEFAULT false)
  - 修改 `github_id` 为 NULLABLE
  - 添加约束: `auth_provider` 只能是 'local' 或 'github'
  - 添加约束: `is_admin` 只能在 `auth_provider='local'` 时为 true
  - 创建唯一索引确保只有一个本地管理员账户

### 2. 后端认证系统 ✅

- **新增**: `backend/src/api/auth_local.rs`

  - `POST /api/setup/create-admin` - 创建本地管理员
  - `POST /api/auth/login` - 本地登录
  - 使用 Argon2id 哈希密码
  - 用户名验证: 3-20 字符,仅字母数字下划线
  - 密码验证: 最少 8 位

- **修改**: `backend/src/api/setup.rs`

  - 更新 `check_admin_user_exists()` 检查本地管理员

- **修改**: `backend/src/api/auth.rs`

  - GitHub OAuth 用户设置为普通权限 (`is_admin=false`)
  - 新增 `GET /api/auth/github/link` - 启动账户绑定流程
  - 新增 `POST /api/auth/link-github` - 绑定 GitHub 账户

- **依赖**: 添加 `argon2 = "0.5"` 和 `regex = "1.10"`

### 3. 前端引导界面 ✅

- **修改**: `frontend/src/components/SetupWizard.tsx`
  - 简化为 2 步流程: 数据库初始化 → 创建管理员
  - 移除 GitHub OAuth 和 Gemini API 配置步骤
  - 新增本地管理员创建表单
  - 客户端表单验证

### 4. 登录系统 ✅

- **新增**: `frontend/src/pages/login.astro`
- **新增**: `frontend/src/components/LoginForm.tsx`
  - 本地登录表单 (用户名+密码)
  - 保存 JWT 到 localStorage
  - 可选 GitHub OAuth 登录按钮 (如果已配置)

### 5. 配置页面 ✅

- **修改**: `frontend/src/pages/config.astro`
  - 添加"账户管理"卡片
  - 显示当前登录用户信息
  - 显示 GitHub 绑定状态
  - 未绑定时显示"绑定 GitHub 账户"按钮
  - 已绑定时提示"本地登录已禁用"

### 6. 文档更新 ✅

- **修改**: `backend/.env.example`
  - GitHub OAuth 标记为可选
- **修改**: `README.md`
  - 更新初始化流程说明
  - 说明 GitHub OAuth 为可选功能
- **修改**: `docs/DEPLOYMENT.md`
  - 移除 GitHub OAuth 前置要求
  - 添加本地管理员创建说明

## 核心设计

### 认证架构

```
用户类型:
1. 本地管理员 (auth_provider='local', is_admin=true)
   - 系统唯一,通过引导界面创建
   - 可绑定 GitHub 账户
   - 绑定后禁用本地密码登录

2. GitHub OAuth 用户 (auth_provider='github', is_admin=false)
   - 普通权限
   - 可选功能,非必需
```

### 密码安全

- **算法**: Argon2id (默认参数: m=19MiB, t=2, p=1)
- **验证**:
  - 用户名: `^[a-zA-Z0-9_]{3,20}$`
  - 密码: 最少 8 位

### JWT Claims

```json
{
  "sub": "user_id",
  "username": "admin",
  "exp": 1234567890,
  "iat": 1234567890
}
```

## API 端点

### 新增端点

- `POST /api/setup/create-admin` - 创建本地管理员
- `POST /api/auth/login` - 本地登录
- `GET /api/auth/github/link` - 启动 GitHub 绑定
- `POST /api/auth/link-github` - 完成 GitHub 绑定

### 修改端点

- `GET /api/setup/status` - 检查本地管理员是否存在
- `GET /api/auth/github/callback` - GitHub OAuth 用户设置为普通权限

## 初始化流程

1. 访问 `/setup`
2. **步骤 1**: 初始化数据库
   - 运行 PostgreSQL 迁移
   - 创建必要的表结构
3. **步骤 2**: 创建本地管理员
   - 输入用户名和密码
   - 创建唯一管理员账户
4. 完成后跳转到 `/login`
5. 使用管理员账户登录

## 可选功能

### GitHub 账户绑定

1. 登录后访问 `/config`
2. 在"账户管理"卡片点击"绑定 GitHub 账户"
3. 完成 GitHub OAuth 授权
4. 绑定成功后自动禁用本地密码登录
5. 后续可使用 GitHub 登录

## 数据库约束

```sql
-- 确保只有一个本地账户
CREATE UNIQUE INDEX idx_local_admin ON users (auth_provider)
WHERE auth_provider = 'local';

-- 确保管理员只能是本地账户
ALTER TABLE users ADD CONSTRAINT check_admin_local_only
CHECK (NOT is_admin OR auth_provider = 'local');

-- 确保 auth_provider 只能是特定值
ALTER TABLE users ADD CONSTRAINT check_auth_provider
CHECK (auth_provider IN ('local', 'github'));
```

## 安全性考虑

1. **密码哈希**: 使用业界标准 Argon2id
2. **唯一管理员**: 数据库级别约束确保唯一性
3. **权限隔离**: GitHub 用户无法获得管理员权限
4. **绑定保护**: 只有本地管理员可以绑定 GitHub
5. **登录禁用**: 绑定后自动禁用本地密码登录

## 向后兼容性

⚠️ **不兼容变更**: 需要运行新的数据库迁移

现有系统需要:

1. 运行迁移 `010_add_local_auth.rs`
2. 更新 Cargo 依赖
3. 重新编译后端
4. 访问 `/setup` 创建管理员账户

## 测试建议

1. **初始化流程**

   - 测试数据库迁移成功
   - 测试创建管理员账户
   - 测试用户名/密码验证

2. **本地登录**

   - 测试正确凭据登录
   - 测试错误凭据被拒绝
   - 测试 JWT 生成和验证

3. **GitHub 绑定**

   - 测试绑定流程完整性
   - 测试绑定后本地登录被禁用
   - 测试绑定后 GitHub 登录可用

4. **权限控制**
   - 测试 GitHub 用户无管理员权限
   - 测试只能创建一个本地管理员

## 部署清单

- [ ] 备份现有数据库
- [ ] 更新代码到最新版本
- [ ] 运行数据库迁移
- [ ] 更新 `.env` 配置
- [ ] 重新编译后端
- [ ] 重新构建前端
- [ ] 重启服务
- [ ] 访问 `/setup` 完成初始化
- [ ] 测试登录功能
- [ ] (可选) 配置 GitHub OAuth
- [ ] (可选) 绑定管理员 GitHub 账户

## 总结

此次重构成功实现了:

- ✅ 单一本地管理员模式
- ✅ GitHub OAuth 改为可选
- ✅ 简化的初始化流程
- ✅ 增强的安全性
- ✅ 完整的账户绑定功能
- ✅ 向后兼容的迁移路径

系统现在可以在没有任何外部服务依赖的情况下完成初始化和使用。
