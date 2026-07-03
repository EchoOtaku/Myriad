# ⚡ Myriad 快速开始指南

Myriad 生产部署默认使用 **proxy + updater** 拓扑：

```text
proxy(唯一宿主端口，默认 80) ─┬─► frontend
                              └─► backend ─► postgres
updater(内网) ─► docker compose / pgdata snapshot / tag switch
```

开发环境才直接访问前端 `1102` 和后端 `1103`。生产环境不要暴露
backend/frontend 端口，也不要用 `:latest` 直接覆盖容器。
完整端口表见 [deployment/PORTS.md](./deployment/PORTS.md)。

## 🚀 生产环境部署（3 分钟）

### 1️⃣ 准备环境

```bash
# 克隆项目
git clone https://github.com/yourusername/Myriad.git
cd Myriad

# 创建配置文件
cp .env.production.example .env
```

### 2️⃣ 生成安全密钥

**一键生成所有密钥：**

```bash
# Linux/macOS
cat >> .env << EOF
POSTGRES_PASSWORD=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
CORS_ORIGINS=https://yourdomain.com
EOF

# 或手动生成
openssl rand -base64 32  # 复制结果到 POSTGRES_PASSWORD
openssl rand -base64 32  # 复制结果到 JWT_SECRET
```

**编辑 .env 文件，修改域名：**

```bash
# 必须修改为你的实际域名
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### 3️⃣ 运行安全检查

```bash
bash scripts/check-security.sh
```

确保所有检查通过后再继续。

### 4️⃣ 启动服务

```bash
# 拉取镜像并启动
bash scripts/docker/deploy.sh up

# 查看日志（可选）
docker compose logs -f
```

### 5️⃣ 访问应用

打开浏览器访问 `http://localhost`（或 `.env` 里的 `HTTP_PORT` 对应端口）。

首次访问会进入初始化向导，按提示完成：
1. 创建管理员账户
2. 配置平台 API（可选）
3. 开始使用

---

## 🔧 开发环境部署

```bash
# 日常开发：只启动 PostgreSQL，不启动 proxy/updater
docker compose -f docker-compose.dev.yml up -d postgres

# 后端：读取 backend/.env，监听 1103
(cd backend && cp .env.example .env && cargo run)

# 前端：监听 1102，/api/* 通过 Astro dev proxy 转发到 1103
(cd frontend && pnpm install && pnpm dev)
```

需要在开发 UI 里测试“更新管理”时，启动 updater harness：

```bash
# 一次性启动 DB + updater harness + backend + frontend
./scripts/dev/dev.sh start all-updater

# 或只启动 updater harness，再重启 backend 让它读取 MYRIAD_UPDATER_URL/UPDATE_TOKEN
./scripts/dev/dev.sh start updater
./scripts/dev/dev.sh restart backend
```

这个 harness 监听 `127.0.0.1:1101`，运行数据放在 `.dev-updater/`，用于验证
backend `/api/admin/updater/*` 和前端更新管理面板。真实镜像替换/生产拓扑仍使用
`scripts/docker/deploy.sh`。

---

## 📋 常用命令

### 服务管理

```bash
# 启动所有服务
docker compose up -d

# 停止所有服务
docker compose down

# 重启服务
docker compose restart

# 查看服务状态
docker compose ps

# 查看实时日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres
```

### 更新应用

生产环境的常规更新从管理员界面执行：设置 → 关于 → 更新管理。
它会通过 backend 的 `/api/admin/updater/*` 通道调用 updater，浏览器不会接触
`UPDATE_TOKEN`。命令行只用于 bootstrap 或救援，详见
[UPDATER_QUICKSTART.md](./UPDATER_QUICKSTART.md)。

### 数据备份

```bash
# 备份数据库
docker compose exec postgres pg_dump -U myriad myriad > backup_$(date +%Y%m%d).sql

# 恢复数据库
docker compose exec -T postgres psql -U myriad myriad < backup_20240101.sql
```

### 清理数据

```bash
# ⚠️ 警告：以下操作会删除所有数据

# 停止并删除所有容器、卷
docker compose down -v

# 删除 bind-mounted 数据目录
rm -rf pgdata

# 完全清理后重新开始
docker compose up -d
```

---

## 🐛 常见问题

### 问题 1: 端口已被占用

```bash
# 查看端口占用
sudo lsof -i :80
sudo lsof -i :5432

# 修改生产入口端口（在 .env 中添加）
HTTP_PORT=8080
```

### 问题 2: 容器启动失败

```bash
# 查看详细日志
docker compose logs backend
docker compose logs postgres

# 检查配置
docker compose config

# 重新构建
docker compose down
docker compose up -d --force-recreate
```

### 问题 3: 数据库连接失败

```bash
# 检查数据库是否正常
docker compose exec postgres psql -U myriad -d myriad -c "SELECT 1"

# 查看数据库日志
docker compose logs postgres

# 检查环境变量
docker compose exec backend env | grep DATABASE_URL
```

### 问题 4: CORS 错误

确保 `.env` 中 `CORS_ORIGINS` 配置正确：

```bash
# 开发环境后端允许前端 dev origin
CORS_ORIGINS=http://localhost:1102

# 生产环境（必须是你的真实域名，通常由 proxy/外层 TLS 入口访问）
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

---

## 🔐 安全提示

生产环境部署前务必检查：

- ✅ `POSTGRES_PASSWORD` 长度 >= 32 字符
- ✅ `JWT_SECRET` 长度 >= 32 字符
- ✅ `CORS_ORIGINS` 配置为实际域名（非 localhost）
- ✅ 已配置 HTTPS（通过 Nginx/Caddy）
- ✅ `.env` 文件权限为 600: `chmod 600 .env`
- ✅ `.env` 文件未提交到 Git

**自动检查：**
```bash
bash scripts/check-security.sh
```

---

## 📚 更多文档

- [Docker 部署](deployment/DOCKER_DEPLOYMENT.md) - 当前 proxy + updater 生产栈
- [Updater 快速开始](UPDATER_QUICKSTART.md) - 生产更新、回滚与 tag 管理
- [README](README.md) - 项目介绍和功能说明
- [Issues](https://github.com/yourusername/Myriad/issues) - 问题反馈

---

**祝使用愉快！🎉**
