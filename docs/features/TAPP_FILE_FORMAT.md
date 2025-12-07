# .tapp 文件格式规范

## 概述

`.tapp` 文件是 Myriad Tapp 应用的标准打包格式，本质上是一个 ZIP 压缩包，包含应用的清单、代码和资源文件。

## 文件结构

```
my-app.tapp (ZIP 格式)
├── manifest.json      # 应用清单（必需）
├── main.js            # 主入口代码（必需）
├── icon.png           # 应用图标（可选，推荐 128x128）
├── README.md          # 说明文档（可选）
└── assets/            # 资源文件夹（可选）
    ├── styles.css
    └── ...
```

## manifest.json 规范

```json
{
  "id": "com.example.my-app",
  "name": "My App",
  "version": "1.0.0",
  "description": "应用描述",
  "author": {
    "name": "Author Name",
    "email": "author@example.com",
    "url": "https://example.com"
  },
  "main": "main.js",
  "permissions": ["widget:register", "storage"],
  "optionalPermissions": ["ai:generate"],
  "icon": "icon.png",
  "themeColor": "#3b82f6",
  "minSystemVersion": "1.0.0",
  "homepage": "https://github.com/example/my-app",
  "repository": "https://github.com/example/my-app",
  "widgets": [
    {
      "id": "clock",
      "name": "数字时钟",
      "defaultSize": "2x2",
      "sizes": ["1x1", "2x1", "2x2"]
    }
  ],
  "hasPage": true
}
```

## 权限列表

| 权限                | 说明             |
| ------------------- | ---------------- |
| `widget:register`   | 注册自定义小组件 |
| `platform:read`     | 读取平台数据     |
| `platform:write`    | 写入平台数据     |
| `platform:register` | 注册自定义平台   |
| `ai:generate`       | 使用 AI 生成功能 |
| `ai:analyze`        | 使用 AI 分析功能 |
| `report:read`       | 读取报告数据     |
| `storage`           | 使用本地存储     |
| `ui:notification`   | 显示通知         |
| `ui:fullscreen`     | 请求全屏         |
| `ui:theme`          | 获取主题信息     |
| `ui:confirm`        | 显示确认对话框   |

## 数据库存储

### tapps 表

存储已安装的 Tapp 元数据：

| 字段                | 类型         | 说明                                    |
| ------------------- | ------------ | --------------------------------------- |
| id                  | SERIAL       | 主键                                    |
| tapp_id             | VARCHAR(255) | Tapp 唯一标识符                         |
| user_id             | INTEGER      | 所属用户                                |
| name                | VARCHAR(255) | 显示名称                                |
| version             | VARCHAR(50)  | 版本号                                  |
| manifest            | JSONB        | 完整清单                                |
| status              | VARCHAR(20)  | 状态: installed/running/suspended/error |
| granted_permissions | JSONB        | 已授权权限                              |
| installed_at        | TIMESTAMP    | 安装时间                                |
| last_run_at         | TIMESTAMP    | 最后运行时间                            |
| error_message       | TEXT         | 错误信息                                |

### tapp_widgets 表

存储 Tapp 注册的小组件：

| 字段          | 类型         | 说明          |
| ------------- | ------------ | ------------- |
| id            | SERIAL       | 主键          |
| widget_id     | VARCHAR(255) | 完整小组件 ID |
| tapp_id       | VARCHAR(255) | 所属 Tapp     |
| user_id       | INTEGER      | 所属用户      |
| config        | JSONB        | 小组件配置    |
| registered_at | TIMESTAMP    | 注册时间      |

### tapp_storage 表

存储 Tapp 的键值数据：

| 字段       | 类型         | 说明      |
| ---------- | ------------ | --------- |
| id         | SERIAL       | 主键      |
| tapp_id    | VARCHAR(255) | 所属 Tapp |
| user_id    | INTEGER      | 所属用户  |
| key        | VARCHAR(255) | 键名      |
| value      | JSONB        | 值        |
| created_at | TIMESTAMP    | 创建时间  |
| updated_at | TIMESTAMP    | 更新时间  |

## 文件存储

`.tapp` 文件本体存储在服务器文件系统中：

```
data/
└── tapps/
    └── {user_id}/
        └── {tapp_id}/
            ├── app.tapp          # 原始文件
            ├── manifest.json     # 解压的清单
            ├── main.js           # 解压的代码
            └── assets/           # 解压的资源
```

## API 接口

### 上传安装 Tapp

```
POST /api/tapps/install
Content-Type: multipart/form-data
Body: file=@my-app.tapp
```

### 获取 Tapp 列表

```
GET /api/tapps
Response: [{ id, name, version, status, ... }]
```

### 获取 Tapp 详情

```
GET /api/tapps/{tapp_id}
Response: { manifest, status, code_url, ... }
```

### 获取 Tapp 代码

```
GET /api/tapps/{tapp_id}/code
Response: JavaScript 代码文本
```

### 启动/停止 Tapp

```
POST /api/tapps/{tapp_id}/start
POST /api/tapps/{tapp_id}/stop
```

### 卸载 Tapp

```
DELETE /api/tapps/{tapp_id}
```

### 注册小组件

```
POST /api/tapps/{tapp_id}/widgets
Body: { id, name, config, ... }
```

### 存储操作

```
GET /api/tapps/{tapp_id}/storage/{key}
PUT /api/tapps/{tapp_id}/storage/{key}
DELETE /api/tapps/{tapp_id}/storage/{key}
```
