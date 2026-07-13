/**
 * 空状态组件 — 统一 ISLAND_GLASS 风格
 */

import type { EmptyStateProps } from '../types'
import React from 'react'

const ISLAND_GLASS =
  'rounded-2xl glass-surface glass-90 border border-gray-200/50 dark:border-neutral-700/50 shadow-lg shadow-black/10'

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  className = '',
}) => {
  return (
    <div className={`flex flex-col items-start py-8 ${className}`}>
      <div className={`${ISLAND_GLASS} flex items-center gap-3 px-5 py-3`}>
        {icon && (
          <div className="w-9 h-9 rounded-xl bg-gray-100/80 dark:bg-white/5 flex items-center justify-center text-gray-400 dark:text-gray-500 shrink-0">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">
            {title}
          </p>
          {description && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">
              {description}
            </p>
          )}
        </div>
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-3 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

EmptyState.displayName = 'EmptyState'
