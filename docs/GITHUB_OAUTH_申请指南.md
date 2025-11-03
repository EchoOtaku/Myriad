# GitHub OAuth App 申请指南

本文档详细说明如何为 Myriad 项目申请和配置 GitHub OAuth App，实现用户登录功能。

---

## 📋 前提条件

- 拥有 GitHub 账号
- 能够访问 GitHub Developer Settings
- 已克隆 Myriad 项目到本地

---

## 🚀 申请步骤

### 第一步：访问 GitHub 开发者设置

有两种方式可以访问：

**方式 1：直接访问链接**

```
https://github.com/settings/developers
```

**方式 2：通过 GitHub 导航**

1. 登录 GitHub
2. 点击右上角头像
3. 选择 **Settings**（设置）
4. 左侧菜单滚动到底部
5. 点击 **Developer settings**（开发者设置）
6. 点击 **OAuth Apps**

---

### 第二步：创建新的 OAuth App

1. 在 OAuth Apps 页面，点击 **"New OAuth App"** 按钮

2. 填写应用信息表单：

#### Application name（应用名称）

```
Myriad
```

> 💡 提示：可以使用任何你喜欢的名字，例如 "Myriad Dev"、"我的 Myriad 应用" 等

#### Homepage URL（主页地址）

```
http://localhost:4321
```

> ⚠️ 开发环境：使用 `http://localhost:4321`  
> 🌐 生产环境：填写你的实际域名，如 `https://yourdomain.com`

#### Application description（应用描述）- 可选

```
Multi-Platform Profile Aggregator - 多平台个人信息聚合与分析工具
```

#### Authorization callback URL（授权回调地址）⭐ 最重要！

```
http://localhost:3000/api/auth/github/callback
```

> ⚠️ **关键**：这个地址必须精确匹配后端配置，否则授权会失败！  
> 🌐 生产环境：改为 `https://yourdomain.com/api/auth/github/callback`

3. 点击 **"Register application"** 按钮完成注册

---

### 第三步：获取凭证信息

注册成功后，你会看到应用详情页面：

#### Client ID（客户端 ID）

- 格式类似：`Iv1.a1b2c3d4e5f6g7h8`
- 这是公开信息，可以直接复制

#### Client Secret（客户端密钥）

1. 点击 **"Generate a new client secret"** 按钮
2. 输入你的 GitHub 密码确认
3. **立即复制并保存！** ⚠️ 只显示一次，关闭页面后无法再查看

示例：

```
Client ID: Iv1.a1b2c3d4e5f6g7h8
Client Secret: 1234567890abcdef1234567890abcdef12345678
```

---

## ⚙️ 项目配置

### 第一步：创建或编辑 .env 文件

在 `backend/` 目录下创建 `.env` 文件（如果不存在）：

```bash
cd C:\Users\Think\Documents\GitHub\Myriad\backend
notepad .env
```

### 第二步：配置环境变量

将以下内容添加到 `.env` 文件中：

```bash
# ========================================
# GitHub OAuth 配置
# ========================================
GITHUB_CLIENT_ID=你的_Client_ID
GITHUB_CLIENT_SECRET=你的_Client_Secret
GITHUB_REDIRECT_URL=http://localhost:3000/api/auth/github/callback

# ========================================
# JWT 密钥配置
# ========================================
# 用于生成和验证用户登录令牌
# 必须是至少 32 位的随机字符串
JWT_SECRET=your_random_secret_key_at_least_32_chars_long

# ========================================
# 前端地址配置
# ========================================
# OAuth 授权成功后跳转的前端地址
FRONTEND_URL=http://localhost:4321
```

### 第三步：生成安全的 JWT Secret

JWT_SECRET 是用于加密用户会话的密钥，必须足够安全。

**Windows PowerShell 生成方法：**

```powershell
# 生成 32 位随机字符串
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

**在线生成方法：**

- 访问 https://www.uuidgenerator.net/
- 或使用密码生成器生成 32 位以上随机字符串

**示例配置：**

```bash
JWT_SECRET=9Kx7mN2pQ5rT8wY3vB6nM1jL4hG7fD0sA
```

---

## 🔧 启动和测试

### 1. 运行数据库迁移

首先确保数据库已创建用户表：

```powershell
# 连接到 PostgreSQL 并执行迁移
psql -U postgres -d myriad -f database/009_create_users_table.sql
```

### 2. 启动后端服务

```powershell
cd C:\Users\Think\Documents\GitHub\Myriad\backend
cargo run
```

看到以下日志表示启动成功：

```
INFO myriad_backend: Database connection established
INFO myriad_backend: 🚀 Server listening on http://127.0.0.1:3000
```

### 3. 启动前端服务

```powershell
cd C:\Users\Think\Documents\GitHub\Myriad\frontend
npm run dev
```

### 4. 测试登录功能

1. 打开浏览器访问：`http://localhost:4321`
2. 在左侧导航岛中找到登录按钮（人物图标）
3. 点击登录按钮
4. 浏览器会跳转到 GitHub 授权页面
5. 点击 **"Authorize"** 按钮授权应用
6. 自动跳转回首页，此时应该显示你的 GitHub 头像
7. 点击头像可以看到用户菜单，包含用户名和退出登录选项

