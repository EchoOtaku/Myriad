/**
 * Tapp Page 沙箱组件
 *
 * 用于渲染 Tapp 的页面模式（全屏应用）
 */

import type { AnimationConfigRef, SafeInsets, TappNotificationOptions } from './sandbox'
import {
  IFRAME_SANDBOX_ATTRS,
  PAGE_STATIC_CSS,
  generateCSP,
  generateFullSDK,
  generateNonce,
  generateSecurityWrapper,
  generateSessionToken,
  generateThemeCSS,
} from './sandbox'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  registerAIHandlers,
  registerAdvancedHandlers,
  registerAnimationHandlers,
  registerBackgroundHandlers,
  registerContextHandlers,
  registerDynamicContentHandlers,
  registerFileHandlers,
  registerLifecycleHandlers,
  registerMediaHandlers,
  registerPlatformHandlers,
  registerReportHandlers,
  registerStorageHandlers,
  registerUIHandlers,
  registerUserHandlers,
  registerWidgetHandlers,
} from './sandbox/handlers'
import { sendResizeMessage, useIframeResize } from '../utils/iframeResize'

import type { TappBridge } from './TappBridge'
import type { TappCodeStructure } from '../examples/tapps/types'
import type { TappInstance } from '../types'
import type { TappPermissionController } from './TappPermission'
import { createPermissionController } from './TappPermission'
import { createTappBridge } from './TappBridge'
import { getCodeForMode } from '../examples/tapps/types'
import { getIsDarkMode } from '../../utils/themeSubscriber'
import { useAnimationLevel } from '../../hooks/useAnimationLevel'
import { useI18n } from '../../contexts/I18nContext'
import { useSandboxSubscriptions } from './useSandboxSubscriptions'

// 核心模块





// 处理器













// 🎯 WebKit/Safari 检测（仅在模块加载时计算一次）
// Safari 及 iOS 浏览器存在合成层 bug，需要将 iframe portal 到 body
// 检测策略：UA + vendor 双重验证，避免单一信号误判
export const isWebKit: boolean = (() => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // UA 检测：包含 AppleWebKit 但排除桌面版 Chrome/Chromium
  // iOS 上所有浏览器（CriOS、FxiOS 等）不含 Chrome/Chromium 标识，会被正确识别
  const uaIsWebKit = /\bAppleWebKit\b/.test(ua) && !/\bChrom(e|ium)\b/.test(ua)
  // vendor 检测：Apple 平台的 WebKit 浏览器 vendor 固定为 "Apple Computer, Inc."
  // 包括 macOS Safari、iOS Safari/Chrome/Firefox 等
  const isAppleVendor = navigator.vendor === 'Apple Computer, Inc.'
  // 双重验证：UA + vendor 同时满足才启用 portal 模式
  return uaIsWebKit && isAppleVendor
})()

export interface TappPageSandboxProps {
  /** Tapp 实例 */
  tappInstance: TappInstance
  /** Tapp 代码 */
  code: TappCodeStructure
  /** 准备就绪回调 */
  onReady?: () => void
  /** 错误回调 */
  onError?: (error: Error) => void
  /** 销毁回调 */
  onDestroy?: () => void
  /** 通知回调 */
  onNotification?: (options: TappNotificationOptions) => void
  /** 自定义类名 */
  className?: string
  /** 自定义样式 */
  style?: React.CSSProperties
  /** 安全区域内边距 */
  safeInsets?: SafeInsets
}

/**
 * 生成 Page 沙箱 HTML
 *
 * 支持三种渲染方式：
 * 1. 纯 JS 模式：Tapp.pages[id].render(container, props)
 * 2. 纯 HTML 模式：pageHtml 直接渲染（适合静态页面）
 * 3. 混合模式：pageHtml 定义结构 + JS 处理交互（性能最优）
 *
 * 🔒 安全特性：
 * - 使用 CSP nonce 替代 unsafe-inline，只有带正确 nonce 的脚本才能执行
 * - 安全包装器禁用危险 API（eval, Function 等）
 *
 * @param tappInstance - Tapp 实例
 * @param code - Tapp 代码结构
 * @param sessionToken - 会话 token（用于消息验证）
 * @param safeInsets - 安全区域内边距
 */
