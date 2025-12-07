# Tapp 开发指南

Tapp (Third-party App) 是 Myriad 的扩展应用系统，允许开发者创建自定义小组件、工具和功能扩展。

## 目录

- [快速开始](#快速开始)
- [代码架构](#代码架构)
- [Manifest 配置](#manifest-配置)
- [生命周期](#生命周期)
- [后台运行](#后台运行)
- [API 参考](#api-参考)
  - [存储 API](#存储-api)
  - [设置 API](#设置-api)
  - [UI API](#ui-api)
  - [动画 API](#动画-api)
  - [平台 API](#平台-api)
  - [AI API](#ai-api)
  - [小组件 API](#小组件-api)
  - [报告 API](#报告-api)
  - [DOM 安全 API](#dom-安全-api)
  - [HTTP 代理 API](#http-代理-api)
  - [数据处理 API](#数据处理-api)
  - [媒体控制 API](#媒体控制-api)
  - [上下文 API](#上下文-api)
  - [用户角色 API](#用户角色-api)
  - [组件注册 API](#组件注册-api)
  - [快捷键 API](#快捷键-api)
  - [事件总线 API](#事件总线-api)
  - [后台需求 API](#后台需求-api)
  - [动态内容 API](#动态内容-api)
  - [速率限制 API](#速率限制-api)
  - [性能指标 API（管理员）](#性能指标-api管理员)
- [权限系统](#权限系统)
- [REST API 端点参考](#rest-api-端点参考)
- [安全沙箱](#安全沙箱)
- [自适应尺寸](#自适应尺寸)
- [页面分层架构](#页面分层架构)
- [国际化 (i18n)](#国际化-i18n)
- [小组件开发](#小组件开发)
- [最佳实践](#最佳实践)
- [示例代码](#示例代码)
- [AI 辅助开发指南](#ai-辅助开发指南)
- [常见问题](#常见问题)

---

## 快速开始

### 1. 创建 Manifest

每个 Tapp 都需要一个 Manifest 配置文件：

```json
{
  "id": "com.example.my-tapp",
  "name": "我的应用",
  "version": "1.0.0",
  "description": "一个示例 Tapp 应用",
  "main": "index.js",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "permissions": ["storage", "ui:notification"],
  "icon": "🚀"
}
```

### 2. 编写代码

```javascript
// 当 Tapp 准备就绪时执行
Tapp.lifecycle.onReady(async () => {
  console.log("Tapp 已启动!");

  // 显示通知
  await Tapp.ui.showNotification({
    title: "欢迎",
    message: "应用已启动",
    type: "success",
  });
});

// 当 Tapp 销毁时执行
Tapp.lifecycle.onDestroy(() => {
  console.log("Tapp 已停止");
});
```

### 3. 安装

在 Tapp 管理页面点击"自定义安装"，粘贴 Manifest 和代码即可。

---

## 代码架构

Tapp 使用**分离模式**，将代码分为三部分：

```
TappCodeStructure {
  core: string    // 核心代码：共享工具函数
  widget?: string // 小组件代码：Widget 渲染逻辑
  page?: string   // 页面代码：页面渲染 + 生命周期
}
```

### 为什么使用分离模式？

1. **避免代码冲突**：Widget 模式和 Page 模式加载不同的代码，互不干扰
2. **更小的加载体积**：Widget 只加载 `core + widget`，Page 只加载 `core + page`
3. **清晰的职责分离**：每个部分专注于单一功能

### 代码加载规则

| 模式        | 加载的代码      | 执行内容                      |
| ----------- | --------------- | ----------------------------- |
| Widget 模式 | `core + widget` | 只渲染 Widget，跳过 `onReady` |
| Page 模式   | `core + page`   | 执行完整生命周期，渲染页面    |

### 代码结构示例

```typescript
// 核心代码 - 共享工具函数
const CORE_CODE = `
function getThemeColors(isDark) {
  return {
    bg: isDark ? '#1a1a2e' : '#f8fafc',
    text: isDark ? '#e2e8f0' : '#1e293b',
    accent: '#6366f1',
  };
}
`;

// Widget 代码 - 只定义 Widget 渲染
const WIDGET_CODE = `
Tapp.widgets['my-widget'] = {
  render: async function(container, props) {
    var colors = getThemeColors(props.theme === 'dark');
    container.style.background = colors.bg;
    container.innerHTML = '<div>Widget Content</div>';
  }
};
`;

// Page 代码 - 页面渲染 + 生命周期
const PAGE_CODE = `
Tapp.pages['my-page'] = {
  render: async function(container) {
    var colors = getThemeColors(document.documentElement.classList.contains('dark'));
    container.innerHTML = '<h1>Page Content</h1>';
  }
};

// 生命周期（仅 Page 模式执行）
Tapp.lifecycle.onReady(async function() {
  // 渲染页面
  var container = document.getElementById('tapp-root');
  await Tapp.pages['my-page'].render(container);
});
`;

// 导出 Tapp 定义
export const myTapp = {
  manifest: {
    /* ... */
  },
  code: {
    core: CORE_CODE,
    widget: WIDGET_CODE,
    page: PAGE_CODE,
  },
};
```

### Widget 预注册机制

**重要**：Widget 从 Manifest 自动预注册，无需在代码中手动注册！

#### 注册时机

| 时机        | 行为                                    |
| ----------- | --------------------------------------- |
| Tapp 安装时 | 从 `manifest.widgets` 预注册所有 Widget |
| Tapp 运行时 | Widget 渲染函数可用                     |
| Tapp 未运行 | Widget 显示"需要启动"提示               |

#### Dashboard 显示规则

- Widget 在 Tapp 安装后即可添加到 Dashboard
- Widget 只在 Tapp **运行中**时真正渲染
- 未运行时显示启动提示，用户可点击启动 Tapp

```javascript
// manifest.json 中声明 widgets（自动注册）
{
  "widgets": [
    {
      "id": "my-widget",
      "name": "我的小组件",
      "defaultSize": "2x2",
      "sizes": ["1x1", "2x2", "4x2"]
    }
  ]
}

// Widget 代码中只需定义渲染函数
Tapp.widgets['my-widget'] = {
  render: function(container, props) {
    // 渲染逻辑
  }
};
```

---

## Manifest 配置

| 字段          | 类型     | 必填 | 说明                               |
| ------------- | -------- | ---- | ---------------------------------- |
| `id`          | string   | ✅   | 唯一标识符，推荐使用反向域名格式   |
| `name`        | string   | ✅   | 应用名称                           |
| `version`     | string   | ✅   | 版本号（语义化版本）               |
| `description` | string   | ❌   | 应用描述                           |
| `main`        | string   | ✅   | 入口文件名                         |
| `author`      | object   | ❌   | 作者信息 `{name, email?, url?}`    |
| `permissions` | string[] | ❌   | 所需权限列表                       |
| `icon`        | string   | ❌   | 图标（emoji 或 URL）               |
| `themeColor`  | string   | ❌   | 主题色（十六进制）                 |
| `widgets`     | object[] | ❌   | 小组件定义                         |
| `hasPage`     | boolean  | ❌   | 是否有页面模块（可在页面模式运行） |
| `settings`    | object[] | ❌   | 用户可配置的设置项                 |
| `aiQuota`     | string   | ❌   | AI 配额等级 `standard`/`premium`   |

### widgets 配置

```json
{
  "widgets": [
    {
      "id": "my-widget",
      "name": "我的小组件",
      "defaultSize": "2x2",
      "sizes": ["1x1", "2x1", "2x2", "4x2"],
      "minRefreshInterval": 60000,
      "category": "tool"
    }
  ]
}
```

### hasPage 配置

声明应用是否有页面模块。设为 `true` 后，运行中的 Tapp 可以点击打开页面视图。

```json
{
  "hasPage": true
}
```

**页面模块的作用**：

页面模块允许 Tapp 提供完整的页面体验，而不仅仅是小组件。当用户点击运行中的 Tapp 时，会打开一个全屏页面视图。

**何时声明 `hasPage: true`**：

- 应用需要提供详细的配置界面
- 应用需要展示大量数据（如列表、报告、仪表盘）
- 应用需要复杂的交互界面（如编辑器、游戏）
- 应用希望提供比 Widget 更丰富的功能

**代码结构要求**：

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

**注意**：

- `hasPage: true` 表示应用代码中包含 `Tapp.pages` 定义或页面渲染逻辑
- 只有 `hasPage: true` 的应用在运行时才会显示"点击打开"提示
- 页面渲染使用框架提供的 `#tapp-background` 和 `#tapp-content` 容器
- 详细的页面开发指南请参考「页面分层架构」章节

### settings 配置

允许用户自定义 Tapp 行为：

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

支持的设置类型：

- `toggle` - 开关
- `select` - 下拉选择
- `input` - 文本输入
- `number` - 数字输入
- `color` - 颜色选择

---

## 生命周期

### onReady

当 Tapp 完全加载并准备就绪时触发。

```javascript
Tapp.lifecycle.onReady(async () => {
  // 初始化代码
});
```

### onDestroy

当 Tapp 即将被销毁时触发（停止或卸载）。

```javascript
Tapp.lifecycle.onDestroy(async () => {
  // 清理代码
});
```

### onPause / onResume

当 Tapp 被暂停/恢复时触发。

```javascript
Tapp.lifecycle.onPause(() => {
  // 暂停定时器等
});

Tapp.lifecycle.onResume(() => {
  // 恢复执行
});
```

---

## 后台运行

Tapp 默认在用户离开运行页面后会被**冻结**（暂停执行）。如果 Tapp 需要在后台持续运行，必须**声明后台运行需求**。

### 设计理念

- **默认冻结**：离开 Tapp 运行页面后，Tapp 停止执行，节省资源
- **按需运行**：只有声明了后台需求的 Tapp 才会在后台持续运行
- **自动管理**：某些操作（如注册 Widget）会自动声明对应的后台需求

### 后台需求类型

| 类型             | 说明                     | 典型场景                 |
| ---------------- | ------------------------ | ------------------------ |
| `widget`         | 有小组件在主页显示       | 数据统计小组件           |
| `media`          | 媒体控制                 | 音乐播放器扩展           |
| `sync`           | 后台数据同步             | 定时从 API 拉取数据      |
| `notification`   | 定时通知                 | 提醒类应用               |
| `scheduler`      | 定时任务                 | 自动执行脚本             |
| `event-listener` | 事件监听（跨 Tapp 通信） | 需要响应其他 Tapp 的事件 |
| `realtime`       | 实时数据更新             | 需要 WebSocket 类通信    |

### 自动声明

以下操作会**自动声明**对应的后台需求，无需手动调用：

| 操作                      | 自动声明的需求 |
| ------------------------- | -------------- |
| `Tapp.widget.register()`  | `widget`       |
| Manifest 中声明 `widgets` | `widget`       |

当所有 Widget 被注销时，`widget` 需求会自动释放。

### 手动声明

对于其他场景，需要在代码中手动声明后台需求：

```javascript
Tapp.lifecycle.onReady(async function () {
  // 声明需要后台同步数据
  await Tapp.background.require("sync", "每5分钟同步一次数据");

  // 启动定时同步
  setInterval(syncData, 5 * 60 * 1000);
});

Tapp.lifecycle.onDestroy(async function () {
  // 释放后台需求（可选，Tapp 停止时会自动清除）
  await Tapp.background.release("sync");
});
```

### 使用示例

#### 媒体播放器扩展

```javascript
Tapp.lifecycle.onReady(async function () {
  // 声明需要后台媒体控制
  await Tapp.background.require("media", "正在控制音乐播放");

  // 监听播放状态
  Tapp.media.onStateChange(function (state) {
    updateUI(state);
  });
});

// 当不再需要后台运行时释放
async function stopMediaControl() {
  await Tapp.background.release("media");
}
```

#### 定时通知应用

```javascript
Tapp.lifecycle.onReady(async function () {
  // 声明需要后台通知
  await Tapp.background.require("notification", "定时提醒功能");

  // 设置定时器
  scheduleNotifications();
});
```

#### 跨 Tapp 通信

```javascript
Tapp.lifecycle.onReady(async function () {
  // 需要持续监听其他 Tapp 的事件
  await Tapp.background.require("event-listener", "监听数据更新事件");

  // 订阅事件
  await Tapp.event.subscribe(["data:updated", "config:changed"]);

  Tapp.event.on("data:updated", function (payload) {
    handleDataUpdate(payload);
  });
});
```

### 查询后台状态

```javascript
// 获取当前已声明的所有后台需求
const requirements = await Tapp.background.list();
console.log("后台需求:", requirements);
// 返回: ['widget', 'sync']

// 检查是否有特定需求
const hasWidget = await Tapp.background.has("widget");
console.log("是否有 widget 需求:", hasWidget);
// 返回: true 或 false
```

### 生命周期关系

```
Tapp 启动
    ↓
声明后台需求 → 添加到后台运行列表
    ↓
用户离开页面
    ↓
┌─────────────────────────────────┐
│ 有后台需求？                      │
│   是 → 继续在后台运行              │
│   否 → 冻结（暂停执行）            │
└─────────────────────────────────┘
    ↓
Tapp 停止 → 自动清除所有后台需求
```

### 注意事项

1. **资源消耗**：后台运行会消耗系统资源，请只在必要时声明
2. **自动清理**：Tapp 停止时，所有后台需求会被自动清除
3. **不可滥用**：频繁声明/释放后台需求可能影响性能
4. **Widget 自动管理**：注册 Widget 会自动声明 `widget` 需求，无需手动处理

---

## API 参考

### 存储 API

**权限**: `storage`

```javascript
// 获取数据
const value = await Tapp.storage.get("key");

// 设置数据
await Tapp.storage.set("key", { any: "value" });

// 删除数据
await Tapp.storage.remove("key");

// 获取所有键
const keys = await Tapp.storage.keys();

// 清空存储
await Tapp.storage.clear();

// 获取存储使用情况
const usage = await Tapp.storage.usage();
// 返回: { used: 1024, quota: 5242880 } // 字节
```

### 设置 API

**权限**: `storage`（使用 `_settings.` 前缀存储）

```javascript
// 获取设置项
const refreshInterval = await Tapp.settings.get("refreshInterval");

// 设置设置项
await Tapp.settings.set("refreshInterval", 60);

// 获取所有设置
const allSettings = await Tapp.settings.getAll();
// 返回: { refreshInterval: 60, showDetails: true, ... }
```

### UI API

**权限**: `ui:notification`, `ui:theme`, `ui:confirm`, `ui:fullscreen`

```javascript
// 设置页面标题
await Tapp.ui.setTitle("我的页面");

// 显示通知（Toast）
// 通知会以 Glass Morphism 风格显示在页面顶部
// 支持四种类型，每种类型有不同的配色和图标
await Tapp.ui.showNotification({
  title: "操作成功", // 可选：通知标题（加粗显示）
  message: "数据已保存", // 必填：通知消息
  type: "success", // 可选：类型 "success" | "error" | "warning" | "info"
  duration: 3000, // 可选：显示时长（毫秒），默认 3000
});

// 通知类型说明：
// - success: 绿色，成功操作（✓ 图标）
// - error:   红色，错误提示（✗ 图标）
// - warning: 橙色，警告信息（⚠ 图标）
// - info:    蓝色，一般信息（ℹ 图标）

// 简单通知示例
await Tapp.ui.showNotification({
  message: "欢迎使用！",
  type: "info",
});

// 获取当前主题
const theme = await Tapp.ui.getTheme();
// 返回: 'light' | 'dark'

// 监听主题变化
const unsubscribe = Tapp.ui.onThemeChange((theme) => {
  console.log("主题切换为:", theme);
});

// 获取全局主色调（壁纸色）
const primaryColor = await Tapp.ui.getPrimaryColor();
// 返回: '#6366f1' (十六进制颜色值)

// 监听主色调变化
const unsubscribe = Tapp.ui.onPrimaryColorChange((color) => {
  console.log("主色调变化:", color);
  // 更新 UI 中使用主色调的元素
});

// 获取当前语言
const locale = await Tapp.ui.getLocale();
// 返回: 'zh-CN' | 'en-US' | ...

// 监听语言变化
const unsubscribe = Tapp.ui.onLocaleChange((locale) => {
  console.log("语言切换为:", locale);
});

// 确认对话框（参数为消息字符串）
const confirmed = await Tapp.ui.confirm("确定要执行吗？");
// 返回: true（用户点击确定）或 false（用户点击取消）

// 全屏控制（需要 ui:fullscreen）
await Tapp.ui.fullscreen.request(); // 请求全屏
await Tapp.ui.fullscreen.exit(); // 退出全屏
await Tapp.ui.fullscreen.toggle(); // 切换全屏
const isFs = await Tapp.ui.fullscreen.isFullscreen(); // 查询状态
```

#### 主色调 API 使用示例

全局主色调（壁纸色）会随着用户切换壁纸而变化。Tapp 可以使用此 API 让 UI 与系统配色保持一致：

```javascript
// 初始化时获取主色调
Tapp.lifecycle.onReady(async function () {
  var primaryColor = await Tapp.ui.getPrimaryColor();
  applyThemeColor(primaryColor);

  // 监听主色调变化，实时更新 UI
  Tapp.ui.onPrimaryColorChange(function (newColor) {
    applyThemeColor(newColor);
  });
});

function applyThemeColor(color) {
  // 更新装饰元素颜色
  document.querySelector(".glow").style.background =
    "radial-gradient(circle, " + color + "20, transparent 70%)";

  // 更新强调色
  document.querySelector(".accent").style.color = color;
  document.querySelector(".badge").style.background = color + "20";
}
```

### 动画 API

**权限**: 无需特殊权限

动画 API 允许 Tapp 获取当前系统的动画配置，以便根据用户的动画偏好设置调整 UI 行为。这确保了 Tapp 与系统整体动画体验保持一致。

```javascript
// 获取当前动画级别
const level = await Tapp.animation.getLevel();
// 返回: 'none' | 'light' | 'standard'
// - 'none': 无动画（适合节省资源或无障碍需求）
// - 'light': 轻量动画（简化的过渡效果）
// - 'standard': 标准动画（完整动画体验）

// 检查是否应该显示动画
const shouldAnimate = await Tapp.animation.shouldAnimate();
// 返回: boolean
// 当动画级别为 'none' 时返回 false，否则返回 true

// 获取完整动画配置
const config = await Tapp.animation.getConfig();
// 返回: {
//   level: 'standard',           // 动画级别
//   loop: true,                  // 是否允许循环动画
//   spring: { tension: 280, friction: 20 },  // 弹簧动画参数
//   durationScale: 1             // 动画时长缩放系数
// }

// 获取推荐的交错延迟（用于列表动画）
const delay = await Tapp.animation.getStaggerDelay(index, baseDelay);
// index: 元素索引（从 0 开始）
// baseDelay: 基础延迟（毫秒），默认 50ms
// 返回: number（计算后的延迟毫秒数）
// 根据动画级别自动调整：
// - 'none': 返回 0
// - 'light': 返回 index * (baseDelay * 0.5) * durationScale
// - 'standard': 返回 index * baseDelay * durationScale

// 监听动画级别变化
const unsubscribe = Tapp.animation.onLevelChange((level) => {
  console.log("动画级别变化:", level);
  // 根据新的动画级别调整 UI
});

// 取消监听
unsubscribe();
```

#### 动画 API 使用示例

```javascript
// 根据动画设置创建列表动画
async function animateListItems(items) {
  const shouldAnimate = await Tapp.animation.shouldAnimate();

  for (let i = 0; i < items.length; i++) {
    const delay = await Tapp.animation.getStaggerDelay(i);

    if (shouldAnimate) {
      // 使用延迟显示动画
      setTimeout(() => {
        items[i].classList.add("visible");
      }, delay);
    } else {
      // 无动画模式：直接显示
      items[i].classList.add("visible");
    }
  }
}

// 根据配置调整动画时长
async function getAnimationDuration(baseDuration = 300) {
  const config = await Tapp.animation.getConfig();
  return baseDuration * config.durationScale;
}

// 响应动画级别变化
Tapp.animation.onLevelChange(async (level) => {
  if (level === "none") {
    // 停止所有正在进行的动画
    document.querySelectorAll(".animating").forEach((el) => {
      el.style.animation = "none";
    });
  }
});
```

### 平台 API

**权限**: `platform:read`, `platform:write`

```javascript
// 获取已启用平台列表
const platforms = await Tapp.platform.listEnabled();
// 返回: [{ id: 'steam', name: 'Steam', enabled: true, ... }]

// 获取平台数据
const data = await Tapp.platform.getData("steam", {
  limit: 100,
  offset: 0,
});

// 获取平台统计
const stats = await Tapp.platform.getStats("steam");
// 返回: { total: 100, distribution: {...} }

// 获取数据分布
const dist = await Tapp.platform.getDistribution("steam", "genre");

// 添加数据条目（需要 platform:write 权限）
const result = await Tapp.platform.addItem({
  platform: "custom",
  type: "game",
  title: "我的游戏",
  description: "描述",
  metadata: { rating: 5 },
});

// 批量添加数据条目
await Tapp.platform.addItems([
  { platform: "custom", title: "游戏1" },
  { platform: "custom", title: "游戏2" },
]);

// 注册自定义平台（需要 platform:register 权限）
await Tapp.platform.registerPlatform({
  id: "my-platform",
  name: "我的平台",
  icon: "🎮",
  schema: {
    // 数据结构定义
  },
});
```

### AI API

**权限**: `ai:generate`, `ai:analyze`, `ai:chat`, `ai:image`

```javascript
// AI 生成
const response = await Tapp.ai.generate({
  prompt: "请帮我写一段介绍",
  context: { theme: "gaming" }, // 可选
  options: { maxTokens: 500 }, // 可选
});
// 返回: { success: true, result: '...', usage: {...} }

// AI 分析
const analysis = await Tapp.ai.analyze({
  data: [{ title: "Game 1" }, { title: "Game 2" }],
  type: "summarize" | "categorize" | "sentiment" | "custom",
  instruction: "自定义指令", // type 为 custom 时必填
});

// AI 对话（需要 ai:chat 权限）
const chat = await Tapp.ai.chat(
  [{ role: "user", content: "你好" }], // messages: 消息数组
  { includePlatformStats: true }, // context: 上下文（可选）
  { maxTokens: 1000 } // options: 选项（可选）
);

// AI 图片生成（需要 ai:image 权限）
const image = await Tapp.ai.image({
  prompt: "一只可爱的猫咪，动漫风格",
  width: 512, // 可选，256-2048
  height: 768, // 可选，256-2048
  model: "flux-anime", // 可选，flux/flux-anime/flux-realism/flux-3d
  enhance: true, // 可选，是否增强提示词
  seed: 12345, // 可选，固定随机种子
});
// 返回: { success: true, provider: 'pollinations', url: '...', width, height }

// 获取 AI 配额
const quota = await Tapp.ai.getQuota();
// 返回: { dailyCalls: 10, dailyTokens: 5000, lastReset: "..." }

// 检查是否可以生成
const canGen = await Tapp.ai.canGenerate();
// 返回: { allowed: true, remaining: 5 }
```

### 小组件 API

**权限**: `widget:register`

```javascript
// 注册小组件
await Tapp.widget.register({
  id: "my-widget",
  name: "我的小组件",
  defaultSize: "2x2",
  sizes: ["1x1", "2x2", "4x2"],
  minRefreshInterval: 60000, // 最小刷新间隔（毫秒）
  category: "tool",
});

// 注销小组件
await Tapp.widget.unregister("my-widget");

// 获取已注册小组件
const widgets = await Tapp.widget.listRegistered();

// 更新小组件配置
await Tapp.widget.updateConfig("my-widget", {
  title: "新标题",
});
```

### 报告 API

**权限**: `report:read`, `report:write`

```javascript
// ========== 读取报告（需要 report:read 权限）==========

// 获取报告列表
const reports = await Tapp.report.listReports();
// 返回: [{ id, platform, type, createdAt, summary }]

// 简便方法：获取报告列表
const reports = await Tapp.report.list();

// 获取报告详情
const report = await Tapp.report.getReport(reportId);

// 简便方法：获取报告详情
const report = await Tapp.report.get(reportId);

// 获取特定平台的报告
const steamReport = await Tapp.report.getPlatformReport("steam");

// ========== 写入报告（需要 report:write 权限）==========

// 创建报告
const newReport = await Tapp.report.create(
  "我的报告", // title
  "summary", // reportType
  { summary: "..." }, // content
  { tags: ["test"] } // metadata (可选)
);

// 更新报告
await Tapp.report.update(
  reportId,
  "新标题",
  { summary: "新内容" },
  { tags: ["updated"] }
);

// 删除报告
await Tapp.report.delete(reportId);
```

### DOM 安全 API

**无需权限** - 防止 XSS 攻击的安全工具

```javascript
// HTML 转义 - 将特殊字符转换为 HTML 实体
const safe = Tapp.dom.escapeHtml('<script>alert("xss")</script>');
// 返回: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'

// 安全设置文本内容（推荐方式）
Tapp.dom.setText(element, userInput);

// 安全设置 HTML（自动转义）
Tapp.dom.setSafeHtml(element, userInput);

// 创建文本节点
const textNode = Tapp.dom.createTextNode(userInput);
container.appendChild(textNode);

// 安全设置属性（阻止危险属性和协议）
Tapp.dom.setAttribute(element, "href", url);
// 自动阻止: onclick, javascript:, data:text/html 等

// 创建安全元素
const div = Tapp.dom.createElement("div", {
  text: "安全文本",
  className: "my-class",
  attributes: { "data-id": "123" },
});

// 安全渲染列表
Tapp.dom.renderList(container, items, (item, index) => {
  return Tapp.dom.createElement("div", {
    text: item.name,
    className: "item",
  });
});
```

> ⚠️ **安全警告**：永远不要直接使用 `innerHTML` 渲染用户输入！

### HTTP 代理 API

**权限**: `network:fetch`

```javascript
// 发送 HTTP 请求（通过后端代理）
const response = await Tapp.fetch.proxy({
  url: "https://api.example.com/data",
  method: "GET", // 可选，默认 GET
  headers: { Authorization: "Bearer token" }, // 可选
  body: { key: "value" }, // 可选
  timeout: 30, // 可选，秒
});

// 返回: { status: 200, headers: {...}, data: {...} }
```

> 注意：内网地址（localhost, 192.168.x.x 等）被禁止访问

### 数据处理 API

**无需权限** - 数据转换管道

```javascript
// 数据转换
const result = await Tapp.data.transform({
  input: { source: "platform", platform: "steam" }, // 或 'storage'/'inline'
  pipeline: [
    { type: "filter", field: "status", operator: "eq", value: "active" },
    { type: "sort", field: "createdAt", order: "desc" },
    { type: "limit", count: 10 },
    { type: "select", fields: ["id", "title", "date"] },
  ],
  output: { target: "storage", key: "my-data" }, // 可选
});
// 返回: { success: true, data: [...], count: 10 }
```

输入源类型：

| 类型       | 参数               | 说明         |
| ---------- | ------------------ | ------------ |
| `platform` | `platform: string` | 从平台读取   |
| `storage`  | `key: string`      | 从存储读取   |
| `inline`   | `data: unknown`    | 直接传入数据 |

支持的管道操作：

| 操作        | 参数                         | 说明     |
| ----------- | ---------------------------- | -------- |
| `filter`    | `field`, `operator`, `value` | 过滤数据 |
| `sort`      | `field`, `order`             | 排序     |
| `limit`     | `count`                      | 限制数量 |
| `offset`    | `count`                      | 跳过数量 |
| `select`    | `fields`                     | 选择字段 |
| `group`     | `by`                         | 分组     |
| `aggregate` | `operation`, `field`         | 聚合统计 |
| `dedupe`    | `key`                        | 去重     |
| `map`       | `expression`                 | 映射转换 |

### 媒体控制 API

**权限**: `media:control`, `media:read`

```javascript
// 播放控制（需要 media:control）
await Tapp.media.play();
await Tapp.media.pause();

// 切换曲目
await Tapp.media.next();
await Tapp.media.prev();

// 跳转到指定位置（秒）
await Tapp.media.seek(120);

// 音量控制（0-1）
await Tapp.media.setVolume(0.8);
await Tapp.media.mute();
await Tapp.media.unmute();

// 设置播放模式
await Tapp.media.setMode("repeat"); // 'repeat' | 'shuffle' | 'normal'

// 播放指定曲目
await Tapp.media.playTrack(trackId, trackIndex);

// 获取播放状态（需要 media:read）
const status = await Tapp.media.getStatus();
// 返回: {
//   isPlaying: true,
//   currentTrack: { id, title, artist, duration, cover },
//   position: 60,
//   volume: 0.8,
//   mode: 'normal',
//   muted: false
// }

// 获取播放列表（需要 media:read）
const playlist = await Tapp.media.getPlaylist();
// 返回: { tracks: [...], currentIndex: 0 }

// 监听状态变化
const unsubscribe = Tapp.media.onStateChange((state) => {
  console.log("播放状态:", state.isPlaying);
});
// 取消监听
unsubscribe();
```

### 上下文 API

**无需权限** - 获取应用上下文信息

```javascript
// 获取应用信息
const app = await Tapp.context.getApp();
// 返回: { version, name, environment }

// 获取用户信息
const user = await Tapp.context.getUser();
// 返回: { id, username, avatar, preferences }

// 获取播放器信息
const player = await Tapp.context.getPlayer();
// 返回: { isPlaying, currentTrack, volume }

// 获取导航信息
const nav = await Tapp.context.getNavigation();
// 返回: { currentPath, params }

// 获取系统信息
const system = await Tapp.context.getSystem();
// 返回: { theme, language, timezone }
```

### 用户角色 API

**无需权限** - 获取当前访客的用户等级，以便根据用户等级提供不同内容

用户角色分为三个等级：

- `guest` - 游客（未登录用户），只能查看管理员的 Tapp 内容
- `user` - 普通用户（已登录），可使用 `basic` 权限，可临时安装 Tapp
- `admin` - 管理员，可使用所有权限，其 Tapp 对所有用户可见

```javascript
// 获取当前用户角色: "guest" | "user" | "admin"
const role = await Tapp.user.getRole();

// 检查是否为管理员
const isAdmin = await Tapp.user.isAdmin();

// 检查是否为游客（未登录）
const isGuest = await Tapp.user.isGuest();

// 检查是否已登录（普通用户或管理员）
const isLoggedIn = await Tapp.user.isLoggedIn();

// 获取用户可用的权限等级列表
const levels = await Tapp.user.getAllowedPermissionLevels();
// 返回: admin -> ['public', 'basic', 'elevated', 'privileged']
//       user  -> ['public', 'basic']
//       guest -> ['public']

// 检查用户是否可以使用指定权限等级
const canUseElevated = await Tapp.user.canUsePermissionLevel("elevated");
```

#### 根据用户等级提供不同内容示例

```javascript
// 在 Tapp 初始化时检查用户角色
async function initContent() {
  const role = await Tapp.user.getRole();

  if (role === "guest") {
    // 游客：显示基础信息和登录提示
    renderGuestView();
  } else if (role === "user") {
    // 普通用户：显示标准功能
    renderUserView();
  } else if (role === "admin") {
    // 管理员：显示完整功能 + 管理选项
    renderAdminView();
  }
}

// 根据权限等级显示/隐藏功能
async function checkFeatureAccess() {
  const canUseAI = await Tapp.user.canUsePermissionLevel("elevated");

  if (canUseAI) {
    showAIFeatures();
  } else {
    showAILockedMessage();
  }
}
```

### 组件注册 API

**权限**: `component:theme`, `component:agent`

```javascript
// 注册自定义主题（需要 component:theme）
await Tapp.component.registerTheme({
  id: "my-theme",
  name: "我的主题",
  colors: {
    primary: "#6366f1",
    background: "#1a1a2e",
  },
});

// 注册 AI Agent（需要 component:agent）
await Tapp.component.registerAgent({
  id: "my-agent",
  name: "我的助手",
  description: "一个自定义 AI 助手",
  capabilities: ["chat", "analyze"],
});

// 注销组件
await Tapp.component.unregister("page", "my-page");

// 列出已注册组件
const pages = await Tapp.component.list("page");
```

### 快捷键 API

**权限**: `shortcut:register`

```javascript
// 注册快捷键
await Tapp.shortcut.register({
  id: "my-shortcut",
  keys: "Ctrl+Shift+M",
  description: "打开我的 Tapp",
  action: "open-tapp", // 快捷键触发时的动作标识符
  scope: "global", // 可选: 'global' | 'tapp' | 'editor'
});

// 通过事件监听快捷键触发
Tapp.event.on("shortcut:triggered", (data) => {
  if (data.shortcutId === "my-shortcut") {
    // 快捷键被触发时执行
    console.log("快捷键已触发:", data.action);
  }
});

// 注销快捷键
await Tapp.shortcut.unregister("my-shortcut");

// 列出已注册快捷键
const shortcuts = await Tapp.shortcut.list();
// 返回: [{ id, tappId, keys, description, action, scope, enabled }]
```

### 事件总线 API

**权限**: `event:subscribe`, `event:publish`

```javascript
// 订阅事件（需要 event:subscribe）
await Tapp.event.subscribe(["user:login", "platform:sync"]);

// 监听事件
const unsubscribe = Tapp.event.on("user:login", (payload) => {
  console.log("用户登录:", payload.username);
});

// 发布事件（需要 event:publish）
await Tapp.event.publish(
  "my-event",
  {
    message: "Hello from Tapp!",
  },
  "broadcast"
); // 目标: 'broadcast' | 'self' | tappId

// 取消订阅
await Tapp.event.unsubscribe(["user:login"]);
unsubscribe(); // 取消监听器
```

### 后台需求 API

**无需权限** - 声明 Tapp 的后台运行需求

```javascript
// 声明后台运行需求
await Tapp.background.require("sync", "每5分钟同步数据");
// 参数: (requirement: string, reason?: string)
// requirement: 'widget' | 'media' | 'sync' | 'notification' | 'scheduler' | 'event-listener' | 'realtime'
// reason: 可选的说明文字，便于调试

// 释放后台运行需求
await Tapp.background.release("sync");

// 获取当前已声明的所有后台需求
const requirements = await Tapp.background.list();
// 返回: ['widget', 'sync']

// 检查是否有特定后台需求
const hasSync = await Tapp.background.has("sync");
// 返回: true | false
```

#### 需求类型说明

| 类型             | 说明               | 使用场景               |
| ---------------- | ------------------ | ---------------------- |
| `widget`         | 有小组件在主页显示 | 自动声明，无需手动     |
| `media`          | 媒体控制功能       | 音乐播放器、视频控制   |
| `sync`           | 后台数据同步       | 定时从 API 拉取数据    |
| `notification`   | 定时通知功能       | 提醒、闹钟类应用       |
| `scheduler`      | 定时任务执行       | 自动化脚本             |
| `event-listener` | 跨 Tapp 事件监听   | 需要响应其他 Tapp 事件 |
| `realtime`       | 实时数据更新       | 需要持续数据流         |

#### 使用示例

```javascript
// 媒体控制 Tapp
Tapp.lifecycle.onReady(async function () {
  // 声明媒体后台需求
  await Tapp.background.require("media", "正在控制音乐播放");

  // 初始化媒体控制...
});

// 数据同步 Tapp
Tapp.lifecycle.onReady(async function () {
  await Tapp.background.require("sync", "每10分钟同步云端数据");

  setInterval(async function () {
    await syncDataFromCloud();
  }, 10 * 60 * 1000);
});
```

> **注意**：`widget` 需求由系统自动管理，注册 Widget 时自动声明，所有 Widget 注销时自动释放。

### 动态内容 API

**权限**: `ui:notification`（自动声明 `notification` 后台需求）

动态内容 API 允许 Tapp 在控制岛（右上角信息控制岛）收缩状态下显示自定义动态内容，实现类似系统问候语、天气、歌词等轮播效果。

```javascript
// 设置动态内容
await Tapp.dynamicContent.set({
  icon: "📊", // 图标（emoji 或 URL）
  text: "今日活跃: 128", // 主文本
  subtext: "较昨日 +15%", // 副文本（可选）
  priority: 10, // 优先级（可选，默认 -1，越高越靠前）
  showSubtext: true, // 是否显示副文本（可选）
  expiresAt: Date.now() + 3600000, // 过期时间戳（可选）
  i18n: {
    // 多语言支持（可选）
    text: {
      "zh-CN": "今日活跃: 128",
      "en-US": "Active today: 128",
    },
    subtext: {
      "zh-CN": "较昨日 +15%",
      "en-US": "+15% vs yesterday",
    },
  },
});
// 返回: { success: true, data: { registered: true } }

// 快速更新文本（无需重新设置完整配置）
await Tapp.dynamicContent.update({
  text: "今日活跃: 156",
  subtext: "较昨日 +22%",
});
// 返回: { success: true, data: { updated: true } }

// 获取当前动态内容
const content = await Tapp.dynamicContent.get();
// 返回: { type: 'tapp-xxx', icon: '📊', text: '...', ... } 或 null

// 移除动态内容
await Tapp.dynamicContent.remove();
// 返回: { success: true, data: { removed: true } }
```

#### 动态内容配置参数

| 参数          | 类型    | 必填 | 说明                                          |
| ------------- | ------- | ---- | --------------------------------------------- |
| `icon`        | string  | ✅   | 图标，支持 emoji 或图片 URL                   |
| `text`        | string  | ✅   | 主文本内容                                    |
| `subtext`     | string  | ❌   | 副文本（在主文本下方显示）                    |
| `priority`    | number  | ❌   | 优先级，默认 -1（Tapp 内容低于系统内容）      |
| `showSubtext` | boolean | ❌   | 是否显示副文本，默认根据 subtext 是否存在判断 |
| `expiresAt`   | number  | ❌   | 过期时间（毫秒时间戳），过期后自动移除        |
| `i18n`        | object  | ❌   | 多语言文本映射，支持 `text` 和 `subtext` 字段 |

#### 控制岛显示规则

- 动态内容会与系统内置内容（问候语、天气、一言、歌词）一起轮播显示
- 轮播间隔约 15 秒（低端设备 30 秒）
- 当用户悬停在控制岛上时，轮播暂停
- 点击控制岛会展开控制面板

#### 文本滚动效果

当动态内容文本超过 2 行时：

- 系统会自动启用垂直滚动动画
- 滚动会在短暂延迟后开始
- 悬停时滚动暂停
- 歌词类内容会根据歌词持续时间自动调整滚动速度

#### 歌词切换动画

当动态内容快速更新时（如歌词切换）：

- 系统会自动添加淡入淡出过渡效果
- 淡出时间约 100ms，淡入时间约 150ms
- 确保文本切换时的视觉连续性

#### 使用示例

##### 实时数据展示

```javascript
Tapp.lifecycle.onReady(async function () {
  // 声明后台需求以保持 Tapp 运行
  await Tapp.background.require("sync", "实时数据更新");

  // 设置初始内容
  await Tapp.dynamicContent.set({
    icon: "📈",
    text: "加载中...",
    priority: 5,
  });

  // 定时更新数据
  async function updateStats() {
    const stats = await fetchLatestStats();
    await Tapp.dynamicContent.update({
      text: "实时访问: " + stats.visitors,
      subtext:
        stats.trend > 0
          ? "↑ " + stats.trend + "%"
          : "↓ " + Math.abs(stats.trend) + "%",
    });
  }

  updateStats();
  setInterval(updateStats, 30000); // 每30秒更新
});

Tapp.lifecycle.onDestroy(async function () {
  await Tapp.dynamicContent.remove();
});
```

##### 多语言内容

```javascript
await Tapp.dynamicContent.set({
  icon: "🌍",
  text: "欢迎使用",
  i18n: {
    text: {
      "zh-CN": "欢迎使用 Myriad",
      "en-US": "Welcome to Myriad",
      "ja-JP": "Myriad へようこそ",
    },
  },
});
```

##### 带过期时间的通知

```javascript
// 设置一个 1 小时后过期的提醒
await Tapp.dynamicContent.set({
  icon: "⏰",
  text: "别忘了休息一下！",
  expiresAt: Date.now() + 60 * 60 * 1000, // 1小时后过期
});
```

> **注意**：设置动态内容会自动声明 `notification` 后台需求，确保 Tapp 在后台继续运行以保持内容更新。移除动态内容时会自动释放该需求。

### 速率限制 API

获取当前 Tapp 的速率限制状态：

```javascript
// GET /api/tapp/rate-limit/:tapp_id
// 获取指定 Tapp 的速率限制状态
const response = await fetch(`/api/tapp/rate-limit/${tappId}`);
const data = await response.json();
// 返回:
// {
//   "success": true,
//   "tappId": "com.example.my-tapp",
//   "limits": [
//     { "operation": "ai.generate", "limit": 20, "used": 5, "remaining": 15, "resetIn": 45 },
//     { "operation": "fetch.proxy", "limit": 60, "used": 10, "remaining": 50, "resetIn": 30 },
//     { "operation": "platform.write", "limit": 30, "used": 0, "remaining": 30, "resetIn": 60 },
//     { "operation": "storage.set", "limit": 100, "used": 25, "remaining": 75, "resetIn": 55 }
//   ]
// }
```

速率限制配置：

| 操作             | 限制      | 窗口  |
| ---------------- | --------- | ----- |
| `ai.generate`    | 20 次/分  | 60 秒 |
| `fetch.proxy`    | 60 次/分  | 60 秒 |
| `platform.write` | 30 次/分  | 60 秒 |
| `storage.set`    | 100 次/分 | 60 秒 |

### 性能指标 API（管理员）

**权限**: 需要管理员账户

```javascript
// GET /api/tapp/metrics
// 获取 Tapp API 性能指标（仅管理员）
const response = await fetch("/api/tapp/metrics");
const data = await response.json();
// 返回:
// {
//   "success": true,
//   "metrics": {
//     "operations": {
//       "ai.generate": { "count": 150, "avgLatencyMs": 1200, "errorRate": 0.02 },
//       "fetch.proxy": { "count": 500, "avgLatencyMs": 350, "errorRate": 0.01 }
//     },
//     "totalRequests": 650,
//     "startTime": "2024-01-01T00:00:00Z"
//   },
//   "rateLimiter": { "activeLimits": 25 },
//   "cache": { "platforms": 4 }
// }

// POST /api/tapp/metrics/reset
// 重置性能指标（仅管理员）
await fetch("/api/tapp/metrics/reset", { method: "POST" });
```

---

## 权限系统

Tapp 使用细粒度权限控制，每个 API 调用都需要相应权限。

### 用户角色

系统定义了三种用户角色，不同角色对 Tapp 有不同的访问权限：

| 角色     | 说明             | Tapp 功能限制                                      |
| -------- | ---------------- | -------------------------------------------------- |
| 未登录   | 游客用户         | 只读访问管理员的 Tapp 内容，无法安装/运行自己的    |
| 普通用户 | 已登录的标准用户 | 独立应用池，可安装/运行 Tapp，受速率限制和配额约束 |
| 管理员   | 系统管理员       | 完整权限，内容对未登录用户可见，无速率限制         |

> **应用池隔离**：每个用户拥有独立的 Tapp 应用池，用户之间的 Tapp 安装、存储数据、配置完全隔离。

#### 未登录用户

- ❌ 安装 Tapp
- ❌ 运行自己的 Tapp
- ❌ 使用任何 Tapp API
- ✅ 浏览 Tapp 市场/列表
- ✅ 查看 Tapp 详情
- ✅ 查看管理员已安装的 Tapp 列表
- ✅ 查看管理员 Tapp 的 Widget 内容（只读展示）

> 未登录用户访问时，系统默认展示管理员账户的 Tapp 应用内容作为演示。

#### 普通用户

- ✅ 安装/卸载 Tapp
- ✅ 运行/停止 Tapp
- ✅ 使用基础权限 API（storage, ui, platform:read 等）
- ✅ 添加 Widget 到 Dashboard
- ❌ 使用提升权限 API（ai, network:fetch, platform:write 等）
- ❌ 使用特权权限 API（component:agent, platform:register）
- ❌ 注册自定义组件（page, theme, agent）
- ⚠️ 受速率限制约束（见下方）
- ⚠️ 受 AI 配额约束

#### 管理员

- ✅ 所有普通用户权限
- ✅ 使用提升和特权权限 API
- ✅ 注册自定义组件（page, theme, agent）
- ✅ 访问性能指标 API (`/api/tapp/metrics`)
- ✅ 重置性能指标 (`/api/tapp/metrics/reset`)
- ✅ 无速率限制
- ✅ 管理所有用户的 Tapp

### 权限等级

| 等级 | 英文         | 说明                           | 可用角色         |
| ---- | ------------ | ------------------------------ | ---------------- |
| 公开 | `public`     | 无需权限即可访问               | 所有用户         |
| 基础 | `basic`      | 标准权限，安装时自动授予       | 普通用户、管理员 |
| 提升 | `elevated`   | 需要用户确认，可能涉及敏感操作 | 仅管理员         |
| 特权 | `privileged` | 高风险权限，需要特别授权       | 仅管理员         |

### 可用权限

| 权限                | 级别 | 说明           | 普通用户 | 管理员 |
| ------------------- | ---- | -------------- | -------- | ------ |
| `storage`           | 基础 | 本地数据存储   | ✅       | ✅     |
| `ui:notification`   | 基础 | 显示通知       | ✅       | ✅     |
| `ui:theme`          | 基础 | 读取主题信息   | ✅       | ✅     |
| `ui:confirm`        | 基础 | 显示确认对话框 | ✅       | ✅     |
| `ui:fullscreen`     | 基础 | 请求全屏显示   | ✅       | ✅     |
| `platform:read`     | 基础 | 读取平台数据   | ✅       | ✅     |
| `report:read`       | 基础 | 读取报告       | ✅       | ✅     |
| `media:read`        | 基础 | 读取媒体状态   | ✅       | ✅     |
| `event:subscribe`   | 基础 | 订阅系统事件   | ✅       | ✅     |
| `widget:register`   | 基础 | 注册小组件     | ✅       | ✅     |
| `platform:write`    | 提升 | 写入平台数据   | ❌       | ✅     |
| `ai:generate`       | 提升 | AI 文本生成    | ❌       | ✅     |
| `ai:analyze`        | 提升 | AI 数据分析    | ❌       | ✅     |
| `ai:chat`           | 提升 | AI 对话        | ❌       | ✅     |
| `ai:image`          | 提升 | AI 图片生成    | ❌       | ✅     |
| `report:write`      | 提升 | 创建/修改报告  | ❌       | ✅     |
| `network:fetch`     | 提升 | 发送 HTTP 请求 | ❌       | ✅     |
| `media:control`     | 提升 | 控制媒体播放   | ❌       | ✅     |
| `component:theme`   | 提升 | 注册自定义主题 | ❌       | ✅     |
| `shortcut:register` | 提升 | 注册键盘快捷键 | ❌       | ✅     |
| `event:publish`     | 提升 | 发布系统事件   | ❌       | ✅     |
| `platform:register` | 特权 | 注册自定义平台 | ❌       | ✅     |
| `component:agent`   | 特权 | 注册 AI Agent  | ❌       | ✅     |

### 权限声明

在 Manifest 中声明所需权限：

```json
{
  "permissions": ["storage", "ui:notification", "platform:read"]
}
```

### 速率限制（普通用户）

| 操作             | 限制      | 窗口  | 说明          |
| ---------------- | --------- | ----- | ------------- |
| `ai.generate`    | 20 次/分  | 60 秒 | AI 生成请求   |
| `ai.analyze`     | 20 次/分  | 60 秒 | AI 分析请求   |
| `ai.chat`        | 20 次/分  | 60 秒 | AI 对话请求   |
| `fetch.proxy`    | 60 次/分  | 60 秒 | HTTP 代理请求 |
| `platform.write` | 30 次/分  | 60 秒 | 平台数据写入  |
| `storage.set`    | 100 次/分 | 60 秒 | 存储写入操作  |

> 管理员用户不受速率限制约束。

---

## REST API 端点参考

以下是 Tapp 系统所有后端 REST API 端点的完整列表。前端 SDK (`Tapp.*` API) 会自动调用这些端点。

### Tapp 管理 API (`/api/tapps`)

| 端点                                     | 方法   | 说明                 | 认证 |
| ---------------------------------------- | ------ | -------------------- | ---- |
| `/api/tapps`                             | GET    | 获取 Tapp 列表       | 公开 |
| `/api/tapps/install`                     | POST   | 从 URL 安装 Tapp     | 需要 |
| `/api/tapps/install-file`                | POST   | 上传文件安装 Tapp    | 需要 |
| `/api/tapps/cleanup-temporary`           | POST   | 清理临时 Tapp        | 需要 |
| `/api/tapps/:tapp_id`                    | GET    | 获取 Tapp 详情       | 公开 |
| `/api/tapps/:tapp_id`                    | DELETE | 卸载 Tapp            | 需要 |
| `/api/tapps/:tapp_id/start`              | POST   | 启动 Tapp            | 需要 |
| `/api/tapps/:tapp_id/stop`               | POST   | 停止 Tapp            | 需要 |
| `/api/tapps/:tapp_id/code`               | GET    | 获取 Tapp 代码       | 公开 |
| `/api/tapps/:tapp_id/resources`          | GET    | 获取 Tapp 资源       | 公开 |
| `/api/tapps/:tapp_id/export`             | GET    | 导出 Tapp            | 需要 |
| `/api/tapps/widgets`                     | GET    | 获取所有 Widget 列表 | 公开 |
| `/api/tapps/:tapp_id/widgets`            | GET    | 获取 Tapp 的 Widget  | 公开 |
| `/api/tapps/:tapp_id/widgets`            | POST   | 注册 Widget          | 需要 |
| `/api/tapps/:tapp_id/widgets/:widget_id` | DELETE | 注销 Widget          | 需要 |

### Storage API (`/api/tapps/:tapp_id/storage`)

| 端点                               | 方法   | 说明       | 认证 |
| ---------------------------------- | ------ | ---------- | ---- |
| `/api/tapps/:tapp_id/storage`      | GET    | 列出存储键 | 需要 |
| `/api/tapps/:tapp_id/storage`      | DELETE | 清空存储   | 需要 |
| `/api/tapps/:tapp_id/storage/:key` | GET    | 获取存储值 | 需要 |
| `/api/tapps/:tapp_id/storage/:key` | POST   | 设置存储值 | 需要 |
| `/api/tapps/:tapp_id/storage/:key` | DELETE | 删除存储键 | 需要 |

### Store Source API (`/api/tapps/store`)

| 端点                                  | 方法   | 说明           | 认证 |
| ------------------------------------- | ------ | -------------- | ---- |
| `/api/tapps/store/sources`            | GET    | 获取商店源列表 | 公开 |
| `/api/tapps/store/sources`            | POST   | 添加商店源     | 需要 |
| `/api/tapps/store/sources/:source_id` | POST   | 更新商店源     | 需要 |
| `/api/tapps/store/sources/:source_id` | DELETE | 删除商店源     | 需要 |

### Platform API (`/api/tapp/platform`)

| 端点                                                   | 方法 | 说明         | 认证 |
| ------------------------------------------------------ | ---- | ------------ | ---- |
| `/api/tapp/platform/:platform/data`                    | GET  | 获取平台数据 | 需要 |
| `/api/tapp/platform/:platform/stats`                   | GET  | 获取平台统计 | 需要 |
| `/api/tapp/platform/:platform/distribution/:dimension` | GET  | 获取数据分布 | 需要 |
| `/api/tapp/platform/items`                             | POST | 添加数据条目 | 需要 |
| `/api/tapp/platform/items/batch`                       | POST | 批量添加条目 | 需要 |

### AI API (`/api/tapp/ai`)

| 端点                    | 方法 | 说明        | 认证 |
| ----------------------- | ---- | ----------- | ---- |
| `/api/tapp/ai/generate` | POST | AI 文本生成 | 可选 |
| `/api/tapp/ai/analyze`  | POST | AI 数据分析 | 可选 |
| `/api/tapp/ai/chat`     | POST | AI 对话     | 可选 |
| `/api/tapp/ai/image`    | POST | AI 图片生成 | 可选 |

> **AI 图片生成支持的模型**：`flux`, `flux-anime`, `flux-realism`, `flux-3d`（使用 Pollinations 免费服务）

### HTTP Proxy API

| 端点                    | 方法 | 说明          | 认证 |
| ----------------------- | ---- | ------------- | ---- |
| `/api/tapp/fetch/proxy` | POST | HTTP 代理请求 | 可选 |

> **安全限制**：内网地址（localhost, 127.0.0.1, 192.168.x.x, 10.x.x.x 等）被禁止访问

### Data Transform API

| 端点                       | 方法 | 说明         | 认证 |
| -------------------------- | ---- | ------------ | ---- |
| `/api/tapp/data/transform` | POST | 数据处理管道 | 需要 |

### Context API (`/api/tapp/context`)

| 端点                           | 方法 | 说明             | 认证 |
| ------------------------------ | ---- | ---------------- | ---- |
| `/api/tapp/context/app`        | GET  | 获取应用上下文   | 可选 |
| `/api/tapp/context/user`       | GET  | 获取用户上下文   | 可选 |
| `/api/tapp/context/player`     | GET  | 获取播放器上下文 | 可选 |
| `/api/tapp/context/navigation` | GET  | 获取导航上下文   | 可选 |
| `/api/tapp/context/system`     | GET  | 获取系统上下文   | 可选 |

### Report API (`/api/tapp/reports`)

| 端点                                    | 方法   | 说明               | 认证 |
| --------------------------------------- | ------ | ------------------ | ---- |
| `/api/tapp/reports`                     | POST   | 创建报告           | 需要 |
| `/api/tapp/reports/tapp/:tapp_id`       | GET    | 获取 Tapp 报告列表 | 需要 |
| `/api/tapp/reports/:tapp_id/:report_id` | GET    | 获取报告详情       | 需要 |
| `/api/tapp/reports/:tapp_id/:report_id` | PUT    | 更新报告           | 需要 |
| `/api/tapp/reports/:tapp_id/:report_id` | DELETE | 删除报告           | 需要 |

### Media Control API (`/api/tapp/media`)

| 端点                      | 方法 | 说明         | 认证 |
| ------------------------- | ---- | ------------ | ---- |
| `/api/tapp/media/control` | POST | 媒体播放控制 | 可选 |
| `/api/tapp/media/status`  | GET  | 获取播放状态 | 可选 |

> **注意**：实际的媒体控制在前端 TappBridge 中完成，此 API 用于权限验证和日志记录

### Component API (`/api/tapp/components`)

| 端点                                       | 方法   | 说明                        | 认证 |
| ------------------------------------------ | ------ | --------------------------- | ---- |
| `/api/tapp/components/register`            | POST   | 注册组件 (page/theme/agent) | 需要 |
| `/api/tapp/components/:tapp_id`            | GET    | 列出 Tapp 已注册组件        | 需要 |
| `/api/tapp/components/:tapp_id/:type/:id`  | DELETE | 注销组件                    | 需要 |
| `/api/tapp/components/all/:component_type` | GET    | 按类型列出所有组件          | 需要 |

### Shortcut API (`/api/tapp/shortcuts`)

| 端点                                        | 方法   | 说明           | 认证 |
| ------------------------------------------- | ------ | -------------- | ---- |
| `/api/tapp/shortcuts/register`              | POST   | 注册快捷键     | 需要 |
| `/api/tapp/shortcuts`                       | GET    | 列出所有快捷键 | 需要 |
| `/api/tapp/shortcuts/:tapp_id/:shortcut_id` | DELETE | 注销快捷键     | 需要 |

### Event Bus API (`/api/tapp/events`)

| 端点                                      | 方法 | 说明         | 认证 |
| ----------------------------------------- | ---- | ------------ | ---- |
| `/api/tapp/events/publish`                | POST | 发布事件     | 需要 |
| `/api/tapp/events/subscriptions/:tapp_id` | GET  | 获取事件订阅 | 需要 |
| `/api/tapp/events/subscriptions/:tapp_id` | PUT  | 更新事件订阅 | 需要 |

### Metrics & Rate Limit API

| 端点                            | 方法 | 说明                    | 认证 |
| ------------------------------- | ---- | ----------------------- | ---- |
| `/api/tapp/metrics`             | GET  | 获取性能指标 (仅管理员) | 需要 |
| `/api/tapp/metrics/reset`       | POST | 重置性能指标 (仅管理员) | 需要 |
| `/api/tapp/rate-limit/:tapp_id` | GET  | 获取速率限制状态        | 需要 |

### 认证说明

- **需要**：必须携带有效的 JWT Token
- **可选**：未登录用户可访问部分功能，但功能受限
- **公开**：无需认证即可访问

---

## 安全沙箱

Tapp 运行在严格的沙箱环境中，具有以下安全特性：

### Content Security Policy (CSP)

沙箱采用严格的 CSP 策略：

```
default-src 'none';
script-src 'unsafe-inline' 'unsafe-eval';
style-src 'unsafe-inline';
img-src data: blob: https:;
font-src data: https:;
connect-src 'none';
frame-src 'none';
object-src 'none';
media-src 'none';
worker-src 'none';
form-action 'none';
base-uri 'none';
manifest-src 'none';
```

**安全限制说明**：

| 策略                 | 限制内容         | 替代方案                  |
| -------------------- | ---------------- | ------------------------- |
| `connect-src 'none'` | 禁止直接网络请求 | 使用 `Tapp.fetch.proxy()` |
| `frame-src 'none'`   | 禁止嵌套 iframe  | -                         |
| `worker-src 'none'`  | 禁止 Web Worker  | -                         |
| `form-action 'none'` | 禁止表单提交     | 使用 `Tapp.fetch.proxy()` |

### iframe Sandbox 属性

```
allow-scripts allow-same-origin
```

- ✅ 允许执行脚本
- ✅ 允许同源访问（用于 postMessage 通信）
- ❌ 禁止表单提交
- ❌ 禁止弹出窗口
- ❌ 禁止导航顶层窗口
- ❌ 禁止下载
- ❌ 禁止自动播放

### 全局对象保护

沙箱启动时会冻结和禁用危险的全局对象：

```javascript
// 被禁用的 API
window.open(); // → 抛出错误
window.alert(); // → 抛出错误
window.confirm(); // → 抛出错误
window.prompt(); // → 抛出错误
fetch(); // → 返回被拒绝的 Promise（提示使用 Tapp.platform API）
XMLHttpRequest; // → 构造函数抛出错误
WebSocket; // → 构造函数抛出错误
EventSource; // → 构造函数抛出错误

// 被冻结的对象
window.parent; // → 只保留 postMessage 方法
window.top; // → 指向 window 自身
window.opener; // → null
localStorage; // → 空操作对象
sessionStorage; // → 空操作对象
indexedDB; // → null
```

---

## 自适应尺寸

Tapp 沙箱自动注入自适应尺寸系统，开发者**无需任何配置**即可使用。

### 核心原理

1. **父窗口监听容器尺寸变化**（通过 ResizeObserver）
2. **自动计算缩放比例**（scale, fontScale）
3. **通过 postMessage 发送到 iframe**
4. **iframe 内自动更新 CSS 变量和状态类**

### CSS 变量

沙箱自动注入以下 CSS 变量，Tapp 代码可直接使用：

#### 主题变量

| 变量              | 说明             | 亮色模式                | 暗色模式                 |
| ----------------- | ---------------- | ----------------------- | ------------------------ |
| `--tapp-primary`  | 主色调（壁纸色） | 动态                    | 动态                     |
| `--tapp-text`     | 主文字色         | `#1f2937`               | `#f3f4f6`                |
| `--tapp-subtext`  | 次要文字色       | `#6b7280`               | `#9ca3af`                |
| `--tapp-bg`       | 背景色           | `#f8fafc`               | `#0a0a0a`                |
| `--tapp-card-bg`  | 卡片背景色       | `rgba(255,255,255,0.7)` | `rgba(255,255,255,0.03)` |
| `--tapp-border`   | 边框色           | `rgba(0,0,0,0.06)`      | `rgba(255,255,255,0.08)` |
| `--tapp-input-bg` | 输入框背景色     | `rgba(255,255,255,0.9)` | `rgba(255,255,255,0.05)` |
| `--tapp-shadow`   | 阴影色           | `rgba(0,0,0,0.08)`      | `rgba(0,0,0,0.4)`        |

> **注意**：主题变量会在主题切换时自动更新，Tapp 无需手动处理。

#### 自适应尺寸变量

| 变量                      | 说明                       | 示例值  |
| ------------------------- | -------------------------- | ------- |
| `--tapp-container-width`  | 容器宽度                   | `200px` |
| `--tapp-container-height` | 容器高度                   | `200px` |
| `--tapp-scale`            | 整体缩放比例（0.1-2）      | `1`     |
| `--tapp-font-scale`       | 字体缩放比例（0.6-1.2）    | `1`     |
| `--tapp-base-font-size`   | 基础字号（会自动缩放）     | `14px`  |
| `--tapp-is-compact`       | 是否紧凑模式（尺寸 < 150） | `0`     |
| `--tapp-is-mini`          | 是否迷你模式（尺寸 < 100） | `0`     |
| `--tapp-spacing-unit`     | 间距单位（自动缩放）       | `4px`   |
| `--tapp-radius-unit`      | 圆角单位（自动缩放）       | `4px`   |

### 使用示例

```javascript
// 使用 CSS 变量实现自适应字体
var title = document.createElement("h1");
title.style.fontSize = "calc(24px * var(--tapp-scale, 1))";
title.textContent = "Hello";

// 使用 CSS 变量实现自适应间距
var card = document.createElement("div");
card.style.padding = "calc(var(--tapp-spacing-unit) * 4)";
card.style.borderRadius = "calc(var(--tapp-radius-unit) * 3)";
```

### 样式系统概述

> **重要说明**：Widget 模式和 Page 模式对样式的支持有所不同。

| 模式   | 完整 Tailwind 类 | `tapp-*` 工具类 | 内联 style | CSS 变量 |
| ------ | ---------------- | --------------- | ---------- | -------- |
| Widget | ✅ 完全支持      | ✅ 支持         | ✅ 支持    | ✅ 支持  |
| Page   | ❌ 不可用        | ✅ 支持         | ✅ 推荐    | ✅ 支持  |

#### 原因说明

- **Widget 模式**：渲染在主应用的 iframe 中，**继承主应用的 Tailwind 样式表**，因此可以直接使用完整的 Tailwind 类（如 `flex`, `p-4`, `text-gray-700`, `dark:bg-white/5` 等）。
- **Page 模式**：运行在独立的沙箱 iframe 中，**没有预加载 Tailwind**，因此推荐使用内联 `style` 或沙箱内置的 `tapp-*` 工具类。

#### 推荐的样式方式

**Widget 模式（推荐使用 Tailwind）**：

```javascript
container.innerHTML = `
  <div class="relative h-full w-full rounded-xl overflow-hidden glass">
    <div class="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent"></div>
    <div class="relative z-10 h-full flex flex-col p-3">
      <h3 class="text-xs font-semibold text-gray-700 dark:text-gray-300">标题</h3>
    </div>
  </div>
`;
```

**Page 模式（推荐使用内联样式 + tapp-\* 类）**：

```javascript
var card = document.createElement("div");
card.style.cssText = `
  background: ${isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.7)"};
  backdrop-filter: blur(12px);
  border-radius: 16px;
  padding: calc(24px * var(--tapp-scale, 1));
`;
card.className = "tapp-transition"; // 使用内置工具类
```

---

### 内置响应式工具类（`tapp-*` 前缀）

沙箱预置了带 `tapp-` 前缀的响应式工具类，**两种模式都可用**。这些类会根据容器尺寸自动缩放：

#### 文字尺寸

```html
<span class="tapp-text-xs">12px × fontScale</span>
<span class="tapp-text-sm">14px × fontScale</span>
<span class="tapp-text-base">16px × fontScale</span>
<span class="tapp-text-lg">18px × fontScale</span>
<span class="tapp-text-xl">20px × fontScale</span>
<span class="tapp-text-2xl">24px × fontScale</span>
<span class="tapp-text-3xl">30px × fontScale</span>
```

#### 间距

```html
<div class="tapp-p-1">padding: 4px × scale</div>
<div class="tapp-p-2">padding: 8px × scale</div>
<div class="tapp-p-3">padding: 12px × scale</div>
<div class="tapp-p-4">padding: 16px × scale</div>
<div class="tapp-px-2">padding-inline: 8px × scale</div>
<div class="tapp-py-2">padding-block: 8px × scale</div>
<div class="tapp-gap-2">gap: 8px × scale</div>
```

#### 圆角

```html
<div class="tapp-rounded">border-radius: 4px × scale</div>
<div class="tapp-rounded-lg">border-radius: 8px × scale</div>
<div class="tapp-rounded-xl">border-radius: 12px × scale</div>
<div class="tapp-rounded-full">border-radius: 9999px</div>
```

#### 布局

```html
<div class="tapp-flex">display: flex</div>
<div class="tapp-flex-col">flex-direction: column</div>
<div class="tapp-flex-center">居中对齐</div>
<div class="tapp-flex-between">两端对齐</div>
<div class="tapp-grid">display: grid</div>
<div class="tapp-absolute-fill">position: absolute; inset: 0</div>
```

#### 动画

```html
<div class="tapp-transition">平滑过渡（GPU 加速）</div>
<div class="tapp-animate-fade-in">淡入动画</div>
<div class="tapp-animate-scale-in">缩放淡入</div>
```

### 内置组件类（`tapp-*` 前缀）

沙箱预置了常用 UI 组件样式，可直接使用：

#### 容器组件

```html
<!-- 玻璃效果容器 -->
<div class="tapp-container">基础容器</div>
<div class="tapp-container tapp-container-glass">玻璃效果容器</div>
```

#### 浮动条

```html
<!-- 顶部浮动条 -->
<div class="tapp-float-bar tapp-float-bar-top">顶部工具栏</div>
<!-- 底部浮动条 -->
<div class="tapp-float-bar tapp-float-bar-bottom">底部输入栏</div>
```

#### 按钮

```html
<button class="tapp-btn tapp-btn-primary">主要按钮</button>
<button class="tapp-btn tapp-btn-icon">🔍</button>
<button class="tapp-btn tapp-btn-ghost">幽灵按钮</button>
```

#### 输入框

```html
<input class="tapp-input" placeholder="请输入..." />
```

#### 消息气泡

```html
<div class="tapp-msg-area tapp-scrollbar">
  <div class="tapp-bubble-row tapp-bubble-row-user">
    <div class="tapp-bubble tapp-bubble-user">用户消息</div>
  </div>
  <div class="tapp-bubble-row">
    <div class="tapp-bubble tapp-bubble-ai">AI 回复</div>
  </div>
</div>
```

#### 打字指示器

```html
<div class="tapp-typing">
  <span class="tapp-typing-dot"></span>
  <span class="tapp-typing-dot"></span>
  <span class="tapp-typing-dot"></span>
</div>
```

#### 图标容器

```html
<div class="tapp-icon tapp-icon-sm tapp-icon-primary">🚀</div>
<div class="tapp-icon tapp-icon-md">📊</div>
<div class="tapp-icon tapp-icon-lg">🎮</div>
```

#### 文本样式

```html
<span class="tapp-text">主文本</span>
<span class="tapp-text-sub">次要文本</span>
<span class="tapp-text-primary">主色调文本</span>
<span class="tapp-text-error">错误文本</span>
<span class="tapp-text-sm">小号文本</span>
<span class="tapp-text-base">正常文本</span>
<span class="tapp-text-lg">大号文本</span>
```

#### 动画类

| 类名                          | 效果             |
| ----------------------------- | ---------------- |
| `tapp-animate-fade-in`        | 淡入 (0.2s)      |
| `tapp-animate-fade-in-up`     | 向上淡入 (0.25s) |
| `tapp-animate-fade-in-down`   | 向下淡入 (0.25s) |
| `tapp-animate-slide-in-left`  | 从左滑入 (0.25s) |
| `tapp-animate-slide-in-right` | 从右滑入 (0.25s) |
| `tapp-animate-scale-in`       | 缩放淡入 (0.2s)  |
| `tapp-animate-spin`           | 旋转 (无限)      |
| `tapp-animate-pulse`          | 脉冲闪烁 (无限)  |

#### 其他工具类

```html
<div class="tapp-scrollbar">自定义滚动条样式</div>
<div class="tapp-empty">空状态/欢迎提示</div>
<span class="tapp-cursor">|</span>
<!-- 打字光标 -->
```

### 条件显示/隐藏

根据尺寸模式控制元素显示：

```html
<!-- 紧凑模式(< 150px)下隐藏 -->
<div class="tapp-hide-compact">详细描述文本</div>

<!-- 迷你模式(< 100px)下隐藏 -->
<div class="tapp-hide-mini">次要内容</div>
```

### 容器查询

支持 CSS Container Queries：

```html
<!-- 容器宽度 < 150px 时隐藏 -->
<div class="tapp-cq-hide-sm">只在较大尺寸显示</div>

<!-- 容器宽度 < 100px 时隐藏 -->
<div class="tapp-cq-hide-xs">只在中等尺寸以上显示</div>

<!-- 容器宽度 >= 200px 时显示 -->
<div class="tapp-cq-show-md" style="display:none">中尺寸显示</div>

<!-- 容器宽度 >= 300px 时显示 -->
<div class="tapp-cq-show-lg" style="display:none">大尺寸显示</div>
```

### 状态类

body 会自动添加状态类：

- `.tapp-compact` - 紧凑模式（尺寸 < 150px）
- `.tapp-mini` - 迷你模式（尺寸 < 100px）

```css
/* 自定义紧凑模式样式 */
.tapp-compact .my-card {
  padding: 8px;
  font-size: 12px;
}

/* 迷你模式下只显示图标 */
.tapp-mini .my-card-text {
  display: none;
}
```

### 监听尺寸变化事件

通过 `tapp:resize` 事件获取详细尺寸信息：

```javascript
window.addEventListener("tapp:resize", function (e) {
  var dims = e.detail;
  console.log("宽度:", dims.width);
  console.log("高度:", dims.height);
  console.log("缩放比例:", dims.scale);
  console.log("字体缩放:", dims.fontScale);
  console.log("紧凑模式:", dims.isCompact);
  console.log("迷你模式:", dims.isMini);

  // 根据尺寸动态调整内容
  if (dims.isCompact) {
    // 显示简化版 UI
  }
});
```

### 全局尺寸对象

也可以直接访问全局尺寸对象：

```javascript
// 获取当前尺寸
var dims = window._TAPP_DIMENSIONS;
console.log(dims.width, dims.height, dims.scale);
```

### 性能优化

自适应系统已内置多项性能优化：

- ✅ 复用全局 ResizeObserver，避免重复创建
- ✅ CSS 变量缓存，仅更新变化的值
- ✅ RAF 节流事件派发，避免高频更新
- ✅ 消息去重，相同尺寸不重复发送
- ✅ 页面不可见时跳过更新
- ✅ CSS 层叠 (@layer) 控制优先级
- ✅ GPU 加速动画 (transform, opacity)

---

## 页面分层架构

Tapp 页面模式下，框架自动提供**背景层**和**内容层**的分层结构，用于处理全屏模式下的安全区域（避免与控制条/控制岛重叠）。

### 设计理念

在全屏模式下，页面顶部有控制条（左上）和信息控制岛（右上）。为了让 Tapp 内容不与这些控件重叠，框架提供了分层架构：

- **背景层**：填满整个屏幕，用于背景色、装饰效果等
- **内容层**：自动应用安全区域 padding，用于主要内容

这样背景可以延伸到屏幕边缘，而内容会自动避开控制区域，实现自然的视觉衔接。

### DOM 结构

框架自动在 iframe 中创建以下结构：

```html
<div id="tapp-root">
  <!-- 背景层：填满全屏，无 padding -->
  <div id="tapp-background"></div>
  <!-- 内容层：自动应用安全区域 padding -->
  <div id="tapp-content"></div>
</div>
```

### CSS 特性

| 容器               | z-index | padding  | 用途               |
| ------------------ | ------- | -------- | ------------------ |
| `#tapp-background` | 0       | 无       | 背景、装饰效果     |
| `#tapp-content`    | 1       | 安全区域 | 主要内容、交互元素 |

安全区域的 padding 值由框架根据全屏模式自动设置：

| 位置   | 值   | 说明                       |
| ------ | ---- | -------------------------- |
| top    | 72px | 避开左上控制条和右上信息岛 |
| left   | 16px | 左侧边距                   |
| right  | 16px | 右侧边距                   |
| bottom | 0    | 底部无需额外间距           |

### 样式规范（Page 模式）

Page 模式运行在独立沙箱中，**没有预加载 Tailwind**，因此需要使用以下方式编写样式：

1. **内联 `style` 属性**（推荐）：直接在元素上设置样式
2. **`tapp-*` 工具类**：沙箱内置的响应式工具类
3. **CSS 变量**：如 `var(--tapp-scale)`, `var(--tapp-font-scale)` 等

> ⚠️ **不要使用**：Tailwind 类（如 `flex`, `p-4`, `dark:bg-*`）在 Page 模式下不可用。

### 使用方式

开发者只需操作两个容器即可，无需手动处理安全区域：

```javascript
// 获取框架提供的分层容器
var bgLayer = document.getElementById("tapp-background");
var contentLayer = document.getElementById("tapp-content");

// 背景层：设置背景色和装饰效果
bgLayer.style.background = isDark ? "#0a0a0a" : "#f8fafc";

// 添加装饰光晕（填满全屏）
var glow = document.createElement("div");
glow.style.cssText = `
  position: absolute;
  right: -10%;
  top: -10%;
  width: 50%;
  height: 50%;
  border-radius: 50%;
  background: radial-gradient(circle, #10B98120, transparent 70%);
  filter: blur(60px);
`;
bgLayer.appendChild(glow);

// 内容层：放置主要内容（自动避开控制条）
var main = document.createElement("div");
main.style.cssText = `
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
`;
main.innerHTML = "<h1>Hello World</h1><p>内容自动避开顶部控制区域</p>";
contentLayer.appendChild(main);
```

### 完整示例

以下是使用分层架构的完整 Tapp 渲染函数：

```javascript
// 页面渲染函数
function renderPage(locale, isDarkTheme, primaryColor) {
  var isDark = isDarkTheme !== false;
  var themeColor = primaryColor || "#10B981";

  // 获取框架提供的分层容器
  var bgLayer = document.getElementById("tapp-background");
  var contentLayer = document.getElementById("tapp-content");

  // 清空容器
  if (bgLayer) bgLayer.innerHTML = "";
  if (contentLayer) contentLayer.innerHTML = "";

  // ========== 背景层：装饰效果（填满全屏） ==========
  if (bgLayer) {
    bgLayer.style.background = isDark ? "#0a0a0a" : "#f8fafc";

    // 右上角光晕
    var glow1 = document.createElement("div");
    glow1.style.cssText = `
      position: absolute;
      right: -10%;
      top: -10%;
      width: 50%;
      height: 50%;
      border-radius: 50%;
      background: radial-gradient(circle, ${themeColor}20, transparent 70%);
      filter: blur(60px);
    `;

    // 左下角光晕
    var glow2 = document.createElement("div");
    glow2.style.cssText = `
      position: absolute;
      left: -5%;
      bottom: -5%;
      width: 40%;
      height: 40%;
      border-radius: 50%;
      background: radial-gradient(circle, ${themeColor}15, transparent 70%);
      filter: blur(40px);
    `;

    bgLayer.appendChild(glow1);
    bgLayer.appendChild(glow2);
  }

  // ========== 内容层：主要内容（自动避开安全区域） ==========
  if (!contentLayer) return;

  contentLayer.style.fontFamily = "system-ui, sans-serif";
  contentLayer.style.color = isDark ? "#f9fafb" : "#1f2937";

  // 主容器
  var main = document.createElement("div");
  main.style.cssText = `
    max-width: 900px;
    margin: 0 auto;
    padding: calc(24px * var(--tapp-scale, 1));
  `;

  // 标题卡片
  var header = document.createElement("div");
  header.style.cssText = `
    background: ${isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.7)"};
    backdrop-filter: blur(12px);
    border-radius: 16px;
    border: 1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"};
    padding: 24px;
    margin-bottom: 24px;
  `;
  header.innerHTML = '<h1 style="margin:0;font-size:32px;">Hello World</h1>';

  main.appendChild(header);
  contentLayer.appendChild(main);
}

// 生命周期
Tapp.lifecycle.onReady(async function () {
  var locale = await Tapp.ui.getLocale();
  var theme = await Tapp.ui.getTheme();
  var primaryColor = await Tapp.ui.getPrimaryColor();

  // 渲染页面
  renderPage(locale, theme === "dark", primaryColor);

  // 监听变化，自动重新渲染
  Tapp.ui.onThemeChange(function (newTheme) {
    renderPage(locale, newTheme === "dark", primaryColor);
  });

  Tapp.ui.onPrimaryColorChange(function (newColor) {
    renderPage(locale, theme === "dark", newColor);
  });
});
```

### Widget 模式

在 Widget 模式下，分层架构仍然存在，但不会应用安全区域 padding（Widget 不需要避开控制条）：

```css
.tapp-mode-widget #tapp-background,
.tapp-mode-widget #tapp-content {
  padding: 0;
}
```

### 安全区域 CSS 变量

框架还提供了安全区域的 CSS 变量，可用于高级自定义：

| 变量                       | 说明         | 全屏模式默认值 |
| -------------------------- | ------------ | -------------- |
| `--tapp-safe-inset-top`    | 顶部安全距离 | `72px`         |
| `--tapp-safe-inset-right`  | 右侧安全距离 | `16px`         |
| `--tapp-safe-inset-bottom` | 底部安全距离 | `0px`          |
| `--tapp-safe-inset-left`   | 左侧安全距离 | `16px`         |

这些变量会随着容器模式自动更新（全屏/非全屏/Widget）。

### 最佳实践

1. **背景与内容分离**：装饰性元素放背景层，交互性内容放内容层
2. **使用 fixed 定位谨慎**：如果在内容层使用 `position: fixed`，元素会脱离安全区域
3. **避免直接操作 #tapp-root**：应该操作 `#tapp-background` 和 `#tapp-content`
4. **清空容器时保持结构**：清空内容时使用 `innerHTML = ''`，不要删除容器本身

---

## 国际化 (i18n)

Tapp 通过 `Tapp.ui.getLocale()` 获取**控制面板的语言设置**，实现多语言支持。

> **注意**：语言由控制面板统一管理，Tapp 不会直接检测浏览器语言 (`navigator.language`)。

### 获取当前语言

```javascript
Tapp.lifecycle.onReady(async function () {
  // 获取控制面板的语言设置
  var locale = await Tapp.ui.getLocale();
  console.log("控制面板语言:", locale);
  // 返回: 'zh-CN', 'en-US', 'ja-JP' 等
});
```

### 翻译表模式

推荐在 Core 代码中定义翻译表：

```javascript
// 翻译表
var i18n = {
  "zh-CN": {
    title: "我的应用",
    greeting: "你好，世界！",
    buttons: {
      submit: "提交",
      cancel: "取消",
    },
  },
  "en-US": {
    title: "My App",
    greeting: "Hello, World!",
    buttons: {
      submit: "Submit",
      cancel: "Cancel",
    },
  },
};

// 当前语言
var currentLocale = "zh-CN";

// 获取翻译
function t(key) {
  var keys = key.split(".");
  var value = i18n[currentLocale] || i18n["zh-CN"];
  for (var i = 0; i < keys.length; i++) {
    value = value[keys[i]];
    if (!value) return key;
  }
  return value;
}

// 使用
var title = t("title"); // "我的应用" 或 "My App"
var submitBtn = t("buttons.submit"); // "提交" 或 "Submit"
```

### 动态切换语言

```javascript
Tapp.lifecycle.onReady(async function () {
  // 获取控制面板语言
  var locale = await Tapp.ui.getLocale();
  currentLocale = normalizeLocale(locale);

  // 渲染页面
  renderPage();

  // 监听语言变化，自动重新渲染
  Tapp.ui.onLocaleChange(function (newLocale) {
    console.log("语言变化:", newLocale);
    currentLocale = normalizeLocale(newLocale);
    renderPage();
  });
});

// 规范化语言代码
function normalizeLocale(locale) {
  if (!locale) return "zh-CN";
  var l = locale.toLowerCase();
  if (l.startsWith("zh")) return "zh-CN";
  if (l.startsWith("en")) return "en-US";
  if (l.startsWith("ja")) return "ja-JP";
  return "zh-CN";
}

function renderPage() {
  document.querySelector("h1").textContent = t("title");
  document.querySelector("#greeting").textContent = t("greeting");
}
```

### 监听语言变化

当用户在控制面板切换语言时，Tapp 会收到 `localeChange` 事件：

```javascript
// 监听语言变化
Tapp.ui.onLocaleChange(function (newLocale) {
  console.log("新语言:", newLocale); // 'zh-CN', 'en-US', 'ja-JP' 等
  // 重新渲染页面
  rerender(newLocale);
});
```

### 根据语言选择默认值

```javascript
Tapp.lifecycle.onReady(async function () {
  var locale = await Tapp.ui.getLocale();

  // 从设置获取用户自定义值，否则根据语言选择默认值
  var greeting = await Tapp.settings.get("greeting");
  if (!greeting) {
    greeting = locale.startsWith("zh")
      ? "欢迎使用 Tapp 系统 🎉"
      : "Welcome to Tapp System 🎉";
  }

  showNotification(greeting);
});
```

### 日期格式化

```javascript
function formatDate(date, locale) {
  return new Date(date).toLocaleDateString(locale);
}

// 使用
var locale = await Tapp.ui.getLocale();
var dateStr = formatDate(new Date(), locale);
// zh-CN: "2024/1/15"
// en-US: "1/15/2024"
```

---

## 小组件开发

### 沙箱限制

以下 API 在 Tapp 沙箱中被禁用，必须使用对应的 Tapp API：

- `localStorage`/`sessionStorage` → 使用 `Tapp.storage`
- `fetch`/`XMLHttpRequest` → 使用 `Tapp.fetch`
- `window.open`/`alert`/`confirm`/`prompt` → 使用 `Tapp.ui`

---

### Widget SDK vs Full SDK

> ⚠️ **重要**：Widget 模式使用**简化版 SDK**，仅包含以下 API。需要完整功能请使用 Page 模式。

| 分类          | Widget SDK                                                               | Full SDK (Page 模式)                            |
| ------------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| **存储**      | ✅ `storage` (get/set/remove/keys/clear)                                 | ✅ 相同                                         |
| **设置**      | ✅ `settings` (get/set/getAll)                                           | ✅ 相同                                         |
| **UI**        | ✅ `ui` (getTheme/getPrimaryColor/getLocale/showNotification + 事件监听) | ✅ 完整 UI API (含 showModal/confirm/prompt 等) |
| **DOM**       | ✅ `dom` (setText/setHtml/addClass/removeClass/toggleClass)              | ✅ 完整 DOM API (含 renderList 等)              |
| **生命周期**  | ✅ `lifecycle` (onReady/onDestroy/onPause/onResume)                      | ✅ 完整 lifecycle                               |
| **AI**        | ⚠️ 仅 `ai.chat`                                                          | ✅ 完整 AI API (chat/generate/analyze/image)    |
| **平台数据**  | ✅ `platform` (listEnabled/getData/getStats/getDistribution)             | ✅ 完整 platform (含 addItem/addItems 等)       |
| **上下文**    | ❌ 不可用                                                                | ✅ `context` (getApp/getUser/getPlayer 等)      |
| **HTTP 代理** | ❌ 不可用                                                                | ✅ `fetch` (request)                            |
| **数据处理**  | ❌ 不可用                                                                | ✅ `data` (transform)                           |
| **媒体控制**  | ❌ 不可用                                                                | ✅ `media` (control/status)                     |
| **报告**      | ✅ `report` (listReports/getReport/getPlatformReport/list/get)           | ✅ 完整 report (含 create/update/delete)        |
| **用户角色**  | ❌ 不可用                                                                | ✅ `user` (getRole/isAdmin 等)                  |
| **后台需求**  | ✅ `background` (require/release/list/has)                               | ✅ 相同                                         |
| **动态内容**  | ❌ 不可用                                                                | ✅ `dynamicContent` (set/update/get/remove)     |
| **动画**      | ✅ `animation` (getLevel/shouldAnimate/getConfig/getStaggerDelay)        | ✅ 完整 animation (含 onLevelChange)            |
| **组件注册**  | ❌ 不可用                                                                | ✅ `component` (register/unregister/list)       |
| **快捷键**    | ❌ 不可用                                                                | ✅ `shortcut` (register/unregister/list)        |
| **事件总线**  | ❌ 不可用                                                                | ✅ `event` (publish/subscribe/getSubscriptions) |

**设计原因**：Widget 运行在首页卡片中，需要轻量快速，因此仅提供必要的展示和基础交互功能。复杂功能（如数据获取、AI 分析）应在 Page 中完成，Widget 仅用于展示结果。

---

### 架构概述

小组件系统采用**预注册 + 按需渲染**模式：

1. **预注册**：Tapp 安装时，从 `manifest.widgets` 自动注册所有 Widget
2. **按需渲染**：只有当 Tapp 运行时，Widget 才真正渲染
3. **代码分离**：Widget 渲染代码与 Page 代码分离，避免冲突

### 基础结构

使用分离模式时，Widget 代码应放在 `WIDGET_CODE` 中：

```javascript
// WIDGET_CODE - 小组件渲染代码
Tapp.widgets["my-widget"] = {
  render: function (container, props) {
    // 渲染逻辑
  },
};
```

> **注意**：Widget 模式下不会执行 `Tapp.lifecycle.onReady()`，因此不要在 Widget 代码中依赖生命周期回调。

### Props 参数

渲染函数接收的 `props` 对象包含：

| 属性         | 类型    | 说明                         |
| ------------ | ------- | ---------------------------- |
| `size`       | string  | 当前尺寸 ('1x1', '2x2' 等)   |
| `config`     | object  | 用户配置                     |
| `isEditMode` | boolean | 是否处于编辑模式             |
| `isPreview`  | boolean | 是否预览模式                 |
| `theme`      | string  | 当前主题 ('light' \| 'dark') |
| `scale`      | number  | 缩放比例（来自自适应系统）   |
| `fontScale`  | number  | 字体缩放（来自自适应系统）   |
| `locale`     | string  | 用户语言（用于 i18n）        |

### 尺寸规格

| 尺寸  | 像素（默认） | 适用场景         |
| ----- | ------------ | ---------------- |
| `1x1` | 100×100      | 图标、状态指示器 |
| `2x1` | 200×100      | 简单统计、标题   |
| `2x2` | 200×200      | 标准小组件       |
| `4x2` | 400×200      | 宽幅展示、图表   |
| `4x4` | 400×400      | 大型展示         |

---

### 样式规范（Widget 模式）

> 以下样式规范基于 Myriad 内置小组件的实际实现，遵循这些规范可确保 Tapp 小组件与系统风格一致。
>
> ⚠️ **注意**：本节使用的 Tailwind 类（如 `glass`, `rounded-xl`, `dark:` 前缀等）**仅在 Widget 模式下可用**。Page 模式请参考「页面分层架构」章节使用内联样式。

#### 核心样式特征

Myriad 小组件采用**毛玻璃（Glass）风格**设计，主要特征（使用 Tailwind 类）：

| 特征       | 实现方式                                           |
| ---------- | -------------------------------------------------- |
| 毛玻璃背景 | `glass` 类（自动添加 backdrop-blur + 半透明背景）  |
| 圆角容器   | `rounded-xl`（12px 圆角）                          |
| 渐变装饰   | `bg-gradient-to-br from-*/to-*` 叠加层             |
| 暗色适配   | 使用 `dark:` 前缀的 Tailwind 类                    |
| 相对定位   | `relative` + `overflow-hidden` 容器                |
| 编辑指示   | `border-2 border-dashed border-*-400` 编辑模式边框 |

#### 基础容器模板

```javascript
Tapp.widgets["my-widget"] = {
  render: function (container, props) {
    const isDark = props.theme === "dark";
    const scale = props.scale || 1;
    const fontScale = props.fontScale || 1;

    container.innerHTML = `
      <div class="relative h-full w-full rounded-xl overflow-hidden glass">
        <!-- 背景装饰层 -->
        <div class="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent"></div>
        
        <!-- 主内容区 -->
        <div class="relative z-10 h-full flex flex-col p-3" 
             style="padding: ${12 * scale}px;">
          <!-- 标题区 -->
          <div class="mb-2">
            <h3 class="text-xs font-semibold text-gray-700 dark:text-gray-300"
                style="font-size: ${12 * fontScale}px;">
              小组件标题
            </h3>
          </div>
          
          <!-- 内容区 -->
          <div class="flex-1">
            <!-- 你的内容 -->
          </div>
        </div>
        
        ${
          props.isEditMode
            ? `
          <div class="absolute inset-0 border-2 border-dashed border-blue-400 rounded-xl pointer-events-none"></div>
        `
            : ""
        }
      </div>
    `;
  },
};
```

#### 颜色系统

使用 Tailwind 的透明度语法实现层次感：

```css
/* 亮色模式背景 */
bg-white/60                    /* 60% 白色，用于卡片背景 */
bg-white/40                    /* 40% 白色，用于悬停效果 */
bg-gray-50/50                  /* 50% 灰色，用于次要区域 */

/* 暗色模式背景 */
dark:bg-white/[0.03]           /* 3% 白色，暗色卡片背景 */
dark:bg-white/[0.02]           /* 2% 白色，暗色次要区域 */
dark:bg-white/5                /* 5% 白色，暗色悬停效果 */

/* 文字颜色 */
text-gray-800 dark:text-gray-100     /* 主文本 */
text-gray-700 dark:text-gray-200     /* 标题 */
text-gray-600 dark:text-gray-400     /* 次要文本 */
text-gray-500 dark:text-gray-400     /* 辅助文本 */

/* 强调色（统一使用 Indigo） */
text-indigo-600 dark:text-indigo-400
bg-indigo-500/10
border-indigo-400
```

#### 渐变装饰层

每个小组件都应该有一个渐变装饰层来增加视觉层次：

```javascript
// 通用渐变（紫色调）
`<div class="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent"></div>` // 统计类组件（灰色调）
`<div class="absolute inset-0 bg-gradient-to-br from-gray-50/50 to-transparent dark:from-white/[0.02] dark:to-transparent"></div>` // 平台卡片（带品牌色）
`<div class="absolute inset-0 bg-gradient-to-br ${platform.color} opacity-90"></div>` // 配合装饰圆形
`<div class="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-white/10 blur-2xl"></div>``<div class="absolute -left-10 -bottom-10 w-32 h-32 rounded-full bg-black/10 blur-xl"></div>`;
```

#### 字体规范

```javascript
// 大数字显示（统计数据）
`<span class="text-3xl font-black text-gray-800 dark:text-gray-100 leading-none"
       style="font-size: ${30 * fontScale}px;">
  ${value}
</span>` // 标题（小组件顶部）
`<h3 class="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider"
     style="font-size: ${12 * fontScale}px;">
  标题
</h3>` // 次要文本
`<span class="text-sm text-gray-600 dark:text-gray-400"
       style="font-size: ${14 * fontScale}px;">
  描述文字
</span>` // 辅助文本（时间、标签等）
`<span class="text-[10px] text-gray-500 dark:text-gray-400">
  3小时前
</span>`;
```

#### 间距与布局

```javascript
// 外层容器内边距（随 scale 缩放）
`<div class="p-3" style="padding: ${
  12 * scale
}px;">` // 标题与内容间距
`<div class="mb-2" style="margin-bottom: ${
  8 * scale
}px;">` // Flex 布局
`<div class="flex items-center gap-2" style="gap: ${
  8 * scale
}px;">` // Grid 布局（如统计卡片）
`<div class="grid grid-cols-5 gap-1.5" style="gap: ${6 * scale}px;">`;
```

#### 内部卡片样式

小组件内部的子卡片使用更轻的背景：

```javascript
// 统计项卡片
`<div class="flex flex-col items-center justify-center 
             bg-white/60 dark:bg-white/[0.03] 
             backdrop-blur-sm rounded-md relative overflow-hidden"
     style="padding: ${6 * scale}px;">
  <!-- 装饰光点 -->
  <div class="absolute top-0 right-0 rounded-full blur-xl opacity-20 w-6 h-6"
       style="background: ${themeColor}; width: ${24 * scale}px; height: ${
  24 * scale
}px;"></div>
  <!-- 内容 -->
</div>` // 列表项卡片（可悬停）
`<div class="flex items-start gap-2 p-2 rounded-md 
             bg-white/40 dark:bg-white/[0.02] 
             hover:bg-white/60 dark:hover:bg-white/[0.04] 
             transition-colors cursor-pointer">
  <!-- 内容 -->
</div>`;
```

#### 图标规范

```javascript
// SVG 图标尺寸
`<svg class="w-4 h-4" style="width: ${16 * scale}px; height: ${16 * scale}px;"
     fill="currentColor" viewBox="0 0 24 24">
  <!-- path -->
</svg>` // 图标颜色
`<div class="text-gray-600 dark:text-gray-400">` // 默认
`<div class="text-gray-700 dark:text-white/60">` // Emoji 图标（带阴影） // 强调
`<span class="text-3xl drop-shadow-md">${weatherData.icon}</span>`;
```

#### 编辑模式指示器

每个小组件必须在编辑模式下显示边框：

```javascript
`${
  props.isEditMode
    ? `
  <div class="absolute inset-0 border-2 border-dashed border-blue-400 rounded-xl pointer-events-none"></div>
`
    : ""
}` // 不同组件可以使用不同颜色
`border-violet-400` // 活动类组件
`border-white/50`; // 深色背景组件
```

#### 加载与空状态

```javascript
// 加载状态
`<div class="flex items-center justify-center h-full">
  <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
</div>` // 空状态
`<div class="flex flex-col items-center justify-center h-full text-center">
  <svg class="w-8 h-8 text-gray-300 dark:text-gray-600 mb-2" 
       fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <!-- icon path -->
  </svg>
  <p class="text-[10px] text-gray-500 dark:text-gray-400">暂无数据</p>
</div>` // 加载中文字
`<div class="text-xs text-gray-500 dark:text-gray-400">加载中...</div>`;
```

#### 动画效果

使用 CSS transition 实现平滑过渡：

```javascript
// 悬停过渡
`transition-colors` // 颜色过渡
`transition-all duration-300` // 初始动画（如果需要，可用 CSS keyframes） // 所有属性过渡
`@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in { animation: fadeIn 0.3s ease-out; }`;
```

#### 滚动区域

当内容可能溢出时，使用自定义滚动条：

```javascript
`<div class="flex-1 overflow-y-auto pr-1 
             scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
  <!-- 可滚动内容 -->
</div>`;
```

#### 响应式设计

根据 `scale` 和 `fontScale` 动态调整：

```javascript
Tapp.widgets["responsive-widget"] = {
  render: function (container, props) {
    const scale = props.scale || 1;
    const fontScale = props.fontScale || 1;
    const isCompact = scale < 0.8; // 小尺寸模式

    container.innerHTML = `
      <div class="relative h-full w-full rounded-xl overflow-hidden glass">
        <div class="relative z-10 h-full flex flex-col" 
             style="padding: ${12 * scale}px;">
          
          <!-- 核心数据始终显示 -->
          <div class="text-center">
            <span class="font-black text-gray-800 dark:text-gray-100"
                  style="font-size: ${24 * fontScale}px;">
              42
            </span>
          </div>
          
          <!-- 紧凑模式隐藏次要信息 -->
          ${
            !isCompact
              ? `
            <div class="mt-2 text-gray-600 dark:text-gray-400"
                 style="font-size: ${12 * fontScale}px;">
              详细描述信息
            </div>
          `
              : ""
          }
          
        </div>
      </div>
    `;
  },
};
```

### 安全渲染（防 XSS）

**❌ 错误示例**：

```javascript
// 危险！直接使用用户数据
container.innerHTML = `<div>${userData.name}</div>`;
```

**✅ 正确示例**：

```javascript
// 使用 DOM 安全 API
Tapp.widgets["safe-widget"] = {
  render: function (container, props) {
    container.innerHTML = "";

    const div = Tapp.dom.createElement("div", {
      className: "widget-content",
    });

    // 安全设置文本
    const title = document.createElement("h3");
    Tapp.dom.setText(title, userData.name);
    div.appendChild(title);

    // 安全渲染列表
    const list = document.createElement("ul");
    Tapp.dom.renderList(list, items, (item) => {
      return Tapp.dom.createElement("li", {
        text: item.title,
        attributes: { "data-id": item.id },
      });
    });
    div.appendChild(list);

    container.appendChild(div);
  },
};
```

### 刷新机制

通知主应用刷新小组件：

```javascript
// 在小组件内部发送刷新请求
window.parent.postMessage(
  {
    type: "widget-message",
    widgetId: "my-widget",
    messageType: "refresh",
  },
  "*"
);
```

> 注意：刷新请求会被防抖处理（300ms 延迟，1s 最小间隔），避免频繁刷新

### 编辑模式处理

在编辑模式下隐藏交互元素：

```javascript
Tapp.widgets["interactive"] = {
  render: function (container, props) {
    const button = props.isEditMode
      ? ""
      : '<button onclick="doAction()">操作</button>';

    container.innerHTML = `
      <div style="padding: 16px;">
        <h3>标题</h3>
        ${button}
        ${
          props.isEditMode
            ? '<div style="color:#9ca3af;font-size:12px;">编辑模式</div>'
            : ""
        }
      </div>
    `;
  },
};
```

### 加载状态

显示加载中的占位内容：

```javascript
Tapp.widgets["async-widget"] = {
  render: async function (container, props) {
    const isDark = props.theme === "dark";

    // 显示加载状态
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;">
        <div style="color:${isDark ? "#9ca3af" : "#6b7280"};">加载中...</div>
      </div>
    `;

    try {
      // 获取数据
      const data = await Tapp.platform.getData("steam", { limit: 5 });

      // 渲染实际内容
      container.innerHTML = `
        <div style="padding:16px;">
          <h3>游戏列表</h3>
          <ul>${data.items
            .map((item) => `<li>${Tapp.dom.escapeHtml(item.title)}</li>`)
            .join("")}</ul>
        </div>
      `;
    } catch (error) {
      // 错误状态
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#ef4444;">
          加载失败
        </div>
      `;
    }
  },
};
```

---

## 最佳实践

### 1. 错误处理

```javascript
Tapp.lifecycle.onReady(async () => {
  try {
    const data = await Tapp.storage.get("config");
    // 处理数据
  } catch (error) {
    console.error("加载配置失败:", error);
    await Tapp.ui.showNotification({
      title: "错误",
      message: "加载配置失败",
      type: "error",
    });
  }
});
```

### 2. 资源清理

```javascript
let intervalId;

Tapp.lifecycle.onReady(() => {
  intervalId = setInterval(updateData, 5000);
});

Tapp.lifecycle.onDestroy(() => {
  if (intervalId) {
    clearInterval(intervalId);
  }
});
```

### 3. 最小权限原则

只声明实际需要的权限：

```json
// ✅ 好 - 仅请求必要权限
{
  "permissions": ["storage"]
}
```

```json
// ❌ 不好 - 过度请求权限
{
  "permissions": [
    "storage",
    "platform:read",
    "platform:write",
    "ai:generate",
    "ai:analyze",
    "widget:register",
    "report:read"
  ]
}
```

### 4. 主题适配

```javascript
Tapp.widgets["themed"] = {
  render: function (container, props) {
    const isDark = props.theme === "dark";

    // 使用条件样式
    container.style.background = isDark ? "#262626" : "#fff";
    container.style.color = isDark ? "#f3f4f6" : "#1f2937";
    container.style.borderColor = isDark ? "#404040" : "#e5e7eb";
  },
};
```

### 5. 设置读取

```javascript
Tapp.lifecycle.onReady(async () => {
  // 读取用户设置（带默认值）
  const refreshInterval =
    (await Tapp.storage.get("_settings.refreshInterval")) || 60;
  const showDetails = (await Tapp.storage.get("_settings.showDetails")) ?? true;

  // 使用设置
  if (showDetails) {
    // 显示详细信息
  }

  setInterval(refresh, refreshInterval * 1000);
});
```

### 6. 性能优化

```javascript
// 避免频繁更新 DOM
let updateScheduled = false;
function scheduleUpdate() {
  if (updateScheduled) return;
  updateScheduled = true;
  requestAnimationFrame(() => {
    updateDOM();
    updateScheduled = false;
  });
}

// 缓存 DOM 查询结果
const elements = {};
function getElement(id) {
  if (!elements[id]) {
    elements[id] = document.getElementById(id);
  }
  return elements[id];
}
```

---

## 示例代码

### Hello World

```javascript
Tapp.lifecycle.onReady(async () => {
  // 获取动画配置，适配用户偏好
  const animConfig = await Tapp.animation.getConfig();
  const shouldAnimate = animConfig.level !== "none";

  // 显示欢迎通知
  await Tapp.ui.showNotification({
    title: "Hello!",
    message: "Tapp 已启动",
    type: "success",
  });

  // 根据动画设置创建入场效果
  const container = document.getElementById("app");
  if (container) {
    const duration = 300 * animConfig.durationScale;

    if (shouldAnimate) {
      container.style.opacity = "0";
      container.style.transform = "translateY(10px)";
      container.style.transition = `all ${duration}ms ease-out`;

      requestAnimationFrame(() => {
        container.style.opacity = "1";
        container.style.transform = "translateY(0)";
      });
    }
  }
});

// 监听动画级别变化
Tapp.animation.onLevelChange((level) => {
  console.log("动画级别变化:", level);
});

Tapp.lifecycle.onDestroy(() => {
  console.log("Tapp 已停止");
});
```

### 通知系统示例

通知（Toast）以 Glass Morphism 风格显示在页面顶部，会自动显示 Tapp 来源信息：

```javascript
// 成功通知 - 绿色配色
await Tapp.ui.showNotification({
  title: "保存成功",
  message: "您的设置已保存",
  type: "success",
  duration: 3000,
});

// 错误通知 - 红色配色
await Tapp.ui.showNotification({
  title: "操作失败",
  message: "网络连接超时，请重试",
  type: "error",
  duration: 5000, // 错误信息可以显示更久
});

// 警告通知 - 橙色配色
await Tapp.ui.showNotification({
  title: "注意",
  message: "即将达到存储限制",
  type: "warning",
});

// 信息通知 - 蓝色配色
await Tapp.ui.showNotification({
  message: "提示：按 F11 进入全屏模式",
  type: "info",
});
```

通知 UI 特点：

- **Glass Morphism 风格**：磨砂玻璃背景，与页面信息条保持一致
- **自动 Tapp 标识**：显示 Tapp 图标和名称，便于用户识别来源
- **类型区分**：四种类型对应不同配色和图标
- **悬停暂停**：鼠标悬停时暂停自动关闭计时器
- **响应式**：适配移动端和桌面端显示

### 数据统计小组件（Glass 风格）

```javascript
Tapp.widgets = {};
Tapp.widgets["stats"] = {
  render: async function (container, props) {
    const isDark = props.theme === "dark";
    const scale = props.scale || 1;
    const fontScale = props.fontScale || 1;
    const stats = await Tapp.platform.getStats("steam");

    container.innerHTML = `
      <div class="relative h-full w-full rounded-xl overflow-hidden glass">
        <!-- 渐变背景装饰 -->
        <div class="absolute inset-0 bg-gradient-to-br from-gray-50/50 to-transparent 
                    dark:from-white/[0.02] dark:to-transparent"></div>
        
        <!-- 主内容 -->
        <div class="relative z-10 h-full flex flex-col justify-center items-center p-3"
             style="padding: ${12 * scale}px;">
          
          <!-- 大数字 -->
          <div class="font-black text-indigo-600 dark:text-indigo-400 leading-none"
               style="font-size: ${48 * fontScale}px;">
            ${stats.total}
          </div>
          
          <!-- 标签 -->
          <div class="text-gray-500 dark:text-gray-400 mt-2 uppercase tracking-wider font-bold"
               style="font-size: ${12 * fontScale}px; margin-top: ${
      8 * scale
    }px;">
            Steam 游戏
          </div>
          
        </div>
        
        ${
          props.isEditMode
            ? `
          <div class="absolute inset-0 border-2 border-dashed border-indigo-400 rounded-xl pointer-events-none"></div>
        `
            : ""
        }
      </div>
    `;
  },
};

Tapp.lifecycle.onReady(async () => {
  await Tapp.widget.register({
    id: "stats",
    name: "数据统计",
    defaultSize: "2x2",
    sizes: ["1x1", "2x2"],
  });
});
```

### 安全列表小组件（带活动项）

```javascript
Tapp.widgets = {};
Tapp.widgets["safe-list"] = {
  render: async function (container, props) {
    const isDark = props.theme === "dark";
    const scale = props.scale || 1;
    const fontScale = props.fontScale || 1;
    const data = await Tapp.platform.getData("steam", { limit: 5 });

    container.innerHTML = `
      <div class="relative h-full w-full rounded-xl overflow-hidden glass">
        <!-- 渐变背景 -->
        <div class="absolute inset-0 bg-gradient-to-br from-violet-500/5 to-transparent"></div>
        
        <div class="relative z-10 h-full flex flex-col" style="padding: ${
          12 * scale
        }px;">
          <!-- 标题 -->
          <div class="mb-2" style="margin-bottom: ${
            8 * scale
          }px; margin-left: ${6 * scale}px;">
            <h3 class="text-xs font-semibold text-gray-700 dark:text-gray-300"
                style="font-size: ${12 * fontScale}px;">
              最近游戏
            </h3>
          </div>
          
          <!-- 列表 -->
          <div class="flex-1 space-y-1.5 overflow-y-auto pr-1 
                      scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"
               style="gap: ${6 * scale}px;">
            ${data.items
              .map(
                (item) => `
              <div class="flex items-start gap-2 p-2 rounded-md 
                          bg-white/40 dark:bg-white/[0.02] 
                          hover:bg-white/60 dark:hover:bg-white/[0.04] 
                          transition-colors cursor-pointer"
                   style="padding: ${8 * scale}px; gap: ${8 * scale}px;">
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-medium text-gray-800 dark:text-gray-200 truncate"
                       style="font-size: ${14 * fontScale}px;">
                    ${Tapp.dom.escapeHtml(item.title)}
                  </div>
                </div>
              </div>
            `
              )
              .join("")}
          </div>
        </div>
        
        ${
          props.isEditMode
            ? `
          <div class="absolute inset-0 border-2 border-dashed border-violet-400 rounded-xl pointer-events-none"></div>
        `
            : ""
        }
      </div>
    `;
  },
};

Tapp.lifecycle.onReady(async () => {
  await Tapp.widget.register({
    id: "safe-list",
    name: "安全列表",
    defaultSize: "2x4",
    sizes: ["2x2", "2x4", "4x4"],
  });
});
```

### 多尺寸卡片小组件

```javascript
Tapp.widgets = {};
Tapp.widgets["multi-size"] = {
  render: async function (container, props) {
    const isDark = props.theme === "dark";
    const scale = props.scale || 1;
    const fontScale = props.fontScale || 1;
    const size = props.size || "2x2";

    // 根据尺寸决定布局
    const isWide = size === "4x2" || size === "4x1";
    const isCompact = size === "1x1" || size === "2x1";

    container.innerHTML = `
      <div class="relative h-full w-full rounded-xl overflow-hidden glass">
        <!-- 渐变背景 -->
        <div class="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent"></div>
        
        <div class="relative z-10 h-full flex ${
          isWide ? "flex-row" : "flex-col"
        } p-3"
             style="padding: ${12 * scale}px;">
          
          ${
            isCompact
              ? `
            <!-- 紧凑模式：只显示核心信息 -->
            <div class="flex-1 flex items-center justify-center">
              <span class="font-black text-emerald-600 dark:text-emerald-400"
                    style="font-size: ${32 * fontScale}px;">
                ✓
              </span>
            </div>
          `
              : `
            <!-- 标准模式：完整显示 -->
            <div class="flex-1 flex flex-col justify-center ${
              isWide ? "" : "items-center"
            }">
              <span class="font-black text-emerald-600 dark:text-emerald-400 leading-none"
                    style="font-size: ${36 * fontScale}px;">
                已完成
              </span>
              <span class="text-gray-500 dark:text-gray-400 mt-2"
                    style="font-size: ${14 * fontScale}px; margin-top: ${
                  8 * scale
                }px;">
                所有任务已处理
              </span>
            </div>
            
            ${
              isWide
                ? `
              <!-- 宽模式：额外信息 -->
              <div class="w-1/3 flex items-center justify-center 
                          border-l border-gray-200/20 dark:border-white/10 pl-4"
                   style="padding-left: ${16 * scale}px;">
                <div class="text-center">
                  <div class="text-2xl font-bold text-gray-800 dark:text-gray-100"
                       style="font-size: ${24 * fontScale}px;">
                    5
                  </div>
                  <div class="text-xs text-gray-500 dark:text-gray-400"
                       style="font-size: ${10 * fontScale}px;">
                    今日完成
                  </div>
                </div>
              </div>
            `
                : ""
            }
          `
          }
          
        </div>
        
        ${
          props.isEditMode
            ? `
          <div class="absolute inset-0 border-2 border-dashed border-emerald-400 rounded-xl pointer-events-none"></div>
        `
            : ""
        }
      </div>
    `;
  },
};

Tapp.lifecycle.onReady(async () => {
  await Tapp.widget.register({
    id: "multi-size",
    name: "多尺寸卡片",
    defaultSize: "2x2",
    sizes: ["1x1", "2x1", "2x2", "4x2"],
  });
});
```

### 带设置的小组件

```javascript
// manifest.json 中添加:
// "settings": [
//   { "key": "showCount", "type": "number", "label": "显示数量", "defaultValue": 5, "min": 1, "max": 20 },
//   { "key": "autoRefresh", "type": "toggle", "label": "自动刷新", "defaultValue": true }
// ]

let refreshInterval;

Tapp.widgets = {};
Tapp.widgets["configurable"] = {
  render: async function (container, props) {
    const showCount = (await Tapp.storage.get("_settings.showCount")) || 5;
    const data = await Tapp.platform.getData("steam", { limit: showCount });

    // 渲染...
  },
};

Tapp.lifecycle.onReady(async () => {
  const autoRefresh = (await Tapp.storage.get("_settings.autoRefresh")) ?? true;

  if (autoRefresh) {
    refreshInterval = setInterval(() => {
      // 触发刷新
      window.parent.postMessage(
        {
          type: "widget-message",
          widgetId: "configurable",
          messageType: "refresh",
        },
        "*"
      );
    }, 60000);
  }

  await Tapp.widget.register({
    id: "configurable",
    name: "可配置小组件",
    defaultSize: "2x2",
    sizes: ["2x2", "4x2"],
  });
});

Tapp.lifecycle.onDestroy(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});
```

### AI 助手

```javascript
async function askAI(question) {
  const response = await Tapp.ai.generate({
    prompt: question,
  });
  return response.result;
}

Tapp.lifecycle.onReady(async () => {
  window.TappAI = { ask: askAI };

  await Tapp.ui.showNotification({
    title: "AI 助手已就绪",
    message: '在控制台使用 TappAI.ask("问题") 提问',
    type: "info",
  });
});
```

---

## 调试

### 控制台日志

所有 `console.log` 输出都会在浏览器控制台显示，前缀为 `[Tapp]`。

### 检查权限

```javascript
// 查看已授予的权限
console.log("Permissions:", Tapp.permissions);
```

### 查看 Tapp 信息

```javascript
// 获取 Tapp 信息
const info = Tapp.lifecycle.getInfo();
console.log(info);
// { id, version, name, permissions, sandboxed: true }
```

### 查看 Tapp 实例（主页面）

```javascript
// 在主页面控制台中
const runtime = window.__TAPP_RUNTIME__;
console.log(runtime.getAllTapps());
```

---

## AI 辅助开发指南

> **本章节专为 AI 代码生成工具设计**，提供生成 Tapp 代码时的关键规范和注意事项。

### 代码生成规范

#### 必须遵循的规则

1. **支持原生 ES6+ 语法**：Tapp 沙箱直接在现代浏览器中运行，完全支持 ES6+ 语法：

   - ✅ `const`/`let` 块级作用域
   - ✅ 箭头函数 `() => {}`
   - ✅ 模板字符串 `` `${var}` ``
   - ✅ 解构赋值 `{ a, b } = obj`
   - ✅ `class` 语法
   - ✅ `async`/`await`
   - ✅ 可选链 `?.` 和空值合并 `??`
   - ❌ `import`/`export` → 不支持 ES Modules，使用全局对象 `Tapp.widgets`、`Tapp.pages`
   - ❌ 顶层 `await` → 代码在 IIFE 中执行，需在 async 函数内使用

2. **三段式代码结构**：

   ```
   CORE_CODE   → 共享工具函数（两种模式都加载）
   WIDGET_CODE → Widget 渲染函数（仅 Widget 模式）
   PAGE_CODE   → 页面渲染 + 生命周期（仅 Page 模式）
   ```

3. **Widget 渲染函数必须挂载到全局**：

   ```javascript
   // ✅ 正确
   Tapp.widgets['my-widget'] = {
     render: function(container, props) { ... }
   };

   // ❌ 错误（函数不会被调用）
   function renderWidget(container, props) { ... }
   ```

4. **生命周期只在 PAGE_CODE 中使用**：

   ```javascript
   // PAGE_CODE 中
   Tapp.lifecycle.onReady(function () {
     // Widget 模式不会执行这里的代码
   });
   ```

5. **必须使用 Tapp.dom API 防止 XSS**：

   ```javascript
   // ❌ 危险
   container.innerHTML = "<div>" + userData + "</div>";

   // ✅ 安全
   var div = Tapp.dom.createElement("div", { text: userData });
   container.appendChild(div);
   ```

#### API 调用签名速查

| API                      | 正确签名                                   | 常见错误                          |
| ------------------------ | ------------------------------------------ | --------------------------------- |
| `Tapp.ui.confirm`        | `confirm(message)`                         | ~~`confirm({ title, message })`~~ |
| `Tapp.ai.chat`           | `chat(messages, context, options)`         | ~~`chat({ messages, context })`~~ |
| `Tapp.shortcut.register` | `{ id, keys, description, action, scope }` | ~~`{ handler: function() {} }`~~  |
| `Tapp.storage.get/set`   | 返回 Promise                               | 忘记 `await`                      |
| `Tapp.platform.getData`  | `getData(platform, { limit, offset })`     | 忘记 options 参数                 |

#### Widget 渲染函数 Props 参数

```javascript
Tapp.widgets["example"] = {
  render: function (container, props) {
    // props 包含以下字段：
    var size = props.size; // '1x1' | '2x1' | '2x2' | '4x2' | '4x4'
    var theme = props.theme; // 'light' | 'dark'
    var scale = props.scale || 1; // 缩放比例 0.1-2
    var fontScale = props.fontScale || 1; // 字体缩放 0.6-1.2
    var locale = props.locale; // 'zh-CN' | 'en-US' | 'ja-JP'
    var isEditMode = props.isEditMode; // 是否编辑模式
    var isPreview = props.isPreview; // 是否预览模式
    var config = props.config; // 用户配置对象
  },
};
```

### 样式生成规范

> ⚠️ **重要**：Widget 模式和 Page 模式的样式支持不同，生成代码时必须区分！

| 模式   | Tailwind 类 | `tapp-*` 工具类 | 内联 style | CSS 变量 |
| ------ | ----------- | --------------- | ---------- | -------- |
| Widget | ✅ 可用     | ✅ 可用         | ✅ 可用    | ✅ 可用  |
| Page   | ❌ 不可用   | ✅ 可用         | ✅ 推荐    | ✅ 可用  |

#### Widget 模式 - Glass 风格必备元素

Widget 可以使用完整 Tailwind 类（因为继承主应用样式表）：

```javascript
// 标准 Widget 容器结构（使用 Tailwind）
container.innerHTML =
  '<div class="relative h-full w-full rounded-xl overflow-hidden glass">' +
  // 1. 渐变装饰层（必须）
  '<div class="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent"></div>' +
  // 2. 主内容区（z-10 确保在装饰层之上）
  '<div class="relative z-10 h-full flex flex-col p-3">' +
  "<!-- 内容 -->" +
  "</div>" +
  // 3. 编辑模式边框（必须）
  (props.isEditMode
    ? '<div class="absolute inset-0 border-2 border-dashed border-blue-400 rounded-xl pointer-events-none"></div>'
    : "") +
  "</div>";
```

#### Page 模式 - 使用内联样式

Page 模式没有 Tailwind，必须使用内联样式：

```javascript
// Page 容器结构（使用内联样式 + tapp-* 工具类）
var card = document.createElement("div");
card.className = "tapp-transition"; // 内置工具类可用
card.style.cssText = `
  position: relative;
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
  background: ${isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.6)"};
  backdrop-filter: blur(12px);
  padding: calc(12px * var(--tapp-scale, 1));
`;
```

#### 响应式样式使用 scale 变量

```javascript
// ✅ 正确：使用 scale 和 fontScale
element.style.padding = 12 * props.scale + "px";
element.style.fontSize = 14 * props.fontScale + "px";
element.style.gap = 8 * props.scale + "px";

// ❌ 错误：硬编码像素值
element.style.padding = "12px";
```

#### 暗色模式适配

```javascript
var isDark = props.theme === "dark";

// 背景色
var bgColor = isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.6)";

// 文字色
var textColor = isDark ? "#f3f4f6" : "#1f2937";
var subtextColor = isDark ? "#9ca3af" : "#6b7280";

// 边框色
var borderColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
```

### 权限声明规范

#### 按需声明最小权限

```json
{
  "permissions": [
    "storage", // 需要存储数据时
    "ui:notification", // 需要显示通知时
    "platform:read", // 需要读取平台数据时
    "widget:register" // 需要注册小组件时
  ]
}
```

#### 权限与 API 对应关系

| 权限              | 可用 API                                  | 用户角色 |
| ----------------- | ----------------------------------------- | -------- |
| `storage`         | `Tapp.storage.*`, `Tapp.settings.*`       | 所有用户 |
| `ui:notification` | `Tapp.ui.showNotification()`              | 所有用户 |
| `ui:theme`        | `Tapp.ui.getTheme()`, `getPrimaryColor()` | 所有用户 |
| `platform:read`   | `Tapp.platform.getData()`, `getStats()`   | 所有用户 |
| `platform:write`  | `Tapp.platform.addItem()`                 | 仅管理员 |
| `ai:generate`     | `Tapp.ai.generate()`                      | 仅管理员 |
| `ai:chat`         | `Tapp.ai.chat()`                          | 仅管理员 |
| `ai:image`        | `Tapp.ai.image()`                         | 仅管理员 |
| `network:fetch`   | `Tapp.fetch.proxy()`                      | 仅管理员 |
| `widget:register` | `Tapp.widget.register()`                  | 所有用户 |

### 常见生成错误及修正

#### 错误 1：使用 ES Modules 语法

```javascript
// ❌ 错误：不支持 ES Modules
import { something } from "./module";
export const myFunction = () => {};

// ✅ 修正：使用全局对象
Tapp.widgets["my-widget"] = {
  render: (container, props) => {
    /* ... */
  },
};
```

#### 推荐用法：使用现代 ES6+ 语法

```javascript
// ✅ 完全支持 ES6+ 语法
const data = await Tapp.storage.get("key");
const items = data?.items ?? [];
items.forEach((item) => console.log(item));

// ✅ 使用 async/await
const fetchData = async () => {
  const result = await Tapp.platform.getData("netease");
  return result;
};
```

#### 错误 2：直接使用 innerHTML 渲染用户数据

```javascript
// ❌ 错误（XSS 漏洞）
container.innerHTML = "<h1>" + userName + "</h1>";

// ✅ 修正
var h1 = document.createElement("h1");
Tapp.dom.setText(h1, userName);
container.appendChild(h1);
```

#### 错误 3：在 Widget 代码中使用生命周期

```javascript
// ❌ 错误（Widget 模式不执行 onReady）
// WIDGET_CODE 中：
Tapp.lifecycle.onReady(function () {
  // 这里的代码不会运行！
});

// ✅ 修正：Widget 渲染函数直接执行初始化
Tapp.widgets["my-widget"] = {
  render: function (container, props) {
    // 直接在这里初始化
  },
};
```

#### 错误 4：忘记处理异步 API

```javascript
// ❌ 错误（data 是 Promise，不是实际数据）
var data = Tapp.storage.get("key");
console.log(data.value);

// ✅ 修正（使用 async/await 或 .then）
Tapp.widgets["my-widget"] = {
  render: async function (container, props) {
    var data = await Tapp.storage.get("key");
    console.log(data);
  },
};
```

#### 错误 5：在 CORE_CODE 中定义 Widget

```javascript
// ❌ 错误（CORE_CODE 在 Widget 渲染前执行，挂载会被覆盖）
// CORE_CODE 中：
Tapp.widgets['my-widget'] = { ... };

// ✅ 修正（Widget 定义必须在 WIDGET_CODE 中）
// WIDGET_CODE 中：
Tapp.widgets['my-widget'] = {
  render: function(container, props) { ... }
};
```

### 代码模板

#### 最小 Widget 模板

```javascript
// === CORE_CODE ===
function formatNumber(num) {
  return num.toLocaleString();
}

// === WIDGET_CODE ===
Tapp.widgets["my-widget"] = {
  render: async function (container, props) {
    var isDark = props.theme === "dark";
    var scale = props.scale || 1;
    var fontScale = props.fontScale || 1;

    // 获取动画配置
    var animConfig = await Tapp.animation.getConfig();
    var shouldAnimate = animConfig.level !== "none";

    container.innerHTML =
      '<div class="relative h-full w-full rounded-xl overflow-hidden glass">' +
      '<div class="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-transparent"></div>' +
      '<div class="relative z-10 h-full flex items-center justify-center p-3" style="padding:' +
      12 * scale +
      'px;">' +
      '<span class="font-bold widget-text" style="font-size:' +
      24 * fontScale +
      "px;color:" +
      (isDark ? "#f3f4f6" : "#1f2937") +
      ';">' +
      "Hello World" +
      "</span>" +
      "</div>" +
      (props.isEditMode
        ? '<div class="absolute inset-0 border-2 border-dashed border-blue-400 rounded-xl pointer-events-none"></div>'
        : "") +
      "</div>";

    // 入场动画（尊重用户动画偏好）
    if (shouldAnimate) {
      var text = container.querySelector(".widget-text");
      if (text) {
        text.style.opacity = "0";
        text.style.transform = "scale(0.9)";
        text.style.transition =
          "all " + 200 * animConfig.durationScale + "ms ease-out";
        requestAnimationFrame(function () {
          text.style.opacity = "1";
          text.style.transform = "scale(1)";
        });
      }
    }
    ("</div>");
  },
};

// === PAGE_CODE ===
Tapp.lifecycle.onReady(async function () {
  await Tapp.widget.register({
    id: "my-widget",
    name: "我的小组件",
    defaultSize: "2x2",
    sizes: ["1x1", "2x2", "4x2"],
  });
});
```

#### 最小 Page 模板

```javascript
// === CORE_CODE ===
var i18n = {
  "zh-CN": { title: "我的页面", greeting: "你好！" },
  "en-US": { title: "My Page", greeting: "Hello!" },
};

function t(key, locale) {
  var lang = i18n[locale] || i18n["zh-CN"];
  return lang[key] || key;
}

// === PAGE_CODE ===
Tapp.pages["my-page"] = {
  render: async function (container, locale, isDark, primaryColor) {
    var bgLayer = document.getElementById("tapp-background");
    var contentLayer = document.getElementById("tapp-content");

    // 获取动画配置
    var animConfig = await Tapp.animation.getConfig();
    var shouldAnimate = animConfig.level !== "none";

    // 背景层
    if (bgLayer) {
      bgLayer.style.background = isDark ? "#0a0a0a" : "#f8fafc";
    }

    // 内容层
    if (contentLayer) {
      contentLayer.innerHTML =
        '<div class="page-content" style="max-width:900px;margin:0 auto;padding:24px;">' +
        '<h1 style="font-size:32px;color:' +
        (isDark ? "#f9fafb" : "#1f2937") +
        ';">' +
        Tapp.dom.escapeHtml(t("title", locale)) +
        "</h1>" +
        '<p style="color:' +
        (isDark ? "#9ca3af" : "#6b7280") +
        ';">' +
        Tapp.dom.escapeHtml(t("greeting", locale)) +
        "</p>" +
        "</div>";

      // 入场动画
      if (shouldAnimate) {
        var content = contentLayer.querySelector(".page-content");
        if (content) {
          var duration = 300 * animConfig.durationScale;
          content.style.opacity = "0";
          content.style.transform = "translateY(16px)";
          content.style.transition = "all " + duration + "ms ease-out";
          requestAnimationFrame(function () {
            content.style.opacity = "1";
            content.style.transform = "translateY(0)";
          });
        }
      }
    }
  },
};

Tapp.lifecycle.onReady(async function () {
  var locale = await Tapp.ui.getLocale();
  var theme = await Tapp.ui.getTheme();
  var primaryColor = await Tapp.ui.getPrimaryColor();

  await Tapp.pages["my-page"].render(
    document.getElementById("tapp-root"),
    locale,
    theme === "dark",
    primaryColor
  );

  // 监听变化
  Tapp.ui.onThemeChange(function (newTheme) {
    Tapp.pages["my-page"].render(
      null,
      locale,
      newTheme === "dark",
      primaryColor
    );
  });

  Tapp.ui.onLocaleChange(function (newLocale) {
    locale = newLocale;
    Tapp.pages["my-page"].render(null, locale, theme === "dark", primaryColor);
  });

  // 监听动画级别变化
  Tapp.animation.onLevelChange(function (level) {
    console.log("动画级别变化:", level);
  });
});
```

### 生成检查清单

生成 Tapp 代码后，请检查以下项目：

**代码结构**：

- [ ] 是否避免使用 ES Modules？（无 import/export，使用 Tapp.widgets/Tapp.pages）
- [ ] Widget 渲染函数是否挂载到 `Tapp.widgets['id']`？
- [ ] 代码是否正确分布在 CORE/WIDGET/PAGE 三段中？

**样式规范**（⚠️ 重要）：

- [ ] **Widget 代码**是否使用 Tailwind 类？（Widget 模式可用）
- [ ] **Page 代码**是否使用内联 style + `tapp-*` 工具类？（Page 模式不支持 Tailwind）
- [ ] 是否处理了 `props.theme` 暗色模式？
- [ ] 是否使用了 `props.scale`/`props.fontScale` 进行缩放？
- [ ] 是否添加了编辑模式边框 `props.isEditMode`？

**动画适配**（⚠️ 重要）：

- [ ] 是否使用 `Tapp.animation.getConfig()` 获取动画配置？
- [ ] 动画是否尊重用户的动画级别偏好（none/light/standard）？
- [ ] 动画时长是否乘以 `durationScale` 进行缩放？
- [ ] 是否监听 `Tapp.animation.onLevelChange` 响应设置变化？

**安全与权限**：

- [ ] 用户输入是否使用了 `Tapp.dom` API 安全渲染？
- [ ] 异步 API 是否正确使用了 `await`？
- [ ] 权限声明是否只包含必需的权限？

---

## 常见问题

### Q: 为什么我的网络请求失败？

A: Tapp 禁用了直接的 `fetch` 和 `XMLHttpRequest`。请使用 `Tapp.fetch.request()` 通过后端代理发送请求，并确保声明了 `network:fetch` 权限。

### Q: 为什么存储的数据丢失了？

A: Tapp 使用独立的存储空间，数据存储在后端数据库中。确保使用了 `Tapp.storage` API 而非 `localStorage`。

### Q: 如何让小组件支持暗色模式？

A: 在渲染函数中检查 `props.theme` 参数，根据其值（'light' 或 'dark'）应用不同的样式。

### Q: 如何防止 XSS 攻击？

A: 使用 `Tapp.dom` API 处理所有用户输入。永远不要直接将用户数据拼接到 `innerHTML` 中。

### Q: 小组件刷新太频繁怎么办？

A: 系统会自动对刷新请求进行防抖处理（300ms）和节流（最小 1s 间隔）。建议在业务逻辑中也添加合理的刷新间隔控制。

### Q: AI 提示词被拒绝怎么办？

A: 系统会过滤可能的注入攻击。避免在提示词中包含：外部 URL、角色覆盖指令（如 "ignore previous"）、敏感关键词（password, api_key 等）。

---

## 更新日志

### 2025-12-07 - 沙箱规范文档完善

#### 安全沙箱章节

- 📝 新增完整 CSP 策略代码块及限制说明表格
- 📝 新增 iframe sandbox 属性详细说明
- 📝 新增全局对象保护机制文档：被禁用和冻结的 API 列表
- 📝 补充安全限制的替代方案说明

#### CSS 变量系统

- 🆕 新增「主题变量」表格：8 个主题相关 CSS 变量
- 📝 包含亮色/暗色模式的具体值
- 📝 说明主题变量会在切换时自动更新

#### 内置组件类

- 🆕 新增「内置组件类」章节：完整的 `tapp-*` 组件样式文档
- 📝 容器组件：`tapp-container`, `tapp-container-glass`
- 📝 浮动条：`tapp-float-bar`, `tapp-float-bar-top`, `tapp-float-bar-bottom`
- 📝 按钮：`tapp-btn`, `tapp-btn-primary`, `tapp-btn-icon`, `tapp-btn-ghost`
- 📝 输入框：`tapp-input`
- 📝 消息气泡：`tapp-msg-area`, `tapp-bubble`, `tapp-bubble-user`, `tapp-bubble-ai`
- 📝 打字指示器：`tapp-typing`, `tapp-typing-dot`
- 📝 图标容器：`tapp-icon`, `tapp-icon-sm/md/lg`, `tapp-icon-primary`
- 📝 文本样式：`tapp-text`, `tapp-text-sub`, `tapp-text-primary`, `tapp-text-error`
- 📝 动画类表格：8 种预置动画效果
- 📝 其他工具类：滚动条、空状态、光标动画

### 2025-12-07 - REST API 文档完善

#### REST API 端点参考

- 🆕 新增「REST API 端点参考」章节：完整的后端 API 端点列表
- 📝 Tapp 管理 API：15 个端点，涵盖安装/卸载/启动/停止
- 📝 Storage API：5 个端点，完整的 CRUD 操作
- 📝 Store Source API：4 个端点，商店源管理
- 📝 Platform API：5 个端点，平台数据读写
- 📝 AI API：4 个端点，包含图片生成支持的模型列表
- 📝 Context API：5 个端点，应用/用户/播放器/导航/系统上下文
- 📝 Report API：5 个端点，报告 CRUD
- 📝 Media Control API：2 个端点
- 📝 Component API：4 个端点，组件注册与管理
- 📝 Shortcut API：3 个端点，快捷键注册
- 📝 Event Bus API：3 个端点，事件发布订阅
- 📝 Metrics API：3 个端点，性能监控与速率限制
- 📝 添加认证说明：需要/可选/公开三种认证级别

#### 目录更新

- 📝 目录新增 REST API 端点参考链接

### 2025-12-06 - 样式规范文档修正

#### 样式系统澄清

- 📝 新增「样式系统概述」章节：明确 Widget 和 Page 模式的样式支持差异
- 📝 Widget 模式：完全支持 Tailwind CSS 类（继承主应用样式表）
- 📝 Page 模式：推荐使用内联 style + `tapp-*` 工具类（沙箱无 Tailwind）
- 📝 更新「样式规范」章节标题为「样式规范（Widget 模式）」
- 📝 新增「样式规范（Page 模式）」章节说明
- 📝 更新 AI 辅助开发指南中的样式生成规范和检查清单

#### API 文档修正

- 🔧 修正 `Tapp.ui.confirm()` 签名：接受字符串参数而非对象
- 🔧 修正 `Tapp.ai.chat()` 签名：接受三个独立参数 `(messages, context, options)` 而非单个对象
- 🔧 修正 `Tapp.shortcut.register()` 配置：使用 `action` 字符串而非 `handler` 回调函数
- 📝 补充 `Tapp.report.list()` 和 `Tapp.report.get()` 简便方法文档
- 📝 补充快捷键触发事件监听说明

#### 动态内容 API

- 🆕 `Tapp.dynamicContent.set()`：设置控制岛动态内容
- 🆕 `Tapp.dynamicContent.update()`：快速更新动态内容文本
- 🆕 `Tapp.dynamicContent.get()`：获取当前动态内容
- 🆕 `Tapp.dynamicContent.remove()`：移除动态内容
- 🆕 多语言支持：`i18n` 参数支持 `text` 和 `subtext` 的多语言映射
- 🆕 过期时间：`expiresAt` 参数支持自动过期移除
- 自动后台需求：设置动态内容时自动声明 `notification` 后台需求

#### 控制岛动画优化

- 🎨 歌词切换淡入淡出效果：文本切换时添加平滑过渡动画
- 🎨 CSS 类 `.lyric-transition`：用于歌词切换时的淡出效果
- ⚡ 优化歌词更新逻辑：减少不必要的状态更新，提升性能

#### hasPage 页面模块文档完善

- 📝 完善 `hasPage` 配置文档：补充页面模块的作用说明
- 📝 新增「何时声明 hasPage」使用场景指南
- 📝 新增「代码结构要求」示例：展示 PAGE_CODE 的基本结构
- 📝 添加页面分层架构章节的交叉引用

### 2025-12-05 - 主色调 API & 后台运行需求系统

#### 主色调 API

- 🆕 `Tapp.ui.getPrimaryColor()`：获取全局主色调（壁纸色）
- 🆕 `Tapp.ui.onPrimaryColorChange(callback)`：监听主色调变化
- Tapp 可与系统壁纸色保持一致的动态主题

#### 后台运行需求系统

- 🆕 `Tapp.background` API：声明后台运行需求
- 🆕 默认冻结机制：Tapp 离开页面后默认暂停
- 🆕 按需后台运行：只有声明需求的 Tapp 才在后台运行
- 🆕 自动需求管理：注册 Widget 自动声明 `widget` 需求
- 🆕 7 种后台需求类型：`widget`, `media`, `sync`, `notification`, `scheduler`, `event-listener`, `realtime`
- 性能优化：减少不必要的后台 Tapp 运行，节省资源
- 📝 小组件样式规范文档更新：基于实际组件代码重写样式指南

### 2025-11-20 - 自适应尺寸 + i18n

- 🆕 自动注入自适应 CSS 变量（`--tapp-scale`, `--tapp-font-scale` 等）
- 🆕 响应式工具类（`tapp-text-*`, `tapp-p-*`, `tapp-hide-compact` 等）
- 🆕 容器查询支持（`tapp-cq-hide-sm`, `tapp-cq-show-lg` 等）
- 🆕 状态类自动切换（`.tapp-compact`, `.tapp-mini`）
- 🆕 `tapp:resize` 事件和 `window._TAPP_DIMENSIONS` 全局对象
- 🆕 `Tapp.ui.getLocale()` 获取用户语言
- 🆕 props 新增 `locale` 字段用于 i18n
- 性能优化：复用全局 ResizeObserver、CSS 变量缓存、RAF 节流

### 2025-10-15 - 代码分离架构

- 新增分离模式：`core`, `widget`, `page` 代码分离
- Widget 预注册机制：从 manifest 自动注册
- Widget 按需渲染：只在 Tapp 运行时显示
- 代码加载优化：按模式加载所需代码

### 2025-09-01 - 安全增强版本

- 新增 `Tapp.dom` 安全 API
- 增强 AI 提示词安全检测
- 添加小组件刷新防抖和节流
- 完善样式规范文档
- 添加设置配置支持

### 2025-08-01 - 初始版本

- 基础 API (storage, ui, lifecycle)
- 小组件系统
- 平台数据访问
- AI 集成
- 报告访问
