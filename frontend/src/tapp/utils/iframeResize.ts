/**
 * Tapp iframe 自适应工具
 * 统一处理 iframe 在不同场景下的尺寸适配
 * 
 * 🚀 性能优化:
 * - 集成统一动画调度系统 (animation/core.ts)
 * - 复用全局 ResizeObserver，避免重复创建
 * - RAF 批量更新，防止布局抖动
 * - 自动节流，低帧率时跳过更新
 * 
 * 支持场景:
 * - Widget 模式: 小组件尺寸 (1x1 到 4x4)
 * - Page 模式: 全屏/嵌入页面
 * - 预览模式: 库中拖拽预览
 * 
 * 🎯 开发者零配置:
 * - 自动注入 CSS 变量和响应式工具类
 * - 自动发送尺寸消息到 iframe
 * - Tapp 代码可直接使用 CSS 变量或监听 tapp:resize 事件
 */

import { useRef, useLayoutEffect, useState } from 'react'
import { observeResize, isPageVisible } from '../../hooks/animation/core'

/** iframe 容器尺寸信息 */
export interface IframeDimensions {
  width: number
  height: number
  scale: number
  fontScale: number
  /** 是否为紧凑模式 (width < 150 或 height < 150) */
  isCompact: boolean
  /** 是否为迷你模式 (width < 100 或 height < 100) */
  isMini: boolean
  /** 安全区域内边距 - 顶部 (避免与控制条重叠) */
  safeInsetTop?: number
  /** 安全区域内边距 - 右侧 */
  safeInsetRight?: number
  /** 安全区域内边距 - 底部 */
  safeInsetBottom?: number
  /** 安全区域内边距 - 左侧 */
  safeInsetLeft?: number
}

/** 尺寸变化回调 */
export type OnResizeCallback = (dimensions: IframeDimensions) => void

/** 标准单元格尺寸常量 */
const BASE_CELL_SIZE = 90

/**
 * 尺寸变化阈值（像素）
 * 只有当宽度或高度变化超过此值时才触发更新
 * 这可以过滤掉 F12 开发工具打开时的微小尺寸变化
 */
const RESIZE_THRESHOLD = 10

/** 默认尺寸 */
const DEFAULT_DIMENSIONS: IframeDimensions = {
  width: 0,
  height: 0,
  scale: 1,
  fontScale: 1,
  isCompact: false,
  isMini: false,
  safeInsetTop: 0,
  safeInsetRight: 0,
  safeInsetBottom: 0,
  safeInsetLeft: 0,
}

/** 计算尺寸信息（优化：避免多次 Math 调用） */
function calculateDimensions(width: number, height: number): IframeDimensions {
  const minSize = width < height ? width : height
  const rawScale = minSize / BASE_CELL_SIZE
  const scale = rawScale < 0.1 ? 0.1 : rawScale
  
  // 字体缩放：clamp(0.6, 0.2 + scale * 0.8, 1.2)
  const rawFontScale = 0.2 + scale * 0.8
  const fontScale = rawFontScale < 0.6 ? 0.6 : rawFontScale > 1.2 ? 1.2 : rawFontScale
  
  return {
    width,
    height,
    scale,
    fontScale,
    isCompact: width < 150 || height < 150,
    isMini: width < 100 || height < 100,
    safeInsetTop: 0,
    safeInsetRight: 0,
    safeInsetBottom: 0,
    safeInsetLeft: 0,
  }
}

/**
 * Hook: 监听容器尺寸变化
 * 
 * 🚀 性能特性:
 * - 复用全局 ResizeObserver (animation/core.ts)
 * - 自动节流，页面不可见时暂停
 * - 使用 batchWrite 批量更新，避免布局抖动
 * 
 * @example
 * ```tsx
 * function TappContainer() {
 *   const { containerRef, dimensions } = useIframeResize()
 *   // dimensions 包含 width, height, scale, fontScale, isCompact, isMini
 *   return <div ref={containerRef}>...</div>
 * }
 * ```
 */
export function useIframeResize<T extends HTMLElement = HTMLDivElement>(): {
  containerRef: React.RefObject<T>
  dimensions: IframeDimensions
} {
  const containerRef = useRef<T>(null!)
  const [dimensions, setDimensions] = useState<IframeDimensions>(DEFAULT_DIMENSIONS)
  
  // 用于追踪是否已经完成初始化，避免 F12 等微小变化触发更新
  const initializedRef = useRef(false)
  const lastDimensionsRef = useRef<IframeDimensions>(DEFAULT_DIMENSIONS)
  
  // useLayoutEffect 确保在 DOM 更新后、浏览器绘制前执行
  // 这样可以确保 ref 已经绑定到元素
  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    
    // 立即计算初始尺寸
    // 注意：页面入场动画期间 getBoundingClientRect 可能返回动画中间状态的尺寸
    // 但这没关系，ResizeObserver 会在动画结束后提供正确的尺寸
    const rect = element.getBoundingClientRect()
    if (rect.width > 0 || rect.height > 0) {
      const initial = calculateDimensions(rect.width, rect.height)
      setDimensions(initial)
      lastDimensionsRef.current = initial
      initializedRef.current = true
    }
    
    // 设置 ResizeObserver 监听后续变化
    const unsubscribe = observeResize(element, (entry: ResizeObserverEntry) => {
      // 页面不可见时跳过更新
      if (!isPageVisible()) return
      
      const { width, height } = entry.contentRect
      
      // 跳过无效尺寸
      if (width === 0 && height === 0) return
      
      const prev = lastDimensionsRef.current
      
      // 初始化时（prev 为默认值 0,0）无条件更新
      // 后续更新时使用阈值过滤 F12 等微小变化
      const isInitial = !initializedRef.current
      const widthChanged = Math.abs(prev.width - width) > RESIZE_THRESHOLD
      const heightChanged = Math.abs(prev.height - height) > RESIZE_THRESHOLD
      
      if (isInitial || widthChanged || heightChanged) {
        const newDimensions = calculateDimensions(width, height)
        lastDimensionsRef.current = newDimensions
        initializedRef.current = true
        setDimensions(newDimensions)
      }
    })
    
    return () => {
      unsubscribe()
      initializedRef.current = false
    }
  }, [])

  return { containerRef, dimensions }
}

/** 消息去重缓存 */
const lastSentDimensions = new WeakMap<HTMLIFrameElement, string>()

/**
 * 向 iframe 发送尺寸更新消息
 * 
 * 🚀 优化:
 * - 消息去重：相同尺寸不重复发送
 * - 使用整数 key 避免字符串拼接
 * - postMessage 本身是异步的，无需额外批量处理
 */
export function sendResizeMessage(
  iframe: HTMLIFrameElement | null,
  dimensions: IframeDimensions
): void {
  if (!iframe?.contentWindow) return
  
  // 消息去重：包含尺寸和安全区域信息
  // 使用字符串 key 确保所有相关属性都被考虑
  const key = `${dimensions.width | 0},${dimensions.height | 0},${dimensions.safeInsetTop || 0},${dimensions.safeInsetRight || 0},${dimensions.safeInsetBottom || 0},${dimensions.safeInsetLeft || 0}`
  const lastKey = lastSentDimensions.get(iframe)
  if (lastKey === key) return
  lastSentDimensions.set(iframe, key)

  try {
    iframe.contentWindow.postMessage({
      type: 'event',
      action: 'container:resize',
      payload: dimensions,
    }, '*')
  } catch {
    // iframe 可能未加载完成或已销毁
  }
}

