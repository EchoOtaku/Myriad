/**
 * Tapp 运行页面 - WebKit 专用版本
 * 
 * 🎯 设计原则：
 * - 只有全屏模式，没有普通模式和切换
 * - 完全无动画，使用纯静态元素
 * - iframe 使用最佳 WebKit 兼容性做法
 * - 功能与标准版本完全一致
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { TappToast, type ToastType } from '../../components/Toast'
import { 
  FaArrowLeft, 
  FaCog, 
  FaPause, 
  FaExclamationTriangle,
  FaSpinner,
  FaRedo,
} from '@lib/icons'
import { getTappRuntime } from '../runtime'
import { getTappIconStyle } from '../utils/tappColors'
import { TappPageSandboxWebKit } from '../runtime/TappPageSandboxWebKit'
import { loadPageResources } from '../runtime/sandbox/resourceLoader'
import { TappIcon } from '../components/TappIcon'
import type { TappNotificationOptions } from '../runtime/sandbox/types'
import type { TappInstance } from '../types'
import type { TappCodeStructure } from '../examples/tapps/types'
import { useI18n } from '../../contexts/I18nContext'

interface TappRunPageWebKitProps {
  tappId: string
}

/**
 * WebKit 专用 Tapp 运行页面
 * 只有全屏模式，无动画
 */
