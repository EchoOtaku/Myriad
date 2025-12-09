/**
 * Tapp 杩愯椤甸潰
 * 鍦ㄦ矙绠变腑杩愯 Tapp
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motionShim as motion } from '@lib/motionShim'
import AnimatedView from '../../components/AnimatedView'
import { useAnimationLevel } from '../../hooks/useAnimationLevel'
import { usePerformanceProfile } from '../../hooks/usePerformanceProfile'
import Toast, { TappToast, type ToastType } from '../../components/Toast'
import { 
  FaArrowLeft, 
  FaExpand, 
  FaCompress, 
  FaCog, 
  FaPause, 
  FaExclamationTriangle,
  FaSpinner,
} from '@lib/icons'
import { getTappRuntime } from '../runtime'
import { getTappIconStyle } from '../utils/tappColors'
import { TappPageSandbox } from '../runtime/TappPageSandbox'
import { loadPageResources, getResourceLoader } from '../runtime/sandbox/resourceLoader'
import type { TappNotificationOptions } from '../runtime/sandbox/types'
import type { TappInstance } from '../types'
import type { TappCodeStructure } from '../examples/tapps/types'
import { useI18n } from '../../contexts/I18nContext'

/** 妫€鏌ュ瓧绗︿覆鏄惁涓?URL锛堢敤浜庡尯鍒?emoji 鍜屽浘鐗?URL锛?*/
function isIconUrl(icon: string | undefined): boolean {
  if (!icon) return false
  return icon.startsWith('http://') || icon.startsWith('https://') || icon.startsWith('data:') || icon.startsWith('/')
}

interface TappRunPageProps {
  tappId: string
}

/**
 * Tapp 杩愯椤甸潰缁勪欢
 */
