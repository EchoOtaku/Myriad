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
      top: 30px; /* 避免被宿主页面顶部 fixed 调试面板遮住 */
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
    #__tapp_debug_center {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      pointer-events: none;
      background: rgba(255, 0, 255, 0.12);
      color: #fff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 18px;
      line-height: 1.3;
      text-shadow: 0 1px 2px rgba(0,0,0,0.6);
      padding: 16px;
    }
    #tapp-root { outline: 3px solid rgba(0, 255, 255, 0.6); outline-offset: -3px; }
    #tapp-content { padding: ${initialPadding}; box-sizing: border-box; }
  </style>
</head>
<body class="${isDark ? 'dark' : 'light'}">
  <div id="__tapp_debug_bar">IFRAME DEBUG: booting…</div>
  <div id="__tapp_debug_center">IFRAME DRAW CHECK…</div>
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

    // 🔧 WebKit 调试/心跳：确认 iframe JS 是否真的在运行（即使不绘制也应该能 postMessage）
    (function(){
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ __tapp_iframe_debug: true, kind: 'boot', tappId: '${tappInstance.id}', t: Date.now() }, '*');
          setInterval(function(){
            window.parent.postMessage({ __tapp_iframe_debug: true, kind: 'ping', tappId: '${tappInstance.id}', t: Date.now(), docW: document.documentElement.clientWidth, docH: document.documentElement.clientHeight }, '*');
          }, 700);
        }
      } catch (e) {
        // ignore
      }
    })();

    (function() {
      var bar = document.getElementById('__tapp_debug_bar');
      var center = document.getElementById('__tapp_debug_center');
      function updateBar(extra) {
        if (!bar && !center) return;
        var d = window._TAPP_DIMENSIONS || {};
        var txt = 'IFRAME DEBUG\n' +
          'doc=' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight +
          ' | dims=' + (d.width || 0) + 'x' + (d.height || 0) +
          ' | scale=' + (d.scale || 1) +
          ' | font=' + (d.fontScale || 1) +
          (extra ? (' | ' + extra) : '');
        if (bar) bar.textContent = txt.replace(/\n/g, ' | ');
        if (center) center.textContent = txt;
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
  safeInsets,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<TappBridge | null>(null)
  const permissionRef = useRef<TappPermissionController | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [iframeDebug, setIframeDebug] = useState<{ boot: boolean; lastPing?: number; lastDoc?: string; strategy: 'blob' | 'srcdoc' }>(() => ({ boot: false, strategy: 'blob' }))
  
  const { containerRef, dimensions } = useIframeResize<HTMLDivElement>()
  const { locale } = useI18n()
  const animationConfig = useAnimationLevel()
  
  const tappInstanceRef = useRef(tappInstance)
  const codeRef = useRef(code)
  const safeInsetsRef = useRef(safeInsets)
  const lastHtmlRef = useRef<string>('')
  const lastBlobUrlRef = useRef<string | null>(null)
  const paintKickDoneRef = useRef<boolean>(false)
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

  const kickWebKitPaint = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe || paintKickDoneRef.current) return
    paintKickDoneRef.current = true

    try {
      // 典型“踢合成层/重绘”手法：轻微切换 transform/opacity/display
      const prevTransform = iframe.style.transform
      const prevWebkitTransform = (iframe.style as any).webkitTransform as string | undefined

      iframe.style.willChange = 'transform, opacity'
      iframe.style.opacity = '0.999'
      ;(iframe.style as any).webkitTransform = 'translate3d(0,0,0)'
      iframe.style.transform = 'translate3d(0,0,0)'

      requestAnimationFrame(() => {
        iframe.style.opacity = '1'
        ;(iframe.style as any).webkitTransform = prevWebkitTransform || 'translate3d(0,0,0)'
        iframe.style.transform = prevTransform || 'translate3d(0,0,0)'
      })
    } catch {
      // ignore
    }
  }, [])

  // 🔧 接收 iframe 的 boot/ping（用于判断：JS 是否活着 vs 彻底没跑）
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const data = e.data as any
      if (!data || data.__tapp_iframe_debug !== true) return
      if (data.tappId && data.tappId !== tappInstanceRef.current.id) return

      if (data.kind === 'boot') {
        setIframeDebug((prev) => ({ ...prev, boot: true }))
        kickWebKitPaint()
        return
      }
      if (data.kind === 'ping') {
        setIframeDebug((prev) => ({
          ...prev,
          boot: true,
          lastPing: typeof data.t === 'number' ? data.t : Date.now(),
          lastDoc: (typeof data.docW === 'number' && typeof data.docH === 'number') ? `${data.docW}x${data.docH}` : prev.lastDoc,
        }))
        kickWebKitPaint()
      }
    }

    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [kickWebKitPaint])

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
    lastHtmlRef.current = html
    
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    console.log('[TappPageSandboxWebKit] Blob URL:', url)
    lastBlobUrlRef.current = url

    // 默认先用 blob；如果 WebKit 不跑/不绘制，后面自动切换 srcdoc
    setIframeDebug((prev) => ({ ...prev, boot: false, lastPing: undefined, lastDoc: undefined, strategy: 'blob' }))
    paintKickDoneRef.current = false

    // 先清空 srcdoc，避免策略切换残留
    iframeRef.current.removeAttribute('srcdoc')
    iframeRef.current.src = url
    console.log('[TappPageSandboxWebKit] Set iframe src')

    // 🔧 兜底：若一定时间内收不到 boot/ping，则切换到 srcdoc 再试一次
    const fallbackId = window.setTimeout(() => {
      setIframeDebug((prev) => {
        if (prev.boot) return prev
        const iframe = iframeRef.current
        if (!iframe) return prev

        console.warn('[TappPageSandboxWebKit] No iframe boot detected; switching to srcdoc fallback')
        try {
          iframe.removeAttribute('src')
          iframe.srcdoc = lastHtmlRef.current
          paintKickDoneRef.current = false
        } catch (e) {
          console.error('[TappPageSandboxWebKit] Failed to apply srcdoc fallback:', e)
        }

        return { ...prev, strategy: 'srcdoc' }
      })
    }, 1600)

    return () => {
      console.log('[TappPageSandboxWebKit] Cleanup')
      setIsReady(false)
      window.clearTimeout(fallbackId)
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
      className={`tapp-page-sandbox relative w-full h-full overflow-visible box-border border-[3px] border-lime-400 ${className || ''}`}
    >
      {/* 🔧 调试：sandbox 容器内的可见标记 */}
      <div className="absolute top-5 left-0 right-0 text-center p-1 bg-blue-600 text-white text-[11px] z-[9998] pointer-events-none">
        TappPageSandboxWebKit | dims: {dimensions.width}x{dimensions.height} | ready: {String(isReady)} | iframeBoot: {String(iframeDebug.boot)} | strategy: {iframeDebug.strategy}{iframeDebug.lastDoc ? ` | doc: ${iframeDebug.lastDoc}` : ''}
      </div>

      {/* 内层裁剪器：把 overflow:hidden 放到更“远离根容器”的层，降低 WebKit 合成概率问题 */}
      <div className="absolute inset-0 overflow-hidden bg-[#2a2a4a] z-0">
        <iframe
          ref={iframeRef}
          className={
            'tapp-page-iframe block w-full h-full border-2 border-dashed border-orange-400 bg-[#2a2a4a] ' +
            '[transform:translate3d(0,0,0)] [-webkit-transform:translate3d(0,0,0)] ' +
            '[backface-visibility:hidden] [-webkit-backface-visibility:hidden] ' +
            '[will-change:transform,opacity]'
          }
          sandbox="allow-scripts allow-pointer-lock"
          referrerPolicy="no-referrer"
          title={tappInstance.manifest.name}
          onLoad={() => console.log('[TappPageSandboxWebKit] iframe onLoad fired')}
          onError={(e) => console.error('[TappPageSandboxWebKit] iframe onError:', e)}
        />
      </div>
      {/* 🔧 调试：iframe 后的标记 */}
      <div className="absolute bottom-10 left-0 right-0 text-center p-1 bg-purple-700 text-white text-[11px] z-[9997] pointer-events-none">
        iframe should be above this (orange dashed border)
      </div>
    </div>
  )
}

export default TappPageSandboxWebKit
