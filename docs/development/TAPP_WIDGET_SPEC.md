# Tapp Widget 开发规范

> 基于 Myriad 项目现有小组件风格设计，为 Tapp 开发者提供统一的 Widget 开发标准。

## 📐 设计原则

### 1. Glass Morphism（玻璃拟态）风格

Myriad 的 Widget 采用现代 Glass Morphism 风格，核心特征：

```css
/* Glass 效果基础样式 */
.glass {
  background: rgba(255, 255, 255, 0.6); /* 浅色模式 */
  background: rgba(255, 255, 255, 0.03); /* 深色模式 */
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.75rem; /* 12px */
}
```

### 2. 响应式缩放系统

Widget 使用 `scale` 和 `fontScale` 实现自适应：

| 属性        | 说明         | 计算方式                                    |
| ----------- | ------------ | ------------------------------------------- |
| `scale`     | 元素尺寸缩放 | `min(containerWidth, containerHeight) / 90` |
| `fontScale` | 字体缩放     | `clamp(0.6, 0.2 + scale * 0.8, 1.2)`        |

**使用示例：**

```javascript
// 间距
padding: `${16 * scale}px`;
gap: `${12 * scale}px`;

// 字体
fontSize: `${14 * fontScale}px`;

// 图标尺寸
width: `${24 * scale}px`;
height: `${24 * scale}px`;
```

---

## 📏 尺寸规范

### 支持的 Widget 尺寸

| 尺寸  | 网格       | 典型用途   | 建议内容量     |
| ----- | ---------- | ---------- | -------------- |
| `1x1` | 1 列 ×1 行 | 状态指示器 | 单图标/数字    |
| `2x1` | 2 列 ×1 行 | 紧凑信息   | 1 行文字       |
| `1x2` | 1 列 ×2 行 | 垂直列表   | 2-3 项         |
| `2x2` | 2 列 ×2 行 | 标准卡片   | 图标+标题+简述 |
| `4x1` | 4 列 ×1 行 | 横向条     | 单行内容       |
| `4x2` | 4 列 ×2 行 | 宽卡片     | 左右/上下布局  |
| `4x4` | 4 列 ×4 行 | 完整功能   | 复杂交互       |

### 基准单元格尺寸

```
BASE_CELL_SIZE = 90px
```

### 尺寸阈值

```javascript
isCompact = width < 150 || height < 150; // 紧凑模式
isMini = width < 100 || height < 100; // 迷你模式
```

---

## 🎨 主题适配

### 颜色变量

Widget 必须支持亮色/暗色主题切换：

```javascript
function getThemeColors(isDark, primaryColor) {
  return {
    // 背景
    bg: isDark ? "#0a0a0a" : "#f8fafc",
    cardBg: isDark ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.7)",
    glassBg: isDark ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.6)",
    inputBg: isDark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.9)",

    // 文字
    text: isDark ? "#f3f4f6" : "#1f2937",
    subtext: isDark ? "#9ca3af" : "#6b7280",

    // 边框
    border: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",

    // 主题色（用户自定义）
    primary: primaryColor || "#8b5cf6",
  };
}
```

### 主题变量（从 props 获取）

```javascript
Tapp.widgets["my-widget"] = {
  render: function (container, props) {
    var isDark = props.theme === "dark";
    var primaryColor = props.primaryColor || "#8b5cf6";
    var locale = props.locale || "zh-CN";
    // ...
  },
};
```

---

## 📦 Widget 结构规范

### 标准 DOM 结构

```html
<!-- 根容器 - 必须填满 container -->
<div class="widget-root">
  <!-- 背景层 - 装饰效果 -->
  <div class="widget-background">
    <!-- 渐变/光晕等装饰 -->
  </div>

  <!-- 内容层 - 主要内容 -->
  <div class="widget-content">
    <!-- 头部（可选） -->
    <div class="widget-header">...</div>

    <!-- 主体 -->
    <div class="widget-body">...</div>

    <!-- 底部（可选） -->
    <div class="widget-footer">...</div>
  </div>

  <!-- 编辑模式指示器（可选） -->
  <div class="edit-indicator"></div>
</div>
```

