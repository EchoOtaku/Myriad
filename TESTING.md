# Myriad 项目测试与启动指南

本文档说明如何启动和测试 Myriad 项目的所有功能。

---

## 📋 前置条件检查

在启动项目之前，请确保以下服务已安装并运行：

### 必需服务

- ✅ **PostgreSQL 16+** - 数据库服务
- ✅ **Node.js 18+** - 前端运行时
- ✅ **Rust 1.75+** - 后端编译器
- ✅ **Docker** (可选) - 用于容器化部署

### 检查命令

```bash
# 检查 PostgreSQL
psql --version

# 检查 Node.js
node --version

# 检查 Rust
rustc --version

# 检查 Docker (可选)
docker --version
```

---

## 🚀 启动步骤

### 方式 1：使用 Docker (推荐)

#### 1. 启动数据库

```bash
# 启动 PostgreSQL 容器
docker-compose up -d postgres

# 验证数据库运行
docker ps | grep postgres
```

#### 2. 初始化数据库

```bash
# 等待数据库就绪
sleep 5

# 运行迁移脚本
docker exec -i myriad-postgres psql -U myriad -d myriad < database/schema.sql
docker exec -i myriad-postgres psql -U myriad -d myriad < database/009_create_users_table.sql
```

#### 3. 配置环境变量

```bash
# 复制环境变量模板
cp backend/.env.example backend/.env
```

编辑 `backend/.env`，至少需要配置以下必需字段：

```env
# 数据库连接（使用 Docker 默认配置）
DATABASE_URL=postgres://myriad:password@localhost:5432/myriad

# 服务器配置
SERVER_HOST=127.0.0.1
SERVER_PORT=3000
RUST_LOG=info

# 安全密钥（生成方式：openssl rand -hex 32）
JWT_SECRET=your-generated-secret-key-here

# GitHub OAuth（必需，用于用户登录）
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_REDIRECT_URL=http://localhost:3000/api/auth/github/callback
FRONTEND_URL=http://localhost:4321

# AI 分析服务（必需）
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash-exp
TOPIC_STYLE=balanced

# 可选：平台集成 API（按需配置）
# GITHUB_USERNAME=your_username
# GITHUB_TOKEN=your_personal_access_token
# BILIBILI_UID=your_bilibili_uid
# STEAM_API_KEY=your_steam_api_key
# STEAM_ID=your_steam_id
```

#### 4. 启动服务

**Windows:**

```powershell
.\scripts\dev.ps1
```

**Linux/macOS:**

```bash
# 后端
cd backend && cargo run &

# 前端
cd frontend && npm run dev &
```

---

### 方式 2：本地 PostgreSQL

#### 1. 启动 PostgreSQL 服务

**Windows:**

```powershell
# 启动 PostgreSQL 服务
Start-Service postgresql-x64-16

# 或通过服务管理器启动
services.msc
```

**Linux:**

```bash
sudo systemctl start postgresql
```

**macOS:**

```bash
brew services start postgresql@16
```

#### 2. 创建数据库

```bash
# 创建数据库
createdb myriad

# 运行迁移
psql myriad < database/schema.sql
psql myriad < database/009_create_users_table.sql
```

#### 3. 配置连接

编辑 `backend/.env` 中的数据库连接字符串：

```env
# 使用本地 PostgreSQL
DATABASE_URL=postgres://postgres:your_password@localhost:5432/myriad

# 或使用 Docker
DATABASE_URL=postgres://myriad:password@localhost:5432/myriad
```

#### 4. 启动服务

同方式 1 的步骤 4。

---

## 🧪 功能测试清单

### 1. 健康检查

```bash
# 后端健康检查
curl http://localhost:3000/health

# 预期响应：
# {"status":"ok","service":"myriad-backend","version":"0.1.0"}
```

### 2. Setup 状态检查

```bash
curl http://localhost:3000/api/setup/status

# 预期响应：
# {
#   "is_setup_required": true/false,
#   "has_database": true,
#   "has_admin_user": false,
#   "has_github_oauth": false,
#   "has_gemini_api": false,
#   "missing_configs": [...]
# }
```

### 3. 首次配置向导

1. 访问 `http://localhost:4321`
2. 自动跳转到 `http://localhost:4321/setup`
3. 按照向导配置：
   - ✅ 数据库初始化
   - ✅ GitHub OAuth
   - ✅ Gemini API
   - ✅ 创建管理员账户

### 4. GitHub OAuth 登录

1. 配置 `.env` 中的 GitHub OAuth
2. 访问 `http://localhost:3000/api/auth/github/login`
3. 授权后应重定向回前端
4. 第一个登录的用户自动成为管理员

### 5. 配置管理

