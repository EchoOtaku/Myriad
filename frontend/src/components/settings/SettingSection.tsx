/**
 * 设置区块组件
 * 带标题、图标；详细说明默认 ⓘ tooltip；
 * 右上角：页级特殊操作 + 重置本页 + 显示说明（同款 CheckboxCard）。
 * 「显示说明」开启时：选项标题旁可挂指南入口 → 弹窗详解。
 */

import type { ReactNode } from 'react'
import type { SettingSectionConfig } from './types'
import type { SettingsGuidePayload } from './SettingsHelpContext'

import React, { useCallback, useMemo, useState } from 'react'
import { SettingGroup } from './SettingGroup'
import { SettingTitleGuideEntry } from './SettingTitleGuideEntry'
import { SettingTitleHelp } from './SettingTitleHelp'
import { SettingsGuideModal } from './SettingsGuideModal'
import { SettingsHelpProvider } from './SettingsHelpContext'
import { SettingsHelpToggle } from './SettingsHelpToggle'
import { SettingsPageResetButton } from './SettingsPageResetButton'
import { useSettingsPageActions } from './SettingsPageActionsContext'
import './settings-motion.css'
import './SettingSection.css'

export interface SettingSectionProps extends SettingSectionConfig {
  /** 是否显示右上角「显示说明」开关，默认 true */
  helpToggle?: boolean
  /** 是否显示「重置本页」；默认跟随页面 actions context */
  showResetPage?: boolean
  /** 本页特殊右上角操作，渲染在重置 / 显示说明之前。 */
  headerActions?: ReactNode
  /**
   * 标题栏左侧前缀（如二级页返回），在区块图标之前。
   */
  headerLeading?: ReactNode
}

export const SettingSection: React.FC<SettingSectionProps> = ({
  sectionId,
  title,
  icon,
  titleExtra,
  detail,
  guide,
  detailTone = 'default',
  description,
  descriptionVisible = false,
  groups,
  children,
  className = '',
  animated = true,
  helpToggle = true,
  showResetPage,
  headerActions,
  headerLeading,
}) => {
  const pageActions = useSettingsPageActions()
  const [showDetails, setShowDetails] = useState(false)
  const [activeGuide, setActiveGuide] = useState<SettingsGuidePayload | null>(
    null,
  )

  const openGuide = useCallback((payload: SettingsGuidePayload) => {
    setActiveGuide(payload)
  }, [])

  const closeGuide = useCallback(() => {
    setActiveGuide(null)
  }, [])

  const helpCtx = useMemo(
    () => ({
      showDetails,
      setShowDetails,
      openGuide,
      closeGuide,
      activeGuide,
    }),
    [showDetails, openGuide, closeGuide, activeGuide],
  )

  const canReset =
    showResetPage !== false &&
    pageActions?.canResetCurrentPage !== false &&
    typeof pageActions?.resetCurrentPage === 'function'

  const hasPinnedActions = canReset || helpToggle
  const hasHeaderRight = Boolean(headerActions) || hasPinnedActions
  const showHeaderDivider = Boolean(headerActions) && hasPinnedActions

  const iconClassName = sectionId
    ? `section-icon icon-${sectionId}`
    : 'section-icon'

  const helpContent = detail ?? description
  const showHelp = helpContent != null && helpContent !== ''
  const showDescriptionLine =
    (descriptionVisible || showDetails) &&
    helpContent != null &&
    helpContent !== ''

  const renderIcon = () => {
    if (!icon) return null
    if (typeof icon === 'string') {
      return <span className={iconClassName}>{icon}</span>
    }
    return <span className={iconClassName}>{icon}</span>
  }

  /* 区块进入交给动效系统的 .sm-enter（与其它设置页动效同一套令牌） */
  const content = (
    <SettingsHelpProvider value={helpCtx}>
      <div
        className={`config-section setting-section${
          animated ? ' sm-enter' : ''
        } ${className}`.trim()}
      >
        <div className="section-header">
          <div className="section-header-left">
            {headerLeading != null && headerLeading !== false ? (
              <div className="section-header-leading">{headerLeading}</div>
            ) : null}
            {renderIcon()}
            <div className="section-header-text">
              <h2 className="section-title">
                {title}
                {showHelp && !showDetails && (
                  <SettingTitleHelp
                    ariaLabel={`${title} 详细说明`}
                    tone={detailTone}
                  >
                    {helpContent}
                  </SettingTitleHelp>
                )}
                <SettingTitleGuideEntry
                  title={typeof title === 'string' ? title : ''}
                  guide={guide ?? detail ?? description}
                />
                {titleExtra != null && titleExtra !== false && (
                  <span className="section-title-extra">{titleExtra}</span>
                )}
              </h2>
              {showDescriptionLine && (
                <div
                  className={`section-description${
                    detailTone === 'warning' ? ' is-warning' : ''
                  }`}
                >
                  {helpContent}
                </div>
              )}
            </div>
          </div>

          {hasHeaderRight && (
            <div className="section-header-right">
              {headerActions != null && headerActions !== false && (
                <div className="section-header-actions-extra">
                  {headerActions}
                </div>
              )}
              {showHeaderDivider && (
                <span
                  className="section-header-actions-divider"
                  aria-hidden
                />
              )}
              {hasPinnedActions && (
                <div className="section-header-actions-pinned">
                  {canReset && (
                    <SettingsPageResetButton
                      onReset={() => pageActions!.resetCurrentPage!()}
                    />
                  )}
                  {helpToggle && (
                    <SettingsHelpToggle
                      checked={showDetails}
                      onChange={setShowDetails}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="config-form">
          {groups?.map((group, index) => (
            <SettingGroup key={group.title || `group-${index}`} {...group} />
          ))}
          {children}
        </div>

        <SettingsGuideModal
          open={activeGuide != null}
          title={activeGuide?.title ?? ''}
          onClose={closeGuide}
        >
          {activeGuide?.body}
        </SettingsGuideModal>
      </div>
    </SettingsHelpProvider>
  )

  return content
}

SettingSection.displayName = 'SettingSection'
