# 🚀 Myriad 在 1Panel 上的部署指南

本文档提供在 1Panel 面板上快速部署 Myriad 的完整指南。

## 📋 架构说明

1Panel 的 OpenResty 作为独立服务运行，通过**宿主机端口**访问 Myriad 容器：

```
Internet → 1Panel OpenResty (独立容器)
              ↓ host.docker.internal:3000
           Myriad Backend (docker-compose)
              ↓ host.docker.internal:4321
           Myriad Frontend (docker-compose)
```

## 🔧 部署步骤

### 第一步：部署 Myriad 应用

#### 1. 在 1Panel 中创建应用

**方式 A：通过应用商店（推荐）**

1. 进入 1Panel → 应用商店
2. 搜索 "Myriad"（如果已上架）
3. 点击安装，填写配置

**方式 B：通过 Docker Compose 手动部署**

1. 进入 1Panel → 容器 → Compose
2. 点击"创建编排"
3. 名称：`myriad`
4. 复制以下配置：

```yaml
version: '3.8'

services:
  # PostgreSQL Database
  postgres:
    image: postgres:16-alpine
    container_name: myriad-postgres
    environment:
      POSTGRES_DB: myriad
      POSTGRES_USER: myriad
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_INITDB_ARGS: "-E UTF8 --locale=C --lc-collate=C --lc-ctype=C"
      TZ: Asia/Shanghai
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myriad -d myriad"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    networks:
      - myriad-net
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp
      - /run

  # Backend API
  backend:
    image: somekawahitomi/myriad-backend:latest
    container_name: myriad-backend
    environment:
      DATABASE_URL: postgres://myriad:${POSTGRES_PASSWORD}@postgres:5432/myriad
      SERVER_HOST: 0.0.0.0
      SERVER_PORT: 3000
      JWT_SECRET: ${JWT_SECRET}
      CORS_ORIGINS: ${CORS_ORIGINS}
      RUST_LOG: ${RUST_LOG:-info}
      TZ: Asia/Shanghai
    ports:
      - "3000:3000"  # ⚠️ 重要：必须保留端口映射供 OpenResty 访问
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    volumes:
      - backend_cache:/app/cache
    networks:
      - myriad-net
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true

  # Frontend
  frontend:
    image: somekawahitomi/myriad-frontend:latest
    container_name: myriad-frontend
    environment:
      PUBLIC_API_URL: ${PUBLIC_API_URL:-}
      NODE_ENV: production
      TZ: Asia/Shanghai
    ports:
      - "4321:4321"  # ⚠️ 重要：必须保留端口映射供 OpenResty 访问
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:4321"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s
    networks:
      - myriad-net
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp

volumes:
  postgres_data:
    driver: local
  backend_cache:
    driver: local

networks:
  myriad-net:
    driver: bridge
```

#### 2. 配置环境变量

在 1Panel 的编排配置中，点击"环境变量"，添加：

```bash
# 必需配置
POSTGRES_PASSWORD=<点击生成随机密码>
JWT_SECRET=<点击生成随机密码>
CORS_ORIGINS=https://yourdomain.com,https://api.yourdomain.com

# 可选配置
PUBLIC_API_URL=https://api.yourdomain.com
RUST_LOG=info
```

**生成强密码的方法：**
- 在 1Panel 终端执行：`openssl rand -base64 32`
- 或使用 1Panel 的密码生成器

#### 3. 启动应用

点击"启动"按钮，等待所有容器变为健康状态。

---

### 第二步：配置 1Panel OpenResty 反向代理

#### 1. 添加后端 API 网站

1. 进入 1Panel → 网站
2. 点击"创建网站" → "反向代理"
3. 填写配置：

**基本信息：**
- 主域名：`api.yourdomain.com`
- 代理地址：`http://127.0.0.1:3000`
- 备注：`Myriad Backend API`

**高级配置（点击"编辑配置文件"）：**

