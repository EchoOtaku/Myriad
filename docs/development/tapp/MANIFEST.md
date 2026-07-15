# Manifest 配置

Manifest 是 Tapp 的核心配置文件，定义了应用的元数据、权限和功能。

## 基础字段

| 字段                     | 类型     | 必填 | 说明                               |
| ------------------------ | -------- | ---- | ---------------------------------- |
| `id`                     | string   | ✅   | 唯一标识符，推荐使用反向域名格式   |
| `name`                   | string   | ✅   | 应用名称                           |
| `version`                | string   | ✅   | 版本号（语义化版本）               |
| `description`            | string   | ❌   | 应用描述                           |
| `main`                   | string   | ✅   | 入口文件名                         |
| `author`                 | object   | ❌   | 作者信息 `{name, email?, url?}`    |
| `permissions`            | string[] | ❌   | 所需权限列表                       |
| `icon`                   | string   | ❌   | 图标（emoji 或 URL）               |
| `iconSvg`                | string   | ❌   | 内联 SVG 图标代码（优先于 icon）   |
| `themeColor`             | string   | ❌   | 主题色（十六进制，如 #6366f1）     |
| `widgets`                | object[] | ❌   | 小组件定义                         |
| `hasPage`                | boolean  | ❌   | 是否有页面模块（可在页面模式运行） |
| `backgroundRequirements` | string[] | ❌   | 启动后需常驻的 headless core 能力  |
| `settings`               | object[] | ❌   | 用户可配置的设置项                 |
| `apis`                   | object   | ❌   | 命名 API 声明（代理+权限校验）     |
| `dataExchange`           | object   | ❌   | 跨 Tapp 具名 import/export 契约    |
| `ai`                     | object   | ❌   | 服务端治理的 AI Task V2 声明       |
| `events`                 | object   | ❌   | Event V2 发布/订阅 topic 声明      |
| `agent`                  | object   | ❌   | Agent Interaction V2 声明          |
| `minSystemVersion`       | string   | ❌   | 最低兼容 Myriad 语义版本           |
| `homepage`               | string   | ❌   | 应用主页 URL                       |
| `repository`             | string   | ❌   | 代码仓库 URL                       |
| `styles`                 | string   | ❌   | 自定义样式文件路径                 |
| `cssMode`                | string   | ❌   | `unified`（默认）或 `separated`    |
| `widgetStyles`           | string   | ❌   | Widget 专用 CSS 路径               |
| `pageStyles`             | string   | ❌   | Page 专用 CSS 路径                 |
| `pageTemplate`           | string   | ❌   | 页面 HTML 模板路径                 |
| `pageModules`            | string[] | ❌   | `page/` 模块执行顺序               |
| `category`               | string   | ❌   | 应用分类                           |

所有资源路径都是相对安装根目录的安全路径。`.tapp` 文件安装会保留经过校验的嵌套
目录，例如 `templates/widget-2x2.html`；direct/store 安装也会把内容写到 Manifest
声明的位置。绝对路径、隐藏组件和 `..` 会被拒绝。`pageModules` 的每项是 `page/`
目录内的文件名，不能再次包含目录前缀。

Manifest 采用严格字段校验：未声明字段、拼写错误以及已经移除的字段都会让安装失败，
不会再被静默忽略。所有运行能力都必须直接写入 `permissions`；宿主只会在真正调用时
按权限和运行时策略决定是否授权。

`minSystemVersion` 使用语义版本。直接安装、商店安装和更新都会由后端与当前 Myriad
包版本比较；当前版本过低或字段格式无效时会拒绝写入，避免出现“安装成功但运行时才
发现 API 不兼容”。商店索引的旧字段 `min_myriad_version` 会在安装时归一化为该字段。

## 完整示例

