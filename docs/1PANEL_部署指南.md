# Myriad 项目 1Panel 部署指南

本文档详细说明如何在 1Panel 面板环境下部署 Myriad 项目（包括前端、后端和数据库）。

---

## 📋 环境要求

### 服务器配置

- **操作系统**: Linux (Ubuntu 20.04+/Debian 11+/CentOS 8+)
- **内存**: 至少 2GB RAM
- **磁盘**: 至少 10GB 可用空间
- **1Panel**: 版本 1.8.0 或更高

### 必需组件

- PostgreSQL 15+
- Node.js 18+
- Rust 1.70+
- Nginx (1Panel 自带)

---

## 🎯 部署架构

```
用户浏览器
    ↓
Nginx (反向代理 - 1Panel 管理)
    ├── https://yourdomain.com → 前端 (Astro 静态文件)
    └── https://yourdomain.com/api → 后端 (Rust Axum 服务)
         ↓
    PostgreSQL 数据库
```

---

## 📦 第一步：准备工作

### 1.1 连接服务器

通过 SSH 连接到你的服务器：

```bash
ssh root@your-server-ip
```

### 1.2 安装 1Panel（如果未安装）

```bash
curl -sSL https://resource.fit2cloud.com/1panel/package/quick_start.sh -o quick_start.sh
bash quick_start.sh
```

访问 `http://your-server-ip:port` 完成初始化设置。

### 1.3 创建项目目录

```bash
# 创建项目根目录
mkdir -p /opt/myriad
cd /opt/myriad

# 克隆代码（或通过 SFTP 上传）
git clone https://github.com/mirai-mamori/Myriad.git .
# 如果是私有仓库，需要配置 SSH key 或使用 Personal Access Token
```

---

## 🗄️ 第二步：配置 PostgreSQL 数据库

### 2.1 在 1Panel 中创建数据库

1. 登录 1Panel 管理面板
2. 进入 **数据库** → **PostgreSQL**
3. 如果没有安装 PostgreSQL，点击 **安装**
4. 创建新数据库：
   - **数据库名**: `myriad`
   - **用户名**: `myriad`
   - **密码**: 生成强密码（保存备用）
   - **权限**: 全部

### 2.2 执行数据库迁移

通过 1Panel 的终端或 SSH 执行：

```bash
# 方式1：使用 1Panel 提供的 psql 命令
psql -h localhost -U myriad -d myriad -f /opt/myriad/database/schema.sql
psql -h localhost -U myriad -d myriad -f /opt/myriad/database/009_create_users_table.sql

# 方式2：通过 1Panel 面板的 SQL 编辑器
# 直接复制 SQL 文件内容到编辑器执行
```

---

## 🔧 第三步：配置后端服务

### 3.1 安装 Rust 环境

```bash
# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# 验证安装
rustc --version
cargo --version
```

### 3.2 配置环境变量

创建 `/opt/myriad/backend/.env` 文件：

```bash
cat > /opt/myriad/backend/.env << 'EOF'
# ========================================
# 数据库配置
# ========================================
DATABASE_URL=postgres://myriad:你的数据库密码@localhost:5432/myriad

# ========================================
# 服务器配置
# ========================================
SERVER_HOST=127.0.0.1
SERVER_PORT=3000
RUST_LOG=info,myriad_backend=debug

# ========================================
# 前端配置
# ========================================
FRONTEND_DIST_PATH=/opt/myriad/frontend/dist

# ========================================
# GitHub OAuth 配置
# ========================================
GITHUB_CLIENT_ID=你的_GitHub_Client_ID
GITHUB_CLIENT_SECRET=你的_GitHub_Client_Secret
GITHUB_REDIRECT_URL=https://yourdomain.com/api/auth/github/callback

# ========================================
# JWT 配置
# ========================================
JWT_SECRET=生成的32位以上随机字符串

# ========================================
# 前端地址
# ========================================
FRONTEND_URL=https://yourdomain.com

# ========================================
# 安全配置
# ========================================
CORS_ORIGINS=https://yourdomain.com

# ========================================
# AI 配置
# ========================================
GEMINI_API_KEY=你的_Gemini_API_Key
GEMINI_MODEL=gemini-1.5-flash

# ========================================
# 平台 API 配置
# ========================================
GITHUB_USERNAME=你的GitHub用户名
GITHUB_TOKEN=你的GitHub_Token

BILIBILI_UID=你的B站UID

STEAM_API_KEY=你的Steam_API_Key
STEAM_ID=你的Steam_ID

# ========================================
# UI 配置
# ========================================
UI_WALLPAPER_URL=https://images.unsplash.com/photo-1579546929518-9e396f3cc809
UI_WALLPAPER_BLUR=3
EOF
```

