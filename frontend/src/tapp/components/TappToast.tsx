/**
 * Tapp 专用 Toast 组件
 * 用于 TappRunPage 等页面显示 Tapp 发出的通知
 *
 * 归属 tapp 特性目录：依赖方向为 feature → core（复用 Toast 的类型配置与资源图标），
 * 避免让核心 Toast 原语反向耦合到 tapp。
 */

import type { ToastType } from '../../components/Toast'
import { useCallback, useEffect, useState } from 'react'
import { renderToastAssetIcon, TYPE_CONFIG } from '../../components/Toast'
import { TappIcon } from './TappIcon'
import '../../components/Toast.css'

export interface TappToastProps {
  /** 通知标题 */
  title?: string
  /** 通知消息 */
  message: string
  /** 通知类型 */
  type?: ToastType
  /** 关闭回调 */
  onClose?: () => void
  /** 显示时长 */
  duration?: number
  /** Tapp 名称（用于显示来源） */
  tappName?: string
  /** Tapp 图标（emoji 或 URL） */
  tappIcon?: string
  /** Tapp 图标（SVG 代码） */
  tappIconSvg?: string
}

/**
 * Tapp 通知 Toast
 * 增强版 Toast，显示 Tapp 来源信息
 */
export function TappToast({
  title,
  message,
  type = 'info',
  onClose,
  duration = 3000,
  tappName,
  tappIcon,
  tappIconSvg,
}: TappToastProps) {
  const [isHiding, setIsHiding] = useState(false)
  const [isPaused, setIsPaused] = useState(false)

  const config = TYPE_CONFIG[type]

  const handleClose = useCallback(() => {
    setIsHiding(true)
    setTimeout(() => {
      onClose?.()
    }, 300)
  }, [onClose])

  useEffect(() => {
    if (duration <= 0 || isPaused) return

    const timer = setTimeout(() => {
      handleClose()
    }, duration)

    return () => clearTimeout(timer)
  }, [duration, isPaused, handleClose])

  return (
    <div
      className={`toast-container toast-tapp ${isHiding ? 'toast-hiding' : ''}`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className={`toast-message toast-message-tapp ${config.colorClass}`}>
        {/* Tapp 来源标识 */}
        {(tappName || tappIcon || tappIconSvg) && (
          <div className="toast-tapp-source">
            {(tappIcon || tappIconSvg) && (
              <span className="toast-tapp-icon">
                <TappIcon
                  icon={tappIcon}
                  iconSvg={tappIconSvg}
                  name={tappName || 'Tapp'}
                  sizeClass="w-4 h-4"
                  textSizeClass="text-xs"
                />
              </span>
            )}
            {tappName && <span className="toast-tapp-name">{tappName}</span>}
            <span className="toast-tapp-separator">·</span>
          </div>
        )}

        {/* 图标 */}
        <div className="toast-icon-wrapper">{renderToastAssetIcon(type)}</div>

        {/* 内容 */}
        <div className="toast-content">
          {title && <div className="toast-title">{title}</div>}
          <div className="toast-text">{message}</div>
        </div>

        {/* 关闭按钮 */}
        <button
          className="toast-close-btn"
          onClick={handleClose}
          aria-label="关闭通知"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