function generatePageHTML(
  tappInstance: TappInstance,
  code: TappCodeStructure,
  sessionToken: string,
  safeInsets?: SafeInsets,
): string {
  const { manifest } = tappInstance
  const isDark = getIsDarkMode()
  const primaryColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-primary')
    .trim() || '#94a3b8'

  // 🔒 生成唯一 nonce（每个沙箱实例独立）
  const nonce = generateNonce()
  const csp = generateCSP(nonce)
  const securityWrapper = generateSecurityWrapper(sessionToken)
  const sdkCode = generateFullSDK(tappInstance, sessionToken)
  const themeCSS = generateThemeCSS(isDark, primaryColor)

  // 自定义 CSS
  const customCSS = code.styles || ''

  // HTML 模板（如果有）
  const hasHtmlTemplate = !!code.pageHtml
  const pageHtmlContent = code.pageHtml || ''

  // 🎯 检测 pageHtml 是否已经包含分层结构
  // 如果包含 #tapp-background 或 #tapp-content，说明 Tapp 自己定义了分层
  const hasLayeredStructure = pageHtmlContent.includes('id="tapp-background"')
    || pageHtmlContent.includes('id=\'tapp-background\'')
    || pageHtmlContent.includes('id="tapp-content"')
    || pageHtmlContent.includes('id=\'tapp-content\'')

  // JS 代码 - 混合模式下也会加载
  const pageCode = getCodeForMode(code, 'page')

  // 🎯 使用安装时预编译的 CSS
  const tailwindCSS = code.pageCSS || ''

  // 是否需要调用 Tapp.pages.render()
  // 仅在没有 HTML 模板时才需要（纯 JS 模式）
  const needsJsRender = !hasHtmlTemplate

  // 初始安全区域 padding（确保首次渲染就有正确的间距）
  const initialPadding = `${safeInsets?.top ?? 0}px ${safeInsets?.right ?? 0}px ${safeInsets?.bottom ?? 0}px ${safeInsets?.left ?? 0}px`

  // 🎯 根据是否有分层结构决定 body 内容
  // - 有分层：直接使用 pageHtmlContent（已包含 #tapp-background 和 #tapp-content）
  // - 无分层：用默认结构包装
  const bodyContent = hasLayeredStructure
    ? `<div id="tapp-root">${pageHtmlContent}</div>`
    : `<div id="tapp-root">
    <div id="tapp-background"></div>
    <div id="tapp-content">${pageHtmlContent}</div>
  </div>`

  return `<!DOCTYPE html>
<html class="tapp-mode-page">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${manifest.name}</title>
  <style>
    ${PAGE_STATIC_CSS}
    ${tailwindCSS}
    ${themeCSS}
    ${customCSS}
    /* 初始安全区域 padding - 确保全屏模式下内容不被遮挡 */
    #tapp-content { padding: ${initialPadding}; box-sizing: border-box; }
  </style>
</head>
<body class="${isDark ? 'dark' : 'light'}">
  ${bodyContent}

  <script nonce="${nonce}">
    window._TAPP_MODE = 'page';
    window._TAPP_HAS_HTML = ${hasHtmlTemplate};
    window._TAPP_INITIAL_SAFE_INSETS = {
      top: ${safeInsets?.top ?? 0},
      right: ${safeInsets?.right ?? 0},
      bottom: ${safeInsets?.bottom ?? 0},
      left: ${safeInsets?.left ?? 0}
    };
    window._TAPP_DIMENSIONS = { width: 0, height: 0, scale: 1, fontScale: 1 };
    window.addEventListener('message', function(e) {
      var msg = e.data;
      if (msg?.type === 'event' && msg.action === 'container:resize') {
        window._TAPP_DIMENSIONS = msg.payload;
        var root = document.documentElement;
        root.style.setProperty('--tapp-scale', msg.payload.scale || 1);
        root.style.setProperty('--tapp-font-scale', msg.payload.fontScale || 1);
        var content = document.getElementById('tapp-content');
        if (content) {
          content.style.padding =
            (msg.payload.safeInsetTop || 0) + 'px ' +
            (msg.payload.safeInsetRight || 0) + 'px ' +
            (msg.payload.safeInsetBottom || 0) + 'px ' +
            (msg.payload.safeInsetLeft || 0) + 'px';
        }
        window.dispatchEvent(new CustomEvent('tapp:resize', { detail: msg.payload }));
      }
    });
  </script>

  <script nonce="${nonce}">${securityWrapper}</script>
  <script nonce="${nonce}">${sdkCode}</script>

  <!-- JS 代码始终加载（用于事件绑定等） -->
  <script nonce="${nonce}">
    (function() {
      'use strict';
      try {
        ${pageCode}
      } catch (error) {
        console.error('[Page] Code error:', error);
        Tapp.lifecycle._notifyError(error);
      }
    })();
  </script>

  ${needsJsRender
    ? `
  <!-- 纯 JS 模式：调用 render 函数 -->
  <script nonce="${nonce}">
    (function() {
      'use strict';
      setTimeout(function() {
        try {
          var pageKeys = Object.keys(Tapp.pages || {});
          if (pageKeys.length > 0) {
            var pageId = pageKeys[0];
            var pageDef = Tapp.pages[pageId];
            if (pageDef && typeof pageDef.render === 'function') {
              var container = document.getElementById('tapp-content');
              container.innerHTML = '';
              pageDef.render(container, {});
            }
          }
        } catch (error) {
          console.error('[Page] Render error:', error);
          document.getElementById('tapp-content').innerHTML =
            '<div class="tapp-empty tapp-text-error">Page Error: ' + error.message + '</div>';
        }
      }, 50);
    })();
  </script>
  `
    : '<!-- 混合/HTML 模式：HTML 已渲染，JS 用于交互 -->'}
</body>
</html>`
}

