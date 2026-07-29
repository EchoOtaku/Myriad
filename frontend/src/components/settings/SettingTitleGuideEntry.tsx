/**
 * 「显示说明」开启时，挂在选项/分组标题旁的指南入口（中性文字标签）。
 * 点击打开 SettingsGuideModal。
 */

import type { ReactNode } from 'react'
import React, { useCallback } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { useSettingsHelp } from './SettingsHelpContext'
import './SettingTitleGuideEntry.css'

export interface SettingTitleGuideEntryProps {
  /** 弹窗标题（通常为选项/分组名） */
  title: string
  /**
   * 弹窗正文。未提供时不渲染入口。
   */
  guide?: ReactNode
  className?: string
}

export const SettingTitleGuideEntry: React.FC<SettingTitleGuideEntryProps> = ({
  title,
  guide,
  className = '',
}) => {
  const { t } = useI18n()
  const help = useSettingsHelp()

  const handleOpen = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (guide == null || guide === false || guide === '') return
      help?.openGuide?.({ title, body: guide })
    },
    [guide, help, title],
  )

  if (!help?.showDetails) return null
  if (guide == null || guide === false || guide === '') return null
  if (typeof help.openGuide !== 'function') return null

  const label = t.config.optionGuide ?? '选项指南'
  const aria =
    t.config.openOptionGuide?.replace('{title}', title) ??
    `打开「${title}」选项指南`

  return (
    <span
      className={['setting-title-guide', className].filter(Boolean).join(' ')}
    >
      <button
        type="button"
        className="setting-title-guide-trigger"
        aria-label={aria}
        title={aria}
        onClick={handleOpen}
      >
        {label}
      </button>
    </span>
  )
}

SettingTitleGuideEntry.displayName = 'SettingTitleGuideEntry'

export default SettingTitleGuideEntry