/**
 * 计算 Widget 模式下的最佳尺寸
 * 根据 widget size (如 '2x2') 和容器尺寸计算
 */
export function calculateWidgetDimensions(
  widgetSize: string,
  containerWidth: number,
  containerHeight: number
): IframeDimensions {
  // 解析 widget size
  const [cols, rows] = widgetSize.split('x').map(Number)
  const validCols = isNaN(cols) ? 1 : cols
  const validRows = isNaN(rows) ? 1 : rows

  // 计算期望尺寸
  const expectedWidth = validCols * BASE_CELL_SIZE
  const expectedHeight = validRows * BASE_CELL_SIZE

  // 计算实际缩放比例（取较小值保持宽高比）
  const scaleX = containerWidth / expectedWidth
  const scaleY = containerHeight / expectedHeight
  const scale = Math.min(scaleX, scaleY, 2) // 最大放大 2 倍

  // 字体缩放使用更平滑的曲线
  const fontScale = Math.max(0.5, Math.min(1.5, 0.3 + scale * 0.7))

  return {
    width: containerWidth,
    height: containerHeight,
    scale: Math.max(0.1, scale),
    fontScale,
    isCompact: containerWidth < 150 || containerHeight < 150,
    isMini: containerWidth < 100 || containerHeight < 100,
  }
}

/**
 * 计算 Page 模式下的尺寸
 * 页面模式通常填满容器
 */
export function calculatePageDimensions(
  containerWidth: number,
  containerHeight: number
): IframeDimensions {
  return {
    width: containerWidth,
    height: containerHeight,
    scale: 1,
    fontScale: 1,
    isCompact: false,
    isMini: false,
  }
}

/**
 * iframe 样式生成器
 * 根据模式和尺寸生成 CSS 样式
 */
export function getIframeStyles(
  mode: 'widget' | 'page',
  dimensions: IframeDimensions,
  isPreview?: boolean
): React.CSSProperties {
  const baseStyles: React.CSSProperties = {
    width: '100%',
    height: '100%',
    border: 'none',
    backgroundColor: 'transparent',
    display: 'block',
  }

  if (mode === 'widget') {
    return {
      ...baseStyles,
      // Widget 模式：确保完全填满容器
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    }
  }

  if (mode === 'page') {
    return {
      ...baseStyles,
      // Page 模式：填满容器，可能需要滚动
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      overflow: 'hidden',
    }
  }

  return baseStyles
}

/**
 * 沙箱 HTML 中注入的自适应脚本
 * 
 * 🎯 开发者零配置:
 * - 自动接收父窗口尺寸消息
 * - 自动更新 CSS 变量
 * - 自动触发 tapp:resize 事件
 * - 支持容器查询 (Container Queries)
 * 
 * 🚀 性能优化:
 * - CSS 变量缓存避免重复设置
 * - RAF 节流事件派发
 * - 被动事件监听
 * - 避免强制布局
 */
export const IFRAME_RESIZE_SCRIPT = `
(function() {
  'use strict';
  
  // 读取预设的安全区域值（由框架注入）
  var initialInsets = window._TAPP_INITIAL_SAFE_INSETS || {};
  
  // 使用 Object.create(null) 避免原型链查找
  var dims = Object.create(null);
  dims.width = window.innerWidth;
  dims.height = window.innerHeight;
  dims.scale = 1;
  dims.fontScale = 1;
  dims.isCompact = false;
  dims.isMini = false;
  // 安全区域内边距（使用预设值或默认 0）
  dims.safeInsetTop = initialInsets.top || 0;
  dims.safeInsetRight = initialInsets.right || 0;
  dims.safeInsetBottom = initialInsets.bottom || 0;
  dims.safeInsetLeft = initialInsets.left || 0;
  
  // 暴露给 Tapp SDK
  window._TAPP_DIMENSIONS = dims;

  // CSS 变量缓存（避免重复设置）
  var cssCache = Object.create(null);
  var root = document.documentElement;
  var rootStyle = root.style;

  // 批量更新 CSS 变量（性能优化）
  function updateCSS(d) {
    var w = d.width + 'px';
    var h = d.height + 'px';
    var s = String(d.scale);
    var fs = String(d.fontScale);
    var bf = Math.max(10, 14 * d.fontScale) + 'px';
    var ic = d.isCompact ? '1' : '0';
    var im = d.isMini ? '1' : '0';
    // 安全区域内边距
    var sit = (d.safeInsetTop || 0) + 'px';
    var sir = (d.safeInsetRight || 0) + 'px';
    var sib = (d.safeInsetBottom || 0) + 'px';
    var sil = (d.safeInsetLeft || 0) + 'px';
    
    // 仅更新变化的变量
    if (cssCache.w !== w) { cssCache.w = w; rootStyle.setProperty('--tapp-container-width', w); }
    if (cssCache.h !== h) { cssCache.h = h; rootStyle.setProperty('--tapp-container-height', h); }
    if (cssCache.s !== s) { cssCache.s = s; rootStyle.setProperty('--tapp-scale', s); }
    if (cssCache.fs !== fs) { cssCache.fs = fs; rootStyle.setProperty('--tapp-font-scale', fs); }
    if (cssCache.bf !== bf) { cssCache.bf = bf; rootStyle.setProperty('--tapp-base-font-size', bf); }
    if (cssCache.ic !== ic) { cssCache.ic = ic; rootStyle.setProperty('--tapp-is-compact', ic); }
    if (cssCache.im !== im) { cssCache.im = im; rootStyle.setProperty('--tapp-is-mini', im); }
    // 安全区域 CSS 变量
    if (cssCache.sit !== sit) { cssCache.sit = sit; rootStyle.setProperty('--tapp-safe-inset-top', sit); }
    if (cssCache.sir !== sir) { cssCache.sir = sir; rootStyle.setProperty('--tapp-safe-inset-right', sir); }
    if (cssCache.sib !== sib) { cssCache.sib = sib; rootStyle.setProperty('--tapp-safe-inset-bottom', sib); }
    if (cssCache.sil !== sil) { cssCache.sil = sil; rootStyle.setProperty('--tapp-safe-inset-left', sil); }
    
    // 使用 classList 批量操作（比 toggle 更快）
    var cl = document.body.classList;
    if (d.isCompact && !cl.contains('tapp-compact')) cl.add('tapp-compact');
    else if (!d.isCompact && cl.contains('tapp-compact')) cl.remove('tapp-compact');
    if (d.isMini && !cl.contains('tapp-mini')) cl.add('tapp-mini');
    else if (!d.isMini && cl.contains('tapp-mini')) cl.remove('tapp-mini');
  }

  // RAF 节流的事件派发
  var eventQueued = false;
  function queueResizeEvent() {
    if (eventQueued) return;
    eventQueued = true;
    requestAnimationFrame(function() {
      eventQueued = false;
      window.dispatchEvent(new CustomEvent('tapp:resize', { detail: dims, bubbles: false }));
    });
  }

  // 消息处理（优化分支）
  function onMessage(e) {
    var msg = e.data;
    if (!msg || msg.type !== 'event' || msg.action !== 'container:resize') return;
    
    var p = msg.payload;
    dims.width = p.width;
    dims.height = p.height;
    dims.scale = p.scale;
    dims.fontScale = p.fontScale;
    dims.isCompact = p.isCompact;
    dims.isMini = p.isMini;
    // 安全区域内边距
    dims.safeInsetTop = p.safeInsetTop || 0;
    dims.safeInsetRight = p.safeInsetRight || 0;
    dims.safeInsetBottom = p.safeInsetBottom || 0;
    dims.safeInsetLeft = p.safeInsetLeft || 0;
    
    updateCSS(dims);
    queueResizeEvent();
  }
  
  window.addEventListener('message', onMessage, false);

  // 备用：监听 iframe resize（节流 100ms）
  var resizeTimer;
  window.addEventListener('resize', function() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function() {
      dims.width = window.innerWidth;
      dims.height = window.innerHeight;
      queueResizeEvent();
    }, 100);
  }, { passive: true });

  // 初始化
  updateCSS(dims);
  
  // 通知父窗口就绪
  // 注意：消息格式需要符合 TappBridge 规范，包含 id、type、action 字段
  // action 只能包含字母数字下划线和点号
  if (window.parent !== window) {
    try { 
      window.parent.postMessage({ 
        type: 'event',
        id: 'tapp-ready-' + Date.now(),
        action: 'tapp.ready',
        payload: null,
        timestamp: Date.now()
      }, '*'); 
    } catch(e) {}
  }
})();
`