```nginx
location / {
    # ⚠️ 重要：使用宿主机地址
    proxy_pass http://127.0.0.1:3000;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket 支持
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # 超时设置
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    # 请求体大小限制
    client_max_body_size 20M;
}

# 健康检查端点（不记录日志）
location /health {
    proxy_pass http://127.0.0.1:3000/health;
    access_log off;
}
```

4. 启用 SSL（推荐）：
   - 点击"HTTPS"标签
   - 选择"Let's Encrypt"
   - 输入邮箱，点击申请

#### 2. 添加前端网站

1. 再次点击"创建网站" → "反向代理"
2. 填写配置：

**基本信息：**
- 主域名：`yourdomain.com`
- 别名：`www.yourdomain.com`
- 代理地址：`http://127.0.0.1:4321`
- 备注：`Myriad Frontend`

**高级配置：**

```nginx
location / {
    # ⚠️ 重要：使用宿主机地址
    proxy_pass http://127.0.0.1:4321;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # 超时设置
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
}

# 静态资源缓存（可选）
location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf)$ {
    proxy_pass http://127.0.0.1:4321;
    proxy_cache_valid 200 1h;
    expires 1h;
    add_header Cache-Control "public, immutable";
}
```

3. 同样启用 SSL（Let's Encrypt）

---

### 第三步：更新 CORS 配置

1. 返回容器 → Compose → myriad
2. 编辑环境变量，更新 `CORS_ORIGINS`：

```bash
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com,https://api.yourdomain.com
```

3. 重启后端容器：
```bash
docker restart myriad-backend
```

---

## 🧪 验证部署

### 1. 检查容器状态

在 1Panel → 容器中，确认所有容器都是"运行中"且健康。

### 2. 测试后端 API

```bash
# 在 1Panel 终端执行
curl http://127.0.0.1:3000/health
# 应该返回: {"status":"ok"}

# 测试外部访问
curl https://api.yourdomain.com/health
```

### 3. 测试前端

在浏览器访问：
- `https://yourdomain.com` - 应该能看到 Myriad 前端界面

### 4. 检查日志

```bash
# 查看后端日志
docker logs myriad-backend

# 查看前端日志
docker logs myriad-frontend

# 查看 OpenResty 日志
# 1Panel → 网站 → 选择网站 → 日志
```

---

## 🔧 常见问题

### 问题 1: 数据库迁移失败 - 重复键约束错误

**表现：** 后端日志显示：
```
❌ 数据库迁移失败: 迁移失败: Execution Error: error returned from database:
duplicate key value violates unique constraint "configurations_key_key"
Detail: Key (key)=(ai_provider) already exists.
```

**原因：** 数据库处于不一致状态 - 某些表已创建但迁移跟踪表（seaql_migrations）丢失，导致迁移系统尝试重新运行所有迁移并插入重复数据。

**解决方案 1：重置数据库（推荐 - 适用于新部署或测试环境）**

⚠️ **警告：此操作会删除所有数据！**

```bash
# 1. 停止所有容器
docker compose down

# 2. 删除数据库卷（清除所有数据）
docker volume rm myriad_postgres_data

# 3. 重新启动（会自动运行迁移）
docker compose up -d

# 4. 查看日志确认迁移成功
docker logs -f myriad-backend
# 应该看到：✅ Database migrations up to date
```

**解决方案 2：手动修复迁移状态（适用于生产环境，保留现有数据）**

如果你有重要数据不能删除：

