# Myriad API 使用指南

## 🎯 概览

Myriad 提供了统一的 API 接口来获取和管理多个平台的用户数据。

## 📡 后端服务

- **地址**: `http://localhost:3000`
- **健康检查**: `GET /health`

## 🎮 平台 API

### Bilibili API

#### 1. 获取用户完整信息

```bash
GET /api/bilibili/user?uid=123456
```

返回: 用户信息 + 收藏夹 + 追番列表

#### 2. 获取用户基本信息

```bash
GET /api/bilibili/user/:uid
```

返回: 用户基本资料

#### 3. 获取收藏夹列表

```bash
GET /api/bilibili/favorites/:uid
```

返回: 用户的所有收藏夹及其内容数量

#### 4. 获取追番/追剧信息

```bash
GET /api/bilibili/bangumi/:uid?bangumi_type=1
```

参数:

- `bangumi_type`:
  - `1` - 动画
  - `2` - 电影
  - `3` - 纪录片
  - `4` - 国创
  - `5` - 电视剧

#### 5. 获取所有类型追番

```bash
GET /api/bilibili/bangumi/all/:uid
```

返回: 自动获取所有类型并合并

### Steam API

#### 1. 获取用户完整信息

```bash
GET /api/steam/user?steam_id=xxx&api_key=yyy
```

返回: 用户信息 + 游戏库 + 愿望单 + 统计数据

#### 2. 获取用户基本信息

```bash
GET /api/steam/user/info?steam_id=xxx&api_key=yyy
```

返回: 用户基本资料

#### 3. 获取游戏库

```bash
GET /api/steam/games?steam_id=xxx&api_key=yyy
```

返回: 拥有的所有游戏及游玩时间

#### 4. 获取愿望单

```bash
GET /api/steam/wishlist/:steam_id
```

返回: 愿望单游戏列表（无需 API Key）

#### 5. 获取游戏统计

```bash
GET /api/steam/stats?steam_id=xxx&api_key=yyy
```

返回: 最常玩游戏（Top 10）和最近游玩游戏

## ⚙️ 配置管理

### 获取配置

```bash
GET /api/config
```

返回示例:

```json
{
  "platforms": [
    {
      "name": "GitHub",
      "enabled": true,
      "has_token": true
    },
    {
      "name": "Bilibili",
      "enabled": true,
      "has_token": true
    },
    {
      "name": "Steam",
      "enabled": false,
      "has_token": false
    }
  ],
  "ai_config": {
    "provider": "Google Gemini",
    "model": "gemini-2.0-flash-exp",
    "enabled": true
  },
  "fetch_config": {
    "auto_fetch": true,
    "interval_hours": 24
  }
}
```

### 更新配置

```bash
POST /api/config
Content-Type: application/json

{
  "platforms": [...],
  "ai_config": {...},
  "fetch_config": {...}
}
```

## 🔑 API 密钥配置

### Bilibili

Bilibili API 主要使用公开接口，大部分功能无需认证。

如需访问私有数据（如私密收藏），可配置:

```bash
BILIBILI_SESSDATA=your_sessdata_cookie_here
```

### Steam

Steam API 需要申请密钥:

1. 访问: https://steamcommunity.com/dev/apikey
2. 登录 Steam 账号
3. 填写域名（可填 localhost）
4. 复制 API Key

在 `.env` 文件中配置:

```bash
STEAM_API_KEY=your_steam_api_key_here
```

## 📝 响应格式

所有 API 统一使用以下响应格式:

### 成功响应

```json
{
  "success": true,
  "data": { ... },
  "message": "获取成功，共 X 个项目"
}
```

### 错误响应

```json
{
  "success": false,
  "data": null,
  "message": "错误描述"
}
```

## 🌐 前端界面

- **主页**: http://localhost:4321/
- **配置页面**: http://localhost:4321/config

配置页面会自动显示所有已注册的平台，并显示其启用状态和认证状态。

## 🧪 测试示例

### PowerShell

```powershell
# 获取配置
Invoke-RestMethod -Uri "http://localhost:3000/api/config"

# 获取 Bilibili 用户信息
Invoke-RestMethod -Uri "http://localhost:3000/api/bilibili/user?uid=123456"

# 获取 Steam 游戏库
Invoke-RestMethod -Uri "http://localhost:3000/api/steam/games?steam_id=76561198XXXXXXXX&api_key=YOUR_KEY"
```

### Curl

```bash
# 获取配置
curl http://localhost:3000/api/config

# 获取 Bilibili 收藏夹
curl "http://localhost:3000/api/bilibili/favorites/123456"

# 获取 Steam 愿望单
curl "http://localhost:3000/api/steam/wishlist/76561198XXXXXXXX"
```

## 🔒 数据存储

所有获取的数据将自动存储到 PostgreSQL 数据库中，支持:

- 数据持久化
- 历史记录追踪
- 数据分析和统计
- 定时自动更新

## 📊 数据库

- **容器名**: myriad-postgres
- **端口**: 5432
- **数据库名**: myriad
- **启动**: `docker compose up -d postgres`

## 🚀 快速开始

1. **启动数据库**

   ```bash
   docker compose up -d postgres
   ```

2. **配置环境变量**

   ```bash
   cp backend/.env.example backend/.env
   # 编辑 .env 文件，添加必要的 API 密钥
   ```

3. **启动后端**

   ```bash
   cd backend
   cargo run
   ```

4. **启动前端**

   ```bash
   cd frontend
   npm run dev
   ```

5. **访问应用**
   - 前端: http://localhost:4321
   - 后端 API: http://localhost:3000
   - 配置页面: http://localhost:4321/config

## 💡 提示

- Bilibili API 限流较严格，建议合理控制请求频率
- Steam API 每日请求有限制，注意配额管理
- 配置自动获取功能可以定时更新数据
- 所有 API 都支持跨域访问（CORS）
