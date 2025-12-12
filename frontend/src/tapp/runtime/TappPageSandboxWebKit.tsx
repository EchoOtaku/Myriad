/**
 * Tapp Page 沙箱组件 - WebKit 专用版本
 *
 * 🎯 目标：恢复旧版本“非全屏可用”的架构（容器/iframe/加载方式），
 * 同时让运行页保留新 UI 与全屏模式。
 */

import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import type { TappInstance } from '../types'
import type { TappCodeStructure } from '../examples/tapps/types'
import { getCodeForMode } from '../examples/tapps/types'
import { TappBridge, createTappBridge } from './TappBridge'
import { TappPermissionController, createPermissionController } from './TappPermission'
import { useIframeResize, sendResizeMessage } from '../utils/iframeResize'
import { useI18n } from '../../contexts/I18nContext'
import { subscribeToTheme, getIsDarkMode } from '../../utils/themeSubscriber'
import { subscribeToPrimaryColor } from '../../utils/colorSubscriber'
import { useAnimationLevel } from '../../hooks/useAnimationLevel'
import { isPageVisible, onVisibility } from '../../hooks/animation/core'

// 核心模块
import {
  generateCSP,
  generateNonce,
  generateSecurityWrapper,
  IFRAME_SANDBOX_ATTRS,
  generateFullSDK,
  generateThemeCSS,
  PAGE_STATIC_CSS,
  type TappNotificationOptions,
  type SafeInsets,
  type AnimationConfigRef,
} from './sandbox'

// 处理器
import {
  registerLifecycleHandlers,
  registerUIHandlers,
  registerStorageHandlers,
  registerUserHandlers,
  registerWidgetHandlers,
  registerPlatformHandlers,
  registerAIHandlers,
  registerReportHandlers,
  registerMediaHandlers,
  registerBackgroundHandlers,
  registerAnimationHandlers,
  registerDynamicContentHandlers,
  registerAdvancedHandlers,
  registerContextHandlers,
} from './sandbox/handlers'

export interface TappPageSandboxWebKitProps {
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
  /** 安全区域内边距 */
  safeInsets?: SafeInsets
}

/**
 * 生成 Page 沙箱 HTML - WebKit 专用版本
 */