1. 访问 `http://localhost:4321/config`
2. 修改平台配置
3. 点击"保存配置"
4. **观察自动重启功能**：
   - 显示"配置已保存！正在重启后端..."
   - 5 秒后显示"后端重启完成，配置已生效"
   - 后端服务自动重启

### 6. 系统重启 API

```bash
# 测试系统状态
curl http://localhost:3000/api/system/status

# 测试手动重启
curl -X POST http://localhost:3000/api/system/restart

# 预期响应：
# {
#   "success": true,
#   "message": "Backend restart initiated...",
#   "estimated_downtime": "10-15 seconds"
# }
```

### 7. 平台数据抓取

```bash
# Bilibili 用户信息
curl "http://localhost:3000/api/bilibili/user?uid=YOUR_UID"

# Steam 用户信息
curl "http://localhost:3000/api/steam/user?steam_id=YOUR_STEAM_ID&api_key=YOUR_KEY"

# GitHub 统计
curl "http://localhost:3000/api/profile/user-info"
```

### 8. 报告生成

1. 访问 `http://localhost:4321`
2. 点击"生成新报告"
3. 选择主题
4. 等待 AI 生成
5. 查看卡片展示

---

## 🔧 脚本测试

### Windows 脚本

```powershell
# 测试重启脚本
.\scripts\restart.ps1 backend

# 测试停止脚本
.\scripts\stop.ps1

# 测试构建脚本
.\scripts\build.ps1
```

### Linux/macOS 脚本

```bash
# 设置权限
chmod +x scripts/*.sh

# 测试重启脚本
./scripts/restart.sh backend

# 测试停止脚本
./scripts/stop.sh

# 测试构建脚本
./scripts/build.sh
```

---

## 📊 测试结果记录

### ✅ 已验证功能

| 功能         | 状态 | 备注                    |
| ------------ | ---- | ----------------------- |
| 后端编译     | ✅   | 无错误                  |
| 前端编译     | ✅   | 仅 1 个 TypeScript 警告 |
| 数据库连接   | ⏸️   | 需要启动 PostgreSQL     |
| 健康检查 API | ⏸️   | 依赖数据库              |
| Setup 向导   | ⏸️   | 依赖数据库              |
| GitHub OAuth | ⏸️   | 需要配置                |
| 配置自动重启 | ⏸️   | 需要测试                |
| 脚本系统     | ✅   | 已创建                  |

---

## 🐛 常见问题

### 1. 数据库连接超时

**错误**：

```
Error: Connection Error: pool timed out while waiting for an open connection
```

**解决方案**：

```bash
# 启动 Docker PostgreSQL
docker-compose up -d postgres

# 或启动本地 PostgreSQL
# Windows: services.msc
# Linux: sudo systemctl start postgresql
# macOS: brew services start postgresql@16
```

### 2. 端口被占用

**错误**：

```
Address already in use (os error 10048)
```

**解决方案**：

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/macOS
lsof -i :3000
kill -9 <PID>
```

### 3. 前端构建失败

**解决方案**：

```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run build
```

### 4. Rust 编译缓存问题

**解决方案**：

```bash
cd backend
cargo clean
cargo build
```

---

## 📈 性能测试

### 后端性能

```bash
# 使用 wrk 测试
wrk -t4 -c100 -d30s http://localhost:3000/health

# 预期结果：
# Requests/sec: 10000+
# Latency: < 10ms
```

### 数据库查询

```bash
# 测试 setup 状态查询
time curl http://localhost:3000/api/setup/status

# 预期响应时间：< 100ms
```

---

## 🔍 日志查看

### 后端日志

```bash
# 开发模式（控制台输出）
cd backend
cargo run

# 生产模式（文件日志）
RUST_LOG=debug ./target/release/myriad-backend > backend.log 2>&1
```

### 前端日志

```bash
# 浏览器控制台
# F12 -> Console

# 服务器日志
cd frontend
npm run dev 2>&1 | tee frontend.log
```

---

## 📝 测试检查清单

在提交代码或部署之前，请确保：

- [ ] 后端编译无错误 (`cargo build`)
- [ ] 前端编译无错误 (`npm run build`)
- [ ] 所有 API 端点响应正常
- [ ] 数据库迁移成功
- [ ] GitHub OAuth 登录流程正常
- [ ] 配置保存和自动重启功能正常
- [ ] 所有脚本可以执行
- [ ] Setup 向导流程完整
- [ ] 报告生成功能正常
- [ ] 日志输出清晰无错误

---

## 🚦 下一步

测试完成后：

1. ✅ 提交代码到 Git
2. ✅ 更新文档
3. ✅ 准备生产部署
4. ✅ 配置 CI/CD

---

**文档版本**: v1.0
**最后更新**: 2025-11-04
**维护者**: Myriad Team
