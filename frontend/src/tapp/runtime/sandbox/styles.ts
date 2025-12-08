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
 * Tailwind CDN Script 标签
 * 使用完整 Tailwind Play CDN，支持所有 Tailwind 类
 * 
 * 🎯 优势：
 * - 完整 Tailwind 支持（包括 JIT 编译）
 * - 支持任意值：bg-[#1da1f2], w-[200px] 等
 * - 自动深色模式：dark: 前缀
 * - 无需手动维护子集
 */
export const TAILWIND_CDN_SCRIPT = `<script src="https://cdn.tailwindcss.com"></script>
<script>
  tailwind.config = {
    darkMode: 'class',
    theme: {
      extend: {
        colors: {
          'tapp-primary': 'var(--tapp-primary)',
        }
      }
    }
  }
</script>`

/**
 * @deprecated 使用 TAILWIND_CDN_SCRIPT 代替
 * Tailwind 子集工具类 - 仅作为离线备用
 */
export const TAILWIND_SUBSET = `
/* ========== Flexbox ========== */
.flex { display: flex; }
.inline-flex { display: inline-flex; }
.flex-col { flex-direction: column; }
.flex-row { flex-direction: row; }
.flex-row-reverse { flex-direction: row-reverse; }
.flex-col-reverse { flex-direction: column-reverse; }
.flex-1 { flex: 1 1 0%; }
.flex-auto { flex: 1 1 auto; }
.flex-initial { flex: 0 1 auto; }
.flex-none { flex: none; }
.flex-wrap { flex-wrap: wrap; }
.flex-nowrap { flex-wrap: nowrap; }
.flex-shrink-0 { flex-shrink: 0; }
.flex-grow { flex-grow: 1; }
.items-center { align-items: center; }
.items-start { align-items: flex-start; }
.items-end { align-items: flex-end; }
.items-baseline { align-items: baseline; }
.items-stretch { align-items: stretch; }
.justify-center { justify-content: center; }
.justify-between { justify-content: space-between; }
.justify-around { justify-content: space-around; }
.justify-evenly { justify-content: space-evenly; }
.justify-start { justify-content: flex-start; }
.justify-end { justify-content: flex-end; }
.self-auto { align-self: auto; }
.self-start { align-self: flex-start; }
.self-end { align-self: flex-end; }
.self-center { align-self: center; }
.self-stretch { align-self: stretch; }

/* ========== Grid ========== */
.grid { display: grid; }
.grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
.grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.col-span-1 { grid-column: span 1 / span 1; }
.col-span-2 { grid-column: span 2 / span 2; }
.col-span-full { grid-column: 1 / -1; }

/* ========== Gap ========== */
.gap-0 { gap: 0; }
.gap-0\\.5 { gap: 0.125rem; }
.gap-1 { gap: 0.25rem; }
.gap-1\\.5 { gap: 0.375rem; }
.gap-2 { gap: 0.5rem; }
.gap-3 { gap: 0.75rem; }
.gap-4 { gap: 1rem; }
.gap-5 { gap: 1.25rem; }
.gap-6 { gap: 1.5rem; }
.gap-8 { gap: 2rem; }

/* ========== Spacing (Padding) ========== */
.p-0 { padding: 0; }
.p-1 { padding: 0.25rem; }
.p-2 { padding: 0.5rem; }
.p-3 { padding: 0.75rem; }
.p-4 { padding: 1rem; }
.p-5 { padding: 1.25rem; }
.p-6 { padding: 1.5rem; }
.p-8 { padding: 2rem; }
.p-12 { padding: 3rem; }
.px-1 { padding-left: 0.25rem; padding-right: 0.25rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.px-4 { padding-left: 1rem; padding-right: 1rem; }
.px-5 { padding-left: 1.25rem; padding-right: 1.25rem; }
.px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
.px-8 { padding-left: 2rem; padding-right: 2rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.py-1\\.5 { padding-top: 0.375rem; padding-bottom: 0.375rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
.py-4 { padding-top: 1rem; padding-bottom: 1rem; }
.py-6 { padding-top: 1.5rem; padding-bottom: 1.5rem; }
.pt-0 { padding-top: 0; }
.pt-2 { padding-top: 0.5rem; }
.pt-4 { padding-top: 1rem; }
.pt-6 { padding-top: 1.5rem; }
.pb-2 { padding-bottom: 0.5rem; }
.pb-4 { padding-bottom: 1rem; }
.pl-2 { padding-left: 0.5rem; }
.pl-4 { padding-left: 1rem; }
.pr-2 { padding-right: 0.5rem; }
.pr-4 { padding-right: 1rem; }

/* ========== Spacing (Margin) ========== */
.m-0 { margin: 0; }
.m-1 { margin: 0.25rem; }
.m-2 { margin: 0.5rem; }
.m-4 { margin: 1rem; }
.m-auto { margin: auto; }
.mx-auto { margin-left: auto; margin-right: auto; }
.mx-2 { margin-left: 0.5rem; margin-right: 0.5rem; }
.mx-4 { margin-left: 1rem; margin-right: 1rem; }
.my-2 { margin-top: 0.5rem; margin-bottom: 0.5rem; }
.my-4 { margin-top: 1rem; margin-bottom: 1rem; }
.mt-0 { margin-top: 0; }
.mt-1 { margin-top: 0.25rem; }
.mt-2 { margin-top: 0.5rem; }
.mt-3 { margin-top: 0.75rem; }
.mt-4 { margin-top: 1rem; }
.mt-6 { margin-top: 1.5rem; }
.mt-8 { margin-top: 2rem; }
.mb-0 { margin-bottom: 0; }
.mb-1 { margin-bottom: 0.25rem; }
.mb-2 { margin-bottom: 0.5rem; }
.mb-3 { margin-bottom: 0.75rem; }
.mb-4 { margin-bottom: 1rem; }
.mb-6 { margin-bottom: 1.5rem; }
.mb-8 { margin-bottom: 2rem; }
.ml-1 { margin-left: 0.25rem; }
.ml-2 { margin-left: 0.5rem; }
.ml-4 { margin-left: 1rem; }
.ml-auto { margin-left: auto; }
.mr-1 { margin-right: 0.25rem; }
.mr-2 { margin-right: 0.5rem; }
.mr-4 { margin-right: 1rem; }
.mr-auto { margin-right: auto; }
.-mt-1 { margin-top: -0.25rem; }
.-mt-2 { margin-top: -0.5rem; }
.-mb-1 { margin-bottom: -0.25rem; }
.-ml-1 { margin-left: -0.25rem; }
.-mr-1 { margin-right: -0.25rem; }

/* ========== Sizing ========== */
.w-0 { width: 0; }
.w-1 { width: 0.25rem; }
.w-2 { width: 0.5rem; }
.w-3 { width: 0.75rem; }
.w-4 { width: 1rem; }
.w-5 { width: 1.25rem; }
.w-6 { width: 1.5rem; }
.w-8 { width: 2rem; }
.w-10 { width: 2.5rem; }
.w-12 { width: 3rem; }
.w-16 { width: 4rem; }
.w-20 { width: 5rem; }
.w-24 { width: 6rem; }
.w-32 { width: 8rem; }
.w-40 { width: 10rem; }
.w-48 { width: 12rem; }
.w-full { width: 100%; }
.w-screen { width: 100vw; }
.w-auto { width: auto; }
.min-w-0 { min-width: 0; }
.min-w-full { min-width: 100%; }
.max-w-xs { max-width: 20rem; }
.max-w-sm { max-width: 24rem; }
.max-w-md { max-width: 28rem; }
.max-w-lg { max-width: 32rem; }
.max-w-xl { max-width: 36rem; }
.max-w-2xl { max-width: 42rem; }
.max-w-3xl { max-width: 48rem; }
.max-w-4xl { max-width: 56rem; }
.max-w-5xl { max-width: 64rem; }
.max-w-full { max-width: 100%; }
.max-w-\\[75\\%\\] { max-width: 75%; }
.h-0 { height: 0; }
.h-1 { height: 0.25rem; }
.h-2 { height: 0.5rem; }
.h-3 { height: 0.75rem; }
.h-4 { height: 1rem; }
.h-5 { height: 1.25rem; }
.h-6 { height: 1.5rem; }
.h-8 { height: 2rem; }
.h-10 { height: 2.5rem; }
.h-12 { height: 3rem; }
.h-16 { height: 4rem; }
.h-20 { height: 5rem; }
.h-24 { height: 6rem; }
.h-32 { height: 8rem; }
.h-48 { height: 12rem; }
.h-full { height: 100%; }
.h-screen { height: 100vh; }
.h-auto { height: auto; }
.min-h-0 { min-height: 0; }
.min-h-full { min-height: 100%; }
.min-h-screen { min-height: 100vh; }
.min-h-\\[48px\\] { min-height: 48px; }
.min-h-\\[40px\\] { min-height: 40px; }
.max-h-full { max-height: 100%; }
.max-h-screen { max-height: 100vh; }
.max-h-\\[150px\\] { max-height: 150px; }
.max-h-8 { max-height: 2rem; }

/* ========== Border Radius ========== */
.rounded-none { border-radius: 0; }
.rounded-sm { border-radius: 0.125rem; }
.rounded { border-radius: 0.25rem; }
.rounded-md { border-radius: 0.375rem; }
.rounded-lg { border-radius: 0.5rem; }
.rounded-xl { border-radius: 0.75rem; }
.rounded-2xl { border-radius: 1rem; }
.rounded-3xl { border-radius: 1.5rem; }
.rounded-full { border-radius: 9999px; }

/* ========== Border ========== */
.border { border-width: 1px; }
.border-0 { border-width: 0; }
.border-2 { border-width: 2px; }
.border-t { border-top-width: 1px; }
.border-b { border-bottom-width: 1px; }
.border-l { border-left-width: 1px; }
.border-r { border-right-width: 1px; }
.border-solid { border-style: solid; }
.border-dashed { border-style: dashed; }
.border-dotted { border-style: dotted; }
.border-none { border-style: none; }
.border-transparent { border-color: transparent; }
.border-white { border-color: #ffffff; }
.border-black { border-color: #000000; }
.border-neutral-200 { border-color: rgb(229 229 229); }
.border-neutral-300 { border-color: rgb(212 212 212); }
.border-neutral-400 { border-color: rgb(163 163 163); }
.border-neutral-700 { border-color: rgb(64 64 64); }
.border-neutral-800 { border-color: rgb(38 38 38); }
.border-indigo-500 { border-color: rgb(99 102 241); }
.border-blue-500 { border-color: rgb(59 130 246); }
.dark .dark\\:border-neutral-700 { border-color: rgb(64 64 64); }
.dark .dark\\:border-neutral-800 { border-color: rgb(38 38 38); }
.dark .dark\\:border-indigo-500 { border-color: rgb(99 102 241); }

/* ========== Background Colors ========== */
.bg-transparent { background-color: transparent; }
.bg-white { background-color: #ffffff; }
.bg-black { background-color: #000000; }
.bg-neutral-50 { background-color: rgb(250 250 250); }
.bg-neutral-100 { background-color: rgb(245 245 245); }
.bg-neutral-200 { background-color: rgb(229 229 229); }
.bg-neutral-700 { background-color: rgb(64 64 64); }
.bg-neutral-800 { background-color: rgb(38 38 38); }
.bg-neutral-900 { background-color: rgb(23 23 23); }
.bg-neutral-950 { background-color: rgb(10 10 10); }
.bg-indigo-500 { background-color: rgb(99 102 241); }
.bg-indigo-600 { background-color: rgb(79 70 229); }
.bg-indigo-700 { background-color: rgb(67 56 202); }
.bg-violet-500 { background-color: rgb(139 92 246); }
.bg-violet-600 { background-color: rgb(124 58 237); }
.bg-blue-500 { background-color: rgb(59 130 246); }
.bg-blue-600 { background-color: rgb(37 99 235); }
.bg-green-500 { background-color: rgb(34 197 94); }
.bg-green-600 { background-color: rgb(22 163 74); }
.bg-red-500 { background-color: rgb(239 68 68); }
.bg-red-600 { background-color: rgb(220 38 38); }
.bg-yellow-500 { background-color: rgb(234 179 8); }
.bg-orange-500 { background-color: rgb(249 115 22); }
.bg-white\\/60 { background-color: rgba(255, 255, 255, 0.6); }
.bg-white\\/80 { background-color: rgba(255, 255, 255, 0.8); }
.bg-black\\/50 { background-color: rgba(0, 0, 0, 0.5); }
.bg-neutral-50\\/50 { background-color: rgba(250, 250, 250, 0.5); }
.dark .dark\\:bg-neutral-800 { background-color: rgb(38 38 38); }
.dark .dark\\:bg-neutral-900 { background-color: rgb(23 23 23); }
.dark .dark\\:bg-neutral-950 { background-color: rgb(10 10 10); }
.dark .dark\\:bg-white\\/\\[0\\.03\\] { background-color: rgba(255, 255, 255, 0.03); }
.dark .dark\\:bg-white\\/\\[0\\.02\\] { background-color: rgba(255, 255, 255, 0.02); }
.dark .dark\\:bg-white\\/5 { background-color: rgba(255, 255, 255, 0.05); }

/* ========== Text Colors ========== */
.text-white { color: #ffffff; }
.text-black { color: #000000; }
.text-neutral-100 { color: rgb(245 245 245); }
.text-neutral-200 { color: rgb(229 229 229); }
.text-neutral-300 { color: rgb(212 212 212); }
.text-neutral-400 { color: rgb(163 163 163); }
.text-neutral-500 { color: rgb(115 115 115); }
.text-neutral-600 { color: rgb(82 82 82); }
.text-neutral-700 { color: rgb(64 64 64); }
.text-neutral-800 { color: rgb(38 38 38); }
.text-indigo-400 { color: rgb(129 140 248); }
.text-indigo-500 { color: rgb(99 102 241); }
.text-indigo-600 { color: rgb(79 70 229); }
.text-blue-500 { color: rgb(59 130 246); }
.text-green-500 { color: rgb(34 197 94); }
.text-red-500 { color: rgb(239 68 68); }
.text-yellow-500 { color: rgb(234 179 8); }
.dark .dark\\:text-white { color: #ffffff; }
.dark .dark\\:text-neutral-100 { color: rgb(245 245 245); }
.dark .dark\\:text-neutral-200 { color: rgb(229 229 229); }
.dark .dark\\:text-neutral-300 { color: rgb(212 212 212); }
.dark .dark\\:text-neutral-400 { color: rgb(163 163 163); }
.dark .dark\\:text-indigo-400 { color: rgb(129 140 248); }
.placeholder-neutral-400::placeholder { color: rgb(163 163 163); }
.dark .dark\\:placeholder-neutral-500::placeholder { color: rgb(115 115 115); }

/* ========== Typography ========== */
.text-xs { font-size: 0.75rem; line-height: 1rem; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-base { font-size: 1rem; line-height: 1.5rem; }
.text-lg { font-size: 1.125rem; line-height: 1.75rem; }
.text-xl { font-size: 1.25rem; line-height: 1.75rem; }
.text-2xl { font-size: 1.5rem; line-height: 2rem; }
.text-3xl { font-size: 1.875rem; line-height: 2.25rem; }
.text-4xl { font-size: 2.25rem; line-height: 2.5rem; }
.text-5xl { font-size: 3rem; line-height: 1; }
.font-normal { font-weight: 400; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.font-bold { font-weight: 700; }
.font-mono { font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, monospace; }
.italic { font-style: italic; }
.not-italic { font-style: normal; }
.uppercase { text-transform: uppercase; }
.lowercase { text-transform: lowercase; }
.capitalize { text-transform: capitalize; }
.normal-case { text-transform: none; }
.tracking-tight { letter-spacing: -0.025em; }
.tracking-normal { letter-spacing: 0; }
.tracking-wide { letter-spacing: 0.025em; }
.tracking-wider { letter-spacing: 0.05em; }
.leading-none { line-height: 1; }
.leading-tight { line-height: 1.25; }
.leading-normal { line-height: 1.5; }
.leading-relaxed { line-height: 1.625; }
.text-center { text-align: center; }
.text-left { text-align: left; }
.text-right { text-align: right; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.whitespace-nowrap { white-space: nowrap; }
.whitespace-pre { white-space: pre; }
.whitespace-pre-wrap { white-space: pre-wrap; }
.break-words { overflow-wrap: break-word; word-break: break-word; }
.break-all { word-break: break-all; }

/* ========== Opacity ========== */
.opacity-0 { opacity: 0; }
.opacity-10 { opacity: 0.1; }
.opacity-25 { opacity: 0.25; }
.opacity-50 { opacity: 0.5; }
.opacity-75 { opacity: 0.75; }
.opacity-100 { opacity: 1; }

/* ========== Overflow ========== */
.overflow-auto { overflow: auto; }
.overflow-hidden { overflow: hidden; }
.overflow-visible { overflow: visible; }
.overflow-scroll { overflow: scroll; }
.overflow-x-auto { overflow-x: auto; }
.overflow-y-auto { overflow-y: auto; }
.overflow-x-hidden { overflow-x: hidden; }
.overflow-y-hidden { overflow-y: hidden; }

/* ========== Position ========== */
.static { position: static; }
.fixed { position: fixed; }
.absolute { position: absolute; }
.relative { position: relative; }
.sticky { position: sticky; }
.inset-0 { top: 0; right: 0; bottom: 0; left: 0; }
.inset-x-0 { left: 0; right: 0; }
.inset-y-0 { top: 0; bottom: 0; }
.top-0 { top: 0; }
.top-1 { top: 0.25rem; }
.top-2 { top: 0.5rem; }
.top-4 { top: 1rem; }
.right-0 { right: 0; }
.right-1 { right: 0.25rem; }
.right-2 { right: 0.5rem; }
.right-4 { right: 1rem; }
.bottom-0 { bottom: 0; }
.bottom-2 { bottom: 0.5rem; }
.bottom-4 { bottom: 1rem; }
.left-0 { left: 0; }
.left-2 { left: 0.5rem; }
.left-4 { left: 1rem; }
.-top-2 { top: -0.5rem; }
.-top-8 { top: -2rem; }
.-right-2 { right: -0.5rem; }
.-right-8 { right: -2rem; }
.-bottom-2 { bottom: -0.5rem; }
.-left-2 { left: -0.5rem; }

/* ========== Z-Index ========== */
.z-0 { z-index: 0; }
.z-10 { z-index: 10; }
.z-20 { z-index: 20; }
.z-30 { z-index: 30; }
.z-40 { z-index: 40; }
.z-50 { z-index: 50; }

/* ========== Display ========== */
.hidden { display: none; }
.block { display: block; }
.inline-block { display: inline-block; }
.inline { display: inline; }
.contents { contents: contents; }

/* ========== Visibility ========== */
.visible { visibility: visible; }
.invisible { visibility: hidden; }

/* ========== Cursor ========== */
.cursor-auto { cursor: auto; }
.cursor-default { cursor: default; }
.cursor-pointer { cursor: pointer; }
.cursor-wait { cursor: wait; }
.cursor-text { cursor: text; }
.cursor-not-allowed { cursor: not-allowed; }

/* ========== User Select ========== */
.select-none { user-select: none; }
.select-text { user-select: text; }
.select-all { user-select: all; }

/* ========== Pointer Events ========== */
.pointer-events-none { pointer-events: none; }
.pointer-events-auto { pointer-events: auto; }

/* ========== Resize ========== */
.resize-none { resize: none; }
.resize { resize: both; }
.resize-y { resize: vertical; }
.resize-x { resize: horizontal; }

/* ========== Outline ========== */
.outline-none { outline: 2px solid transparent; outline-offset: 2px; }
.outline { outline-style: solid; }

/* ========== Ring (Focus) ========== */
.ring-0 { box-shadow: var(--tw-ring-inset) 0 0 0 calc(0px + var(--tw-ring-offset-width)) var(--tw-ring-color); }
.ring-1 { box-shadow: var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color); }
.ring-2 { box-shadow: var(--tw-ring-inset) 0 0 0 calc(2px + var(--tw-ring-offset-width)) var(--tw-ring-color); }
.focus\\:ring-2:focus { box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2); }
.focus\\:ring-indigo-500\\/20:focus { box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2); }
.focus\\:border-indigo-500:focus { border-color: rgb(99 102 241); }

/* ========== Shadow ========== */
.shadow-sm { box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
.shadow { box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1); }
.shadow-md { box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); }
.shadow-lg { box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); }
.shadow-xl { box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1); }
.shadow-2xl { box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25); }
.shadow-none { box-shadow: none; }

/* ========== Transitions ========== */
.transition-none { transition-property: none; }
.transition-all { transition-property: all; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition { transition-property: color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition-colors { transition-property: color, background-color, border-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition-opacity { transition-property: opacity; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.transition-transform { transition-property: transform; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; }
.duration-75 { transition-duration: 75ms; }
.duration-100 { transition-duration: 100ms; }
.duration-150 { transition-duration: 150ms; }
.duration-200 { transition-duration: 200ms; }
.duration-300 { transition-duration: 300ms; }
.duration-500 { transition-duration: 500ms; }
.ease-linear { transition-timing-function: linear; }
.ease-in { transition-timing-function: cubic-bezier(0.4, 0, 1, 1); }
.ease-out { transition-timing-function: cubic-bezier(0, 0, 0.2, 1); }
.ease-in-out { transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }

/* ========== Transform ========== */
.transform { transform: translateX(var(--tw-translate-x)) translateY(var(--tw-translate-y)) rotate(var(--tw-rotate)) skewX(var(--tw-skew-x)) skewY(var(--tw-skew-y)) scaleX(var(--tw-scale-x)) scaleY(var(--tw-scale-y)); }
.translate-y-0 { transform: translateY(0); }
.translate-y-2 { transform: translateY(0.5rem); }
.-translate-y-2 { transform: translateY(-0.5rem); }
.scale-95 { transform: scale(0.95); }
.scale-100 { transform: scale(1); }
.scale-105 { transform: scale(1.05); }
.scale-110 { transform: scale(1.1); }
.hover\\:scale-105:hover { transform: scale(1.05); }
.hover\\:scale-110:hover { transform: scale(1.1); }
.active\\:scale-95:active { transform: scale(0.95); }

/* ========== Gradients ========== */
.bg-gradient-to-t { background-image: linear-gradient(to top, var(--tw-gradient-stops)); }
.bg-gradient-to-tr { background-image: linear-gradient(to top right, var(--tw-gradient-stops)); }
.bg-gradient-to-r { background-image: linear-gradient(to right, var(--tw-gradient-stops)); }
.bg-gradient-to-br { background-image: linear-gradient(to bottom right, var(--tw-gradient-stops)); }
.bg-gradient-to-b { background-image: linear-gradient(to bottom, var(--tw-gradient-stops)); }
.bg-gradient-to-bl { background-image: linear-gradient(to bottom left, var(--tw-gradient-stops)); }
.bg-gradient-to-l { background-image: linear-gradient(to left, var(--tw-gradient-stops)); }
.bg-gradient-to-tl { background-image: linear-gradient(to top left, var(--tw-gradient-stops)); }
.from-indigo-500 { --tw-gradient-from: rgb(99 102 241); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); }
.from-violet-500 { --tw-gradient-from: rgb(139 92 246); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); }
.from-violet-600 { --tw-gradient-from: rgb(124 58 237); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); }
.from-neutral-50\\/50 { --tw-gradient-from: rgba(250, 250, 250, 0.5); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); }
.to-violet-600 { --tw-gradient-to: rgb(124 58 237); }
.to-indigo-600 { --tw-gradient-to: rgb(79 70 229); }
.to-transparent { --tw-gradient-to: transparent; }
.dark .dark\\:from-white\\/\\[0\\.02\\] { --tw-gradient-from: rgba(255, 255, 255, 0.02); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); }
.dark .dark\\:to-transparent { --tw-gradient-to: transparent; }

/* ========== Backdrop Filter ========== */
.backdrop-blur { backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
.backdrop-blur-sm { backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.backdrop-blur-md { backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.backdrop-blur-lg { backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
.backdrop-blur-xl { backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px); }

/* ========== Glass Effect ========== */
.glass {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.dark .glass {
  background: rgba(38, 38, 38, 0.8);
}

/* ========== Hover States ========== */
.hover\\:bg-neutral-100:hover { background-color: rgb(245 245 245); }
.hover\\:bg-neutral-200:hover { background-color: rgb(229 229 229); }
.hover\\:bg-indigo-50:hover { background-color: rgb(238 242 255); }
.hover\\:bg-indigo-600:hover { background-color: rgb(79 70 229); }
.hover\\:bg-indigo-700:hover { background-color: rgb(67 56 202); }
.hover\\:text-indigo-600:hover { color: rgb(79 70 229); }
.hover\\:shadow-lg:hover { box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); }
.hover\\:border-indigo-500:hover { border-color: rgb(99 102 241); }
.dark .dark\\:hover\\:bg-neutral-700:hover { background-color: rgb(64 64 64); }
.dark .dark\\:hover\\:bg-neutral-800:hover { background-color: rgb(38 38 38); }
.dark .dark\\:hover\\:bg-indigo-950:hover { background-color: rgb(30 27 75); }
.dark .dark\\:hover\\:text-indigo-400:hover { color: rgb(129 140 248); }
.dark .dark\\:hover\\:border-indigo-500:hover { border-color: rgb(99 102 241); }
.group:hover .group-hover\\:text-indigo-600 { color: rgb(79 70 229); }
.dark .group:hover .dark\\:group-hover\\:text-indigo-400 { color: rgb(129 140 248); }

/* ========== Disabled States ========== */
.disabled\\:opacity-50:disabled { opacity: 0.5; }
.disabled\\:cursor-not-allowed:disabled { cursor: not-allowed; }
.disabled\\:hover\\:scale-100:disabled:hover { transform: scale(1); }

/* ========== Space Between ========== */
.space-y-1 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.25rem; }
.space-y-2 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.5rem; }
.space-y-3 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.75rem; }
.space-y-4 > :not([hidden]) ~ :not([hidden]) { margin-top: 1rem; }
.space-x-1 > :not([hidden]) ~ :not([hidden]) { margin-left: 0.25rem; }
.space-x-2 > :not([hidden]) ~ :not([hidden]) { margin-left: 0.5rem; }
.space-x-3 > :not([hidden]) ~ :not([hidden]) { margin-left: 0.75rem; }
.space-x-4 > :not([hidden]) ~ :not([hidden]) { margin-left: 1rem; }

/* ========== Animations ========== */
@keyframes bounce {
  0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8, 0, 1, 1); }
  50% { transform: translateY(0); animation-timing-function: cubic-bezier(0, 0, 0.2, 1); }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes fade-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-bounce { animation: bounce 1s infinite; }
.animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
.animate-spin { animation: spin 1s linear infinite; }
.animate-fade-in { animation: fade-in 0.3s ease-out; }
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

/** 
 * Widget 模式的完整静态 CSS（不含主题变量）
 * 🎯 Tailwind 通过 CDN 加载，不再内联
 */
export const WIDGET_STATIC_CSS = `${BASE_CSS}${WIDGET_CSS}${COMPONENT_CSS}` as const

/** 
 * Page 模式的完整静态 CSS（不含主题变量）
 * 🎯 Tailwind 通过 CDN 加载，不再内联
 */
export const PAGE_STATIC_CSS = `${BASE_CSS}${PAGE_CSS}${COMPONENT_CSS}` as const

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