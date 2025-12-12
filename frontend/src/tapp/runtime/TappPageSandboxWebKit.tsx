/**
 * Tapp Page 沙箱组件 - WebKit 专用版本
 *
 * 🎯 回归 ae9d05a 版本的实现方式：
 * - 使用 blob URL 加载
 * - 使用 contain: strict + isolation: isolate 隔离层
 * - sandbox 只用 allow-scripts
 * - 保持 CSP nonce 安全机制
 * - 🔧 WebKit 兼容：将可选链转换为传统语法
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
  generateFullSDK,
  generateThemeCSS,
  PAGE_STATIC_CSS,
  IFRAME_SANDBOX_ATTRS,
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

/**
 * 🔧 WebKit 兼容：转换 SDK 代码以适配 WebKit
 * 
 * 1. 将可选链 ?. 和空值合并 ?? 转换为传统语法（Safari 兼容）
 * 2. 禁用强制重排逻辑（WebKit iframe 中不需要）
 */
function convertToWebKitCompatible(code: string): string {
  let result = code
  
  // 🔧 关键：替换 _forceRepaint 函数为空操作
  // 原函数中的 void document.body.offsetHeight 会触发同步重排
  // WebKit iframe 在文档流内不需要强制重排，反而可能导致问题
  result = result.replace(
    /const _forceRepaint = function \(\) \{[\s\S]*?void document\.body\.offsetHeight;[\s\S]*?\};/,
    'const _forceRepaint = function () { /* WebKit: 禁用重排 */ };'
  )
  
  // 同样处理 Widget SDK 中的 forceRepaint
  result = result.replace(
    /var forceRepaint = function\s*\(\)\s*\{[\s\S]*?void document\.body\.offsetHeight;[\s\S]*?\};/g,
    'var forceRepaint = function () { /* WebKit: 禁用重排 */ };'
  )
  
  // 转换可选链调用 foo?.() → (foo && foo())
  result = result.replace(/(\w+)\?\.\(/g, '($1 && $1(')
  
  // 转换可选链属性访问 foo?.bar → (foo && foo.bar)
  result = result.replace(/(\w+)\?\.(\w+)/g, '($1 && $1.$2)')
  
  // 转换空值合并 a ?? b → (a != null ? a : b)
  result = result.replace(/(\w+)\s*\?\?\s*(['"\w]+)/g, '($1 != null ? $1 : $2)')
  
  return result
}

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
  /** 自定义样式 */
  style?: React.CSSProperties
  /** 安全区域内边距 */
  safeInsets?: SafeInsets
}

/**
 * 生成 Page 沙箱 HTML
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

  const nonce = generateNonce()
  const csp = generateCSP(nonce)
  // 🔧 WebKit 兼容：转换可选链语法
  const securityWrapper = convertToWebKitCompatible(generateSecurityWrapper(sessionToken))
  const sdkCode = convertToWebKitCompatible(generateFullSDK(tappInstance, sessionToken))
  const themeCSS = generateThemeCSS(isDark, primaryColor)

  const customCSS = code.styles || ''
  const hasHtmlTemplate = !!code.pageHtml
  const pageHtmlContent = code.pageHtml || ''
  const pageCode = getCodeForMode(code, 'page')
  const tailwindCSS = code.pageCSS || ''
  const needsJsRender = !hasHtmlTemplate
  const initialPadding = `${safeInsets?.top ?? 0}px ${safeInsets?.right ?? 0}px ${safeInsets?.bottom ?? 0}px ${safeInsets?.left ?? 0}px`

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
    #tapp-content { padding: ${initialPadding}; box-sizing: border-box; }
  </style>
</head>
<body class="${isDark ? 'dark' : 'light'}">
  <div id="tapp-root">
    <div id="tapp-background"></div>
    <div id="tapp-content">${pageHtmlContent}</div>
  </div>

  <script nonce="${nonce}">
    // 🔧 WebKit 专用：禁用所有强制重排逻辑
    // WebKit iframe 在文档流内的自然布局已经足够，不需要 transform 切换
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
      if (msg && msg.type === 'event' && msg.action === 'container:resize') {
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
  ` : ''}
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

  const tappInstanceRef = useRef(tappInstance)
  const codeRef = useRef(code)
  tappInstanceRef.current = tappInstance
  codeRef.current = code

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

  // 初始化
  useEffect(() => {
    if (!iframeRef.current) return

    const currentTappInstance = tappInstanceRef.current
    const currentCode = codeRef.current

    const bridge = createTappBridge()
    bridgeRef.current = bridge

    const permission = createPermissionController(currentTappInstance)
    permissionRef.current = permission

    bridge.initialize(iframeRef.current, currentTappInstance)

    // 注册所有处理器
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

    const sessionToken = bridge.getSessionToken()
    const html = generatePageHTML(currentTappInstance, currentCode, sessionToken, safeInsets)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    iframeRef.current.src = url

    return () => {
      setIsReady(false)
      URL.revokeObjectURL(url)
      bridge.destroy()
      onDestroy?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tappInstance.id, codeFingerprint, handleReady, safeInsets])

  return (
    <div
      ref={containerRef}
      className={`tapp-page-sandbox ${className || ''}`}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        // 🔧 WebKit 专用：不使用 contain/isolation
        // 在文档流内的自然布局足够，这些属性反而会触发合成层问题
        ...style,
      }}
    >
      <iframe
        ref={iframeRef}
        className="tapp-page-iframe"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
        }}
        sandbox={IFRAME_SANDBOX_ATTRS}
        referrerPolicy="no-referrer"
        title={tappInstance.manifest.name}
      />
    </div>
  )
}

export default TappPageSandboxWebKit
