# Myriad 脚本使用指南

本文档说明 Myriad 项目中所有可用的脚本和命令。

---

## 📂 脚本目录

所有脚本位于 `scripts/` 目录下：

```
scripts/
├── build.ps1          # Windows 生产构建
├── build.sh           # Linux/macOS 生产构建
├── clean.ps1          # Windows 清理配置和数据
├── clean.sh           # Linux/macOS 清理配置和数据
├── dev.ps1            # Windows 开发环境启动 (旧版)
├── start.ps1          # Windows 启动服务 (推荐)
├── start.sh           # Linux/macOS 启动服务 (推荐)
├── restart.ps1        # Windows 服务重启
├── restart.sh         # Linux/macOS 服务重启
├── setup.ps1          # Windows 环境初始化
├── stop.ps1           # Windows 停止所有服务
└── stop.sh            # Linux/macOS 停止所有服务
```

---

## 🪟 Windows 脚本

### 1. 环境初始化

首次设置开发环境：

```powershell
.\scripts\setup.ps1
```

**功能**：

- 检查并安装 Node.js, Rust, PostgreSQL
- 安装前后端依赖
- 初始化数据库
- 从 `.env.example` 生成 `.env` 配置文件（需手动填写 API 密钥）

---

### 2. 启动服务 (推荐)

在新窗口中启动开发服务器：

```powershell
.\scripts\start.ps1
```

**功能**：

- 在独立窗口启动后端（localhost:3000）
- 在独立窗口启动前端（localhost:4321）
- 自动检测已运行的服务
- 后台运行，窗口不会闪退
- 日志实时显示在各自窗口

**替代方案（旧版）**：

```powershell
.\scripts\dev.ps1
```

---

### 3. 生产构建

构建生产版本：

```powershell
.\scripts\build.ps1
```

**输出**：

- 后端：`backend\target\release\myriad-backend.exe`
- 前端：`frontend\dist\`

---

### 4. 服务重启

重启指定服务：

```powershell
# 重启所有服务
.\scripts\restart.ps1 all

# 仅重启后端
.\scripts\restart.ps1 backend

