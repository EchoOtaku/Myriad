import type { BaseSettingItemConfig } from '../types'
import type { ReactNode } from 'react'
import React from 'react'
import { useSettingsHelp } from '../SettingsHelpContext'
import { SettingTitleGuideEntry } from '../SettingTitleGuideEntry'
import { SettingTitleHelp } from '../SettingTitleHelp'
import './SettingItem.css'

export interface SettingItemWrapperProps extends Partial<BaseSettingItemConfig> {
  children: React.ReactNode
  className?: string
  id?: string
  contentRight?: boolean
  /** 覆盖 BaseSettingItemConfig.detail */
  detail?: ReactNode
  /** 覆盖 BaseSettingItemConfig.guide */
  guide?: ReactNode
}

export const SettingItemWrapper: React.FC<SettingItemWrapperProps> = ({
  label,
  detail,
  guide,
  description,
  hint,
  error,
  required,
  layout = 'vertical',
  size = 'md',
  className = '',
  id,
  children,
  contentRight = false,
  disabled = false,
}) => {
  const expandHelp = Boolean(useSettingsHelp()?.showDetails)
  const detailText = detail != null && detail !== '' ? detail : null
  const guideBody = guide ?? detailText ?? description
  const expandedExtra =
    expandHelp && detailText ? (
      <span className="setting-description setting-description--detail">
        {detailText}
      </span>
    ) : null

  const labelText = label && (
    <span className="setting-label-text">
      {label}
      {required && <span className="required">*</span>}
      {detailText && !expandHelp && (
        <SettingTitleHelp ariaLabel={`${label} 详细说明`}>
          {detailText}
        </SettingTitleHelp>
      )}
      <SettingTitleGuideEntry title={label} guide={guideBody} />
    </span>
  )

  const labelContent = label && (
    <div className="setting-label">
      {labelText}
      {description && (
        <span className="setting-description">{description}</span>
      )}
      {expandedExtra}
    </div>
  )

  if (layout === 'horizontal') {
    return (
      <div
        className={`setting-item setting-${layout} setting-${size} ${className} ${disabled ? 'disabled' : ''}`}
      >
        <div className="setting-item-content">
          {contentRight ? (
            <>
              {labelContent}
              <div className="setting-control">{children}</div>
            </>
          ) : (
            <>
              {labelContent}
              <div className="setting-control">{children}</div>
            </>
          )}
        </div>
        {hint && <p className="setting-hint">{hint}</p>}
        {error && <p className="setting-error">{error}</p>}
      </div>
    )
  }

  return (
    <div
      className={`setting-item setting-${layout} setting-${size} ${className} ${disabled ? 'disabled' : ''}`}
    >
      {label && (
        <label htmlFor={id} className="setting-label">
          {labelText}
          {description && (
            <span className="setting-description">{description}</span>
          )}
          {expandedExtra}
        </label>
      )}

      <div className="setting-control">{children}</div>

      {hint && <p className="setting-hint">{hint}</p>}
      {error && <p className="setting-error">{error}</p>}
    </div>
  )
}