```json
{
  "id": "com.example.my-tapp",
  "name": "我的应用",
  "version": "1.0.0",
  "description": "一个功能丰富的 Tapp 示例",
  "main": "index.js",
  "author": {
    "name": "开发者名称",
    "email": "dev@example.com",
    "url": "https://example.com"
  },
  "icon": "🚀",
  "themeColor": "#6366f1",
  "permissions": [
    "storage",
    "ui:notification",
    "platform:read",
    "network:fetch"
  ],
  "hasPage": true,
  "backgroundRequirements": ["scheduler", "sync"],
  "homepage": "https://example.com",
  "repository": "https://github.com/example/my-tapp",
  "minSystemVersion": "0.2.0",
  "apis": {
    "weather": {
      "type": "http",
      "access": "protected",
      "endpoint": "https://api.weather.com/v1/current",
      "method": "GET",
      "description": "获取天气信息",
      "spoof": "china",
      "inject": { "city": "{{geo.city}}" }
    }
  },
  "widgets": [
    {
      "id": "stats-widget",
      "name": "数据统计",
      "description": "展示平台统计数据",
      "icon": "📊",
      "defaultSize": "2x2",
      "sizes": ["1x1", "1x2", "2x1", "2x2", "4x2", "4x4"],
      "category": "tool"
    }
  ],
  "settings": [
    {
      "key": "refreshInterval",
      "type": "number",
      "label": "刷新间隔",
      "description": "自动刷新间隔（秒）",
      "defaultValue": 60,
      "min": 10,
      "max": 3600
    }
  ]
}
```

---

## widgets 配置

小组件定义允许用户将应用添加到 Dashboard。

```json
{
  "widgets": [
    {
      "id": "my-widget",
      "name": "我的小组件",
      "description": "示例 Widget",
      "icon": "🧊",
      "defaultSize": "2x2",
      "sizes": ["1x1", "1x2", "2x1", "2x2", "3x2", "4x2", "4x4"],
      "category": "tool",
      "templates": {
        "2x2": "templates/widget-2x2.html",
        "4x2": "templates/widget-4x2.html"
      },
      "settings": [
        {
          "key": "compact",
          "type": "toggle",
          "label": "紧凑布局",
          "defaultValue": false
        }
      ],
      "refreshPolicy": {
        "mode": "event",
        "refreshOnVisible": true
      }
    }
  ]
}
```

### Widget 字段说明

| 字段            | 类型     | 必填 | 说明                              |
| --------------- | -------- | ---- | --------------------------------- |
| `id`            | string   | ✅   | Widget 唯一标识符                 |
| `name`          | string   | ✅   | Widget 显示名称                   |
| `description`   | string   | ❌   | Widget 描述                       |
| `icon`          | string   | ❌   | Widget 图标（emoji 或 URL）       |
| `defaultSize`   | string   | ✅   | 默认尺寸（如 "2x2"）              |
| `sizes`         | string[] | ✅   | 支持的尺寸列表                    |
| `category`      | string   | ❌   | 分类（tool, data, media, custom)  |
| `templates`     | object   | ❌   | HTML 模板（按尺寸覆盖）           |
| `settings`      | object[] | ❌   | 每个 Dashboard 实例独立的设置声明 |
| `refreshPolicy` | object   | ❌   | 宿主管理的刷新策略                |

单个 Tapp 最多声明或动态注册 64 个 Widget；每个 Widget 最多声明 10 个尺寸，且
`defaultSize` 必须包含在 `sizes` 中。超出限制会在安装或注册时被后端拒绝。
顶层 `settings` 是整个 Tapp 共用的全局设置；`widgets[].settings` 则属于单个 Dashboard
Widget 实例，因此同一种 Widget 添加两次时可以采用不同配置。实例设置会由 Dashboard
设置面板保存并通过 `props.config`、`Tapp.widget.getInstanceSettings()` 提供给沙箱。

