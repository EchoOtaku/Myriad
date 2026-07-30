/**
 * 设置标题旁标签提示
 * 标签 / chip 形态，可静态展示说明，也可点击跳转（如「前往高级配置」）
 * 可选 detail：hover ⓘ 显示详细说明 tooltip
 */

import type { ReactNode } from 'react'
import React, { useCallback } from 'react'
import { SettingTitleHelp } from './SettingTitleHelp'
import './SettingTitleTag.css'

export type SettingTitleTagVariant = 'default' | 'muted'

export interface SettingTitleTagProps {
  /** 标签文案 */
  children: ReactNode
  /** 左侧小图标 */
  icon?: ReactNode
  /** 有 onClick 时渲染为 button，可跳转 / 操作 */
  onClick?: () => void
  /** 原生 title（短提示）；详细说明请用 detail */
  title?: string
  /**
   * 详细说明：默认不展示，标签旁 ⓘ hover 显示 tooltip
   */
  detail?: ReactNode
  disabled?: boolean
  /** default = 品牌色强调；muted = 中性信息 */
  variant?: SettingTitleTagVariant
  className?: string
}

export const SettingTitleTag: React.FC<SettingTitleTagProps> = ({
  children,
  icon,
  onClick,
  title,
  detail,
  disabled = false,
  variant = 'default',
  className = '',
}) => {
  const classes = [
    'setting-title-tag',
    variant === 'muted' ? 'setting-title-tag--muted' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // 折叠组标题是 button，阻止冒泡以免触发展开/收起
      e.stopPropagation()
      e.preventDefault()
      if (!disabled) onClick?.()
    },
    [disabled, onClick],
  )

  const body = (
    <>
      {icon && (
        <span className="setting-title-tag-icon" aria-hidden>
          {icon}
        </span>
      )}
      <span className="setting-title-tag-label">{children}</span>
      {detail != null && detail !== '' && (
        <SettingTitleHelp>{detail}</SettingTitleHelp>
      )}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        title={title}
        disabled={disabled}
        onClick={handleClick}
      >
        {body}
      </button>
    )
  }

  return (
    <span className={classes} title={title}>
      {body}
    </span>
  )
}

SettingTitleTag.displayName = 'SettingTitleTag'