# 仅重启前端
.\scripts\restart.ps1 frontend
```

**功能**：

- 优雅停止运行中的服务
- 清理进程
- 重新启动服务

---

### 5. 停止服务

停止所有 Myriad 服务：

```powershell
.\scripts\stop.ps1
```

**功能**：

- 停止后端进程（myriad-backend, cargo）
- 停止前端进程（node, astro, vite）
- 显示停止的进程数量

---

### 6. 清理配置和数据 ⚠️

**警告：此操作不可逆！将删除所有配置和数据！**

完全清理项目以进行全新测试：

```powershell
.\scripts\clean.ps1
```

**功能**：

- 停止并删除 Docker 容器和数据卷（PostgreSQL 数据）
- 删除后端构建文件（`backend/target/`）
- 删除前端构建文件（`frontend/dist/`）
- 删除缓存文件（`backend/cache/*.json`）
- 删除环境配置（`backend/.env`）
- 需要用户确认才执行

**清理后的步骤**：

1. 复制并配置 `backend/.env` 文件
2. 运行 `docker-compose up -d postgres` 启动数据库
3. 运行 `.\scripts\start.ps1` 启动服务

---

## 🐧 Linux/macOS 脚本

### 1. 启动服务 (推荐)

后台启动开发服务器：

```bash
./scripts/start.sh
```

**功能**：

- 后台启动后端和前端
- 自动检测已运行的服务
- 日志输出到 `logs/` 目录
- 显示进程 ID (PID)

**查看日志**：

```bash
# 实时查看后端日志
tail -f logs/backend.log

# 实时查看前端日志
tail -f logs/frontend.log
```

---

### 2. 生产构建

```bash
./scripts/build.sh
```

功能同 Windows 版本。

---

### 3. 服务重启

```bash
# 重启所有服务
./scripts/restart.sh all

# 仅重启后端
./scripts/restart.sh backend

# 仅重启前端
./scripts/restart.sh frontend
```

**日志位置**：

- 后端：`logs/backend.log`
- 前端：`logs/frontend.log`

---

### 4. 停止服务

```bash
./scripts/stop.sh
```

---

### 5. 清理配置和数据 ⚠️

**警告：此操作不可逆！将删除所有配置和数据！**

完全清理项目以进行全新测试：

```bash
./scripts/clean.sh
```

**功能**：

- 停止并删除 Docker 容器和数据卷（PostgreSQL 数据）
- 删除后端构建文件（`backend/target/`）
- 删除前端构建文件（`frontend/dist/`）
- 删除缓存文件（`backend/cache/*.json`）
- 删除环境配置（`backend/.env`）
- 需要用户确认才执行

**清理后的步骤**：

1. 复制并配置 `backend/.env` 文件
2. 运行 `docker-compose up -d postgres` 启动数据库
3. 运行 `./scripts/start.sh` 启动服务

---

## 🔧 手动命令

### 后端

```bash
# 开发模式（热重载）
cd backend
cargo run

# 生产构建
cargo build --release

# 运行测试
cargo test

# 代码检查
cargo clippy

# 格式化代码
cargo fmt
```

### 前端

```bash
# 开发模式
cd frontend
npm run dev

# 生产构建
npm run build

# 预览生产构建
npm run preview

# TypeScript 类型检查
npm run check

# 代码格式化
npm run format
```

### 数据库

```bash
# 创建数据库
createdb myriad

# 运行迁移
psql myriad < database/schema.sql
psql myriad < database/009_create_users_table.sql

# 或使用 Docker
docker-compose up -d postgres

# 查看数据库
psql myriad
```

---

## 🌐 通过 Web UI 重启后端

配置保存后自动重启：

1. 访问配置页面：`http://localhost:4321/config`
2. 修改配置并点击"保存配置"
3. 系统自动调用 `/api/system/restart` 重启后端
4. 等待 5-10 秒后配置生效

**API 端点**：

```http
POST /api/system/restart
```

---

## 🔄 CI/CD 构建

### GitHub Actions 示例

```yaml
name: Build

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Build
        run: ./scripts/build.sh

      - name: Upload artifacts
        uses: actions/upload-artifact@v3
        with:
          name: myriad-build
          path: |
            backend/target/release/myriad-backend
            frontend/dist/
```

---

## ⚠️ 常见问题

### 1. 权限错误 (Linux/macOS)

```bash
# 如果脚本不可执行
chmod +x scripts/*.sh
```

### 2. PowerShell 执行策略 (Windows)

```powershell
# 如果无法执行脚本
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 3. 端口被占用

```bash
# 检查端口占用
# Windows
netstat -ano | findstr :3000
netstat -ano | findstr :4321

# Linux/macOS
lsof -i :3000
lsof -i :4321

# 杀死进程
# Windows
taskkill /PID <PID> /F

# Linux/macOS
kill -9 <PID>
```

### 4. 后端重启失败

如果自动重启失败，手动重启：

```bash
# Windows
.\scripts\restart.ps1 backend

# Linux/macOS
./scripts/restart.sh backend
```

---

## 📊 脚本执行流程图

### 开发流程

```
setup.ps1 / setup.sh
    ↓
dev.ps1 / npm run dev
    ↓
[开发中] ← → [修改代码]
    ↓
[保存配置] → POST /api/system/restart
    ↓
[自动重启后端]
```

### 生产部署流程

```
build.ps1 / build.sh
    ↓
[构建完成]
    ↓
Docker compose up -d
    ↓
[服务运行中]
```

---

## 🚀 快速启动

### 全新安装

```bash
# 1. 环境初始化
.\scripts\setup.ps1        # Windows
./scripts/setup.sh         # Linux/macOS

# 2. 配置环境变量
# 编辑 backend/.env 文件

# 3. 启动开发服务器
.\scripts\start.ps1        # Windows (新窗口启动)
./scripts/start.sh         # Linux/macOS (后台启动)
```

### 日常开发

```bash
# 启动服务
.\scripts\start.ps1        # Windows
./scripts/start.sh         # Linux/macOS

# 修改代码...

# 保存配置（自动重启后端）
# 访问 http://localhost:4321/config

# 查看日志 (Linux/macOS)
tail -f logs/backend.log
tail -f logs/frontend.log

# 停止服务
.\scripts\stop.ps1         # Windows
./scripts/stop.sh          # Linux/macOS
```

---

## 📚 相关文档

- [README.md](README.md) - 项目说明
- [DEPLOYMENT.md](DEPLOYMENT.md) - 部署指南
- [API_USAGE.md](API_USAGE.md) - API 使用指南
- [CONTRIBUTING.md](CONTRIBUTING.md) - 贡献指南

---

**最后更新**: 2025-11-04