function generatePageHTML(
  tappInstance: TappInstance,
  code: TappCodeStructure,
  sessionToken: string,
  safeInsets?: SafeInsets
): string {
  const { manifest } = tappInstance
  const isDark = getIsDarkMode()
  const primaryColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-primary').trim() || '#94a3b8'

  // 🔒 生成唯一 nonce（每个沙箱实例独立）
  const nonce = generateNonce()
  const csp = generateCSP(nonce)
  const securityWrapper = generateSecurityWrapper(sessionToken)
  const sdkCode = generateFullSDK(tappInstance, sessionToken)
  const themeCSS = generateThemeCSS(isDark, primaryColor)
  
  const customCSS = code.styles || ''
  const hasHtmlTemplate = !!code.pageHtml
  const pageHtmlContent = code.pageHtml || ''

  // 🎯 检测 pageHtml 是否已经包含分层结构
  // 如果包含 #tapp-background 或 #tapp-content，说明 Tapp 自己定义了分层
  const hasLayeredStructure = pageHtmlContent.includes('id="tapp-background"') ||
    pageHtmlContent.includes("id='tapp-background'") ||
    pageHtmlContent.includes('id="tapp-content"') ||
    pageHtmlContent.includes("id='tapp-content'")
  
  const pageCode = getCodeForMode(code, 'page')
  const tailwindCSS = code.pageCSS || ''
  const needsJsRender = !hasHtmlTemplate
  const initialPadding = `${safeInsets?.top ?? 0}px ${safeInsets?.right ?? 0}px ${safeInsets?.bottom ?? 0}px ${safeInsets?.left ?? 0}`

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
    // WebKit 专用：显式禁用 SDK 内的 transform repaint hack（避免 iframe 空白回归）
    window._TAPP_DISABLE_TRANSFORM_REPAINT = true;

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

  ${needsJsRender ? `
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
  ` : '<!-- 混合/HTML 模式：HTML 已渲染，JS 用于交互 -->'}
</body>
</html>`
}

/**
 * Tapp Page 沙箱组件 - WebKit 专用版本
 */
export const TappPageSandboxWebKit: React.FC<TappPageSandboxWebKitProps> = ({
  tappInstance,
  code,
  onReady,
  onError,
  onDestroy,
  onNotification,
  className,
  safeInsets,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<TappBridge | null>(null)
  const permissionRef = useRef<TappPermissionController | null>(null)
  const [isReady, setIsReady] = useState(false)
  const lastBlobUrlRef = useRef<string | null>(null)
  
  const { containerRef, dimensions } = useIframeResize<HTMLDivElement>()
  const { locale } = useI18n()
  const animationConfig = useAnimationLevel()
  
  const tappInstanceRef = useRef(tappInstance)
  const codeRef = useRef(code)
  const safeInsetsRef = useRef(safeInsets)
  tappInstanceRef.current = tappInstance
  codeRef.current = code
  safeInsetsRef.current = safeInsets
  
  const pageVisibleRef = useRef(isPageVisible())
  useEffect(() => {
    return onVisibility((visible) => {
      pageVisibleRef.current = visible
      if (isReady && bridgeRef.current) {
        bridgeRef.current.emit(visible ? 'lifecycle:resume' : 'lifecycle:pause', null)
      }
    })
  }, [isReady])
  
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

  const emitHostDebug = useCallback((detail: Record<string, unknown>) => {
    try {
      window.dispatchEvent(new CustomEvent('__tapp_webkit_sandbox', { detail }))
    } catch {
      // ignore
    }
  }, [])

  // 尺寸更新
  useEffect(() => {
    if (!iframeRef.current || dimensions.width === 0) return
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
    if (!bridgeRef.current || !isReady) return
    bridgeRef.current.emit('locale:change', locale)
  }, [locale, isReady])

  // 主题变化
  useEffect(() => {
    if (!isReady) return
    return subscribeToTheme((isDark) => {
      const bridge = bridgeRef.current
      if (bridge) {
        bridge.emit('theme:change', isDark ? 'dark' : 'light')
      }
    })
  }, [isReady])

  // 主色调变化
  useEffect(() => {
    if (!isReady) return
    return subscribeToPrimaryColor((color) => {
      const bridge = bridgeRef.current
      if (bridge && color) {
        bridge.emit('primaryColor:change', color)
      }
    })
  }, [isReady])

  // 媒体状态变化
  useEffect(() => {
    if (!isReady) return
    
    const handleMusicStateChange = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      
      const bridge = bridgeRef.current
      if (!bridge) return
      
      const tapp = tappInstanceRef.current
      if (!tapp?.grantedPermissions?.includes('media:read')) return
      
      const currentSong = detail.currentSong as Record<string, unknown> | null
      const currentTime = (detail.currentTime as number) || 0
      const audioDuration = (detail.audioDuration as number) || (currentSong?.duration as number) || 0
      const volume = (detail.volume as number) || 0.7
      const playMode = (detail.playMode as string) || 'loop'
      
      const modeMap: Record<string, string> = {
        'loop': 'loop',
        'single': 'single',
        'shuffle': 'shuffle'
      }
      
      const mediaState = {
        isPlaying: detail.isPlaying || false,
        isPaused: !detail.isPlaying && currentSong !== null,
        currentTrack: currentSong ? {
          id: currentSong.id || '',
          title: currentSong.name || currentSong.title || '',
          name: currentSong.name || currentSong.title || '',
          artist: currentSong.artist || '',
          album: currentSong.album || '',
          cover: currentSong.cover || '',
          duration: currentSong.duration || 0,
        } : null,
        progress: {
          current: currentTime,
          duration: audioDuration,
          percentage: audioDuration > 0 ? (currentTime / audioDuration) * 100 : 0
        },
        position: currentTime,
        volume: Math.round(volume * 100),
        mode: modeMap[playMode] || 'sequence',
        muted: volume === 0,
        lyrics: detail.lyrics || [],
        currentLyricIndex: detail.currentLyricIndex ?? -1,
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
    if (!isReady) return
    bridgeRef.current?.emit('animationLevel:change', animationConfig.level)
  }, [isReady, animationConfig.level])

  const handleReady = useCallback(() => {
    setIsReady(true)
    onReady?.()
  }, [onReady])

  // 初始化 iframe（恢复旧版：blob URL + 标准容器样式）
  useEffect(() => {
    if (!iframeRef.current) {
      return
    }
    
    const currentTappInstance = tappInstanceRef.current
    const currentCode = codeRef.current
    
    const bridge = createTappBridge()
    bridgeRef.current = bridge

    const permission = createPermissionController(currentTappInstance)
    permissionRef.current = permission

    bridge.initialize(iframeRef.current, currentTappInstance)

    // 注册所有处理器（与 TappPageSandbox 保持一致）
    registerLifecycleHandlers(bridge, currentTappInstance, handleReady)
    registerUIHandlers(bridge, () => localeRef.current, onNotification)
    registerStorageHandlers(bridge, currentTappInstance.id)
    registerUserHandlers(bridge, currentTappInstance)
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

    // 获取 session token（Bridge 在 initialize 时已生成）
    const sessionToken = bridge.getSessionToken()

    // 生成 HTML（传递 session token 用于安全验证）
    const html = generatePageHTML(currentTappInstance, currentCode, sessionToken, safeInsetsRef.current)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    lastBlobUrlRef.current = url
    iframeRef.current.src = url
    emitHostDebug({ kind: 'load:blob', t: Date.now() })

    return () => {
      setIsReady(false)
      try {
        if (lastBlobUrlRef.current) {
          URL.revokeObjectURL(lastBlobUrlRef.current)
          lastBlobUrlRef.current = null
        }
      } catch {
        // ignore
      }
      bridge.destroy()
      bridgeRef.current = null
      permissionRef.current = null
      onDestroy?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tappInstance.id, codeFingerprint, handleReady])

  return (
    <div
      ref={containerRef}
      className={`tapp-page-sandbox relative w-full h-full overflow-hidden isolate [contain:strict] ${className || ''}`}
    >
      <iframe
        ref={iframeRef}
        className="tapp-page-iframe absolute inset-0 w-full h-full border-0 block"
        sandbox={IFRAME_SANDBOX_ATTRS}
        referrerPolicy="no-referrer"
        title={tappInstance.manifest.name}
        allowFullScreen
        // @ts-expect-error Safari webkit prefix
        webkitallowfullscreen="true"
      />
    </div>
  )
}

export default TappPageSandboxWebKit