```bash
# 1. 连接到数据库
docker exec -it myriad-postgres psql -U myriad -d myriad

# 2. 检查迁移表是否存在
SELECT * FROM seaql_migrations;
# 如果显示 "relation does not exist"，说明迁移表丢失

# 3. 重新创建迁移跟踪表并标记所有迁移为已完成
CREATE TABLE IF NOT EXISTS seaql_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at BIGINT NOT NULL
);

# 4. 插入所有已应用的迁移记录（根据实际情况调整版本号）
INSERT INTO seaql_migrations (version, applied_at) VALUES
    ('m20240101_000001_create_platforms_table', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000002_create_user_profiles_table', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000003_create_user_activities_table', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000004_create_analysis_results_table', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000005_create_configurations_table', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000006_create_api_keys_table', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000007_create_fetch_jobs_table', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000008_create_reports_table', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000009_create_users_table', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000010_add_local_auth', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000011_extend_configurations', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000012_create_platform_metadata', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000013_create_metadata_history', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000014_create_virtual_persona', EXTRACT(EPOCH FROM NOW())::BIGINT),
    ('m20240101_000015_make_image_fields_optional', EXTRACT(EPOCH FROM NOW())::BIGINT)
ON CONFLICT DO NOTHING;

# 5. 退出数据库
\q

# 6. 重启后端
docker restart myriad-backend
```

**预防措施：**
- 始终使用 `docker compose down`（不带 `-v`）来停止容器，保留数据卷
- 定期备份数据库（见下文"数据备份"章节）
- 在测试环境验证配置后再部署到生产环境

---

### 问题 2: 502 Bad Gateway

**原因：** 1Panel OpenResty 无法连接到容器

**解决方案：**

1. 确认容器正在运行：
```bash
docker ps | grep myriad
```

2. 确认端口映射正确：
```bash
netstat -tlnp | grep 3000
netstat -tlnp | grep 4321
```

3. 测试本地连接：
```bash
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:4321
```

4. 检查防火墙（如果使用）：
```bash
# 1Panel 通常会自动配置，但可以确认
firewall-cmd --list-ports
```

### 问题 3: CORS 错误

**表现：** 浏览器控制台显示跨域错误

**解决方案：**

1. 检查 CORS 配置是否包含所有域名：
```bash
docker exec myriad-backend env | grep CORS_ORIGINS
```

2. 确保包含协议（https://）和所有子域名：
```bash
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com,https://api.yourdomain.com
```

3. 重启后端：
```bash
docker restart myriad-backend
```

### 问题 4: SSL 证书申请失败

**可能原因：**
- 域名未正确解析到服务器 IP
- 80 端口被占用
- 域名已超过 Let's Encrypt 速率限制

**解决方案：**

1. 确认域名解析：
```bash
nslookup yourdomain.com
# 应该返回你的服务器 IP
```

2. 检查 80 端口：
```bash
netstat -tlnp | grep :80
```

3. 查看 1Panel 日志：
   - 1Panel → 日志 → 系统日志

### 问题 5: 容器无法启动

**解决方案：**

1. 查看容器日志：
```bash
docker logs myriad-backend
docker logs myriad-postgres
```

2. 检查环境变量：
```bash
docker exec myriad-backend env | grep -E "DATABASE_URL|JWT_SECRET"
```

3. 重新生成密钥：
```bash
openssl rand -base64 32
```

4. 重建容器：
   - 1Panel → 容器 → Compose → myriad → 重新创建

---

## 📊 性能优化

### 1. 启用 OpenResty 缓存

在 1Panel → 网站 → 编辑网站配置：

```nginx
# 在 server 块外添加（全局配置）
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=myriad_cache:10m max_size=100m inactive=60m;

server {
    # ... 其他配置 ...

    # 针对特定路径启用缓存
    location ~* ^/api/(public|health) {
        proxy_pass http://127.0.0.1:3000;
        proxy_cache myriad_cache;
        proxy_cache_valid 200 5m;
        proxy_cache_key "$scheme$request_method$host$request_uri";
        add_header X-Cache-Status $upstream_cache_status;
    }
}
```

### 2. 限流配置

```nginx
# 在 http 块添加
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

server {
    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        # ... 其他配置 ...
    }
}
```

### 3. 启用 Gzip 压缩

1Panel 默认启用，可以在网站配置中确认：

```nginx
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript
           application/json application/javascript application/xml+rss;
```

---

## 🔄 更新应用

### 方法 1: 通过 1Panel 界面