`refreshPolicy.mode` 默认为事件驱动语义：同一 Tapp 的其他运行实例发生 storage 变更时
宿主会通知并刷新 Widget；当前 Widget 可用 `Tapp.widget.invalidate()` 显式请求刷新。
确实需要轮询时可设为 `interval` 并提供
`intervalSeconds`（15–86400 秒）；计时器仅在页面和 Widget 可见且 Tapp 运行时工作。
`refreshOnVisible` 默认为 `true`。后台同步应使用 scheduler/headless core，而不是依赖
Widget 的可见计时器。

### templates 配置说明

`templates` 字段允许为不同尺寸的 Widget 指定 HTML 模板文件。系统会在渲染前加载模板内容到容器中，然后调用 JS 渲染函数进行事件绑定和数据填充。

```json
{
  "templates": {
    "2x2": "widget-2x2.html",
    "4x2": "widget-4x2.html",
    "4x4": "widget-4x4.html"
  }
}
```

**⚠️ 重要**：

1. **文件必须存在**：如果声明了模板路径，对应文件必须实际存在，否则会导致 Widget 渲染失败
2. **路径相对于应用目录**：模板路径相对于 Tapp 应用根目录
3. **未声明的尺寸**：对于未在 `templates` 中声明的尺寸，系统会完全依赖 JS 渲染

**模板文件示例** (widget-2x2.html)：

```html
<div
  class="h-full w-full flex flex-col p-3 glass rounded-xl"
  data-widget-root="true"
>
  <div class="flex items-center gap-2 mb-2">
    <span class="text-lg" data-icon>🤖</span>
    <span class="font-semibold text-sm" data-title>标题</span>
  </div>
  <div class="flex-1 overflow-auto" data-content="main">
    <!-- JS 会填充这里 -->
  </div>
</div>
```

**推荐实践**：

- 使用 `data-*` 属性标记需要 JS 操作的元素
- 模板定义静态结构，JS 负责动态内容和事件绑定
- 不同尺寸的模板可以有完全不同的布局

### 支持的尺寸

| 尺寸  | 像素（默认） | 适用场景         |
| ----- | ------------ | ---------------- |
| `1x1` | 100×100      | 图标、状态指示器 |
| `1x2` | 100×200      | 竖向简报         |
| `2x1` | 200×100      | 简单统计、标题   |
| `2x2` | 200×200      | 标准小组件       |
| `2x3` | 200×300      | 列表 / 纵向卡片  |
| `3x2` | 300×200      | 横向信息块       |
| `4x1` | 400×100      | 紧凑横幅         |
| `4x2` | 400×200      | 宽幅展示、图表   |
| `2x4` | 200×400      | 长列表 / Feed    |
| `3x3` | 300×300      | 中等复杂组件     |
| `4x4` | 400×400      | 大型展示         |

---

## hasPage 配置

声明应用是否有页面模块。设为 `true` 后，运行中的 Tapp 可以点击打开页面视图。

```json
{
  "hasPage": true
}
```

### 页面模块的作用

页面模块允许 Tapp 提供完整的页面体验，而不仅仅是小组件。当用户点击运行中的 Tapp 时，会打开一个全屏页面视图。

### 何时声明 `hasPage: true`

- 应用需要提供详细的配置界面
- 应用需要展示大量数据（如列表、报告、仪表盘）
- 应用需要复杂的交互界面（如编辑器、游戏）
- 应用希望提供比 Widget 更丰富的功能

### 代码结构要求

声明 `hasPage: true` 后，需要在 `PAGE_CODE` 中定义页面渲染逻辑：

```javascript
// PAGE_CODE 中
Tapp.pages["my-page"] = {
  render: function (container, locale, isDark, primaryColor) {
    var bgLayer = document.getElementById("tapp-background");
    var contentLayer = document.getElementById("tapp-content");
    // 渲染页面...
  },
};

Tapp.lifecycle.onReady(async function () {
  var locale = await Tapp.ui.getLocale();
  var theme = await Tapp.ui.getTheme();
  var primaryColor = await Tapp.ui.getPrimaryColor();

  Tapp.pages["my-page"].render(null, locale, theme === "dark", primaryColor);
});
```