export const TappRunPageWebKit = ({ tappId }: TappRunPageWebKitProps) => {
  const navigate = useNavigate()
  const { t } = useI18n()
  
  const [tapp, setTapp] = useState<TappInstance | null>(null)
  const [code, setCode] = useState<TappCodeStructure | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)
  const [notification, setNotification] = useState<{ 
    title?: string
    message: string
    type: ToastType
    tappName?: string
    tappIcon?: string
    tappIconSvg?: string 
  } | null>(null)
  
  const runtime = getTappRuntime()

  // 处理 Tapp 通知
  const handleNotification = useCallback((options: TappNotificationOptions) => {
    const toastType: ToastType = options.type || 'info'
    setNotification({
      title: options.title,
      message: options.message,
      type: toastType,
      tappName: tapp?.manifest.name,
      tappIcon: tapp?.manifest.icon,
      tappIconSvg: tapp?.manifest.iconSvg,
    })
  }, [tapp])

  // 加载 Tapp
  useEffect(() => {
    const loadTapp = async () => {
      try {
        await runtime.waitForSync()
        
        const instance = runtime.getTapp(tappId)
        if (!instance) {
          setError(t.tapp.appNotExist)
          setLoading(false)
          return
        }

        const resources = await loadPageResources(instance)
        
        const tappCode: TappCodeStructure = {
          core: resources.core,
          page: resources.page,
          pageHtml: resources.html,
          styles: resources.styles,
          pageCSS: resources.css,
        }

        if (!runtime.isRunning(tappId)) {
          await runtime.startTapp(tappId)
        }

        setTapp(instance)
        setCode(tappCode)
        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : t.tapp.loadAppFailed)
        setLoading(false)
      }
    }

    loadTapp()
  }, [tappId, runtime, t.tapp.appNotExist, t.tapp.loadAppFailed])

  // 重试加载
  const handleRetry = useCallback(() => {
    setLoading(true)
    setError(null)
    setTapp(null)
    setCode(null)
  }, [])

  // 返回
  const goBack = useCallback(() => {
    navigate('/tapp')
  }, [navigate])

  // 停止应用
  const handleStop = useCallback(async () => {
    try {
      await runtime.stopTapp(tappId)
      goBack()
    } catch (err) {
      console.error('Failed to stop Tapp:', err)
    }
  }, [runtime, tappId, goBack])

  // 打开设置
  const openSettings = useCallback(() => {
    navigate(`/tapp/detail/${tappId}`)
  }, [navigate, tappId])

  // 🎯 全屏模式的 safeInsets
  const safeInsets = useMemo(() => {
    return { top: 72, right: 16, left: 16, bottom: 0 }
  }, [])

  // 状态判断
  const hasError = !!error
  const iconStyle = tapp ? getTappIconStyle(tapp.manifest) : null
  const canStartStop = tapp?.userRole === 'admin' || (tapp?.userRole === 'user' && tapp?.isTemporary === true)

  // 处理沙箱就绪
  const handleReady = useCallback(() => {
    setIsReady(true)
  }, [])

  // 🔧 调试信息
  console.log('[TappRunPageWebKit] Render - loading:', loading, 'hasError:', hasError, 'tapp:', !!tapp, 'code:', !!code, 'isReady:', isReady)

  return (
    // 🎯 WebKit 专用：模仿旧版本 (ae9d05a) 非全屏模式的 flex 布局结构
    // 旧版本非全屏模式是可用的！
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#1a1a2e' }}>
      {/* 🔧 全局调试条 */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '8px', background: 'rgba(0,0,0,0.8)', color: '#0f0', fontSize: '10px', zIndex: 99999, fontFamily: 'monospace' }}>
        WebKit Mode | loading: {String(loading)} | error: {String(hasError)} | tapp: {String(!!tapp)} | code: {String(!!code)} | ready: {String(isReady)}
      </div>
      {/* 🎯 加载/错误状态 - 全屏显示 */}
      {(loading || hasError) && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-100 dark:bg-neutral-900">
          {loading ? (
            <div className="text-center">
              <FaSpinner className="w-10 h-10 mx-auto text-gray-400 animate-spin mb-4" />
              <p className="text-gray-500 dark:text-gray-400">{t.tapp.loadingApp}</p>
            </div>
          ) : (
            <div className="text-center max-w-sm mx-4">
              <FaExclamationTriangle className="w-12 h-12 mx-auto text-red-500 mb-4" />
              <h3 className="text-gray-800 dark:text-gray-100 font-medium text-lg mb-2">
                {t.tapp.cannotLoadApp}
              </h3>
              <p className="text-gray-500 dark:text-gray-400 mb-6">
                {error || t.tapp.appNotExist}
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={goBack}
                  className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                >
                  <FaArrowLeft className="w-4 h-4 inline mr-2" />
                  {t.tapp.back}
                </button>
                <button
                  onClick={handleRetry}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
                >
                  <FaRedo className="w-4 h-4" />
                  {t.tapp.retry || '重试'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 🎯 工具栏 - 左上角悬浮 */}
      {isReady && tapp && !loading && !hasError && (
        <div className="absolute top-4 left-4 z-[60]">
          <div className="glass rounded-xl px-3 py-2 flex items-center gap-2 shadow-lg">
            {/* 返回按钮 */}
            <button
              onClick={goBack}
              className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
              title={t.tapp.back}
              aria-label={t.tapp.backToAppList}
            >
              <FaArrowLeft className="w-3.5 h-3.5" />
            </button>
            
            {/* 分隔线 */}
            <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
            
            {/* 应用图标和名称 */}
            <div className="flex items-center gap-2">
              {iconStyle && (
                <div 
                  className={`w-6 h-6 rounded-lg ${iconStyle.className} flex items-center justify-center text-white text-xs font-bold`}
                  style={iconStyle.style}
                >
                  <TappIcon
                    icon={tapp.manifest.icon}
                    iconSvg={tapp.manifest.iconSvg}
                    name={tapp.manifest.name}
                    sizeClass="w-3.5 h-3.5"
                    textSizeClass="text-xs"
                  />
                </div>
              )}
              <span className="text-xs text-gray-600 dark:text-gray-300 font-medium hidden sm:inline">
                {tapp.manifest.name}
              </span>
            </div>
            
            {/* 分隔线 */}
            <div className="w-px h-5 bg-gray-200 dark:bg-gray-700" />
            
            {/* 操作按钮 */}
            <div className="flex items-center gap-1">
              {canStartStop && (
                <button
                  onClick={handleStop}
                  className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                  title={t.tapp.stopApp}
                >
                  <FaPause className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={openSettings}
                className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                title={t.tapp.settings}
              >
                <FaCog className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 🎯 沙箱容器 - 使用 flex-1 布局（模仿旧版本 ae9d05a 非全屏模式，该模式在 WebKit 上可用！）*/}
      {tapp && code && !loading && !hasError && (
        <div 
          className="flex-1 min-h-0 relative overflow-hidden"
          style={{
            // 🎯 关键样式 - 旧版本非全屏模式的容器样式
            background: '#0f0f1a',
            contain: 'strict',
            isolation: 'isolate',
            willChange: 'contents',
          }}
        >
          {/* 🔧 调试：显示容器是否正确渲染 */}
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: '4px', background: 'red', color: 'white', fontSize: '12px', zIndex: 9999 }}>
            DEBUG: Container rendered
          </div>
          <TappPageSandboxWebKit
            tappInstance={tapp}
            code={code}
            onReady={handleReady}
            onError={(err: Error) => console.error('[TappRunPageWebKit] Error:', err)}
            onNotification={handleNotification}
            className="absolute inset-0"
            safeInsets={safeInsets}
          />
        </div>
      )}

      {/* Tapp 通知 Toast */}
      {notification && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100]">
          <TappToast
            title={notification.title}
            message={notification.message}
            type={notification.type}
            tappName={notification.tappName}
            tappIcon={notification.tappIcon}
            tappIconSvg={notification.tappIconSvg}
            onClose={() => setNotification(null)}
          />
        </div>
      )}
    </div>
  )
}

export default TappRunPageWebKit