1. 进入容器 → Compose → myriad
2. 点击"更新"
3. 1Panel 会自动拉取最新镜像并重启

### 方法 2: 命令行

```bash
# 进入 1Panel 终端
cd /opt/1panel/apps/myriad  # 实际路径可能不同

# 拉取最新镜像
docker compose pull

# 重启服务
docker compose up -d

# 清理旧镜像
docker image prune -f
```

---

## 💾 数据备份

### 自动备份脚本

1. 在 1Panel → 计划任务 → 创建任务

**任务名称：** Myriad 数据库备份

**类型：** Shell 脚本

**执行周期：** 每天 02:00

**脚本内容：**

```bash
#!/bin/bash
# Myriad 数据库备份脚本

# 配置
BACKUP_DIR="/opt/1panel/backup/myriad"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=7

# 创建备份目录
mkdir -p $BACKUP_DIR

# 备份数据库
docker exec myriad-postgres pg_dump -U myriad myriad | gzip > "${BACKUP_DIR}/myriad_${DATE}.sql.gz"

# 删除旧备份
find $BACKUP_DIR -name "myriad_*.sql.gz" -mtime +$KEEP_DAYS -delete

# 记录日志
echo "[$(date)] Backup completed: myriad_${DATE}.sql.gz"
```

### 手动备份

```bash
# 备份数据库
docker exec myriad-postgres pg_dump -U myriad myriad > myriad_backup.sql

# 压缩备份
gzip myriad_backup.sql

# 下载到本地（通过 1Panel 文件管理）
```

### 恢复备份

```bash
# 解压备份
gunzip myriad_backup.sql.gz

# 恢复数据库
docker exec -i myriad-postgres psql -U myriad myriad < myriad_backup.sql
```

---

## 🔐 安全加固

### 1. 修改默认数据库端口（可选）

如果担心 5432 端口暴露，可以修改 docker-compose.yml：

```yaml
services:
  postgres:
    # 不要映射端口到宿主机（仅内部访问）
    # ports:
    #   - "5432:5432"  # 移除这一行
```

### 2. 启用防火墙规则

在 1Panel → 安全 → 防火墙：

```bash
# 仅允许 80、443、1Panel 端口
# 其他端口（3000、4321）不对外开放
```

### 3. 定期更新

```bash
# 更新 Docker 镜像
docker compose pull

# 更新 1Panel
# 通过 1Panel → 系统设置 → 在线升级
```

---

## 📊 监控和日志

### 1. 查看实时日志

在 1Panel → 容器 → 选择容器 → 日志

或通过命令行：

```bash
# 实时查看所有日志
docker compose -f /path/to/docker-compose.yml logs -f

# 仅查看后端
docker logs -f myriad-backend

# 仅查看数据库
docker logs -f myriad-postgres
```

### 2. 监控资源使用

在 1Panel → 主机监控 → 容器资源

或命令行：

```bash
docker stats myriad-backend myriad-frontend myriad-postgres
```

---

## 🎯 最佳实践

### ✅ 部署检查清单

- [ ] 使用强密码（32+ 字符）
- [ ] CORS 配置为实际域名（非 localhost）
- [ ] 启用 HTTPS（Let's Encrypt）
- [ ] 配置自动备份
- [ ] 查看日志确认无错误
- [ ] 测试所有功能正常
- [ ] 设置监控告警

### 💡 推荐配置

```bash
# 环境变量
POSTGRES_PASSWORD=<32位随机密码>
JWT_SECRET=<32位随机密码>
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com,https://api.yourdomain.com
PUBLIC_API_URL=https://api.yourdomain.com
RUST_LOG=info
```

---

## 📞 获取帮助

- 📖 [Myriad 文档](https://github.com/yourusername/Myriad)
- 📖 [1Panel 文档](https://1panel.cn/docs/)
- 🐛 [问题反馈](https://github.com/yourusername/Myriad/issues)

---

**在 1Panel 上部署 Myriad，享受丝滑体验！🎉**