---

## settings 配置

允许用户自定义 Tapp 行为。

```json
{
  "settings": [
    {
      "key": "refreshInterval",
      "type": "number",
      "label": "刷新间隔",
      "description": "自动刷新间隔（秒）",
      "defaultValue": 60,
      "min": 10,
      "max": 3600
    },
    {
      "key": "theme",
      "type": "select",
      "label": "主题",
      "defaultValue": "auto",
      "options": [
        { "value": "auto", "label": "跟随系统" },
        { "value": "light", "label": "亮色" },
        { "value": "dark", "label": "暗色" }
      ]
    },
    {
      "key": "showDetails",
      "type": "toggle",
      "label": "显示详情",
      "defaultValue": true
    }
  ]
}
```

### 支持的设置类型

| 类型     | 说明     | 额外字段                                 |
| -------- | -------- | ---------------------------------------- |
| `toggle` | 开关     | -                                        |
| `select` | 下拉选择 | `options: [{value, label}]`              |
| `input`  | 文本输入 | `placeholder`, `maxLength`               |
| `number` | 数字输入 | `min`, `max`, `step`                     |
| `color`  | 颜色选择 | `presets: string[]` (可选的预设颜色列表) |

### 读取设置

```javascript
// 使用 Tapp.settings API
const refreshInterval = await Tapp.settings.get("refreshInterval");
const allSettings = await Tapp.settings.getAll();

// 或使用 Tapp.storage（设置以 _settings. 前缀存储）
const value = await Tapp.storage.get("_settings.refreshInterval");
```

---

## API 声明 (`apis`)

声明 Tapp 需要调用的外部或内置 API。每个键是沙箱调用时使用的 API 名称，后端统一执行权限校验、模板注入、SSRF 防护和可选缓存。

```json
{
  "apis": {
    "data": {
      "type": "http",
      "access": "protected",
      "endpoint": "https://api.example.com/data?city={{city}}",
      "method": "GET",
      "headers": { "X-Region": "{{params.region}}" },
      "cacheTtl": 60,
      "spoof": "china",
      "description": "获取数据",
      "inject": { "city": "{{geo.city}}" }
    },
    "summarize": {
      "type": "builtin",
      "access": "protected",
      "builtin": "ai:generate",
      "description": "生成摘要"
    }
  }
}
```

### API 声明字段

| 字段          | 类型   | 必填 | 说明                                              |
| ------------- | ------ | ---- | ------------------------------------------------- |
| `type`        | string | ❌   | `http`（默认）或 `builtin`                        |
| `access`      | string | ❌   | `protected`（默认）或 `public`                    |
| `endpoint`    | string | HTTP | HTTP URL，可使用 `{{params.*}}` 等模板            |
| `url`         | string | 兼容 | `endpoint` 的旧别名，不能与其同时声明             |
| `params`      | object | 兼容 | 旧版查询参数模板，会编码后追加到 URL              |
| `method`      | string | ❌   | HTTP 方法，默认 `GET`                             |
| `headers`     | object | ❌   | 请求头模板                                        |
| `body`        | object | ❌   | JSON 请求体模板                                   |
| `builtin`     | string | 内置 | `geo`、`ai:chat` 或 `ai:generate`                 |
| `inject`      | object | ❌   | 将宿主模板值映射为可复用别名                      |
| `cacheTtl`    | number | ❌   | 响应缓存秒数；缓存按 Tapp、用户、客户端上下文隔离 |
| `spoof`       | string | ❌   | 区域伪装：`china`、`japan` 或 `us`                |
| `description` | string | ❌   | API 描述                                          |

