# Config 区块与设置原语

`ConfigForm` 的各配置区块已拆到 `components/config/*ConfigSection.tsx`，并优先复用 `components/settings/` 统一原语。

## 设置原语（必读）

详见 [`../settings/README.md`](../settings/README.md)。

| 场景 | 使用 |
| ---- | ---- |
| **操作按钮** | **`SettingsButton`**（禁止手写 `btn-base`） |
| 带标签的按钮行 | `ButtonItem` |
| **单选 / 多选分段** | **`SegmentedControl`**（`mode` / `columns`） |
| 带标签的开关行 | `SwitchItem` |
| 卡片头 / 紧凑开关 | `ToggleSwitch` |
| 文本 / 密码 / URL / email | `InputItem` |
| 数字 + 单位 | `NumberItem` |
| 下拉 | `FieldSelect` 或 `SelectItem`（禁止原生 `<select>`） |
| 卡片式多选 | `CheckboxGroupItem` |
| 可操作列表（含可选添加表单 `form`） | `ManagedList` |
| 信息卡 + 操作按钮 | `InfoActionCard` |
| 区块结构 | `SettingSection` + `SettingGroup` |

## 已接入的配置区块

| 组件 | 区块 |
| ---- | ---- |
| `ModuleConfigSection` | 模块（可见性、库来源、报告、一言、音乐播放器） |
| `OAuthConfigSection` | OAuth |
| `UiConfigSection` | UI |
| `PermissionsConfigSection` | 权限 |
| `UsersConfigSection` | 用户管理 |
| `NotificationConfigSection` | 通知 |
| `UpdaterConfigSection` | 更新器（主状态机）；UI 子块在 `config/updater/*` |
| `AiConfigSection` | AI |
| `FederationConfigSection` | 联邦 |
| `AdvancedConfigSection` | 高级（**网络代理** / API 镜像、导入导出重置） |
| `AboutConfigSection` | 关于 |
| `PlatformsConfigSection` | 数据平台（列表 + 二级页 + 自动刷新编排） |
| `PlatformAutoRefreshSettings` | 数据平台 · 自动刷新 |
| `PlatformDataManagement` | 数据平台 · 单平台数据管理（二级页内嵌，非独立路由） |

> 独立路由 `/data-management` 已移除；旧书签应落到 `/config`（App 内 redirect）。

`ConfigForm` 本身还负责：导航搜索等壳层 UI、**浮动统一保存**（`handleSave` + dirty 草稿）。数据平台 UI 已拆到 **`PlatformsConfigSection`**（列表拖拽 / 二级凭证 / `PlatformDataManagement` / `AutoHeight`）。

**移动端（&lt;1024px）分层导航**：`data-mobile-pane=nav|section` —— 一级为完整分类列表；点入后为二级内容；平台凭证/数据管理为三级（区块内返回）。桌面仍为左栏 + 右内容双栏。

策略类设置（权限、OAuth、模块、通知、**联邦信任策略** 等）只改草稿，写入走统一保存；即时动作（封禁实例、过滤规则 CRUD、测语音、换域名、平台数据刷新/清缓存）可保留区块内按钮。

## 各一级分类下的子分组（现行）

| 一级 | 子分组顺序 |
| ---- | ---------- |
| 数据平台 | 列表 → 自动刷新；**进入某平台二级页**：凭证字段 → **数据管理**（刷新 / 智能过滤 / 清缓存） |
| AI | Lite / Standard / Pro → 图片 → 语音 |
| 基础 | 站点地址 → 元数据 → 页脚 → 域名更换 → 背景 → 壁纸动效 |
| 第三方登录 | 登录方式列表 |
| 联邦 | 身份 → 策略 → 已知实例 → 内容过滤 → 投递队列 → 限流（折叠） |
| 权限 | Agent 预设 → 用户/游客 elevated → 用户/游客 AI 配额 |
| 用户 | 注册策略开关 → **ManagedList**（统计 / 搜索筛选 / 创建 / 展开详情） |
| 通知 | 总开关 → 显示方式 → 各来源 |
| 模块 | 可见性 → 媒体库 → 报告 → 一言 → 音乐 |
| 高级 | 网络代理 → API 镜像 → 备份与恢复 |
| 关于 | 开发信息 + 更新器内联 |

## 新增设置时的约定

1. 不要手写 `.toggle-switch` DOM 或原生 `<select>` option 列表。
2. 深色对比与 focus 样式跟 `settings/items/*.css` 走。
3. 领域专用控件（如来源 chip、更新通道卡）可以保留自定义 DOM，但开关/输入/下拉仍优先原语。
