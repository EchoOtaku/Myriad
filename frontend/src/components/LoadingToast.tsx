import { useEffect, useState } from 'react'
import { useI18n } from '../contexts/I18nContext'
import './LoadingToast.css'

interface LoadingToastProps {
  message?: string
  show: boolean
}

export default function LoadingToast({ message, show }: LoadingToastProps) {
  const { t } = useI18n()
  const displayMessage = message || t.common.loading
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (show) {
      setVisible(true)
    } else {
      const timer = setTimeout(setVisible, 300, false)
      return () => clearTimeout(timer)
    }
  }, [show])

  if (!visible) return null

  return (
    <div
      className={`pointer-events-auto transition-all duration-300 ${
        show
          ? 'opacity-100 translate-y-0 animate-fade-in'
          : 'opacity-0 translate-y-2'
      }`}
    >
      <div className="loading-toast-container glass rounded-xl px-4 py-3 shadow-lg border flex items-center gap-3 backdrop-blur-md">
        <svg
          className="loading-toast-spinner"
          width="18"
          height="18"
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <circle
            className="loading-toast-spinner-track"
            cx="10"
            cy="10"
            r="8"
            strokeWidth="2.5"
          />
          <path
            className="loading-toast-spinner-segment"
            d="M18 10a8 8 0 0 0-8-8"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>

        {/* 加载文字 */}
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {displayMessage}
        </span>
      </div>
    </div>
  )
}