/**
 * Tapp Page 沙箱组件
 */
export const TappPageSandbox: React.FC<TappPageSandboxProps> = ({
  tappInstance,
  code,
  onReady,
  onError,
  onDestroy,
  onNotification,
  className,
  style,
  safeInsets,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<TappBridge | null>(null)
  const permissionRef = useRef<TappPermissionController | null>(null)
  const [isReady, setIsReady] = useState(false)

  const { containerRef, dimensions } = useIframeResize<HTMLDivElement>()
  const { locale } = useI18n()
  const animationConfig = useAnimationLevel()

  // 🎯 性能优化：使用 ref 存储对象引用，避免依赖变化触发 iframe 重建
  const tappInstanceRef = useRef(tappInstance)
  const codeRef = useRef(code)
  const safeInsetsRef = useRef(safeInsets)
  tappInstanceRef.current = tappInstance
  codeRef.current = code
  safeInsetsRef.current = safeInsets

  // 🎯 集成动画调度器的页面可见性感知 + 主题/主色调订阅（共享 hook）
  useSandboxSubscriptions(bridgeRef, isReady)

  // 🎯 生成稳定的代码指纹，只有代码实际变化时才重建 iframe
  const codeFingerprint = useMemo(() => {
    const ph = code.pageHtml || ''
    const st = code.styles || ''
    const js = getCodeForMode(code, 'page') || ''
    return `${ph.length}:${st.length}:${js.length}`
  }, [code])

  const localeRef = useRef(locale)
  useEffect(() => { localeRef.current = locale }, [locale])

  const animationConfigRef = useRef<AnimationConfigRef>(animationConfig)
  useEffect(() => { animationConfigRef.current = animationConfig }, [animationConfig])

  // 尺寸更新
  useEffect(() => {
    if (!iframeRef.current || dimensions.width === 0)
      return
    const dims = {
      ...dimensions,
      safeInsetTop: safeInsets?.top ?? 0,
      safeInsetRight: safeInsets?.right ?? 0,
      safeInsetBottom: safeInsets?.bottom ?? 0,
      safeInsetLeft: safeInsets?.left ?? 0,
    }
    sendResizeMessage(iframeRef.current, dims)
  }, [dimensions, safeInsets])

  // 语言变化
  useEffect(() => {
    if (!bridgeRef.current || !isReady)
      return
    bridgeRef.current.emit('locale:change', locale)
  }, [locale, isReady])

  // 媒体状态变化 - 转发给 Tapp 沙箱
  useEffect(() => {
    if (!isReady)
      return

    const handleMusicStateChange = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail)
        return

      const bridge = bridgeRef.current
      if (!bridge)
        return

      // 检查 Tapp 是否有 media:read 权限
      const tapp = tappInstanceRef.current
      if (!tapp?.grantedPermissions?.includes('media:read'))
        return

      const currentSong = detail.currentSong as Record<string, unknown> | null
      const currentTime = (detail.currentTime as number) || 0
      const audioDuration = (detail.audioDuration as number) || (currentSong?.duration as number) || 0
      const volume = (detail.volume as number) || 0.7
      const playMode = (detail.playMode as string) || 'loop'

      // 将内部 playMode 映射为 API 模式
      const modeMap: Record<string, string> = {
        loop: 'loop',
        single: 'single',
        shuffle: 'shuffle',
      }

      // 构建状态对象
      const mediaState = {
        isPlaying: detail.isPlaying || false,
        isPaused: !detail.isPlaying && currentSong !== null,
        currentTrack: currentSong
          ? {
              id: currentSong.id || '',
              title: currentSong.name || currentSong.title || '',
              name: currentSong.name || currentSong.title || '',
              artist: currentSong.artist || '',
              album: currentSong.album || '',
              cover: currentSong.cover || '',
              duration: currentSong.duration || 0,
            }
          : null,
        progress: {
          current: currentTime,
          duration: audioDuration,
          percentage: audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0,
        },
        position: currentTime,
        volume: Math.round(volume * 100), // 0-100
        mode: modeMap[playMode] || 'sequence',
        muted: volume === 0,
        // 歌词信息
        lyrics: detail.lyrics || [],
        currentLyricIndex: detail.currentLyricIndex ?? -1,
        // 动态主题色（完整颜色对象）
        primaryColor: detail.musicColor || '#fc3c44',
        secondaryColor: detail.musicColors?.secondary || detail.musicColor || '#fc3c44',
        accentColor: detail.musicColors?.accent || detail.musicColor || '#fc3c44',
        lightColor: detail.musicColors?.light || '#ffffff',
        darkColor: detail.musicColors?.dark || '#000000',
      }

      bridge.emit('mediaStateChange', mediaState)
    }

    window.addEventListener('music-player-state-change', handleMusicStateChange)
    return () => {
      window.removeEventListener('music-player-state-change', handleMusicStateChange)
    }
  }, [isReady])

  // 动画级别变化
  useEffect(() => {
    if (!isReady)
      return
    bridgeRef.current?.emit('animationLevel:change', animationConfig.level)
  }, [isReady, animationConfig.level])

  const handleReady = useCallback(() => {
    setIsReady(true)
    onReady?.()
  }, [onReady])

  const handleError = useCallback((error: Error) => {
    onError?.(error)
  }, [onError])

  // 初始化
  // 🎯 依赖优化：只使用稳定的 ID 和指纹，不使用对象引用
  // 🎯 Safari 兼容：使用 imperative iframe 创建，确保 srcdoc 在 DOM 插入前设置
  //    Safari/WebKit 不会重新渲染已挂载的 sandboxed iframe 的 srcdoc 变更
  useEffect(() => {
    const container = containerRef.current
    if (!container)
      return

    // 🎯 从 ref 获取当前对象，避免闭包陈旧问题
    const currentTappInstance = tappInstanceRef.current
    const currentCode = codeRef.current

    // 生成 session token（独立于 Bridge，确保 HTML 生成和 Bridge 使用同一 token）
    const sessionToken = generateSessionToken()

    // 创建 iframe
    const iframe = document.createElement('iframe')
    iframe.className = 'tapp-page-iframe'
    iframe.setAttribute('sandbox', IFRAME_SANDBOX_ATTRS)
    iframe.setAttribute('referrerpolicy', 'no-referrer')
    iframe.title = currentTappInstance.manifest.name
    iframe.allowFullscreen = true
    iframeRef.current = iframe

    // 初始化 Bridge（在 DOM 插入前设置消息监听）
    const bridge = createTappBridge()
    bridgeRef.current = bridge

    const permission = createPermissionController(currentTappInstance)
    permissionRef.current = permission

    bridge.initialize(iframe, currentTappInstance, sessionToken)

    // 注册所有处理器
    registerLifecycleHandlers(bridge, currentTappInstance, handleReady, handleError)
    registerUIHandlers(bridge, () => localeRef.current, onNotification)
    registerStorageHandlers(bridge, currentTappInstance.id)
    registerUserHandlers(bridge, currentTappInstance)
    registerFileHandlers(bridge)
    registerWidgetHandlers(bridge, currentTappInstance)
    registerPlatformHandlers(bridge, currentTappInstance)
    registerAIHandlers(bridge, permission, currentTappInstance)
    registerReportHandlers(bridge, currentTappInstance)
    registerMediaHandlers(bridge, currentTappInstance)
    registerBackgroundHandlers(bridge, currentTappInstance)
    registerAnimationHandlers(bridge, animationConfigRef)
    registerDynamicContentHandlers(bridge, currentTappInstance)
    registerAdvancedHandlers(bridge, currentTappInstance)
    registerContextHandlers(bridge, currentTappInstance)

    // 生成 HTML（使用预生成的 session token）
    const html = generatePageHTML(currentTappInstance, currentCode, sessionToken, safeInsetsRef.current)

    // 清理函数列表
    const cleanups: (() => void)[] = []

    if (isWebKit) {
      // 🎯 Safari/WebKit Portal 模式
      // WebKit 存在合成层 bug：当 iframe 嵌套在含 opacity 动画、overflow:hidden 的祖先链中时，
      // iframe 内容无法被绘制到屏幕上。
      // 解决方案：将 iframe 挂载到 body，使用 position:fixed + ResizeObserver 同步位置和尺寸。
      iframe.style.cssText = 'position:fixed;border:none;display:block;z-index:40;overflow:hidden;border-bottom-left-radius:0.75rem;border-bottom-right-radius:0.75rem;'

      let lastRect = ''
      const syncPosition = () => {
        if (!document.body.contains(iframe))
          return
        const rect = container.getBoundingClientRect()
        const key = `${rect.top},${rect.left},${rect.width},${rect.height}`
        if (key === lastRect)
          return
        lastRect = key
        iframe.style.top = `${rect.top}px`
        iframe.style.left = `${rect.left}px`
        iframe.style.width = `${rect.width}px`
        iframe.style.height = `${rect.height}px`
      }

      const resizeObserver = new ResizeObserver(syncPosition)
      resizeObserver.observe(container)
      if (container.parentElement) {
        resizeObserver.observe(container.parentElement)
      }

      requestAnimationFrame(syncPosition)
      const syncInterval = setInterval(syncPosition, 200)
      const stopPolling = setTimeout(() => clearInterval(syncInterval), 2000)

      document.body.appendChild(iframe)
      iframe.srcdoc = html

      cleanups.push(() => {
        resizeObserver.disconnect()
        clearInterval(syncInterval)
        clearTimeout(stopPolling)
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe)
        }
      })
    }
    else {
      // 🎯 非 Safari 内联模式
      // iframe 直接放在 container 内，位置/尺寸自然跟随父元素，无延迟
      iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;display:block;overflow:hidden;border-bottom-left-radius:0.75rem;border-bottom-right-radius:0.75rem;'

      container.appendChild(iframe)
      iframe.srcdoc = html

      cleanups.push(() => {
        if (container.contains(iframe)) {
          container.removeChild(iframe)
        }
      })
    }

    return () => {
      cleanups.forEach(fn => fn())
      setIsReady(false)
      iframeRef.current = null
      bridge.destroy()
      onDestroy?.()
    }
  // 🎯 稳定依赖：只有这些真正改变时才重建 iframe
  // - tappInstance.id: Tapp 实例 ID
  // - codeFingerprint: 代码指纹（内容变化才会变）
  // ⚠️ 注意：safeInsets 通过 ref 获取，不作为依赖（通过 postMessage 动态更新）
  }, [tappInstance.id, codeFingerprint, handleReady])

  return (
    <div
      ref={containerRef}
      className={`tapp-page-sandbox ${className || ''}`}
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        ...style,
      }}
      data-no-ripple
    >
      {/* iframe 挂载方式：
          - Safari/WebKit: Portal 到 document.body（解决合成层 bug）
          - 其他浏览器: 内联在 container 内（无位置同步延迟） */}
    </div>
  )
}

export default TappPageSandbox
