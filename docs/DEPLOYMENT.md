# 🚀 Myriad 生产环境部署指南

本文档提供 Myriad 在生产环境中使用 Docker Compose 一键部署的完整指南。

## 📋 前置要求

- Docker 20.10+
- Docker Compose 2.0+
- 域名（用于 HTTPS 访问）
- 反向代理（推荐 Nginx/Caddy/Traefik）

## 🔐 快速部署（3 步完成）

### 1️⃣ 克隆项目并配置环境变量

```bash
# 克隆项目
git clone https://github.com/yourusername/Myriad.git
cd Myriad

# 复制生产环境配置模板
cp .env.production.example .env

# 生成强密钥
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)" >> .env
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
```

### 2️⃣ 编辑 .env 文件

```bash
nano .env  # 或使用你喜欢的编辑器
```

**必须修改的配置：**

```bash
# 修改为你的实际域名
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# 如果前后端分离部署，设置 API 地址
PUBLIC_API_URL=https://api.yourdomain.com
```

### 3️⃣ 启动服务

```bash
# 拉取最新镜像并启动
docker compose pull
docker compose up -d

# 查看日志
docker compose logs -f
```

访问 `http://localhost:4321` 完成初始化配置。

---

## 🔧 详细配置说明

### 环境变量配置

#### 必需配置

| 变量名 | 说明 | 生成方式 | 示例 |
|--------|------|---------|------|
| `POSTGRES_PASSWORD` | 数据库密码 | `openssl rand -base64 32` | `kJ8mN2pQ5rT7vX9z...` |
| `JWT_SECRET` | JWT 密钥 | `openssl rand -base64 32` | `B3cF6hK8mP0qS4tW...` |
| `CORS_ORIGINS` | 允许的前端域名 | 手动设置 | `https://yourdomain.com` |

#### 可选配置

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PUBLIC_API_URL` | 前端 API 地址 | 空（自动检测） |
| `EXPOSE_DB_PORT` | 数据库端口映射 | 未设置（不暴露） |
| `BACKEND_PORT` | 后端端口 | 3000 |
| `FRONTEND_PORT` | 前端端口 | 4321 |
| `RUST_LOG` | 日志级别 | info |

### 🔒 安全最佳实践

#### ✅ 必须执行

1. **使用强密钥**
   ```bash
   # 密钥长度不少于 32 字符
   openssl rand -base64 32
   ```

2. **配置 CORS**
   ```bash
   # ❌ 错误 - 不要使用通配符
   CORS_ORIGINS=*

   # ✅ 正确 - 明确指定域名
   CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
   ```

3. **不暴露数据库端口**
   ```bash
   # ❌ 错误 - 暴露到公网
   EXPOSE_DB_PORT=5432

   # ✅ 正确 - 不设置此变量（仅内部网络访问）
   # EXPOSE_DB_PORT=
   ```

4. **使用 HTTPS**
   - 使用反向代理（Nginx/Caddy）配置 SSL
   - 推荐使用 Let's Encrypt 免费证书

#### ⚠️ 推荐执行

1. **定期备份数据库**
   ```bash
   # 备份
   docker compose exec postgres pg_dump -U myriad myriad > backup.sql

   # 恢复
   docker compose exec -T postgres psql -U myriad myriad < backup.sql
   ```

2. **监控日志**
   ```bash
   # 实时查看所有服务日志
   docker compose logs -f

   # 仅查看后端日志
   docker compose logs -f backend
   ```

3. **限制容器权限**
   - 已在 docker-compose.yml 中配置
   - `no-new-privileges:true`
   - `read_only:true`（frontend）

---

## 🌐 反向代理配置示例

### Nginx 配置

```nginx
# /etc/nginx/sites-available/myriad.conf

# 后端 API
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持（如需要）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# 前端
server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://localhost:4321;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name api.yourdomain.com yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

### Caddy 配置（推荐，自动 HTTPS）

```caddyfile
# Caddyfile

# 后端 API
api.yourdomain.com {
    reverse_proxy localhost:3000
}

# 前端
yourdomain.com, www.yourdomain.com {
    reverse_proxy localhost:4321
}
```

启用 Caddy：
```bash
caddy run --config Caddyfile
```

---

## 🔄 更新与维护

### 更新应用

```bash
# 拉取最新镜像
docker compose pull

# 重启服务
docker compose up -d

# 清理旧镜像
docker image prune -f
```

### 数据备份

```bash
# 创建备份脚本 backup.sh
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker compose exec -T postgres pg_dump -U myriad myriad | gzip > backup_${DATE}.sql.gz

# 保留最近 7 天的备份
find . -name "backup_*.sql.gz" -mtime +7 -delete
```

```bash
# 添加定时任务（每天凌晨 2 点）
crontab -e
0 2 * * * /path/to/backup.sh
```

### 健康检查

```bash
# 检查所有服务状态
docker compose ps

# 查看服务健康状态
curl http://localhost:3000/health
curl http://localhost:4321
```

---

## 🐛 故障排查

### 问题 1: 容器无法启动

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

### 问题 2: 数据库连接失败

```bash
# 检查数据库容器
docker compose exec postgres psql -U myriad -d myriad -c "SELECT 1"

# 验证环境变量
docker compose exec backend env | grep DATABASE_URL

# 查看数据库日志
docker compose logs postgres
```

### 问题 3: CORS 错误

确保 `.env` 中配置正确：
```bash
# 必须包含协议和端口（如有）
CORS_ORIGINS=https://yourdomain.com

# 多个域名用逗号分隔，无空格
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

### 问题 4: JWT 验证失败

```bash
# 检查 JWT_SECRET 是否一致
docker compose exec backend env | grep JWT_SECRET

# 确保长度 >= 32 字符
# 重新生成
openssl rand -base64 32
```

---

## 📊 性能优化

### 1. 数据库优化

编辑 `docker-compose.yml`，添加 PostgreSQL 性能参数：

```yaml
postgres:
  environment:
    POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    # 性能优化
    POSTGRES_SHARED_BUFFERS: 256MB
    POSTGRES_EFFECTIVE_CACHE_SIZE: 1GB
    POSTGRES_MAX_CONNECTIONS: 100
```

### 2. 启用日志轮转

```yaml
backend:
  logging:
    driver: "json-file"
    options:
      max-size: "10m"
      max-file: "3"
```

### 3. 资源限制

```yaml
backend:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 1G
      reservations:
        cpus: '0.5'
        memory: 512M
```

---

## 🔐 安全检查清单

部署前请确认：

- [ ] POSTGRES_PASSWORD 使用强密码（32+ 字符）
- [ ] JWT_SECRET 使用强密钥（32+ 字符）
- [ ] CORS_ORIGINS 配置为实际域名（非 localhost/*）
- [ ] EXPOSE_DB_PORT 未设置（数据库不暴露）
- [ ] 已配置 HTTPS（通过反向代理）
- [ ] .env 文件不在版本控制中（已添加到 .gitignore）
- [ ] 已设置防火墙规则（仅开放 80/443）
- [ ] 已配置自动备份
- [ ] 已启用容器安全加固（no-new-privileges）

---

## 📞 获取帮助

- 📖 [项目文档](https://github.com/yourusername/Myriad)
- 🐛 [问题反馈](https://github.com/yourusername/Myriad/issues)
- 💬 [讨论区](https://github.com/yourusername/Myriad/discussions)

---

**部署愉快！🎉**
