# GitHub OAuth 设置指南

## 1. 创建 GitHub OAuth App

1. 访问 [GitHub Developer Settings](https://github.com/settings/developers)
2. 点击 "New OAuth App"
3. 填写应用信息：
   - **Application name**: Myriad (或你喜欢的名字)
   - **Homepage URL**: `http://localhost:4321` (开发环境) 或你的实际域名
   - **Authorization callback URL**: `http://localhost:3000/api/auth/github/callback`
4. 点击 "Register application"
5. 在应用页面，记下：
   - **Client ID**
   - **Client Secret** (点击 "Generate a new client secret" 生成)

## 2. 配置环境变量

在 `backend/.env` 文件中配置：

```bash
# GitHub OAuth
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here
GITHUB_REDIRECT_URL=http://localhost:3000/api/auth/github/callback

# JWT Secret (随机生成一个强密码)
JWT_SECRET=your_random_secret_key_at_least_32_characters

# Frontend URL
FRONTEND_URL=http://localhost:4321
```

## 3. 运行数据库迁移

执行用户表创建脚本：

```bash
psql -U postgres -d myriad -f database/009_create_users_table.sql
```

## 4. 重启服务

```bash
cd backend
cargo run
```

## 5. 测试登录

1. 访问 `http://localhost:4321`
2. 在左侧导航岛中点击登录按钮
3. 授权 GitHub 应用
4. 成功后会跳转回首页，显示你的 GitHub 头像

## 注意事项

- 生产环境需要将回调 URL 改为你的实际域名
- JWT_SECRET 请使用强随机字符串，不要暴露给外部
- 确保数据库已经创建 users 和 sessions 表
- 未登录状态下，配置保存和报告生成功能会被禁用

## 权限说明

应用会请求以下 GitHub 权限：

- `read:user` - 读取用户基本信息
- `user:email` - 读取用户邮箱地址

不会请求任何写入权限，完全安全。