/**
 * 沙箱 HTML 中注入的自适应 CSS
 * 
 * 🎯 开发者零配置响应式:
 * - CSS 变量自动更新
 * - 响应式工具类（类似 Tailwind）
 * - 紧凑/迷你模式自动切换
 * - 容器查询支持
 * 
 * 🚀 性能优化:
 * - 使用 CSS 层叠 (@layer) 控制优先级
 * - GPU 加速动画 (transform, opacity)
 * - 减少选择器复杂度
 * - will-change 提示
 */
export const IFRAME_RESIZE_CSS = `
/* CSS 层叠定义：确保正确的样式优先级 */
@layer tapp-reset, tapp-base, tapp-utilities, tapp-responsive;

/* ==================== 重置层 ==================== */
@layer tapp-reset {
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
}

/* ==================== 基础层 ==================== */
@layer tapp-base {
  :root {
    --tapp-container-width: 100vw;
    --tapp-container-height: 100vh;
    --tapp-scale: 1;
    --tapp-font-scale: 1;
    --tapp-base-font-size: 14px;
    --tapp-is-compact: 0;
    --tapp-is-mini: 0;
    --tapp-spacing-unit: calc(4px * var(--tapp-scale));
    --tapp-radius-unit: calc(4px * var(--tapp-scale));
    /* 安全区域内边距 - 用于避免与控制条/控制岛重叠 */
    --tapp-safe-inset-top: 0px;
    --tapp-safe-inset-right: 0px;
    --tapp-safe-inset-bottom: 0px;
    --tapp-safe-inset-left: 0px;
    color-scheme: light dark;
  }

  html {
    height: 100%;
    width: 100%;
    font-size: var(--tapp-base-font-size);
    -webkit-text-size-adjust: 100%;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  body {
    width: 100%;
    height: 100%;
    min-height: 100%;
    overflow: hidden;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: inherit;
    line-height: 1.5;
    background: transparent;
  }

  /* 根容器 */
  #tapp-root {
    position: absolute;
    inset: 0;
    overflow: hidden;
    container-type: size;
    container-name: tapp;
    contain: layout style;
  }

  /* 背景层 - 填满整个屏幕，无安全区域限制 */
  #tapp-background {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    overflow: hidden;
  }

  /* 内容层 - 自动应用安全区域 padding */
  #tapp-content {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: auto;
    box-sizing: border-box;
    /* 安全区域内边距 - 开发者无需手动处理 */
    padding-top: var(--tapp-safe-inset-top, 0px);
    padding-right: var(--tapp-safe-inset-right, 0px);
    padding-bottom: var(--tapp-safe-inset-bottom, 0px);
    padding-left: var(--tapp-safe-inset-left, 0px);
  }

  /* Widget 模式下不需要分层和安全区域 */
  .tapp-mode-widget #tapp-root { 
    overflow: hidden;
    contain: strict;
  }
  .tapp-mode-widget #tapp-background,
  .tapp-mode-widget #tapp-content {
    padding: 0;
  }
}

/* ==================== 工具类层 ==================== */
@layer tapp-utilities {
  /* 文本 */
  .tapp-text-xs { font-size: calc(.75rem * var(--tapp-font-scale)); }
  .tapp-text-sm { font-size: calc(.875rem * var(--tapp-font-scale)); }
  .tapp-text-base { font-size: calc(1rem * var(--tapp-font-scale)); }
  .tapp-text-lg { font-size: calc(1.125rem * var(--tapp-font-scale)); }
  .tapp-text-xl { font-size: calc(1.25rem * var(--tapp-font-scale)); }
  .tapp-text-2xl { font-size: calc(1.5rem * var(--tapp-font-scale)); }
  .tapp-text-3xl { font-size: calc(1.875rem * var(--tapp-font-scale)); }

  /* 间距 - 使用 CSS 变量减少计算 */
  .tapp-p-0 { padding: 0; }
  .tapp-p-1 { padding: var(--tapp-spacing-unit); }
  .tapp-p-2 { padding: calc(var(--tapp-spacing-unit) * 2); }
  .tapp-p-3 { padding: calc(var(--tapp-spacing-unit) * 3); }
  .tapp-p-4 { padding: calc(var(--tapp-spacing-unit) * 4); }

  .tapp-px-1 { padding-inline: var(--tapp-spacing-unit); }
  .tapp-px-2 { padding-inline: calc(var(--tapp-spacing-unit) * 2); }
  .tapp-px-3 { padding-inline: calc(var(--tapp-spacing-unit) * 3); }
  .tapp-px-4 { padding-inline: calc(var(--tapp-spacing-unit) * 4); }

  .tapp-py-1 { padding-block: var(--tapp-spacing-unit); }
  .tapp-py-2 { padding-block: calc(var(--tapp-spacing-unit) * 2); }
  .tapp-py-3 { padding-block: calc(var(--tapp-spacing-unit) * 3); }
  .tapp-py-4 { padding-block: calc(var(--tapp-spacing-unit) * 4); }

  .tapp-m-0 { margin: 0; }
  .tapp-m-1 { margin: var(--tapp-spacing-unit); }
  .tapp-m-2 { margin: calc(var(--tapp-spacing-unit) * 2); }
  .tapp-m-auto { margin: auto; }

  .tapp-gap-1 { gap: var(--tapp-spacing-unit); }
  .tapp-gap-2 { gap: calc(var(--tapp-spacing-unit) * 2); }
  .tapp-gap-3 { gap: calc(var(--tapp-spacing-unit) * 3); }
  .tapp-gap-4 { gap: calc(var(--tapp-spacing-unit) * 4); }

  /* 圆角 */
  .tapp-rounded { border-radius: var(--tapp-radius-unit); }
  .tapp-rounded-lg { border-radius: calc(var(--tapp-radius-unit) * 2); }
  .tapp-rounded-xl { border-radius: calc(var(--tapp-radius-unit) * 3); }
  .tapp-rounded-full { border-radius: 9999px; }

  /* 阴影 - 使用 filter 替代 box-shadow 获得更好的性能 */
  .tapp-shadow-sm { filter: drop-shadow(0 1px 1px rgb(0 0 0 / .05)); }
  .tapp-shadow { filter: drop-shadow(0 1px 2px rgb(0 0 0 / .1)); }
  .tapp-shadow-lg { filter: drop-shadow(0 4px 6px rgb(0 0 0 / .1)); }

  /* 布局 */
  .tapp-flex { display: flex; }
  .tapp-flex-col { flex-direction: column; }
  .tapp-flex-center { display: flex; place-items: center; place-content: center; }
  .tapp-flex-between { display: flex; align-items: center; justify-content: space-between; }
  .tapp-grid { display: grid; }
  .tapp-absolute-fill { position: absolute; inset: 0; }
  .tapp-relative { position: relative; }
  .tapp-overflow-hidden { overflow: hidden; }
  .tapp-overflow-auto { overflow: auto; }
  .tapp-w-full { width: 100%; }
  .tapp-h-full { height: 100%; }

  /* 安全区域工具类 - 使用安全区域内边距 */
  .tapp-safe-p {
    padding-top: var(--tapp-safe-inset-top, 0px);
    padding-right: var(--tapp-safe-inset-right, 0px);
    padding-bottom: var(--tapp-safe-inset-bottom, 0px);
    padding-left: var(--tapp-safe-inset-left, 0px);
  }
  .tapp-safe-pt { padding-top: var(--tapp-safe-inset-top, 0px); }
  .tapp-safe-pr { padding-right: var(--tapp-safe-inset-right, 0px); }
  .tapp-safe-pb { padding-bottom: var(--tapp-safe-inset-bottom, 0px); }
  .tapp-safe-pl { padding-left: var(--tapp-safe-inset-left, 0px); }
  .tapp-safe-px {
    padding-left: var(--tapp-safe-inset-left, 0px);
    padding-right: var(--tapp-safe-inset-right, 0px);
  }
  .tapp-safe-py {
    padding-top: var(--tapp-safe-inset-top, 0px);
    padding-bottom: var(--tapp-safe-inset-bottom, 0px);
  }
  /* 安全区域 + 额外边距 */
  .tapp-safe-p-4 {
    padding-top: calc(var(--tapp-safe-inset-top, 0px) + var(--tapp-spacing-unit) * 4);
    padding-right: calc(var(--tapp-safe-inset-right, 0px) + var(--tapp-spacing-unit) * 4);
    padding-bottom: calc(var(--tapp-safe-inset-bottom, 0px) + var(--tapp-spacing-unit) * 4);
    padding-left: calc(var(--tapp-safe-inset-left, 0px) + var(--tapp-spacing-unit) * 4);
  }
  .tapp-safe-p-6 {
    padding-top: calc(var(--tapp-safe-inset-top, 0px) + var(--tapp-spacing-unit) * 6);
    padding-right: calc(var(--tapp-safe-inset-right, 0px) + var(--tapp-spacing-unit) * 6);
    padding-bottom: calc(var(--tapp-safe-inset-bottom, 0px) + var(--tapp-spacing-unit) * 6);
    padding-left: calc(var(--tapp-safe-inset-left, 0px) + var(--tapp-spacing-unit) * 6);
  }

  /* 动画 - GPU 加速 */
  .tapp-transition { 
    transition: color .15s, background-color .15s, border-color .15s, opacity .15s, transform .15s;
    will-change: transform, opacity;
  }

  .tapp-animate-fade-in {
    animation: tapp-fade .2s ease-out;
  }

  .tapp-animate-scale-in {
    animation: tapp-scale .2s ease-out;
  }
}

/* ==================== 响应式层 ==================== */
@layer tapp-responsive {
  /* 紧凑模式 */
  .tapp-compact .tapp-hide-compact { display: none; }
  
  /* 迷你模式 */
  .tapp-mini .tapp-hide-mini { display: none; }
  .tapp-mini .tapp-hide-compact { display: none; }

  /* 容器查询 */
  @container tapp (width < 150px) { .tapp-cq-hide-sm { display: none; } }
  @container tapp (width < 100px) { .tapp-cq-hide-xs { display: none; } }
  @container tapp (width >= 200px) { .tapp-cq-show-md { display: block; } }
  @container tapp (width >= 300px) { .tapp-cq-show-lg { display: block; } }
}

/* 动画关键帧（在层外定义） */
@keyframes tapp-fade { from { opacity: 0; } }
@keyframes tapp-scale { from { opacity: 0; transform: scale(.95); } }

/* 减少动画偏好 */
@media (prefers-reduced-motion: reduce) {
  .tapp-transition { transition: none; }
  .tapp-animate-fade-in, .tapp-animate-scale-in { animation: none; }
}
`