### 根容器样式（必需）

```javascript
var root = document.createElement("div");
root.style.cssText = [
  "position: absolute",
  "inset: 0",
  "border-radius: 0.75rem", // 12px
  "overflow: hidden",
  "background: " + colors.glassBg,
  "backdrop-filter: blur(12px)",
  "-webkit-backdrop-filter: blur(12px)",
  "border: 1px solid " + colors.border,
].join(";");
```

---

## 🔄 尺寸适配布局

### 2x2 紧凑布局

```javascript
if (size === "2x2") {
  // 简化内容，垂直居中
  content.style.cssText = `
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: ${16 * scale}px;
  `;
  // 只显示核心信息：图标 + 标题 + 简短描述
}
```

### 4x2 宽版布局

```javascript
if (size === "4x2") {
  // 左右分栏或上下分区
  content.style.cssText = `
    height: 100%;
    display: flex;
    flex-direction: row;  // 或 column
    gap: ${16 * scale}px;
    padding: ${16 * scale}px;
  `;
}
```

### 4x4 完整布局

```javascript
if (size === "4x4") {
  // 完整功能布局
  content.style.cssText = `
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: ${16 * scale}px;
  `;
  // 可包含：头部、内容区（可滚动）、输入区
}
```

---

## ✨ 装饰效果

### 渐变背景

```javascript
var gradient = document.createElement("div");
gradient.style.cssText = `
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(135deg, 
    ${primaryColor}08, 
    transparent 60%
  );
`;
```

### 光晕效果

```javascript
var glow = document.createElement("div");
glow.style.cssText = `
  position: absolute;
  right: -10%;
  top: -10%;
  width: 50%;
  height: 50%;
  border-radius: 50%;
  background: radial-gradient(circle, 
    ${primaryColor}15, 
    transparent 70%
  );
  filter: blur(40px);
  pointer-events: none;
`;
```

---

## 🎯 交互规范

### 按钮样式

```javascript
var button = document.createElement("button");
button.style.cssText = `
  padding: ${10 * scale}px ${20 * scale}px;
  border-radius: ${10 * scale}px;
  font-size: ${14 * fontScale}px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  background: ${primaryColor};
  color: white;
  transition: opacity 0.2s, transform 0.2s;
`;

button.onmouseenter = function () {
  button.style.opacity = "0.9";
  button.style.transform = "scale(1.02)";
};
button.onmouseleave = function () {
  button.style.opacity = "1";
  button.style.transform = "scale(1)";
};
```

### 输入框样式

```javascript
var input = document.createElement("input");
input.style.cssText = `
  padding: ${12 * scale}px ${16 * scale}px;
  border-radius: ${12 * scale}px;
  font-size: ${14 * fontScale}px;
  background: ${colors.inputBg};
  border: 1px solid ${colors.border};
  color: ${colors.text};
  outline: none;
  transition: border-color 0.2s, box-shadow 0.2s;
`;

input.onfocus = function () {
  input.style.borderColor = primaryColor;
  input.style.boxShadow = `0 0 0 3px ${primaryColor}20`;
};
input.onblur = function () {
  input.style.borderColor = colors.border;
  input.style.boxShadow = "none";
};
```

---

## 📝 完整示例

