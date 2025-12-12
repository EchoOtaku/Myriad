/**
 * 🎯 WebKit 专用 Tapp 运行页面
 * 
 * 极简设计：
 * - 全屏模式，无切换
 * - 无动画
 * - 无额外判断
 * - 单一渲染路径
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FaArrowLeft, FaPause, FaCog, FaSpinner, FaExclamationTriangle } from '@lib/icons'
import { getTappRuntime } from '../runtime'
import { getTappIconStyle } from '../utils/tappColors'
import { loadPageResources } from '../runtime/sandbox/resourceLoader'
import { TappIcon } from '../components/TappIcon'
import type { TappInstance } from '../types'
import type { TappCodeStructure } from '../examples/tapps/types'
import { useI18n } from '../../contexts/I18nContext'
import { TappPageSandboxWebKit } from '../runtime/TappPageSandboxWebKit'

interface TappRunPageWebKitProps {
  tappId: string
}

/**
 * WebKit 专用 Tapp 运行页面
 */
export const TappRunPageWebKit = ({ tappId }: TappRunPageWebKitProps) => {
  const navigate = useNavigate()
  const { t } = useI18n()
  
  const [tapp, setTapp] = useState<TappInstance | null>(null)
  const [code, setCode] = useState<TappCodeStructure | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  const runtime = getTappRuntime()

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
  }, [tappId, runtime, t])

  const goBack = useCallback(() => navigate('/tapp'), [navigate])
  
  const handleStop = useCallback(async () => {
    if (!tapp) return
    await runtime.stopTapp(tapp.id)
    goBack()
  }, [tapp, runtime, goBack])

  const canStartStop = tapp?.userRole === 'admin' || (tapp?.userRole === 'user' && tapp?.isTemporary === true)
  const iconStyle = tapp ? getTappIconStyle(tapp.manifest) : null

  // 加载中
  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-100 dark:bg-neutral-900">
        <div className="text-center">
          <FaSpinner className="w-8 h-8 mx-auto text-gray-400 animate-spin mb-3" />
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t.tapp.loadingApp}</p>
        </div>
      </div>
    )
  }

  // 错误
  if (error || !tapp || !code) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-gray-100 dark:bg-neutral-900">
        <div className="text-center max-w-sm mx-4">
          <FaExclamationTriangle className="w-10 h-10 mx-auto text-red-500 mb-3" />
          <h3 className="text-gray-800 dark:text-gray-100 font-medium mb-2">
            {t.tapp.cannotLoadApp}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
            {error || t.tapp.appNotExist}
          </p>
          <button
            onClick={goBack}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg"
          >
            <FaArrowLeft className="w-3.5 h-3.5" />
            {t.tapp.back}
          </button>
        </div>
      </div>
    )
  }

  // 全屏渲染
  return (
    <div className="fixed inset-0">
      {/* 悬浮工具栏 */}
      <div className="absolute top-4 left-4 z-[60] opacity-0 hover:opacity-100 transition-opacity duration-300">
        <div className="glass rounded-xl px-3 py-2 flex items-center gap-3 shadow-lg">
          <div className="flex items-center gap-2">
            {iconStyle && (
              <div 
                className={`w-7 h-7 rounded-lg ${iconStyle.className} flex items-center justify-center text-white text-xs font-bold`}
                style={iconStyle.style}
              >
                <TappIcon
                  icon={tapp.manifest.icon}
                  iconSvg={tapp.manifest.iconSvg}
                  name={tapp.manifest.name}
                  sizeClass="w-4 h-4"
                  textSizeClass="text-sm"
                />
              </div>
            )}
            <div className="hidden sm:block">
              <h1 className="font-semibold text-gray-800 dark:text-gray-100 text-xs leading-tight">
                {tapp.manifest.name}
              </h1>
            </div>
          </div>
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700" />
          <div className="flex items-center gap-1">
            <button
              onClick={goBack}
              className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg"
              title={t.tapp.back}
            >
              <FaArrowLeft className="w-3.5 h-3.5" />
            </button>
            {canStartStop && (
              <button
                onClick={handleStop}
                className="p-1.5 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg"
                title={t.tapp.stopApp}
              >
                <FaPause className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => navigate(`/tapp/${tappId}/settings`)}
              className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-neutral-700 rounded-lg"
              title={t.tapp.settings}
            >
              <FaCog className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 沙箱全屏 */}
      <TappPageSandboxWebKit
        tappInstance={tapp}
        code={code}
        safeInsets={{ top: 0, right: 0, bottom: 0, left: 0 }}
      />
    </div>
  )
}

export default TappRunPageWebKit