export const TappRunPage = ({ tappId }: TappRunPageProps) => {
  const navigate = useNavigate()
  const { t } = useI18n()
  
  // 🎬 动画和性能配置
  const animConfig = useAnimationLevel()
  const perf = usePerformanceProfile()
  
  const [tapp, setTapp] = useState<TappInstance | null>(null)
  const [code, setCode] = useState<TappCodeStructure | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [notification, setNotification] = useState<{ title?: string; message: string; type: ToastType; tappName?: string; tappIcon?: string } | null>(null)
  const runtime = getTappRuntime()

  // 处理 Tapp 通知
  const handleNotification = useCallback((options: TappNotificationOptions) => {
    // 直接使用 Tapp SDK 传来的类型
    const toastType: ToastType = options.type || 'info'
    
    setNotification({
      title: options.title,
      message: options.message,
      type: toastType,
      tappName: tapp?.manifest.name,
      tappIcon: tapp?.manifest.icon,
    })
  }, [tapp])

  // 鍔犺浇 Tapp
  useEffect(() => {
    const loadTapp = async () => {
      try {
        // 绛夊緟 runtime 鍚屾瀹屾垚
        await runtime.waitForSync()
        
        // 鑾峰彇 Tapp 瀹炰緥
        let instance = runtime.getTapp(tappId)
        if (!instance) {
          setError(t.tapp.appNotExist)
          setLoading(false)
          return
        }

        // 🎯 使用新的资源加载器获取 Page 专用资源
        const resources = await loadPageResources(instance)
        
        // 转换为 TappCodeStructure 格式以兼容 TappPageSandbox
        const tappCode: TappCodeStructure = {
          core: resources.core,
          page: resources.page,
          pageHtml: resources.html,
          styles: resources.styles,
          pageCSS: resources.css,
        }
        
        console.log('[TappRunPage] Resources loaded via ResourceLoader:', {
          tappId,
          hasHtml: !!resources.html,
          cssLength: resources.css.length,
        })

        // 如果未运行，启动它
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
  }, [tappId, runtime])

  // 杩斿洖
  const goBack = useCallback(() => {
    navigate('/tapp')
  }, [navigate])

  // 鍋滄搴旂敤
  const handleStop = useCallback(async () => {
    try {
      await runtime.stopTapp(tappId)
      goBack()
    } catch (err) {
      console.error('Failed to stop Tapp:', err)
    }
  }, [runtime, tappId, goBack])

  // 鍒囨崲鍏ㄥ睆
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev)
  }, [])

  // 鎵撳紑璁剧疆
  const openSettings = useCallback(() => {
    navigate(`/tapp/detail/${tappId}`)
  }, [navigate, tappId])

  // 鍔犺浇鐘舵€?
  if (loading) {
    return (
      <AnimatedView className="min-h-screen px-4 sm:px-6 pt-20 pb-24 md:pb-12">
        <div className="max-w-6xl mx-auto">
          <div className="glass rounded-xl p-8 md:p-12 text-center">
            <FaSpinner className="w-12 h-12 mx-auto text-indigo-500 animate-spin mb-4" />
            <h3 className="text-lg font-medium text-gray-800 dark:text-gray-100 mb-2">
              {t.tapp.loadingApp}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {t.tapp.pleaseWait}
            </p>
          </div>
        </div>
      </AnimatedView>
    )
  }

  // 閿欒鐘舵€?
  if (error || !tapp || !code) {
    return (
      <AnimatedView className="min-h-screen px-4 sm:px-6 pt-20 pb-24 md:pb-12">
        <div className="max-w-6xl mx-auto">
          <div className="glass rounded-xl p-8 md:p-12 text-center">
            <FaExclamationTriangle className="w-12 h-12 mx-auto text-red-500 mb-4" />
            <h3 className="text-lg font-medium text-gray-800 dark:text-gray-100 mb-2">
              {t.tapp.cannotLoadApp}
            </h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
              {error || t.tapp.appNotExist}
            </p>
            <button
              onClick={goBack}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors"
            >
              <FaArrowLeft className="w-4 h-4" />
              {t.tapp.backToAppList}
            </button>
          </div>
        </div>
      </AnimatedView>
    )
  }

  // 鍏ㄥ睆妯″紡
  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900">
        {/* 悬浮工具栏 - 左侧放置，避开右上角的信息控制岛 */}
        {(() => {
          // 权限检查
          const canStartStop = tapp.userRole === 'admin' || (tapp.userRole === 'user' && tapp.isTemporary === true)
          return (
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="absolute top-4 left-4 z-10 opacity-0 hover:opacity-100 transition-opacity"
            >
              <div className="glass rounded-xl px-3 py-2 flex items-center gap-3">
                <div className="flex items-center gap-2">
              <div 
                className={`w-7 h-7 rounded-lg ${getTappIconStyle(tapp.manifest).className} flex items-center justify-center text-white text-xs font-bold`}
                style={getTappIconStyle(tapp.manifest).style}
              >
                {tapp.manifest.icon ? (
                  isIconUrl(tapp.manifest.icon) ? (
                    <img src={tapp.manifest.icon} alt="" className="w-4 h-4 object-contain" />
                  ) : (
                    <span className="text-sm">{tapp.manifest.icon}</span>
                  )
                ) : (
                  tapp.manifest.name.charAt(0).toUpperCase()
                )}
              </div>
              <div className="hidden sm:block">
                <h1 className="font-semibold text-gray-800 dark:text-gray-100 text-xs leading-tight">
                  {tapp.manifest.name}
                </h1>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">
                  v{tapp.manifest.version}
                </p>
              </div>
            </div>
            <div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />
                <div className="flex items-center gap-1">
                  <button
                    onClick={toggleFullscreen}
                    className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                    title={t.tapp.exitFullscreen}
                  >
                    <FaCompress className="w-3.5 h-3.5" />
                  </button>
                  {canStartStop && (
                    <button
                      onClick={handleStop}
                      className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      title={t.tapp.stopApp}
                    >
                      <FaPause className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )
        })()}

        {/* 沙箱 - 全屏填充，背景不受安全间距限制 */}
        <TappPageSandbox
          tappInstance={tapp}
          code={code}
          onError={(err: Error) => console.error('[TappRunPage] Error:', err)}
          onNotification={handleNotification}
          className="absolute inset-0"
          safeInsets={{
            top: 72,
            right: 16,
            left: 16,
            bottom: 0,
          }}
        />
      </div>
    )
  }

  // 普通模式
  // 使用 h-screen 填满视口高度，flex 布局自动分配空间
  // F12 打开时的 ResizeObserver 已通过阈值过滤（iframeResize.ts）
  return (
    <AnimatedView className="h-screen flex flex-col overflow-hidden">
      {/* 固定高度的顶部间距 */}
      <div className="h-20 flex-shrink-0" />
      
      {/* 主内容区域 - flex 布局自动填充，使用 contain 隔离重排 */}
      <div 
        className="flex-1 min-h-0 px-4 sm:px-6 pb-4 md:pb-6 flex flex-col"
        style={{ contain: 'layout style' }}
      >
        <div className="max-w-6xl mx-auto w-full flex flex-col flex-1 min-h-0">
          {/* 澶撮儴鍗＄墖 - 固定高度，不参与 flex 收缩 */}
          <div className="mb-4 md:mb-6 flex-shrink-0">
            <div className="glass rounded-xl p-4 md:p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={goBack}
                    className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                    title={t.tapp.back}
                    aria-label={t.tapp.backToAppList}
                  >
                    <FaArrowLeft className="w-5 h-5" />
                  </button>
                  <div 
                    className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl ${getTappIconStyle(tapp.manifest).className} flex items-center justify-center text-white text-lg sm:text-xl font-bold shadow-md`}
                    style={getTappIconStyle(tapp.manifest).style}
                  >
                    {tapp.manifest.icon ? (
                      isIconUrl(tapp.manifest.icon) ? (
                        <img src={tapp.manifest.icon} alt="" className="w-6 h-6 sm:w-8 sm:h-8 object-contain" />
                      ) : (
                        <span className="text-xl sm:text-2xl">{tapp.manifest.icon}</span>
                      )
                    ) : (
                      tapp.manifest.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-gray-800 dark:text-gray-100">
                      {tapp.manifest.name}
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      v{tapp.manifest.version}
                    </p>
                  </div>
                </div>
                {(() => {
                  // 权限检查
                  const canStartStop = tapp.userRole === 'admin' || (tapp.userRole === 'user' && tapp.isTemporary === true)
                  const canConfigure = tapp.userRole === 'admin' || (tapp.userRole === 'user' && tapp.isTemporary === true)
                  return (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={toggleFullscreen}
                        className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                        title={t.tapp.fullscreen}
                      >
                        <FaExpand className="w-4 h-4" />
                      </button>
                      {canConfigure && (
                        <button
                          onClick={openSettings}
                          className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                          title={t.tapp.settings}
                        >
                          <FaCog className="w-4 h-4" />
                        </button>
                      )}
                      {canStartStop && (
                        <button
                          onClick={handleStop}
                          className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                          title={t.tapp.stopApp}
                        >
                          <FaPause className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          </div>

          {/* 沙箱容器 - flex-1 填充剩余空间，使用 contain: strict 完全隔离内部布局 */}
          <div
            className="rounded-xl overflow-hidden relative flex-1 min-h-0"
            style={{
              background: '#0f0f1a',
              // contain: strict 完全隔离：大小、布局、样式、绘制都不会影响外部
              contain: 'strict',
              // 创建独立的层叠上下文和合成层，减少重绘范围
              isolation: 'isolate',
              willChange: 'contents',
            }}
          >
            <TappPageSandbox
              tappInstance={tapp}
              code={code}
              onError={(err: Error) => console.error('[TappRunPage] Error:', err)}
              onNotification={handleNotification}
              className="absolute inset-0"
            />
          </div>

          {/* Tapp 通知 Toast */}
          {notification && (
            <TappToast
              title={notification.title}
              message={notification.message}
              type={notification.type}
              tappName={notification.tappName}
              tappIcon={notification.tappIcon}
              onClose={() => setNotification(null)}
            />
          )}
        </div>
      </div>
    </AnimatedView>
  )
}

export default TappRunPage


