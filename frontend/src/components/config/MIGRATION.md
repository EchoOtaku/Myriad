# ConfigForm 迁移指南

本文档说明如何将 `ConfigForm.tsx` 中的各个配置区块迁移到使用新的通用设置组件。

## 已完成的迁移组件

以下配置区块组件已完成迁移，可以直接导入使用：

| 组件                       | 对应区块    | 文件路径                              |
| -------------------------- | ----------- | ------------------------------------- |
| `MusicConfigSection`       | 音乐播放器  | `config/MusicConfigSection.tsx`       |
| `NetworkConfigSection`     | 网络代理    | `config/NetworkConfigSection.tsx`     |
| `OAuthConfigSection`       | OAuth 配置  | `config/OAuthConfigSection.tsx`       |
| `UiConfigSection`          | UI 基础配置 | `config/UiConfigSection.tsx`          |
| `PermissionsConfigSection` | 权限配置    | `config/PermissionsConfigSection.tsx` |

## 在 ConfigForm 中使用

### 1. 添加导入

```tsx
// 在 ConfigForm.tsx 顶部添加
import {
  MusicConfigSection,
  NetworkConfigSection,
  OAuthConfigSection,
  UiConfigSection,
  PermissionsConfigSection,
} from './config';
```

### 2. 替换音乐播放器区块

**原代码：** 约 80 行（第 1650-1770 行）

**替换为：**

```tsx
{
  activeSection === 'music' && (
    <MusicConfigSection
      configFields={config.ui_config.config_fields}
      updateValue={updateUiFieldValue}
      onMessage={(msg) => {
        setMessage(msg);
        setTimeout(() => setMessage(''), 3000);
      }}
    />
  );
}
```

### 3. 替换网络代理区块

**原代码：** 约 120 行（第 1774-1895 行）

**替换为：**

```tsx
{
  activeSection === 'network' && (
    <NetworkConfigSection
      configFields={config.ui_config.config_fields}
      updateValue={updateUiFieldValue}
    />
  );
}
```

### 4. 替换 OAuth 配置区块

**原代码：** 约 100 行（第 1550-1650 行）

**替换为：**

```tsx
{
  activeSection === 'oauth' && (
    <OAuthConfigSection
      configFields={config.ui_config.config_fields}
      updateValue={updateUiFieldValue}
    />
  );
}
```

### 5. 替换 UI 基础配置区块

**原代码：** 约 200 行（第 1350-1550 行）

**替换为：**

```tsx
{
  activeSection === 'ui' && (
    <UiConfigSection
      configFields={config.ui_config.config_fields}
      updateValue={updateUiFieldValue}
      getFieldLabel={getFieldLabel}
      getFieldPlaceholder={getFieldPlaceholder}
    />
  );
}
```

### 6. 替换权限配置区块

**原代码：** 约 500+ 行（第 1899-2400+ 行）

**替换为：**

```tsx
{
  activeSection === 'permissions' && (
    <PermissionsConfigSection
      permissionConfig={permissionConfig}
      updatePermissionConfig={updatePermissionConfig}
      loading={permissionLoading}
    />
  );
}
```

## 代码行数对比

| 区块        | 迁移前       | 迁移后     | 减少        |
| ----------- | ------------ | ---------- | ----------- |
| 音乐播放器  | ~80 行       | ~10 行     | ~70 行      |
| 网络代理    | ~120 行      | ~6 行      | ~114 行     |
| OAuth 配置  | ~100 行      | ~6 行      | ~94 行      |
| UI 基础配置 | ~200 行      | ~8 行      | ~192 行     |
| 权限配置    | ~500 行      | ~8 行      | ~492 行     |
| **总计**    | **~1000 行** | **~38 行** | **~962 行** |

## 待迁移区块

以下区块由于复杂度较高，建议后续迁移：

### 平台配置 (platforms)

- 包含平台网格卡片
- 包含模态框配置
- 建议创建 `PlatformsGridSection` 组件

### AI 配置 (ai)

- 包含多个 provider 选择
- 包含图片生成、语音服务等子配置
- 建议创建 `AiConfigSectionV2` 组件

## 组件接口规范

### ConfigField 接口

```typescript
interface ConfigField {
  key: string;
  value: string;
}
```

### 标准 Props 模式

```typescript
interface XxxConfigSectionProps {
  configFields: ConfigField[];
  updateValue: (key: string, value: string) => void;
  onMessage?: (message: string) => void;
}
```

## 注意事项

1. **保持 CSS 类名兼容** - 新组件复用了 `ConfigForm.css` 中的样式类名
2. **动画由组件内部处理** - `SettingSection` 组件已包含 framer-motion 动画
3. **国际化** - 组件内部使用 `useI18n()` 获取翻译
4. **响应式布局** - 组件自动适配移动端
