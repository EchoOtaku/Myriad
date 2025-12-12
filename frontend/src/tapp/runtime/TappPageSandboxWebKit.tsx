/**
 * Tapp Page 沙箱组件 - WebKit 专用版本
 * 
 * 🎯 设计原则：
 * - 使用最简化的 CSS，避免任何可能影响 iframe 渲染的属性
 * - 无 overflow:hidden, isolation, contain, transform 等
 * - 功能与标准版本完全一致
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
  // IFRAME_SANDBOX_ATTRS 不再使用，WebKit 版本使用更宽松的设置
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
  /** 自定义样式 */
  style?: React.CSSProperties
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

  const nonce = generateNonce()
  const csp = generateCSP(nonce)
  const securityWrapper = generateSecurityWrapper(sessionToken)
  const sdkCode = generateFullSDK(tappInstance, sessionToken)
  const themeCSS = generateThemeCSS(isDark, primaryColor)
  
  const customCSS = code.styles || ''
  const hasHtmlTemplate = !!code.pageHtml
  const pageHtmlContent = code.pageHtml || ''
  
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
    /* 🔧 WebKit 调试：确保能一眼看出 iframe 是否在绘制 */
    html, body { background: #10203a !important; }
    #__tapp_debug_bar {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 2147483647;
      background: rgba(255, 0, 255, 0.85);
      color: #000;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      padding: 6px 8px;
      pointer-events: none;
    }
    #tapp-root { outline: 3px solid rgba(0, 255, 255, 0.6); outline-offset: -3px; }
    #tapp-content { padding: ${initialPadding}; box-sizing: border-box; }
  </style>
</head>
<body class="${isDark ? 'dark' : 'light'}">
  <div id="__tapp_debug_bar">IFRAME DEBUG: booting…</div>
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

    (function() {
      var bar = document.getElementById('__tapp_debug_bar');
      function updateBar(extra) {
        if (!bar) return;
        var d = window._TAPP_DIMENSIONS || {};
        bar.textContent = 'IFRAME DEBUG | ' +
          'doc=' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight +
          ' | dims=' + (d.width || 0) + 'x' + (d.height || 0) +
          ' | scale=' + (d.scale || 1) +
          ' | font=' + (d.fontScale || 1) +
          (extra ? (' | ' + extra) : '');
      }
      updateBar('init');
      setInterval(function(){ updateBar(); }, 500);
    })();

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
      }
    });
  </script>
  
  <script nonce="${nonce}">${securityWrapper}</script>
  <script nonce="${nonce}">${sdkCode}</script>
  ${pageCode ? `<script nonce="${nonce}">${pageCode}</script>` : ''}
  
  ${needsJsRender ? `
  <script nonce="${nonce}">
    (function() {
      setTimeout(function() {
        if (typeof Tapp !== 'undefined' && Tapp.pages && typeof Tapp.pages['${tappInstance.id}'] === 'object') {
          var pageDef = Tapp.pages['${tappInstance.id}'];
          if (typeof pageDef.render === 'function') {
            try {
              var container = document.getElementById('tapp-content');
              container.innerHTML = '';
              pageDef.render(container, {});
            } catch(e) { console.error('[Tapp] Page render error:', e); }
          }
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

  // 初始化 iframe
  useEffect(() => {
    console.log('[TappPageSandboxWebKit] Init effect triggered')
    console.log('[TappPageSandboxWebKit] iframeRef.current:', iframeRef.current)
    
    if (!iframeRef.current) {
      console.error('[TappPageSandboxWebKit] iframeRef is null!')
      return
    }
    
    const currentTappInstance = tappInstanceRef.current
    const currentCode = codeRef.current
    
    console.log('[TappPageSandboxWebKit] Loading tapp:', currentTappInstance.id)

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
    
    // 生成 HTML 并加载到 iframe
    // 🎯 WebKit: 使用 blob URL（旧版本就是这样工作的）
    const html = generatePageHTML(currentTappInstance, currentCode, sessionToken, safeInsetsRef.current)
    console.log('[TappPageSandboxWebKit] Generated HTML length:', html.length)
    
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    console.log('[TappPageSandboxWebKit] Blob URL:', url)
    
    iframeRef.current.src = url
    console.log('[TappPageSandboxWebKit] Set iframe src')

    return () => {
      console.log('[TappPageSandboxWebKit] Cleanup')
      setIsReady(false)
      URL.revokeObjectURL(url)
      bridge.destroy()
      bridgeRef.current = null
      permissionRef.current = null
      onDestroy?.()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tappInstance.id, codeFingerprint, handleReady])

  // 🎯 WebKit 专用渲染：尽可能接近旧版本（ae9d05a）的实现
  // 旧版本在普通模式下是可以工作的！
  // 添加调试日志
  useEffect(() => {
    console.log('[TappPageSandboxWebKit] Mounted, containerRef:', containerRef.current)
    console.log('[TappPageSandboxWebKit] iframeRef:', iframeRef.current)
  }, [])
  
  useEffect(() => {
    console.log('[TappPageSandboxWebKit] isReady:', isReady)
  }, [isReady])

  return (
    <div 
      ref={containerRef} 
      className={`tapp-page-sandbox ${className || ''}`}
      style={{
        // 🎯 保持与旧版一致的基线尺寸，避免父级没给出明确尺寸时变成 0
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        // 🔧 调试：添加边框确认容器边界
        border: '3px solid lime',
        boxSizing: 'border-box',
        ...style,
      }}
    >
      {/* 🔧 调试：sandbox 容器内的可见标记 */}
      <div style={{ position: 'absolute', top: 20, left: 0, right: 0, textAlign: 'center', padding: '4px', background: 'blue', color: 'white', fontSize: '11px', zIndex: 9998, pointerEvents: 'none' }}>
        TappPageSandboxWebKit | dimensions: {dimensions.width}x{dimensions.height} | ready: {String(isReady)}
      </div>
      <iframe
        ref={iframeRef}
        className="tapp-page-iframe"
        sandbox="allow-scripts allow-pointer-lock"
        referrerPolicy="no-referrer"
        title={tappInstance.manifest.name}
        onLoad={() => console.log('[TappPageSandboxWebKit] iframe onLoad fired')}
        onError={(e) => console.error('[TappPageSandboxWebKit] iframe onError:', e)}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          border: '2px dashed orange',
          display: 'block',
          background: '#2a2a4a',
        }}
      />
      {/* 🔧 调试：iframe 后的标记 */}
      <div style={{ position: 'absolute', bottom: 40, left: 0, right: 0, textAlign: 'center', padding: '4px', background: 'purple', color: 'white', fontSize: '11px', zIndex: 9997, pointerEvents: 'none' }}>
        iframe should be above this (orange dashed border)
      </div>
    </div>
  )
}

export default TappPageSandboxWebKit
