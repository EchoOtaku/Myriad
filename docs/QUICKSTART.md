# ⚡ Myriad 快速开始指南

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
docker compose pull
docker compose up -d

# 查看日志（可选）
docker compose logs -f
```

### 5️⃣ 访问应用

打开浏览器访问 `http://localhost:4321`

首次访问会进入初始化向导，按提示完成：
1. 创建管理员账户
2. 配置平台 API（可选）
3. 开始使用

---

## 🔧 开发环境部署

```bash
# 1. 创建开发配置
cp .env.production.example .env

# 2. 使用简单密钥（仅开发环境）
cat >> .env << EOF
POSTGRES_PASSWORD=dev_password_123
JWT_SECRET=dev_jwt_secret_key_at_least_32_chars
CORS_ORIGINS=http://localhost:4321
EOF

# 3. 启动服务
docker compose up -d

# 4. 查看日志
docker compose logs -f
```

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

```bash
# 拉取最新镜像
docker compose pull

# 重新创建容器
docker compose up -d --force-recreate

# 清理旧镜像
docker image prune -f
```

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

# 删除数据库卷
docker volume rm myriad_postgres_data

# 完全清理后重新开始
docker compose up -d
```

---

## 🐛 常见问题

### 问题 1: 端口已被占用

```bash
# 查看端口占用
sudo lsof -i :3000
sudo lsof -i :4321
sudo lsof -i :5432

# 修改端口（在 .env 中添加）
BACKEND_PORT=3001
FRONTEND_PORT=4322
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
# 开发环境
CORS_ORIGINS=http://localhost:4321

# 生产环境（必须是 https）
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

- [完整部署指南](DEPLOYMENT.md) - 生产环境详细配置
- [README](README.md) - 项目介绍和功能说明
- [Issues](https://github.com/yourusername/Myriad/issues) - 问题反馈

---

**祝使用愉快！🎉**