`inject` 的键是新别名，值是宿主上下文模板。例如
`{"city":"{{geo.city}}"}` 会创建 `{{city}}`，供 `endpoint`、`headers` 或 `body`
复用；精确引用会保留数字、布尔值等 JSON 类型。别名不能覆盖 `user.*`、`geo.*`、
`secrets.*` 或 `params.*`。HTTP API 必须且只能声明 `endpoint` 或兼容字段 `url`
其中之一；内置 API 只接受 `geo`、`ai:chat`、`ai:generate`，不能混入 HTTP 字段。
单个 Manifest 最多声明 64 个 API，每个 API 最多声明 32 个注入别名，`cacheTtl` 上限
为 86400 秒。

### 区域伪装 (`spoof`)

用于绕过地区限制，自动添加对应地区的请求头：

| 代码                     | 地区     |
| ------------------------ | -------- |
| `china` / `cn`           | 中国大陆 |
| `japan` / `jp`           | 日本     |
| `us` / `usa` / `america` | 美国     |
| `korea` / `kr`           | 韩国     |
| `taiwan` / `tw`          | 台湾     |
| `hongkong` / `hk`        | 香港     |

### 使用示例

```javascript
// 调用已声明的 API
const response = await Tapp.api("data", { region: "jp" });
const summary = await Tapp.api("summarize", { prompt: "总结这些数据" });
```

> `Tapp.api(name, params)` 只能调用当前解析到的 manifest 的 `apis[name]`。缓存键包含 owner，
> 不会在不同 owner 间复用定义；同 ID 冲突时当前兼容规则选择管理员公开版本。

---

## 跨 Tapp 数据契约 (`dataExchange`)

Tapp 私有 storage、报告和内部状态不会因为知道另一个 `tappId` 而开放。提供方必须声明
具名 `exports`，调用方必须声明匹配的 `imports`；声明只表示接口兼容，每次真实调用仍会
显示宿主的“仅本次”授权弹窗。

```json
{
  "dataExchange": {
    "exports": [
      {
        "id": "playlist.current",
        "description": "当前播放列表",
        "maxBytes": 262144,
        "maxRecords": 200,
        "schema": {
          "type": "array",
          "maxItems": 200,
          "items": {
            "type": "object",
            "required": ["id", "title"],
            "properties": {
              "id": { "type": "string" },
              "title": { "type": "string", "maxLength": 200 },
              "artist": { "type": "string", "maxLength": 200 }
            },
            "additionalProperties": false
          }
        }
      }
    ],
    "imports": [
      {
        "tappId": "com.example.player",
        "exportId": "playlist.current"
      }
    ]
  }
}
```

约束：

- 每个方向最多 32 条声明；export ID 最长 128 字节，只允许字母、数字、`_-.`；
- `maxBytes` 为 1–524288，`maxRecords` 可选且为 1–10000；
- `schema` 必须是最多 64 KiB 的内联对象，当前支持 `type`、`properties`、`required`、
  `additionalProperties: false`、`items`、`min/maxItems`、`min/maxLength`、
  `minimum/maximum`、`enum` 和 `const`；不支持 `$ref` 或外部 schema；
- 响应失败、超限或 schema 不匹配同样会耗尽一次性 Grant，不能修改参数后重放；
- 相同 Tapp 内部读取应使用自己的私有 API，不走跨 Tapp 交换。