### 3.3 编译后端

```bash
cd /opt/myriad/backend

# Release 编译（生产环境）
cargo build --release

# 编译后的文件位于
# /opt/myriad/backend/target/release/myriad-backend
```

### 3.4 创建 systemd 服务

创建 `/etc/systemd/system/myriad-backend.service`：

```bash
cat > /etc/systemd/system/myriad-backend.service << 'EOF'
[Unit]
Description=Myriad Backend Service
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/myriad/backend
Environment="RUST_LOG=info,myriad_backend=debug"
EnvironmentFile=/opt/myriad/backend/.env
ExecStart=/opt/myriad/backend/target/release/myriad-backend
Restart=always
RestartSec=10

# 安全配置
NoNewPrivileges=true
PrivateTmp=true

# 日志配置
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
```

启动服务：

```bash
# 重载 systemd
systemctl daemon-reload

# 启动服务
systemctl start myriad-backend

# 设置开机自启
systemctl enable myriad-backend

# 查看状态
systemctl status myriad-backend

# 查看日志
journalctl -u myriad-backend -f
```

---

## 🎨 第四步：构建前端

### 4.1 安装 Node.js 和 pnpm

```bash
# 方式1：使用 1Panel 的 Node.js 环境管理
# 在 1Panel 中安装 Node.js 18+

# 方式2：手动安装
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# 安装 pnpm
npm install -g pnpm
```

### 4.2 构建前端

```bash
cd /opt/myriad/frontend

# 安装依赖
pnpm install

# 生产环境构建
pnpm run build

# 构建产物在 dist/ 目录
ls -la dist/
```

---

## 🌐 第五步：配置 Nginx（通过 1Panel）

### 5.1 在 1Panel 中创建网站

1. 登录 1Panel 管理面板
2. 进入 **网站** → **创建网站**
3. 配置信息：
   - **域名**: `yourdomain.com`
   - **别名**: `www.yourdomain.com`
   - **PHP 版本**: 无（纯静态/反向代理）
   - **网站目录**: `/opt/myriad/frontend/dist`

### 5.2 配置 SSL 证书

1. 在网站管理中点击 **SSL**
2. 选择 **Let's Encrypt** 自动申请
3. 或上传已有的证书文件

### 5.3 配置反向代理

在 1Panel 网站配置中添加反向代理规则，或直接编辑 Nginx 配置：

```bash
# 1Panel 的 Nginx 配置通常在
# /opt/1panel/apps/openresty/openresty/conf/conf.d/
```

创建或编辑网站配置文件：

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # 强制 HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL 证书配置（1Panel 自动管理）
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # SSL 优化
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
    gzip_min_length 1000;

    # 根目录 - 前端静态文件
    root /opt/myriad/frontend/dist;
    index index.html;

    # API 反向代理到后端
    location /api {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # 超时配置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 健康检查
    location /health {
        proxy_pass http://127.0.0.1:3000;
        access_log off;
    }

    # 前端路由 - SPA 支持
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 静态资源缓存
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 日志
    access_log /var/log/nginx/myriad_access.log;
    error_log /var/log/nginx/myriad_error.log;
}
```

### 5.4 重载 Nginx

```bash
# 测试配置
nginx -t

# 重载配置
nginx -s reload

# 或通过 1Panel 面板重启 Nginx
```

---

## 🔐 第六步：配置防火墙

### 6.1 在 1Panel 中配置

1. 进入 **安全** → **防火墙**
2. 开放端口：
   - `80` (HTTP)
   - `443` (HTTPS)
   - `22` (SSH - 建议修改默认端口)
3. **关闭** `3000` 端口（后端端口不对外开放，只通过 Nginx 代理）

### 6.2 使用 iptables（可选）

```bash
# 允许 HTTP/HTTPS
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# 保存规则
iptables-save > /etc/iptables/rules.v4
```

---

## 🚀 第七步：部署后检查

### 7.1 检查服务状态

```bash
# 检查后端服务
systemctl status myriad-backend

# 检查后端日志
journalctl -u myriad-backend -n 50

# 检查 Nginx
systemctl status nginx

# 检查数据库
systemctl status postgresql
```

### 7.2 测试接口

```bash
# 健康检查
curl https://yourdomain.com/health