---

## 🎯 权限说明

Myriad 应用请求的 GitHub 权限：

| 权限         | 说明             | 用途                                 |
| ------------ | ---------------- | ------------------------------------ |
| `read:user`  | 读取用户基本信息 | 获取用户名、头像、个人简介等公开信息 |
| `user:email` | 读取用户邮箱地址 | 获取用户的主要邮箱地址               |

> ✅ **安全提示**：应用不会请求任何写入权限，完全只读，保证账号安全。

---

## 🌐 生产环境配置

如果要部署到生产环境，需要修改以下配置：

### 1. GitHub OAuth App 设置

在 GitHub OAuth App 设置页面修改：

- **Homepage URL**: `https://yourdomain.com`
- **Authorization callback URL**: `https://yourdomain.com/api/auth/github/callback`

> 💡 可以同时注册开发和生产两个不同的 OAuth App

### 2. 后端 .env 配置

```bash
GITHUB_CLIENT_ID=生产环境的_Client_ID
GITHUB_CLIENT_SECRET=生产环境的_Client_Secret
GITHUB_REDIRECT_URL=https://yourdomain.com/api/auth/github/callback
FRONTEND_URL=https://yourdomain.com

# 生产环境务必使用新的强随机 JWT Secret
JWT_SECRET=生产环境专用的超长随机字符串
```

### 3. CORS 配置

确保后端允许来自生产域名的跨域请求（已在代码中配置）。

---

## ❓ 常见问题

### Q1: 回调地址填错了怎么办？

**A**: 在 GitHub OAuth App 设置页面可以随时修改，修改后立即生效，无需重新生成凭证。

### Q2: Client Secret 忘记复制了？

**A**: 在应用设置页面点击 "Generate a new client secret"，生成新的密钥。旧密钥会立即失效。

### Q3: 授权时提示 redirect_uri_mismatch 错误？

**A**: 这表示回调地址不匹配，检查以下项：

- GitHub OAuth App 中配置的回调地址
- 后端 .env 中的 `GITHUB_REDIRECT_URL`
- 确保端口号正确（后端默认 3000）
- 确保没有多余的斜杠 `/`

### Q4: 点击登录按钮提示 "GITHUB_CLIENT_ID not set"？

**A**: 检查以下几点：

- `.env` 文件是否在 `backend/` 目录下
- 环境变量名拼写是否正确
- 是否重启了后端服务
- 是否安装了 `dotenvy` 依赖（项目已包含）

### Q5: 授权成功但没有跳转回前端？

**A**: 检查 `.env` 中的 `FRONTEND_URL` 是否正确配置为 `http://localhost:4321`

### Q6: 如何撤销应用授权？

**A**: 访问 https://github.com/settings/applications，在 "Authorized OAuth Apps" 中找到应用并点击 "Revoke"。

### Q7: 开发和生产环境可以共用一个 OAuth App 吗？

**A**: 不推荐。建议分别创建 "Myriad Dev" 和 "Myriad" 两个应用，避免混淆和安全风险。

---

## 🔒 安全最佳实践

1. **保护 Client Secret**

   - ❌ 不要提交到 Git 仓库
   - ❌ 不要分享给他人
   - ✅ 只存储在服务器的 .env 文件中
   - ✅ 项目已配置 `.gitignore` 忽略 `.env` 文件

2. **保护 JWT Secret**

   - ❌ 不要使用简单字符串
   - ❌ 不要使用默认值
   - ✅ 使用 32 位以上随机字符串
   - ✅ 生产环境使用独立的密钥

3. **定期更新密钥**

   - 建议每 3-6 个月更新一次 Client Secret
   - 怀疑泄露时立即重新生成

4. **监控应用使用**
   - 定期检查 GitHub OAuth App 的授权用户列表
   - 发现异常及时撤销可疑授权

---

## 📚 相关文档

- [GitHub OAuth 官方文档](https://docs.github.com/en/developers/apps/building-oauth-apps)
- [Myriad 项目架构文档](./ARCHITECTURE.md)
- [Myriad API 文档](./API.md)
- [部署指南](./DEPLOYMENT.md)

---

## 🆘 需要帮助？

如果遇到问题：

1. 查看后端日志：注意 `ERROR` 和 `WARN` 级别的日志
2. 查看浏览器控制台：按 F12 查看网络请求和错误信息
3. 检查配置文件：确保所有环境变量都正确设置
4. 提交 Issue：在 GitHub 仓库提交问题，附上错误日志

---

**最后更新**: 2025 年 11 月 3 日  
**文档版本**: 1.0