```javascript
Tapp.widgets["demo-widget"] = {
  render: function (container, props) {
    // 1. 获取参数
    var isDark = props.theme === "dark";
    var primaryColor = props.primaryColor || "#8b5cf6";
    var size = props.size || "2x2";
    var dims = window._TAPP_DIMENSIONS || {};
    var scale = dims.scale || 1;
    var fontScale = dims.fontScale || 1;

    // 2. 计算主题色
    var colors = {
      bg: isDark ? "#0a0a0a" : "#f8fafc",
      glassBg: isDark ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.6)",
      text: isDark ? "#f3f4f6" : "#1f2937",
      subtext: isDark ? "#9ca3af" : "#6b7280",
      border: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)",
    };

    // 3. 创建根容器
    var root = document.createElement("div");
    root.style.cssText = [
      "position:absolute",
      "inset:0",
      "border-radius:" + 12 * scale + "px",
      "overflow:hidden",
      "background:" + colors.glassBg,
      "backdrop-filter:blur(12px)",
      "-webkit-backdrop-filter:blur(12px)",
      "border:1px solid " + colors.border,
    ].join(";");

    // 4. 背景装饰
    var gradient = document.createElement("div");
    gradient.style.cssText =
      "position:absolute;inset:0;pointer-events:none;" +
      "background:linear-gradient(135deg," +
      primaryColor +
      "08,transparent 60%);";
    root.appendChild(gradient);

    // 5. 内容区域
    var content = document.createElement("div");
    content.style.cssText = [
      "position:relative",
      "z-index:1",
      "height:100%",
      "display:flex",
      "flex-direction:column",
      "padding:" + 16 * scale + "px",
    ].join(";");

    // 6. 根据尺寸渲染不同布局
    if (size === "2x2" || size === "1x1") {
      // 紧凑布局
      content.innerHTML = `
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;">
          <div style="font-size:${32 * scale}px;margin-bottom:${
        8 * scale
      }px;">🎯</div>
          <div style="font-size:${16 * fontScale}px;font-weight:600;color:${
        colors.text
      };">Demo Widget</div>
          <div style="font-size:${12 * fontScale}px;color:${
        colors.subtext
      };margin-top:${4 * scale}px;">Hello World</div>
        </div>
      `;
    } else {
      // 完整布局
      content.innerHTML = `
        <div style="display:flex;align-items:center;gap:${
          12 * scale
        }px;margin-bottom:${12 * scale}px;">
          <div style="font-size:${24 * scale}px;">🎯</div>
          <div>
            <div style="font-size:${16 * fontScale}px;font-weight:600;color:${
        colors.text
      };">Demo Widget</div>
            <div style="font-size:${12 * fontScale}px;color:${
        colors.subtext
      };">完整功能示例</div>
          </div>
        </div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center;">
          <div style="font-size:${14 * fontScale}px;color:${
        colors.text
      };">Widget 内容区域</div>
        </div>
      `;
    }

    root.appendChild(content);

    // 7. 编辑模式指示器
    if (props.isEditMode) {
      var indicator = document.createElement("div");
      indicator.style.cssText =
        "position:absolute;inset:0;" +
        "border:2px dashed rgba(139,92,246,0.5);" +
        "border-radius:" +
        12 * scale +
        "px;" +
        "pointer-events:none;z-index:100;";
      root.appendChild(indicator);
    }

    // 8. 渲染到容器
    container.appendChild(root);
  },
};
```

---

## ⚠️ 注意事项

### 1. 容器样式

- **不要修改** `container` 的 `position`、`width`、`height`
- 创建子元素时使用 `position: absolute; inset: 0;` 填满容器

### 2. 性能优化

- 避免频繁 DOM 操作，一次性构建 HTML
- 使用 CSS transition 而非 JavaScript 动画
- 缓存计算结果（颜色、尺寸等）

### 3. 主题兼容

- 必须同时支持亮色和暗色主题
- 使用 `props.theme` 判断当前主题
- 监听主题变化需要使用 `Tapp.ui.onThemeChange()`

### 4. 国际化

- 使用 `props.locale` 获取当前语言
- 预定义多语言文案对象
- 非中文语言适当减小字体（英文单词较长）

### 5. 可访问性

- 按钮添加 `title` 属性
- 图标配合文字说明
- 保持足够的颜色对比度

---

## 🔗 相关资源

- [Tapp SDK API 文档](./TAPP_DEVELOPMENT.md)
- [Widget Grid 布局说明](../features/)
- [主题系统文档](../CONFIG_FORM_LAYOUT.md)