运行时用法见 [Data Exchange API](API_REFERENCE.md#跨-tapp-data-exchange-api)。

---

## AI、Event 与 Agent V2 声明

```json
{
  "permissions": ["ai:generate", "event:publish", "event:subscribe"],
  "ai": {
    "protocolVersion": 2,
    "operations": ["generate", "chat"],
    "modelTier": "standard",
    "contextSources": ["platform", "report", "profile", "custom"],
    "outputFormats": ["text", "json"]
  },
  "events": {
    "publish": ["tapp.com.example.my-tapp.status.changed"],
    "subscribe": [
      "system.theme.changed",
      "tapp.com.example.player.track.changed"
    ]
  },
  "agent": {
    "protocolVersion": 2,
    "interactions": [
      {
        "type": "report.compose",
        "inputSchema": "schemas/report-input.json",
        "resultSchema": "schemas/report-result.json"
      }
    ],
    "intents": ["ui.open", "report.create", "dataExchange.request"]
  }
}
```

- AI operation 必须同时声明匹配的 `ai:*` 权限；模型供应商、模型名和生成参数不进入 Manifest；
- Event publish topic 必须位于 `tapp.<当前 id>.*`；Tapp 不能发布 `system.*`；每个方向最多
  100 个 topic；
- `system.*` 只能由宿主发布；当前提供 theme、network、locale、visibility 和 navigation
  状态变更 producer；
- Event `owner` 作用域只允许有界状态元数据，跨 Tapp 正文必须使用 `dataExchange`；
- Agent interaction type 最多 32 个。schema 是安装根目录内的 JSON 资源，安装时校验存在，
  运行时限制为 64 KiB、禁止 `$ref`，输入和结果都由后端验证；
- 兼容交互必须显式声明 `legacy.fill`、`legacy.interact` 或 `legacy.read`，不会自动获得任意
  DOM 操作权限。

---

## 权限列表

权限等级与运行时边界见 [架构文档的权限模型](./ARCHITECTURE.md#权限模型)。Manifest
中的权限仍需经过安装授权；“基础”不表示 Tapp 可以省略申请。

### 基础权限（所有用户可用）

| 权限                 | 说明             |
| -------------------- | ---------------- |
| `storage`            | 本地数据存储     |
| `ui:notification`    | 显示通知         |
| `ui:theme`           | 读取主题信息     |
| `ui:confirm`         | 显示确认对话框   |
| `ui:fullscreen`      | 请求全屏显示     |
| `platform:read`      | 读取平台数据     |
| `tappList:read`      | 读取 Tapp 列表   |
| `brew:read`          | 读取 Brew 内容   |
| `brew:write`         | 修改 Brew 状态   |
| `brew:comment`       | 操作 Brew 评论   |
| `report:read`        | 读取报告         |
| `media:read`         | 读取媒体状态     |
| `event:subscribe`    | 订阅声明的 topic |
| `widget:register`    | 注册小组件       |
| `federation:read`    | 读取联邦数据     |
| `federation:write`   | 联邦个人操作     |
| `federation:message` | 联邦消息         |
| `federation:files`   | 联邦文件传输     |

### 提升权限（管理员可配置下放）

| 权限                 | 说明              |
| -------------------- | ----------------- |
| `ai:generate`        | AI 文本生成       |
| `ai:analyze`         | AI 数据分析       |
| `ai:chat`            | AI 对话           |
| `ai:image`           | AI 图片生成       |
| `report:write`       | 创建/修改报告     |
| `network:fetch`      | 发送 HTTP 请求    |
| `media:control`      | 控制媒体播放      |
| `component:theme`    | 注册自定义主题    |
| `shortcut:register`  | 注册键盘快捷键    |
| `event:publish`      | 发布本 Tapp topic |
| `scheduler:register` | 注册定时任务      |
| `speech:tts`         | 文本转语音        |
| `speech:asr`         | 语音转文本        |

`brew:write` 与 `brew:comment` 描述的是 Tapp 能力，不按宿主用户角色下放。Tapp 仍必须在
Manifest 中声明并在安装时获授；实际读写始终落在当前会话可访问的 Brew 数据范围内。

### 特权权限

| 权限                | 说明           |
| ------------------- | -------------- |
| `platform:write`    | 写入平台数据   |
| `platform:register` | 注册自定义平台 |
| `component:agent`   | 注册 AI Agent  |
| `tappList:manage`   | 管理 Tapp      |
| `brew:manage`       | 管理 Brew      |
| `federation:trust`  | 管理联邦信任   |
