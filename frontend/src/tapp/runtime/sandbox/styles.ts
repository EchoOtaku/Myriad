/**
 * 沙箱 CSS 样式
 * 
 * 提供基础 CSS、Tailwind 子集和主题变量
 * 
 * 🎯 性能优化：
 * - 静态 CSS 使用模块级常量（避免重复计算）
 * - 主题 CSS 使用缓存（相同参数返回缓存结果）
 * - 组合 CSS 预计算
 */

// ========================
// 🎯 主题 CSS 缓存
// ========================

/** 主题 CSS 缓存 */
const themeCSSCache = new Map<string, string>()

/**
 * 生成主题 CSS 变量（带缓存）
 * 
 * @param isDark - 是否暗色主题
 * @param primaryColor - 主色调
 * @returns 主题 CSS 字符串
 */
export function generateThemeCSS(isDark: boolean, primaryColor: string): string {
  const cacheKey = `${isDark ? 'd' : 'l'}-${primaryColor}`
  
  const cached = themeCSSCache.get(cacheKey)
  if (cached) return cached
  
  // 限制缓存大小（最多保留 20 个主题组合）
  if (themeCSSCache.size > 20) {
    const firstKey = themeCSSCache.keys().next().value
    if (firstKey) themeCSSCache.delete(firstKey)
  }
  
  const css = `
:root {
  --tapp-primary: ${primaryColor};
  --tapp-text: ${isDark ? '#f3f4f6' : '#1f2937'};
  --tapp-subtext: ${isDark ? '#9ca3af' : '#6b7280'};
  --tapp-bg: ${isDark ? '#0a0a0a' : '#f8fafc'};
  --tapp-card-bg: ${isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.7)'};
  --tapp-border: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'};
  --tapp-input-bg: ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.9)'};
  --tapp-scale: 1;
  --tapp-font-scale: 1;
}
`
  
  themeCSSCache.set(cacheKey, css)
  return css
}

/**
 * 基础 CSS 重置
 */
export const BASE_CSS = `
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
`

/**
 * Widget 专用 CSS
 */
export const WIDGET_CSS = `
body {
  background: transparent;
}

#widget-root {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
}
`

/**
 * Page 专用 CSS
 */
export const PAGE_CSS = `
#tapp-root {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
}

#tapp-background {
  position: absolute;
  inset: 0;
  z-index: 0;
}

#tapp-content {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
}
`

/**
 * Tailwind 子集工具类
 */
export const TAILWIND_SUBSET = `
.flex { display: flex; }
.flex-col { flex-direction: column; }
.flex-row { flex-direction: row; }
.flex-1 { flex: 1; }
.flex-wrap { flex-wrap: wrap; }
.items-center { align-items: center; }
.items-start { align-items: flex-start; }
.items-end { align-items: flex-end; }
.justify-center { justify-content: center; }
.justify-between { justify-content: space-between; }
.justify-start { justify-content: flex-start; }
.justify-end { justify-content: flex-end; }
.gap-1 { gap: 0.25rem; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.p-1 { padding: 0.25rem; }
.p-2 { padding: 0.5rem; }
.p-3 { padding: 0.75rem; }
.p-4 { padding: 1rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
.m-0 { margin: 0; }
.m-2 { margin: 0.5rem; }
.mt-2 { margin-top: 0.5rem; }
.mb-2 { margin-bottom: 0.5rem; }
.rounded { border-radius: 0.25rem; }
.rounded-lg { border-radius: 0.5rem; }
.rounded-xl { border-radius: 0.75rem; }
.rounded-2xl { border-radius: 1rem; }
.rounded-full { border-radius: 9999px; }
.overflow-hidden { overflow: hidden; }
.overflow-auto { overflow: auto; }
.overflow-y-auto { overflow-y: auto; }
.w-full { width: 100%; }
.h-full { height: 100%; }
.min-w-0 { min-width: 0; }
.min-h-0 { min-height: 0; }
.text-center { text-align: center; }
.text-left { text-align: left; }
.text-right { text-align: right; }
.text-xs { font-size: 0.75rem; }
.text-sm { font-size: 0.875rem; }
.text-base { font-size: 1rem; }
.text-lg { font-size: 1.125rem; }
.text-xl { font-size: 1.25rem; }
.text-2xl { font-size: 1.5rem; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.font-bold { font-weight: 700; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.whitespace-nowrap { white-space: nowrap; }
.opacity-50 { opacity: 0.5; }
.opacity-75 { opacity: 0.75; }
.cursor-pointer { cursor: pointer; }
.select-none { user-select: none; }
.transition { transition: all 0.2s ease; }
.hidden { display: none; }
.block { display: block; }
.inline-block { display: inline-block; }
.grid { display: grid; }
.absolute { position: absolute; }
.relative { position: relative; }
.inset-0 { top: 0; right: 0; bottom: 0; left: 0; }
.z-10 { z-index: 10; }
.z-20 { z-index: 20; }
`
/**
 * 组件级 CSS - 预定义常用 UI 组件
 * 使用 CSS 变量实现响应式缩放和主题适配
 */
