# Myriad Docker 部署指南

## 🚀 快速开始（一键部署）

### Windows 用户

使用 PowerShell 运行：

```powershell
# 一键部署（首次运行会自动创建配置文件）
.\docker-deploy.ps1
```

### Linux/Mac 用户

```bash
# 创建环境配置
cp .env.docker .env

# 编辑配置（修改密码和密钥）
nano .env

# 启动所有服务
docker-compose up -d
```

## 📋 前置要求

- **Docker Desktop** 或 **Docker Engine** (20.10+)
- **Docker Compose** (2.0+)
- 至少 **4GB** 可用内存
- 至少 **10GB** 可用磁盘空间

### 安装 Docker

- **Windows/Mac**: [Docker Desktop](https://www.docker.com/products/docker-desktop)
- **Linux**:
  ```bash
  curl -fsSL https://get.docker.com -o get-docker.sh
  sudo sh get-docker.sh
  ```

## 🔧 详细配置步骤

### 1. 配置环境变量

首次部署时需要配置环境变量：

```powershell
# Windows
copy .env.docker .env
notepad .env

# Linux/Mac
cp .env.docker .env
nano .env
```

**必须修改的配置项：**

```env
# 数据库密码（必须修改！）
POSTGRES_PASSWORD=your_strong_password_here

# JWT 密钥（必须修改！使用 openssl 生成）
JWT_SECRET=your_secret_key_here
```

**生成安全的 JWT 密钥：**

```powershell
# Windows (PowerShell)
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)

# Linux/Mac
openssl rand -base64 32
```

### 2. 启动服务

#### 使用一键部署脚本（推荐）

```powershell
# Windows - 标准启动
.\docker-deploy.ps1

# Windows - 重新构建镜像
.\docker-deploy.ps1 -Build

# Windows - 查看状态
.\docker-deploy.ps1 -Status

# Windows - 查看日志
.\docker-deploy.ps1 -Logs

# Windows - 停止服务
.\docker-deploy.ps1 -Stop

# Windows - 完全清理（删除数据）
.\docker-deploy.ps1 -Clean
```

#### 使用 Docker Compose

```bash
# 启动所有服务（后台运行）
docker-compose up -d

# 启动并重新构建
docker-compose up -d --build

# 查看日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f backend

# 停止服务
docker-compose down

# 停止并删除数据卷
docker-compose down -v
```

## 🌐 访问应用

服务启动后，可以通过以下地址访问：

- **前端界面**: http://localhost:4321
- **后端 API**: http://localhost:3000
- **数据库**: localhost:5432

### 健康检查端点

- Backend: http://localhost:3000/api/health
- Frontend: http://localhost:4321

## 🔍 服务管理

### 查看服务状态

```bash
# 查看所有容器
docker-compose ps

# 查看详细状态
docker-compose ps -a

# 查看资源使用
docker stats
```

### 进入容器

```bash
# 进入后端容器
docker exec -it myriad-backend sh

# 进入数据库容器
docker exec -it myriad-postgres psql -U myriad -d myriad

# 进入前端容器
docker exec -it myriad-frontend sh
```

### 查看日志

```bash
# 所有服务日志
docker-compose logs -f

# 特定服务日志
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f postgres

# 查看最近 100 行
docker-compose logs --tail=100 backend
```

## 🗄️ 数据库管理

### 连接数据库

```bash
# 使用 psql 连接
docker exec -it myriad-postgres psql -U myriad -d myriad

# 使用外部工具连接
Host: localhost
Port: 5432
Database: myriad
Username: myriad
Password: (你在 .env 中设置的密码)
```

### 备份数据库

```powershell
# Windows
docker exec myriad-postgres pg_dump -U myriad myriad > backup_$(Get-Date -Format "yyyyMMdd_HHmmss").sql

# Linux/Mac
docker exec myriad-postgres pg_dump -U myriad myriad > backup_$(date +%Y%m%d_%H%M%S).sql
```

### 恢复数据库

```bash
# 恢复备份
docker exec -i myriad-postgres psql -U myriad -d myriad < backup.sql
```

### 重置数据库

```bash
# 停止服务并删除数据卷
docker-compose down -v

# 重新启动（将自动创建新数据库）
docker-compose up -d
```

## 🔧 故障排查

### 服务无法启动

1. **检查端口占用：**

   ```powershell
   # Windows
   netstat -ano | findstr "3000"
   netstat -ano | findstr "4321"
   netstat -ano | findstr "5432"

   # Linux/Mac
   lsof -i :3000
   lsof -i :4321
   lsof -i :5432
   ```

2. **检查 Docker 状态：**

   ```bash
   docker info
   docker-compose ps
   ```

3. **查看详细错误：**
   ```bash
   docker-compose logs backend
   docker-compose logs postgres
   ```

### 数据库连接失败

1. **检查数据库是否健康：**

   ```bash
   docker exec myriad-postgres pg_isready -U myriad
   ```

2. **验证连接字符串：**

   ```bash
   # 检查环境变量
   docker exec myriad-backend env | grep DATABASE_URL
   ```

3. **重启数据库：**
   ```bash
   docker-compose restart postgres
   ```

### 前端无法访问后端

1. **检查 CORS 配置：**
   确保 `.env` 中的 `CORS_ORIGINS` 包含前端地址

2. **检查后端健康状态：**

   ```bash
   curl http://localhost:3000/api/health
   ```

3. **检查网络连接：**
   ```bash
   docker network inspect myriad_myriad-network
   ```

### 构建失败

1. **清理 Docker 缓存：**

   ```bash
   docker system prune -a
   docker volume prune
   ```

2. **重新构建：**
   ```bash
   docker-compose build --no-cache
   docker-compose up -d
   ```

## 📊 性能优化

### 调整资源限制

编辑 `docker-compose.yml`，为服务添加资源限制：

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: "2"
          memory: 2G
        reservations:
          cpus: "1"
          memory: 512M
```

### 启用日志轮转

```yaml
services:
  backend:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## 🔒 生产环境部署建议

### 安全性

1. **更改所有默认密码和密钥**
2. **使用 HTTPS（配置反向代理）**
3. **限制数据库端口访问（不对外暴露 5432）**
4. **定期更新镜像**
5. **启用防火墙规则**

### 反向代理示例（Nginx）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:4321;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 自动备份脚本

```powershell
# backup.ps1
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = ".\backups"
New-Item -ItemType Directory -Force -Path $backupDir
docker exec myriad-postgres pg_dump -U myriad myriad > "$backupDir\backup_$timestamp.sql"
Write-Host "Backup created: backup_$timestamp.sql"
```

### 监控和告警

建议集成监控工具：

- **Prometheus + Grafana**: 性能监控
- **Loki**: 日志聚合
- **cAdvisor**: 容器监控

## 📝 环境变量参考

| 变量名              | 默认值                | 说明                     |
| ------------------- | --------------------- | ------------------------ |
| `POSTGRES_DB`       | myriad                | 数据库名称               |
| `POSTGRES_USER`     | myriad                | 数据库用户名             |
| `POSTGRES_PASSWORD` | -                     | 数据库密码（必须设置）   |
| `POSTGRES_PORT`     | 5432                  | 数据库端口               |
| `BACKEND_PORT`      | 3000                  | 后端 API 端口            |
| `FRONTEND_PORT`     | 4321                  | 前端服务端口             |
| `JWT_SECRET`        | -                     | JWT 签名密钥（必须设置） |
| `CORS_ORIGINS`      | localhost             | CORS 允许的源            |
| `RUST_LOG`          | info                  | 日志级别                 |
| `PUBLIC_API_URL`    | http://localhost:3000 | 前端访问的后端地址       |

## 🆘 获取帮助

如遇到问题：

1. 查看日志：`docker-compose logs -f`
2. 检查容器状态：`docker-compose ps`
3. 查看健康检查：`docker inspect myriad-backend --format='{{.State.Health.Status}}'`
4. 提交 Issue：包含完整的错误日志和环境信息

## 📚 相关文档

- [Docker 官方文档](https://docs.docker.com/)
- [Docker Compose 文档](https://docs.docker.com/compose/)
- [PostgreSQL 文档](https://www.postgresql.org/docs/)
- [Myriad 项目文档](./docs/)

---

**提示**: 首次部署建议使用一键部署脚本 `docker-deploy.ps1`，它会自动处理配置文件创建和服务启动。
