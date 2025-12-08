/**
 * 沙箱核心模块索引
 * 
 * 导出所有原子化模块
 * 
 * 🎯 性能优化：
 * - 导出预计算的组合 CSS
 * - 导出缓存管理函数
 */

// 类型
export * from './types'

// 安全策略
export { 
  generateCSP, 
  generateSecurityWrapper, 
  generateNonce,
  generateSessionToken,
  validateStorageKey,
  sanitizeStorageValue,
  IFRAME_SANDBOX_ATTRS,
} from './security'

// 样式（含性能优化的预计算 CSS）
export { 
  generateThemeCSS, 
  BASE_CSS, 
  WIDGET_CSS, 
  PAGE_CSS, 
  TAILWIND_SUBSET,
  TAILWIND_CDN_SCRIPT,
  COMPONENT_CSS,
  // 🎯 预计算的组合 CSS
  WIDGET_STATIC_CSS,
  PAGE_STATIC_CSS,
  // 🎯 缓存管理
  clearThemeCSSCache,
  getThemeCSSCacheSize,
} from './styles'

// SDK 生成器
export { generateFullSDK, generateWidgetSDK } from './sdkGenerator'