export const COMPONENT_CSS = `
/* ========== 动画 ========== */
@keyframes tapp-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes tapp-fade-in-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes tapp-fade-in-down {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes tapp-slide-in-left {
  from { opacity: 0; transform: translateX(-12px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes tapp-slide-in-right {
  from { opacity: 0; transform: translateX(12px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes tapp-scale-in {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes tapp-typing-dot {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-4px); }
}
@keyframes tapp-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
@keyframes tapp-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes tapp-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* 动画类 */
.tapp-animate-fade-in { animation: tapp-fade-in 0.2s ease-out; }
.tapp-animate-fade-in-up { animation: tapp-fade-in-up 0.25s ease-out; }
.tapp-animate-fade-in-down { animation: tapp-fade-in-down 0.25s ease-out; }
.tapp-animate-slide-in-left { animation: tapp-slide-in-left 0.25s ease-out; }
.tapp-animate-slide-in-right { animation: tapp-slide-in-right 0.25s ease-out; }
.tapp-animate-scale-in { animation: tapp-scale-in 0.2s ease-out; }
.tapp-animate-spin { animation: tapp-spin 1s linear infinite; }
.tapp-animate-pulse { animation: tapp-pulse 2s ease-in-out infinite; }

/* ========== 容器 ========== */
.tapp-container {
  position: absolute;
  inset: 0;
  border-radius: calc(16px * var(--tapp-scale, 1));
  overflow: hidden;
  background: var(--tapp-card-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--tapp-border);
}

.tapp-container-glass {
  background: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.dark .tapp-container-glass {
  background: rgba(15, 23, 42, 0.75);
}

.light .tapp-container-glass {
  background: rgba(255, 255, 255, 0.8);
}

/* ========== 浮动条 ========== */
.tapp-float-bar {
  position: absolute;
  left: calc(8px * var(--tapp-scale, 1));
  right: calc(8px * var(--tapp-scale, 1));
  z-index: 20;
  display: flex;
  align-items: center;
  gap: calc(8px * var(--tapp-scale, 1));
  padding: calc(8px * var(--tapp-scale, 1)) calc(12px * var(--tapp-scale, 1));
  border-radius: calc(10px * var(--tapp-scale, 1));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--tapp-border);
}

.tapp-float-bar-top {
  top: calc(8px * var(--tapp-scale, 1));
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
}

.tapp-float-bar-bottom {
  bottom: calc(8px * var(--tapp-scale, 1));
  box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.1);
}

.dark .tapp-float-bar {
  background: rgba(15, 23, 42, 0.85);
}

.light .tapp-float-bar {
  background: rgba(255, 255, 255, 0.9);
}

/* ========== 按钮 ========== */
.tapp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s ease;
  outline: none;
}

.tapp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.tapp-btn-primary {
  background: var(--tapp-primary);
  color: white;
  border-radius: calc(10px * var(--tapp-scale, 1));
  padding: calc(10px * var(--tapp-scale, 1)) calc(16px * var(--tapp-scale, 1));
  font-size: calc(13px * var(--tapp-font-scale, 1));
}

.tapp-btn-primary:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.tapp-btn-icon {
  width: calc(36px * var(--tapp-scale, 1));
  height: calc(36px * var(--tapp-scale, 1));
  border-radius: calc(10px * var(--tapp-scale, 1));
  background: var(--tapp-primary);
  color: white;
  padding: 0;
}

.tapp-btn-icon:hover:not(:disabled) {
  opacity: 0.85;
}

.tapp-btn-ghost {
  background: transparent;
  color: var(--tapp-text);
  padding: calc(8px * var(--tapp-scale, 1));
  border-radius: calc(8px * var(--tapp-scale, 1));
  opacity: 0.6;
}

.tapp-btn-ghost:hover:not(:disabled) {
  opacity: 1;
  background: var(--tapp-border);
}

/* ========== 输入框 ========== */
.tapp-input {
  flex: 1;
  min-width: 0;
  padding: calc(10px * var(--tapp-scale, 1)) calc(14px * var(--tapp-scale, 1));
  border-radius: calc(10px * var(--tapp-scale, 1));
  font-size: calc(13px * var(--tapp-font-scale, 1));
  font-family: inherit;
  background: var(--tapp-input-bg);
  border: 1px solid transparent;
  color: var(--tapp-text);
  outline: none;
  transition: all 0.2s ease;
}

.tapp-input::placeholder {
  color: var(--tapp-subtext);
}

.tapp-input:focus {
  border-color: var(--tapp-primary);
  box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.15);
}

/* ========== 消息气泡 ========== */
.tapp-msg-area {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
  gap: calc(8px * var(--tapp-scale, 1));
  padding: calc(12px * var(--tapp-scale, 1));
}

.tapp-bubble {
  max-width: 80%;
  padding: calc(10px * var(--tapp-scale, 1)) calc(14px * var(--tapp-scale, 1));
  border-radius: calc(12px * var(--tapp-scale, 1));
  font-size: calc(12px * var(--tapp-font-scale, 1));
  line-height: 1.5;
  word-break: break-word;
}

.tapp-bubble-row {
  display: flex;
}

.tapp-bubble-row-user {
  flex-direction: row-reverse;
}

.tapp-bubble-user {
  background: var(--tapp-primary);
  color: white;
  margin-left: auto;
}

.tapp-bubble-ai {
  color: var(--tapp-text);
}

.dark .tapp-bubble-ai {
  background: rgba(255, 255, 255, 0.08);
}

.light .tapp-bubble-ai {
  background: rgba(0, 0, 0, 0.04);
}

/* ========== 打字指示器 ========== */
.tapp-typing {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: calc(10px * var(--tapp-scale, 1)) calc(16px * var(--tapp-scale, 1));
  border-radius: calc(12px * var(--tapp-scale, 1));
}

.dark .tapp-typing {
  background: rgba(255, 255, 255, 0.08);
}

.light .tapp-typing {
  background: rgba(0, 0, 0, 0.04);
}

.tapp-typing-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tapp-primary);
  animation: tapp-typing-dot 1.4s infinite;
}

.tapp-typing-dot:nth-child(2) { animation-delay: 0.2s; }
.tapp-typing-dot:nth-child(3) { animation-delay: 0.4s; }

/* ========== 打字光标 ========== */
.tapp-cursor {
  animation: tapp-blink 0.8s infinite;
  opacity: 0.7;
}

/* ========== 图标容器 ========== */
.tapp-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tapp-icon-sm {
  width: calc(24px * var(--tapp-scale, 1));
  height: calc(24px * var(--tapp-scale, 1));
  border-radius: calc(6px * var(--tapp-scale, 1));
}

.tapp-icon-md {
  width: calc(32px * var(--tapp-scale, 1));
  height: calc(32px * var(--tapp-scale, 1));
  border-radius: calc(8px * var(--tapp-scale, 1));
}

.tapp-icon-lg {
  width: calc(48px * var(--tapp-scale, 1));
  height: calc(48px * var(--tapp-scale, 1));
  border-radius: calc(12px * var(--tapp-scale, 1));
}

.tapp-icon-primary {
  background: var(--tapp-primary);
  color: white;
}

/* ========== 文本样式 ========== */
.tapp-text { color: var(--tapp-text); }
.tapp-text-sub { color: var(--tapp-subtext); }
.tapp-text-primary { color: var(--tapp-primary); }
.tapp-text-error { color: #ef4444; }

.tapp-text-sm { font-size: calc(12px * var(--tapp-font-scale, 1)); }
.tapp-text-base { font-size: calc(13px * var(--tapp-font-scale, 1)); }
.tapp-text-lg { font-size: calc(15px * var(--tapp-font-scale, 1)); }

/* ========== 滚动条 ========== */
.tapp-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.tapp-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.tapp-scrollbar::-webkit-scrollbar-thumb {
  background: var(--tapp-border);
  border-radius: 2px;
}

.tapp-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--tapp-subtext);
}

/* ========== 欢迎/空状态 ========== */
.tapp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: calc(20px * var(--tapp-scale, 1));
  color: var(--tapp-subtext);
  font-size: calc(12px * var(--tapp-font-scale, 1));
}
`

// ========================
// 🎯 预计算的组合 CSS（避免运行时拼接）
// ========================

/** Widget 模式的完整静态 CSS（不含主题变量） */
export const WIDGET_STATIC_CSS = `${BASE_CSS}${WIDGET_CSS}${TAILWIND_SUBSET}${COMPONENT_CSS}` as const

/** Page 模式的完整静态 CSS（不含主题变量） */
export const PAGE_STATIC_CSS = `${BASE_CSS}${PAGE_CSS}${TAILWIND_SUBSET}${COMPONENT_CSS}` as const

/**
 * 清理主题 CSS 缓存
 * 用于内存敏感场景或主题大量变化时
 */
export function clearThemeCSSCache(): void {
  themeCSSCache.clear()
}

/**
 * 获取主题 CSS 缓存大小
 */
export function getThemeCSSCacheSize(): number {
  return themeCSSCache.size
}