# API 测试
curl https://yourdomain.com/api/config
```

### 7.3 浏览器测试

1. 访问 `https://yourdomain.com`
2. 检查前端是否正常加载
3. 测试登录功能
4. 检查配置页面
5. 测试报告生成

---

## 📊 第八步：监控和日志

### 8.1 通过 1Panel 监控

1. **系统监控**

   - CPU、内存、磁盘使用率
   - 网络流量统计

2. **服务监控**
   - Nginx 访问统计
   - 数据库连接数
   - 应用进程状态

### 8.2 查看日志

```bash
# 后端日志
journalctl -u myriad-backend -f

# Nginx 访问日志
tail -f /var/log/nginx/myriad_access.log

# Nginx 错误日志
tail -f /var/log/nginx/myriad_error.log

# PostgreSQL 日志
tail -f /var/log/postgresql/postgresql-15-main.log
```

### 8.3 配置日志轮转

创建 `/etc/logrotate.d/myriad`：

```bash
/var/log/nginx/myriad_*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 www-data adm
    sharedscripts
    postrotate
        nginx -s reload > /dev/null 2>&1
    endscript
}
```

---

## 🔄 第九步：自动化部署脚本

### 9.1 创建部署脚本

创建 `/opt/myriad/deploy.sh`：

```bash
#!/bin/bash

set -e

echo "🚀 开始部署 Myriad..."

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="/opt/myriad"

# 检查是否为 root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}请使用 root 权限运行${NC}"
    exit 1
fi

# 1. 拉取最新代码
echo -e "${YELLOW}📥 拉取最新代码...${NC}"
cd $PROJECT_DIR
git pull origin main

# 2. 编译后端
echo -e "${YELLOW}🔨 编译后端...${NC}"
cd $PROJECT_DIR/backend
cargo build --release

# 3. 构建前端
echo -e "${YELLOW}🎨 构建前端...${NC}"
cd $PROJECT_DIR/frontend
pnpm install
pnpm run build

# 4. 重启后端服务
echo -e "${YELLOW}🔄 重启后端服务...${NC}"
systemctl restart myriad-backend

# 5. 等待服务启动
sleep 5

# 6. 检查服务状态
if systemctl is-active --quiet myriad-backend; then
    echo -e "${GREEN}✅ 后端服务运行正常${NC}"
else
    echo -e "${RED}❌ 后端服务启动失败${NC}"
    journalctl -u myriad-backend -n 20
    exit 1
fi

# 7. 重载 Nginx
echo -e "${YELLOW}🌐 重载 Nginx...${NC}"
nginx -t && nginx -s reload

# 8. 健康检查
echo -e "${YELLOW}🏥 健康检查...${NC}"
sleep 2
if curl -sf https://yourdomain.com/health > /dev/null; then
    echo -e "${GREEN}✅ 服务健康检查通过${NC}"
else
    echo -e "${RED}❌ 服务健康检查失败${NC}"
    exit 1
fi

echo -e "${GREEN}🎉 部署完成！${NC}"
echo "访问: https://yourdomain.com"
```

添加执行权限：

```bash
chmod +x /opt/myriad/deploy.sh
```

使用：

```bash
/opt/myriad/deploy.sh
```

### 9.2 配置 Webhook 自动部署（可选）

使用 1Panel 的 Webhook 功能或安装 webhook 工具：

```bash
# 安装 webhook
apt-get install webhook

# 配置 webhook
cat > /opt/webhook/hooks.json << 'EOF'
[
  {
    "id": "myriad-deploy",
    "execute-command": "/opt/myriad/deploy.sh",
    "command-working-directory": "/opt/myriad",
    "response-message": "Deployment started",
    "trigger-rule": {
      "match": {
        "type": "payload-hash-sha256",
        "secret": "your-webhook-secret",
        "parameter": {
          "source": "header",
          "name": "X-Hub-Signature-256"
        }
      }
    }
  }
]
EOF

# 启动 webhook 服务
webhook -hooks /opt/webhook/hooks.json -verbose
```

在 GitHub 仓库设置中添加 Webhook：

- Payload URL: `https://yourdomain.com:9000/hooks/myriad-deploy`
- Secret: `your-webhook-secret`
- Events: `push`

---

## 🔧 第十步：性能优化

### 10.1 后端优化

1. **开启 Release 优化**（已配置）
2. **配置连接池**

   ```rust
   // 在 config.rs 中
   pub max_connections: u32 = 20;
   ```

