# VSCode 扩展安装指南

## 快速安装（推荐）

### 方式 1: 使用自动化脚本

在项目根目录运行：

```powershell
.\scripts\install-extensions.ps1
```

这将自动安装所有推荐的扩展。

### 方式 2: 通过 VSCode 界面

1. 打开 VSCode
2. 按 `Ctrl + Shift + P`
3. 输入 `Extensions: Show Recommended Extensions`
4. 点击 **Install All** 按钮

### 方式 3: 手动安装

按 `Ctrl + Shift + X` 打开扩展面板，搜索并安装以下扩展：

## 必需扩展 (Required)

### 1. 🦀 Rust Analyzer
**ID:** `rust-lang.rust-analyzer`

**功能:**
- Rust 语言服务器
- 代码补全、跳转定义
- 实时错误检查
- 代码格式化

**重要性:** ⭐⭐⭐⭐⭐ **最重要！没有这个扩展，Rust 代码会显示错误**

### 2. 📄 Even Better TOML
**ID:** `tamasfe.even-better-toml`

**功能:**
- `Cargo.toml` 语法高亮
- 配置文件验证
- 自动补全

**重要性:** ⭐⭐⭐⭐

### 3. 🚀 Astro
**ID:** `astro-build.astro-vscode`

**功能:**
- `.astro` 文件支持
- 语法高亮
- 智能提示

**重要性:** ⭐⭐⭐⭐⭐ **必需，否则 Astro 文件会报错**

## 推荐扩展 (Recommended)

### 4. 📦 Crates
**ID:** `serayuzgur.crates`

**功能:**
- 显示 Cargo.toml 中依赖的最新版本
- 一键更新依赖
- 漏洞警告

**重要性:** ⭐⭐⭐

### 5. 💅 Prettier
**ID:** `esbenp.prettier-vscode`

**功能:**
- JavaScript/TypeScript 代码格式化
- JSON/Markdown 格式化
- 保存时自动格式化

**重要性:** ⭐⭐⭐⭐

### 6. 🎨 Tailwind CSS IntelliSense
**ID:** `bradlc.vscode-tailwindcss`

**功能:**
- Tailwind 类名自动补全
- 类名悬停预览
- 语法高亮

**重要性:** ⭐⭐⭐⭐

### 7. ✅ ESLint
**ID:** `dbaeumer.vscode-eslint`

**功能:**
- JavaScript/TypeScript 代码检查
- 自动修复问题

**重要性:** ⭐⭐⭐

### 8. 🐳 Docker
**ID:** `ms-azuretools.vscode-docker`

**功能:**
- Dockerfile 语法支持
- Docker Compose 支持
- 容器管理界面

**重要性:** ⭐⭐⭐

## 验证安装

安装完成后，验证扩展是否正常工作：

```powershell
# 重启 VSCode
# 打开任意 Rust 文件，应该看到：
# - 右下角显示 "rust-analyzer"
# - 代码有语法高亮和智能提示
# - 没有红色波浪线（错误提示）
```

## 常见问题

### Q: 安装了 rust-analyzer 但还是显示错误？

**A:** 等待索引完成（首次可能需要 3-5 分钟）
- 右下角会显示 "Indexing..." 进度
- 完成后会显示 "rust-analyzer: Ready"

### Q: rust-analyzer 加载很慢？

**A:** 这是正常的，特别是首次打开项目时：
```powershell
# 可以手动触发构建以加速索引
cd backend
cargo check
```

### Q: Astro 文件还是显示错误？

**A:** 重启 VSCode 或重新加载窗口：
- 按 `Ctrl + Shift + P`
- 输入 "Developer: Reload Window"

### Q: 格式化不工作？

**A:** 检查设置已启用：
```json
{
  "editor.formatOnSave": true
}
```

## 扩展配置

所有推荐的配置已保存在 `.vscode/settings.json`，包括：

- ✅ 保存时自动格式化
- ✅ Rust Analyzer 使用 Clippy 检查
- ✅ 各语言的默认格式化工具
- ✅ 文件搜索排除规则

## 禁用不需要的扩展

如果某些扩展导致性能问题，可以禁用：

1. 右键点击扩展
2. 选择 "Disable (Workspace)"
3. 只在当前工作区禁用

## 更新扩展

VSCode 会自动更新扩展，或手动更新：

```powershell
# 查看可更新的扩展
code --list-extensions --show-versions

# 更新所有扩展
# （在 VSCode 扩展面板点击 "Update All"）
```

---

**安装完成后记得重启 VSCode！** 🎉
