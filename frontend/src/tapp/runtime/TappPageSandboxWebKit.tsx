/**
 * 🎯 WebKit 专用 Tapp Page 沙箱组件
 * 
 * 极简设计：
 * - 无额外判断
 * - 全屏渲染
 * - 最简化 CSS
 * - 单一渲染路径
 */

import React, { useEffect, useRef, useCallback, useMemo } from 'react'
import type { TappInstance } from '../types'
import type { TappCodeStructure } from '../examples/tapps/types'
import { getCodeForMode } from '../examples/tapps/types'
import { TappBridge, createTappBridge } from './TappBridge'
import { TappPermissionController, createPermissionController } from './TappPermission'
import { sendResizeMessage } from '../utils/iframeResize'
import { useI18n } from '../../contexts/I18nContext'
import { subscribeToTheme, getIsDarkMode } from '../../utils/themeSubscriber'
import { subscribeToPrimaryColor } from '../../utils/colorSubscriber'
import { useAnimationLevel } from '../../hooks/useAnimationLevel'

import {
  generateCSP,
  generateNonce,
  generateSecurityWrapper,
  generateFullSDK,
  generateThemeCSS,
  PAGE_STATIC_CSS,
  IFRAME_SANDBOX_ATTRS,
  type SafeInsets,
  type AnimationConfigRef,
} from './sandbox'

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
  tappInstance: TappInstance
  code: TappCodeStructure
  safeInsets?: SafeInsets
}

/**
 * 生成 Page 沙箱 HTML
 */
function generatePageHTML(
  tappInstance: TappInstance,
  code: TappCodeStructure,
  sessionToken: string
): string {
  const { manifest } = tappInstance
  const isDark = getIsDarkMode()
  const primaryColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-primary').trim() || '#94a3b8'

  const nonce = generateNonce()
  const csp = generateCSP(nonce)
  const securityWrapper = generateSecurityWrapper(sessionToken)
  const sdk = generateFullSDK(tappInstance, sessionToken)
  const themeCSS = generateThemeCSS(isDark, primaryColor)
  
  const jsCode = getCodeForMode(code, 'page') || ''
  const hasPageHtml = !!code.pageHtml
  
  const cssCode = `
    ${PAGE_STATIC_CSS}
    ${themeCSS}
    ${code.pageCSS || ''}
    ${code.styles || ''}
  `.trim()

  const renderScript = `
    window.addEventListener('DOMContentLoaded', function() {
      if (typeof Tapp !== 'undefined' && Tapp.pages && Tapp.pages['${manifest.id}']) {
        var pageDef = Tapp.pages['${manifest.id}'];
        if (!${hasPageHtml} && typeof pageDef.render === 'function') {
          var container = document.getElementById('tapp-content');
          container.innerHTML = '';
          pageDef.render(container, {});
        }
      }
      Tapp.ready();
    });
  `

  return `<!DOCTYPE html>
<html lang="zh-CN" class="${isDark ? 'dark' : ''}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>${manifest.name}</title>
  <style nonce="${nonce}">${cssCode}</style>
</head>
<body>
  <div id="tapp-content">${code.pageHtml || ''}</div>
  <script nonce="${nonce}">${securityWrapper}</script>
  <script nonce="${nonce}">${sdk}</script>
  <script nonce="${nonce}">${jsCode}</script>
  <script nonce="${nonce}">${renderScript}</script>
</body>
</html>`
}

/**
 * WebKit 专用沙箱组件
 */
export const TappPageSandboxWebKit: React.FC<TappPageSandboxWebKitProps> = ({
  tappInstance,
  code,
  safeInsets,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const bridgeRef = useRef<TappBridge | null>(null)
  const permissionRef = useRef<TappPermissionController | null>(null)
  
  const { locale } = useI18n()
  const animationConfig = useAnimationLevel()
  
  const localeRef = useRef(locale)
  const animationConfigRef = useRef<AnimationConfigRef>(animationConfig)
  
  useEffect(() => { localeRef.current = locale }, [locale])
  useEffect(() => { animationConfigRef.current = animationConfig }, [animationConfig])

  const codeFingerprint = useMemo(() => {
    const ph = code.pageHtml || ''
    const st = code.styles || ''
    const js = getCodeForMode(code, 'page') || ''
    return `${ph.length}:${st.length}:${js.length}`
  }, [code])

  // 尺寸更新
  useEffect(() => {
    const container = containerRef.current
    const iframe = iframeRef.current
    if (!container || !iframe) return
    
    const updateSize = () => {
      const dims = {
        width: container.clientWidth,
        height: container.clientHeight,
        scale: 1,
        fontScale: 1,
        isCompact: false,
        isMini: false,
        safeInsetTop: safeInsets?.top ?? 0,
        safeInsetRight: safeInsets?.right ?? 0,
        safeInsetBottom: safeInsets?.bottom ?? 0,
        safeInsetLeft: safeInsets?.left ?? 0,
      }
      sendResizeMessage(iframe, dims)
    }
    
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [safeInsets])

  // 主题变化
  useEffect(() => {
    return subscribeToTheme((isDark) => {
      bridgeRef.current?.emit('theme:change', isDark ? 'dark' : 'light')
    })
  }, [])

  // 主色调变化
  useEffect(() => {
    return subscribeToPrimaryColor((color) => {
      if (color) bridgeRef.current?.emit('primaryColor:change', color)
    })
  }, [])

  // 初始化
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const bridge = createTappBridge()
    bridgeRef.current = bridge

    const permission = createPermissionController(tappInstance)
    permissionRef.current = permission

    bridge.initialize(iframe, tappInstance)

    const handleReady = useCallback(() => {}, [])
    
    registerLifecycleHandlers(bridge, tappInstance, handleReady)
    registerUIHandlers(bridge, () => localeRef.current)
    registerStorageHandlers(bridge, tappInstance.id)
    registerUserHandlers(bridge, tappInstance)
    registerWidgetHandlers(bridge, tappInstance)
    registerPlatformHandlers(bridge, tappInstance)
    registerAIHandlers(bridge, permission, tappInstance)
    registerReportHandlers(bridge, tappInstance)
    registerMediaHandlers(bridge, tappInstance)
    registerBackgroundHandlers(bridge, tappInstance)
    registerAnimationHandlers(bridge, animationConfigRef)
    registerDynamicContentHandlers(bridge, tappInstance)
    registerAdvancedHandlers(bridge, tappInstance)
    registerContextHandlers(bridge, tappInstance)

    const sessionToken = bridge.getSessionToken()
    const html = generatePageHTML(tappInstance, code, sessionToken)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    iframe.src = url

    return () => {
      URL.revokeObjectURL(url)
      bridge.destroy()
    }
  }, [tappInstance.id, codeFingerprint])

  return (
    <div ref={containerRef} className="absolute inset-0">
      <iframe
        ref={iframeRef}
        className="absolute inset-0 w-full h-full border-none"
        sandbox={IFRAME_SANDBOX_ATTRS}
        referrerPolicy="no-referrer"
        title={tappInstance.manifest.name}
        allowFullScreen
      />
    </div>
  )
}

export default TappPageSandboxWebKit
