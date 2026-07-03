# 通用设置组件架构

## 概述

设置组件系统提供一套统一、可复用的设置项组件，用于替换分散在项目中的各种设置实现。

## 架构设计

```
settings/
├── types.ts              # 类型定义
├── SettingItem.tsx       # 单个设置项组件（工厂组件）
├── SettingGroup.tsx      # 设置项分组容器
├── SettingSection.tsx    # 设置区块（带标题和图标）
├── items/                # 具体设置项类型
│   ├── SwitchItem.tsx    # 开关切换
│   ├── InputItem.tsx     # 文本输入
│   ├── NumberItem.tsx    # 数字输入
│   ├── SelectItem.tsx    # 下拉选择
│   ├── ProviderItem.tsx  # 服务提供商选择器
│   ├── SliderItem.tsx    # 滑动条
│   └── ButtonItem.tsx    # 操作按钮
├── presets/              # 预设组合
│   ├── PermissionGroup.tsx   # 权限设置组
│   ├── QuotaGroup.tsx        # 配额设置组
│   └── ProviderGroup.tsx     # 服务商选择组
├── hooks/
│   └── useSettingState.ts    # 设置状态管理 Hook
└── index.ts              # 统一导出
```

## 核心类型

### SettingItemConfig

```typescript
interface SettingItemConfig {
  // 基础属性
  key: string // 唯一标识
  label: string // 显示标签
  description?: string // 描述说明
  hint?: string // 提示文本

  // 类型相关
  type: SettingType // 设置项类型
  value: unknown // 当前值
  defaultValue?: unknown // 默认值

  // 交互
  onChange: (value: unknown) => void
  onFocus?: () => void
  onBlur?: () => void

  // 验证
  required?: boolean
  validate?: (value: unknown) => string | null

  // 状态
  disabled?: boolean
  loading?: boolean
  error?: string

  // 类型特定配置
  options?: SettingOption[] // 用于 select/provider
  min?: number // 用于 number/slider
  max?: number
  step?: number
  placeholder?: string // 用于 input
  inputType?: 'text' | 'password' | 'url' | 'email'
  multiline?: boolean // 用于 textarea

  // 样式
  size?: 'sm' | 'md' | 'lg'
  layout?: 'horizontal' | 'vertical'
}
```

### SettingType 枚举

```typescript
type SettingType =
  | 'switch' // 开关
  | 'input' // 文本输入
  | 'number' // 数字输入
  | 'select' // 下拉选择
  | 'provider' // 服务商选择器（带图标的按钮组）
  | 'slider' // 滑动条
  | 'button' // 操作按钮
  | 'checkbox' // 复选框
  | 'custom' // 自定义渲染
```

## 使用示例

### 基础开关

```tsx
<SettingItem
  type="switch"
  key="music_enabled"
  label="启用音乐播放器"
  description="开启后将在底部显示音乐播放器"
  value={config.music_enabled}
  onChange={(v) => updateConfig('music_enabled', v)}
/>
```

### 服务商选择器

```tsx
<SettingItem
  type="provider"
  key="ai_provider"
  label="AI 服务商"
  value={config.provider}
  onChange={(v) => updateConfig('provider', v)}
  options={[
    { value: 'gemini', label: 'Gemini', icon: '🤖' },
    { value: 'openai', label: 'OpenAI', icon: '✨' },
  ]}
/>
```

### 设置分组

```tsx
<SettingSection
  title="AI 配置"
  icon="🤖"
  description="配置 AI 服务相关参数"
>
  <SettingGroup title="基础设置">
    <SettingItem type="provider" ... />
    <SettingItem type="input" key="api_key" ... />
  </SettingGroup>

  <SettingGroup title="高级设置">
    <SettingItem type="number" key="max_tokens" ... />
    <SettingItem type="slider" key="temperature" ... />
  </SettingGroup>
</SettingSection>
```

### 权限配置（预设组合）

```tsx
<PermissionGroup
  title="普通用户权限"
  description="控制普通用户可使用的 Tapp 权限"
  permissions={[
    {
      key: 'ai:generate',
      label: 'AI 生成',
      hint: '允许 Tapp 调用 AI 生成内容',
    },
    { key: 'ai:analyze', label: 'AI 分析', hint: '允许 Tapp 调用 AI 分析内容' },
    // ...
  ]}
  values={permissionConfig}
  onChange={updatePermissionConfig}
/>
```

## 设计原则

### 1. 一致性

- 所有设置项共享相同的视觉语言
- 统一的交互模式（hover、focus、active）
- 响应式布局适配移动端

### 2. 可访问性

- 完整的 ARIA 标签
- 键盘导航支持
- 屏幕阅读器友好

### 3. 灵活性

- 支持水平/垂直布局
- 可配置尺寸
- 自定义渲染插槽

### 4. 性能

- React.memo 优化
- 受控/非受控模式
- 防抖输入

## 样式规范

### 布局模式

**水平模式 (horizontal)** - 默认

```
┌────────────────────────────────────────┐
│ 标签和描述                      [控件] │
└────────────────────────────────────────┘
```

**垂直模式 (vertical)** - 适用于复杂输入

```
┌────────────────────────────────────────┐
│ 标签                                   │
│ 描述文本                               │
│ ┌────────────────────────────────────┐ │
│ │ 输入控件                           │ │
│ └────────────────────────────────────┘ │
│ 提示文本                               │
└────────────────────────────────────────┘
```

### 尺寸规范

| 尺寸 | 内边距  | 字体大小  | 圆角    |
| ---- | ------- | --------- | ------- |
| sm   | 0.5rem  | 0.8125rem | 0.5rem  |
| md   | 1rem    | 0.875rem  | 0.75rem |
| lg   | 1.25rem | 1rem      | 1rem    |

## 迁移计划

1. **Phase 1**: 创建核心组件
   - types.ts
   - SettingItem.tsx (工厂组件)
   - 基础 items/

2. **Phase 2**: 创建预设组合
   - PermissionGroup
   - QuotaGroup
   - ProviderGroup

3. **Phase 3**: 迁移 ConfigForm
   - 逐个 section 迁移
   - 保持向后兼容

4. **Phase 4**: 迁移其他设置页面
   - BrewReader 设置
   - TappDetailPage 设置
   - 各种 Modal 中的设置