3. **启用 HTTP/2**（Nginx 已配置）

### 10.2 前端优化

1. **CDN 加速**（可选）

   - 将静态资源上传到 CDN
   - 修改前端引用路径

2. **资源压缩**（Nginx 已配置 gzip）

3. **图片优化**
   - 使用 WebP 格式
   - 配置懒加载

### 10.3 数据库优化

```sql
-- 创建索引
CREATE INDEX CONCURRENTLY idx_users_github_id ON users(github_id);
CREATE INDEX CONCURRENTLY idx_sessions_token ON sessions(token_hash);
CREATE INDEX CONCURRENTLY idx_sessions_user ON sessions(user_id);

-- 优化配置（PostgreSQL）
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;

-- 重载配置
SELECT pg_reload_conf();
```

---

## 🛡️ 第十一步：安全加固

### 11.1 数据库安全

```bash
# 修改 PostgreSQL 监听地址（只允许本地连接）
# 编辑 /etc/postgresql/15/main/postgresql.conf
listen_addresses = 'localhost'

# 重启 PostgreSQL
systemctl restart postgresql
```

### 11.2 SSH 安全

```bash
# 禁用密码登录，只允许密钥
# 编辑 /etc/ssh/sshd_config
PasswordAuthentication no
PubkeyAuthentication yes

# 修改 SSH 端口
Port 2222

# 重启 SSH
systemctl restart sshd
```

### 11.3 定期更新

```bash
# 创建定时任务
cat > /etc/cron.weekly/update-system << 'EOF'
#!/bin/bash
apt-get update
apt-get upgrade -y
apt-get autoremove -y
EOF

chmod +x /etc/cron.weekly/update-system
```

---

## 📋 第十二步：备份策略

### 12.1 数据库备份

创建 `/opt/myriad/backup-db.sh`：

```bash
#!/bin/bash

BACKUP_DIR="/opt/backups/myriad"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="myriad"

mkdir -p $BACKUP_DIR

# 备份数据库
pg_dump -U myriad -h localhost $DB_NAME | gzip > $BACKUP_DIR/myriad_db_$DATE.sql.gz

# 保留最近 30 天的备份
find $BACKUP_DIR -name "myriad_db_*.sql.gz" -mtime +30 -delete

echo "数据库备份完成: myriad_db_$DATE.sql.gz"
```

配置定时任务：

```bash
# 每天凌晨 2 点备份
crontab -e

# 添加
0 2 * * * /opt/myriad/backup-db.sh >> /var/log/myriad-backup.log 2>&1
```

### 12.2 代码备份

```bash
# 通过 1Panel 的备份功能
# 或使用 rsync 同步到远程服务器
rsync -avz /opt/myriad/ user@backup-server:/backups/myriad/
```

---

## 🆘 故障排查

### 常见问题

1. **后端服务无法启动**

   ```bash
   # 查看详细日志
   journalctl -u myriad-backend -n 100 --no-pager

   # 检查环境变量
   cat /opt/myriad/backend/.env

   # 检查数据库连接
   psql -U myriad -h localhost -d myriad -c "SELECT 1"
   ```

2. **前端 404 错误**

   ```bash
   # 检查构建产物
   ls -la /opt/myriad/frontend/dist/

   # 检查 Nginx 配置
   nginx -t

   # 检查文件权限
   chmod -R 755 /opt/myriad/frontend/dist/
   ```

3. **API 请求失败**

   ```bash
   # 检查后端是否监听
   netstat -tlnp | grep 3000

   # 测试本地 API
   curl http://127.0.0.1:3000/health

   # 检查 Nginx 代理配置
   ```

4. **数据库连接失败**

   ```bash
   # 检查 PostgreSQL 状态
   systemctl status postgresql

   # 检查连接
   psql -U myriad -h localhost -d myriad

   # 查看数据库日志
   tail -f /var/log/postgresql/postgresql-15-main.log
   ```

---

## 📞 技术支持

遇到问题？

1. 查看项目文档: `/opt/myriad/docs/`
2. 检查日志文件
3. 提交 GitHub Issue
4. 联系技术支持

---

**部署完成！** 🎉

现在你的 Myriad 项目已经成功部署在 1Panel 环境中。

记得定期：

- ✅ 检查服务状态
- ✅ 查看监控数据
- ✅ 备份数据库
- ✅ 更新系统和依赖

**文档版本**: 1.0  
**最后更新**: 2025 年 11 月 3 日