/**
 * Tailwind CSS 子集 - 常用工具类
 * 为 Tapp 开发提供熟悉的 Tailwind 类名
 * 
 * 包含：
 * - 布局: flex, grid, position, display
 * - 间距: padding, margin, gap
 * - 尺寸: width, height
 * - 排版: font-size, font-weight, text-align, text-color
 * - 边框: border, rounded
 * - 背景: background-color, opacity
 * - 效果: shadow, backdrop-blur, transition
 * - 交互: cursor, pointer-events, overflow
 */
export const TAILWIND_SUBSET_CSS = `
/* ==================== Tailwind 工具类子集 ==================== */
@layer tapp-tailwind {
  /* === Display === */
  .hidden { display: none; }
  .block { display: block; }
  .inline-block { display: inline-block; }
  .inline { display: inline; }
  .flex { display: flex; }
  .inline-flex { display: inline-flex; }
  .grid { display: grid; }

  /* === Flex === */
  .flex-row { flex-direction: row; }
  .flex-col { flex-direction: column; }
  .flex-wrap { flex-wrap: wrap; }
  .flex-nowrap { flex-wrap: nowrap; }
  .flex-1 { flex: 1 1 0%; }
  .flex-auto { flex: 1 1 auto; }
  .flex-initial { flex: 0 1 auto; }
  .flex-none { flex: none; }
  .flex-shrink-0 { flex-shrink: 0; }
  .flex-grow { flex-grow: 1; }
  .grow { flex-grow: 1; }
  .shrink-0 { flex-shrink: 0; }

  /* === Justify / Align === */
  .justify-start { justify-content: flex-start; }
  .justify-end { justify-content: flex-end; }
  .justify-center { justify-content: center; }
  .justify-between { justify-content: space-between; }
  .justify-around { justify-content: space-around; }
  .justify-evenly { justify-content: space-evenly; }
  .items-start { align-items: flex-start; }
  .items-end { align-items: flex-end; }
  .items-center { align-items: center; }
  .items-baseline { align-items: baseline; }
  .items-stretch { align-items: stretch; }
  .self-auto { align-self: auto; }
  .self-start { align-self: flex-start; }
  .self-end { align-self: flex-end; }
  .self-center { align-self: center; }

  /* === Position === */
  .static { position: static; }
  .relative { position: relative; }
  .absolute { position: absolute; }
  .fixed { position: fixed; }
  .sticky { position: sticky; }
  .inset-0 { inset: 0; }
  .top-0 { top: 0; }
  .right-0 { right: 0; }
  .bottom-0 { bottom: 0; }
  .left-0 { left: 0; }
  .top-1 { top: 0.25rem; }
  .top-2 { top: 0.5rem; }
  .top-4 { top: 1rem; }
  .right-1 { right: 0.25rem; }
  .right-2 { right: 0.5rem; }
  .right-4 { right: 1rem; }
  .bottom-1 { bottom: 0.25rem; }
  .bottom-2 { bottom: 0.5rem; }
  .bottom-4 { bottom: 1rem; }
  .left-1 { left: 0.25rem; }
  .left-2 { left: 0.5rem; }
  .left-4 { left: 1rem; }
  .z-0 { z-index: 0; }
  .z-10 { z-index: 10; }
  .z-20 { z-index: 20; }
  .z-30 { z-index: 30; }
  .z-40 { z-index: 40; }
  .z-50 { z-index: 50; }

  /* === Width / Height === */
  .w-full { width: 100%; }
  .w-screen { width: 100vw; }
  .w-auto { width: auto; }
  .w-fit { width: fit-content; }
  .w-1\\/2 { width: 50%; }
  .w-1\\/3 { width: 33.333333%; }
  .w-2\\/3 { width: 66.666667%; }
  .w-1\\/4 { width: 25%; }
  .w-3\\/4 { width: 75%; }
  .min-w-0 { min-width: 0; }
  .min-w-full { min-width: 100%; }
  .max-w-full { max-width: 100%; }
  .max-w-sm { max-width: 24rem; }
  .max-w-md { max-width: 28rem; }
  .max-w-lg { max-width: 32rem; }
  .max-w-xl { max-width: 36rem; }
  .max-w-2xl { max-width: 42rem; }
  .max-w-none { max-width: none; }
  .h-full { height: 100%; }
  .h-screen { height: 100vh; }
  .h-auto { height: auto; }
  .h-fit { height: fit-content; }
  .min-h-0 { min-height: 0; }
  .min-h-full { min-height: 100%; }
  .min-h-screen { min-height: 100vh; }
  .max-h-full { max-height: 100%; }

  /* === Padding === */
  .p-0 { padding: 0; }
  .p-1 { padding: 0.25rem; }
  .p-2 { padding: 0.5rem; }
  .p-3 { padding: 0.75rem; }
  .p-4 { padding: 1rem; }
  .p-5 { padding: 1.25rem; }
  .p-6 { padding: 1.5rem; }
  .p-8 { padding: 2rem; }
  .px-0 { padding-left: 0; padding-right: 0; }
  .px-1 { padding-left: 0.25rem; padding-right: 0.25rem; }
  .px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
  .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
  .px-4 { padding-left: 1rem; padding-right: 1rem; }
  .px-5 { padding-left: 1.25rem; padding-right: 1.25rem; }
  .px-6 { padding-left: 1.5rem; padding-right: 1.5rem; }
  .px-8 { padding-left: 2rem; padding-right: 2rem; }
  .py-0 { padding-top: 0; padding-bottom: 0; }
  .py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
  .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
  .py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
  .py-4 { padding-top: 1rem; padding-bottom: 1rem; }
  .py-5 { padding-top: 1.25rem; padding-bottom: 1.25rem; }
  .py-6 { padding-top: 1.5rem; padding-bottom: 1.5rem; }
  .py-8 { padding-top: 2rem; padding-bottom: 2rem; }
  .pt-0 { padding-top: 0; }
  .pt-1 { padding-top: 0.25rem; }
  .pt-2 { padding-top: 0.5rem; }
  .pt-4 { padding-top: 1rem; }
  .pt-6 { padding-top: 1.5rem; }
  .pb-0 { padding-bottom: 0; }
  .pb-1 { padding-bottom: 0.25rem; }
  .pb-2 { padding-bottom: 0.5rem; }
  .pb-4 { padding-bottom: 1rem; }
  .pb-6 { padding-bottom: 1.5rem; }
  .pl-0 { padding-left: 0; }
  .pl-2 { padding-left: 0.5rem; }
  .pl-4 { padding-left: 1rem; }
  .pr-0 { padding-right: 0; }
  .pr-2 { padding-right: 0.5rem; }
  .pr-4 { padding-right: 1rem; }

  /* === Margin === */
  .m-0 { margin: 0; }
  .m-1 { margin: 0.25rem; }
  .m-2 { margin: 0.5rem; }
  .m-3 { margin: 0.75rem; }
  .m-4 { margin: 1rem; }
  .m-auto { margin: auto; }
  .mx-0 { margin-left: 0; margin-right: 0; }
  .mx-1 { margin-left: 0.25rem; margin-right: 0.25rem; }
  .mx-2 { margin-left: 0.5rem; margin-right: 0.5rem; }
  .mx-4 { margin-left: 1rem; margin-right: 1rem; }
  .mx-auto { margin-left: auto; margin-right: auto; }
  .my-0 { margin-top: 0; margin-bottom: 0; }
  .my-1 { margin-top: 0.25rem; margin-bottom: 0.25rem; }
  .my-2 { margin-top: 0.5rem; margin-bottom: 0.5rem; }
  .my-4 { margin-top: 1rem; margin-bottom: 1rem; }
  .my-auto { margin-top: auto; margin-bottom: auto; }
  .mt-0 { margin-top: 0; }
  .mt-1 { margin-top: 0.25rem; }
  .mt-2 { margin-top: 0.5rem; }
  .mt-4 { margin-top: 1rem; }
  .mt-6 { margin-top: 1.5rem; }
  .mt-auto { margin-top: auto; }
  .mb-0 { margin-bottom: 0; }
  .mb-1 { margin-bottom: 0.25rem; }
  .mb-2 { margin-bottom: 0.5rem; }
  .mb-4 { margin-bottom: 1rem; }
  .mb-6 { margin-bottom: 1.5rem; }
  .mb-auto { margin-bottom: auto; }
  .ml-0 { margin-left: 0; }
  .ml-1 { margin-left: 0.25rem; }
  .ml-2 { margin-left: 0.5rem; }
  .ml-4 { margin-left: 1rem; }
  .ml-auto { margin-left: auto; }
  .mr-0 { margin-right: 0; }
  .mr-1 { margin-right: 0.25rem; }
  .mr-2 { margin-right: 0.5rem; }
  .mr-4 { margin-right: 1rem; }
  .mr-auto { margin-right: auto; }
  .-mt-1 { margin-top: -0.25rem; }
  .-mt-2 { margin-top: -0.5rem; }
  .-mb-1 { margin-bottom: -0.25rem; }
  .-ml-1 { margin-left: -0.25rem; }
  .-mr-1 { margin-right: -0.25rem; }

  /* === Gap === */
  .gap-0 { gap: 0; }
  .gap-1 { gap: 0.25rem; }
  .gap-2 { gap: 0.5rem; }
  .gap-3 { gap: 0.75rem; }
  .gap-4 { gap: 1rem; }
  .gap-5 { gap: 1.25rem; }
  .gap-6 { gap: 1.5rem; }
  .gap-8 { gap: 2rem; }
  .gap-x-1 { column-gap: 0.25rem; }
  .gap-x-2 { column-gap: 0.5rem; }
  .gap-x-4 { column-gap: 1rem; }
  .gap-y-1 { row-gap: 0.25rem; }
  .gap-y-2 { row-gap: 0.5rem; }
  .gap-y-4 { row-gap: 1rem; }

  /* === Grid === */
  .grid-cols-1 { grid-template-columns: repeat(1, minmax(0, 1fr)); }
  .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .col-span-1 { grid-column: span 1 / span 1; }
  .col-span-2 { grid-column: span 2 / span 2; }
  .col-span-full { grid-column: 1 / -1; }

  /* === Font Size === */
  .text-xs { font-size: 0.75rem; line-height: 1rem; }
  .text-sm { font-size: 0.875rem; line-height: 1.25rem; }
  .text-base { font-size: 1rem; line-height: 1.5rem; }
  .text-lg { font-size: 1.125rem; line-height: 1.75rem; }
  .text-xl { font-size: 1.25rem; line-height: 1.75rem; }
  .text-2xl { font-size: 1.5rem; line-height: 2rem; }
  .text-3xl { font-size: 1.875rem; line-height: 2.25rem; }
  .text-4xl { font-size: 2.25rem; line-height: 2.5rem; }

  /* === Font Weight === */
  .font-thin { font-weight: 100; }
  .font-light { font-weight: 300; }
  .font-normal { font-weight: 400; }
  .font-medium { font-weight: 500; }
  .font-semibold { font-weight: 600; }
  .font-bold { font-weight: 700; }
  .font-extrabold { font-weight: 800; }

  /* === Text Align === */
  .text-left { text-align: left; }
  .text-center { text-align: center; }
  .text-right { text-align: right; }
  .text-justify { text-align: justify; }

  /* === Text Decoration === */
  .underline { text-decoration: underline; }
  .line-through { text-decoration: line-through; }
  .no-underline { text-decoration: none; }

  /* === Text Transform === */
  .uppercase { text-transform: uppercase; }
  .lowercase { text-transform: lowercase; }
  .capitalize { text-transform: capitalize; }
  .normal-case { text-transform: none; }

  /* === Text Overflow === */
  .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .text-ellipsis { text-overflow: ellipsis; }
  .text-clip { text-overflow: clip; }
  .whitespace-normal { white-space: normal; }
  .whitespace-nowrap { white-space: nowrap; }
  .whitespace-pre { white-space: pre; }
  .whitespace-pre-line { white-space: pre-line; }
  .whitespace-pre-wrap { white-space: pre-wrap; }
  .break-normal { word-break: normal; overflow-wrap: normal; }
  .break-words { overflow-wrap: break-word; }
  .break-all { word-break: break-all; }

  /* === Line Height === */
  .leading-none { line-height: 1; }
  .leading-tight { line-height: 1.25; }
  .leading-snug { line-height: 1.375; }
  .leading-normal { line-height: 1.5; }
  .leading-relaxed { line-height: 1.625; }
  .leading-loose { line-height: 2; }

  /* === Text Color === */
  .text-inherit { color: inherit; }
  .text-current { color: currentColor; }
  .text-transparent { color: transparent; }
  .text-black { color: #000; }
  .text-white { color: #fff; }
  .text-gray-50 { color: #f9fafb; }
  .text-gray-100 { color: #f3f4f6; }
  .text-gray-200 { color: #e5e7eb; }
  .text-gray-300 { color: #d1d5db; }
  .text-gray-400 { color: #9ca3af; }
  .text-gray-500 { color: #6b7280; }
  .text-gray-600 { color: #4b5563; }
  .text-gray-700 { color: #374151; }
  .text-gray-800 { color: #1f2937; }
  .text-gray-900 { color: #111827; }
  .text-red-400 { color: #f87171; }
  .text-red-500 { color: #ef4444; }
  .text-red-600 { color: #dc2626; }
  .text-green-400 { color: #4ade80; }
  .text-green-500 { color: #22c55e; }
  .text-green-600 { color: #16a34a; }
  .text-blue-400 { color: #60a5fa; }
  .text-blue-500 { color: #3b82f6; }
  .text-blue-600 { color: #2563eb; }
  .text-yellow-400 { color: #facc15; }
  .text-yellow-500 { color: #eab308; }
  .text-purple-400 { color: #c084fc; }
  .text-purple-500 { color: #a855f7; }
  .text-violet-400 { color: #a78bfa; }
  .text-violet-500 { color: #8b5cf6; }
  .text-pink-400 { color: #f472b6; }
  .text-pink-500 { color: #ec4899; }

  /* === Background Color === */
  .bg-inherit { background-color: inherit; }
  .bg-current { background-color: currentColor; }
  .bg-transparent { background-color: transparent; }
  .bg-black { background-color: #000; }
  .bg-white { background-color: #fff; }
  .bg-gray-50 { background-color: #f9fafb; }
  .bg-gray-100 { background-color: #f3f4f6; }
  .bg-gray-200 { background-color: #e5e7eb; }
  .bg-gray-300 { background-color: #d1d5db; }
  .bg-gray-400 { background-color: #9ca3af; }
  .bg-gray-500 { background-color: #6b7280; }
  .bg-gray-600 { background-color: #4b5563; }
  .bg-gray-700 { background-color: #374151; }
  .bg-gray-800 { background-color: #1f2937; }
  .bg-gray-900 { background-color: #111827; }
  .bg-red-50 { background-color: #fef2f2; }
  .bg-red-100 { background-color: #fee2e2; }
  .bg-red-500 { background-color: #ef4444; }
  .bg-red-600 { background-color: #dc2626; }
  .bg-green-50 { background-color: #f0fdf4; }
  .bg-green-100 { background-color: #dcfce7; }
  .bg-green-500 { background-color: #22c55e; }
  .bg-green-600 { background-color: #16a34a; }
  .bg-blue-50 { background-color: #eff6ff; }
  .bg-blue-100 { background-color: #dbeafe; }
  .bg-blue-500 { background-color: #3b82f6; }
  .bg-blue-600 { background-color: #2563eb; }
  .bg-yellow-50 { background-color: #fefce8; }
  .bg-yellow-100 { background-color: #fef9c3; }
  .bg-purple-50 { background-color: #faf5ff; }
  .bg-purple-100 { background-color: #f3e8ff; }
  .bg-purple-500 { background-color: #a855f7; }
  .bg-violet-50 { background-color: #f5f3ff; }
  .bg-violet-100 { background-color: #ede9fe; }
  .bg-violet-500 { background-color: #8b5cf6; }
  .bg-neutral-900 { background-color: #171717; }
  .bg-neutral-800 { background-color: #262626; }

  /* === Background Opacity (with CSS vars for custom colors) === */
  .bg-black\\/5 { background-color: rgb(0 0 0 / 0.05); }
  .bg-black\\/10 { background-color: rgb(0 0 0 / 0.1); }
  .bg-black\\/20 { background-color: rgb(0 0 0 / 0.2); }
  .bg-black\\/50 { background-color: rgb(0 0 0 / 0.5); }
  .bg-white\\/5 { background-color: rgb(255 255 255 / 0.05); }
  .bg-white\\/10 { background-color: rgb(255 255 255 / 0.1); }
  .bg-white\\/20 { background-color: rgb(255 255 255 / 0.2); }
  .bg-white\\/50 { background-color: rgb(255 255 255 / 0.5); }
  .bg-white\\/70 { background-color: rgb(255 255 255 / 0.7); }
  .bg-white\\/80 { background-color: rgb(255 255 255 / 0.8); }

  /* === Border Radius === */
  .rounded-none { border-radius: 0; }
  .rounded-sm { border-radius: 0.125rem; }
  .rounded { border-radius: 0.25rem; }
  .rounded-md { border-radius: 0.375rem; }
  .rounded-lg { border-radius: 0.5rem; }
  .rounded-xl { border-radius: 0.75rem; }
  .rounded-2xl { border-radius: 1rem; }
  .rounded-3xl { border-radius: 1.5rem; }
  .rounded-full { border-radius: 9999px; }
  .rounded-t-lg { border-top-left-radius: 0.5rem; border-top-right-radius: 0.5rem; }
  .rounded-b-lg { border-bottom-left-radius: 0.5rem; border-bottom-right-radius: 0.5rem; }
  .rounded-l-lg { border-top-left-radius: 0.5rem; border-bottom-left-radius: 0.5rem; }
  .rounded-r-lg { border-top-right-radius: 0.5rem; border-bottom-right-radius: 0.5rem; }

  /* === Border === */
  .border-0 { border-width: 0; }
  .border { border-width: 1px; }
  .border-2 { border-width: 2px; }
  .border-4 { border-width: 4px; }
  .border-t { border-top-width: 1px; }
  .border-b { border-bottom-width: 1px; }
  .border-l { border-left-width: 1px; }
  .border-r { border-right-width: 1px; }
  .border-solid { border-style: solid; }
  .border-dashed { border-style: dashed; }
  .border-dotted { border-style: dotted; }
  .border-none { border-style: none; }
  .border-transparent { border-color: transparent; }
  .border-current { border-color: currentColor; }
  .border-black { border-color: #000; }
  .border-white { border-color: #fff; }
  .border-gray-100 { border-color: #f3f4f6; }
  .border-gray-200 { border-color: #e5e7eb; }
  .border-gray-300 { border-color: #d1d5db; }
  .border-gray-400 { border-color: #9ca3af; }
  .border-gray-500 { border-color: #6b7280; }
  .border-gray-600 { border-color: #4b5563; }
  .border-gray-700 { border-color: #374151; }
  .border-violet-400 { border-color: #a78bfa; }
  .border-violet-500 { border-color: #8b5cf6; }
  .border-white\\/10 { border-color: rgb(255 255 255 / 0.1); }
  .border-white\\/20 { border-color: rgb(255 255 255 / 0.2); }
  .border-black\\/10 { border-color: rgb(0 0 0 / 0.1); }
  .divide-y > :not([hidden]) ~ :not([hidden]) { border-top-width: 1px; }
  .divide-gray-200 > :not([hidden]) ~ :not([hidden]) { border-color: #e5e7eb; }
  .divide-gray-700 > :not([hidden]) ~ :not([hidden]) { border-color: #374151; }

  /* === Opacity === */
  .opacity-0 { opacity: 0; }
  .opacity-5 { opacity: 0.05; }
  .opacity-10 { opacity: 0.1; }
  .opacity-20 { opacity: 0.2; }
  .opacity-25 { opacity: 0.25; }
  .opacity-30 { opacity: 0.3; }
  .opacity-40 { opacity: 0.4; }
  .opacity-50 { opacity: 0.5; }
  .opacity-60 { opacity: 0.6; }
  .opacity-70 { opacity: 0.7; }
  .opacity-75 { opacity: 0.75; }
  .opacity-80 { opacity: 0.8; }
  .opacity-90 { opacity: 0.9; }
  .opacity-100 { opacity: 1; }

  /* === Shadow === */
  .shadow-sm { box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); }
  .shadow { box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1); }
  .shadow-md { box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1); }
  .shadow-lg { box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); }
  .shadow-xl { box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1); }
  .shadow-2xl { box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25); }
  .shadow-none { box-shadow: none; }

  /* === Backdrop Blur (Glass Effect) === */
  .backdrop-blur-none { backdrop-filter: blur(0); }
  .backdrop-blur-sm { backdrop-filter: blur(4px); }
  .backdrop-blur { backdrop-filter: blur(8px); }
  .backdrop-blur-md { backdrop-filter: blur(12px); }
  .backdrop-blur-lg { backdrop-filter: blur(16px); }
  .backdrop-blur-xl { backdrop-filter: blur(24px); }
  .backdrop-blur-2xl { backdrop-filter: blur(40px); }

  /* === Transition === */
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

  /* === Transform === */
  .scale-0 { transform: scale(0); }
  .scale-50 { transform: scale(.5); }
  .scale-75 { transform: scale(.75); }
  .scale-90 { transform: scale(.9); }
  .scale-95 { transform: scale(.95); }
  .scale-100 { transform: scale(1); }
  .scale-105 { transform: scale(1.05); }
  .scale-110 { transform: scale(1.1); }
  .rotate-0 { transform: rotate(0deg); }
  .rotate-45 { transform: rotate(45deg); }
  .rotate-90 { transform: rotate(90deg); }
  .rotate-180 { transform: rotate(180deg); }
  .-rotate-90 { transform: rotate(-90deg); }
  .-rotate-45 { transform: rotate(-45deg); }
  .translate-x-0 { transform: translateX(0); }
  .translate-y-0 { transform: translateY(0); }
  .-translate-x-1\\/2 { transform: translateX(-50%); }
  .-translate-y-1\\/2 { transform: translateY(-50%); }

  /* === Cursor === */
  .cursor-auto { cursor: auto; }
  .cursor-default { cursor: default; }
  .cursor-pointer { cursor: pointer; }
  .cursor-wait { cursor: wait; }
  .cursor-text { cursor: text; }
  .cursor-move { cursor: move; }
  .cursor-not-allowed { cursor: not-allowed; }
  .cursor-grab { cursor: grab; }
  .cursor-grabbing { cursor: grabbing; }

  /* === Pointer Events === */
  .pointer-events-none { pointer-events: none; }
  .pointer-events-auto { pointer-events: auto; }

  /* === User Select === */
  .select-none { user-select: none; }
  .select-text { user-select: text; }
  .select-all { user-select: all; }
  .select-auto { user-select: auto; }

  /* === Overflow === */
  .overflow-auto { overflow: auto; }
  .overflow-hidden { overflow: hidden; }
  .overflow-visible { overflow: visible; }
  .overflow-scroll { overflow: scroll; }
  .overflow-x-auto { overflow-x: auto; }
  .overflow-y-auto { overflow-y: auto; }
  .overflow-x-hidden { overflow-x: hidden; }
  .overflow-y-hidden { overflow-y: hidden; }
  .overflow-x-scroll { overflow-x: scroll; }
  .overflow-y-scroll { overflow-y: scroll; }

  /* === Object Fit === */
  .object-contain { object-fit: contain; }
  .object-cover { object-fit: cover; }
  .object-fill { object-fit: fill; }
  .object-none { object-fit: none; }
  .object-center { object-position: center; }

  /* === Visibility === */
  .visible { visibility: visible; }
  .invisible { visibility: hidden; }
  .collapse { visibility: collapse; }

  /* === Outline === */
  .outline-none { outline: 2px solid transparent; outline-offset: 2px; }
  .outline { outline-style: solid; }
  .outline-dashed { outline-style: dashed; }
  .outline-offset-2 { outline-offset: 2px; }
  .outline-offset-4 { outline-offset: 4px; }

  /* === Ring (Focus) === */
  .ring-0 { box-shadow: 0 0 0 0 transparent; }
  .ring-1 { box-shadow: 0 0 0 1px var(--tw-ring-color, rgb(59 130 246 / 0.5)); }
  .ring-2 { box-shadow: 0 0 0 2px var(--tw-ring-color, rgb(59 130 246 / 0.5)); }
  .ring-4 { box-shadow: 0 0 0 4px var(--tw-ring-color, rgb(59 130 246 / 0.5)); }
  .ring-violet-500 { --tw-ring-color: #8b5cf6; }
  .ring-blue-500 { --tw-ring-color: #3b82f6; }

  /* === Aspect Ratio === */
  .aspect-auto { aspect-ratio: auto; }
  .aspect-square { aspect-ratio: 1 / 1; }
  .aspect-video { aspect-ratio: 16 / 9; }

  /* === Scroll === */
  .scroll-smooth { scroll-behavior: smooth; }
  .scrollbar-hide { scrollbar-width: none; -ms-overflow-style: none; }
  .scrollbar-hide::-webkit-scrollbar { display: none; }

  /* === Animation === */
  .animate-none { animation: none; }
  .animate-spin { animation: spin 1s linear infinite; }
  .animate-ping { animation: ping 1s cubic-bezier(0, 0, 0.2, 1) infinite; }
  .animate-pulse { animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
  .animate-bounce { animation: bounce 1s infinite; }

  /* === Hover States (using :hover) === */
  .hover\\:opacity-80:hover { opacity: 0.8; }
  .hover\\:opacity-90:hover { opacity: 0.9; }
  .hover\\:opacity-100:hover { opacity: 1; }
  .hover\\:scale-105:hover { transform: scale(1.05); }
  .hover\\:scale-110:hover { transform: scale(1.1); }
  .hover\\:bg-gray-100:hover { background-color: #f3f4f6; }
  .hover\\:bg-gray-200:hover { background-color: #e5e7eb; }
  .hover\\:bg-gray-700:hover { background-color: #374151; }
  .hover\\:bg-gray-800:hover { background-color: #1f2937; }
  .hover\\:bg-white\\/10:hover { background-color: rgb(255 255 255 / 0.1); }
  .hover\\:bg-black\\/10:hover { background-color: rgb(0 0 0 / 0.1); }
  .hover\\:text-gray-900:hover { color: #111827; }
  .hover\\:text-white:hover { color: #fff; }
  .hover\\:border-gray-400:hover { border-color: #9ca3af; }
  .hover\\:shadow-lg:hover { box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1); }

  /* === Focus States === */
  .focus\\:outline-none:focus { outline: 2px solid transparent; outline-offset: 2px; }
  .focus\\:ring-2:focus { box-shadow: 0 0 0 2px var(--tw-ring-color, rgb(59 130 246 / 0.5)); }
  .focus\\:ring-violet-500:focus { --tw-ring-color: #8b5cf6; }
  .focus\\:border-violet-500:focus { border-color: #8b5cf6; }

  /* === Active States === */
  .active\\:scale-95:active { transform: scale(0.95); }
  .active\\:opacity-80:active { opacity: 0.8; }

  /* === Disabled States === */
  .disabled\\:opacity-50:disabled { opacity: 0.5; }
  .disabled\\:cursor-not-allowed:disabled { cursor: not-allowed; }
  .disabled\\:pointer-events-none:disabled { pointer-events: none; }

  /* === Group Hover === */
  .group:hover .group-hover\\:visible { visibility: visible; }
  .group:hover .group-hover\\:opacity-100 { opacity: 1; }
  .group:hover .group-hover\\:scale-105 { transform: scale(1.05); }

  /* === Dark Mode (using .dark class on parent) === */
  .dark .dark\\:bg-gray-800 { background-color: #1f2937; }
  .dark .dark\\:bg-gray-900 { background-color: #111827; }
  .dark .dark\\:bg-neutral-900 { background-color: #171717; }
  .dark .dark\\:bg-white\\/5 { background-color: rgb(255 255 255 / 0.05); }
  .dark .dark\\:bg-white\\/10 { background-color: rgb(255 255 255 / 0.1); }
  .dark .dark\\:text-gray-100 { color: #f3f4f6; }
  .dark .dark\\:text-gray-200 { color: #e5e7eb; }
  .dark .dark\\:text-gray-300 { color: #d1d5db; }
  .dark .dark\\:text-gray-400 { color: #9ca3af; }
  .dark .dark\\:text-white { color: #fff; }
  .dark .dark\\:border-gray-600 { border-color: #4b5563; }
  .dark .dark\\:border-gray-700 { border-color: #374151; }
  .dark .dark\\:border-white\\/10 { border-color: rgb(255 255 255 / 0.1); }
  .dark .dark\\:hover\\:bg-gray-700:hover { background-color: #374151; }
  .dark .dark\\:hover\\:bg-gray-800:hover { background-color: #1f2937; }
  .dark .dark\\:hover\\:bg-white\\/10:hover { background-color: rgb(255 255 255 / 0.1); }
  .dark .dark\\:hover\\:text-white:hover { color: #fff; }
  .dark .dark\\:divide-gray-700 > :not([hidden]) ~ :not([hidden]) { border-color: #374151; }
}

/* Keyframes for animations */
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes ping { 75%, 100% { transform: scale(2); opacity: 0; } }
@keyframes pulse { 50% { opacity: .5; } }
@keyframes bounce { 0%, 100% { transform: translateY(-25%); animation-timing-function: cubic-bezier(0.8,0,1,1); } 50% { transform: none; animation-timing-function: cubic-bezier(0,0,0.2,1); } }
`

export default {
  useIframeResize,
  sendResizeMessage,
  calculateWidgetDimensions,
  calculatePageDimensions,
  getIframeStyles,
  IFRAME_RESIZE_SCRIPT,
  IFRAME_RESIZE_CSS,
  TAILWIND_SUBSET_CSS,
}
