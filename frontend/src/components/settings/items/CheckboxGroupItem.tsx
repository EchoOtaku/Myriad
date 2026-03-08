/**
 * 复选框组设置项组件
 * 将多个复选框选项组合为一组，共享标签和描述
 */

import React, { useCallback } from 'react'

import './SettingItem.css'

export interface CheckboxGroupOption {
  /** 唯一标识 */
  key: string
  /** 选项显示文本 */
  label: string
  /** 选项说明文本 */
  description?: string
  /** 选项图标 */
  icon?: React.ReactNode
  /** 当前是否选中 */
  value: boolean
}

export interface CheckboxGroupItemProps {
  /** 组标签 */
  label: string
  /** 描述说明 */
  description?: string
  /** 提示文本 */
  hint?: string
  /** 选项列表 */
  options: CheckboxGroupOption[]
  /** 值变化回调 */
  onChange: (key: string, value: boolean) => void
  /** 是否禁用 */
  disabled?: boolean
  /** 自定义 class */
  className?: string
}

export const CheckboxGroupItem = React.memo<CheckboxGroupItemProps>(({
  label,
  description,
  hint,
  options,
  onChange,
  disabled = false,
  className = '',
}) => {
  const handleToggle = useCallback((key: string, currentValue: boolean) => () => {
    if (!disabled) {
      onChange(key, !currentValue)
    }
  }, [onChange, disabled])

  return (
    <div className={`setting-item setting-vertical ${className} ${disabled ? 'disabled' : ''}`}>
      <div className="setting-label">
        <span className="setting-label-text">{label}</span>
        {description && <span className="setting-description">{description}</span>}
      </div>
      <div className="checkbox-group-options">
        {options.map(option => (
          <button
            key={option.key}
            type="button"
            className={`checkbox-group-card${option.value ? ' active' : ''}`}
            onClick={handleToggle(option.key, option.value)}
            disabled={disabled}
          >
            <span className="checkbox-group-card-header">
              <span className="checkbox-group-card-indicator" />
              {option.icon && <span className="checkbox-group-card-icon">{option.icon}</span>}
              <span className="checkbox-group-card-label">{option.label}</span>
            </span>
            {option.description && (
              <span className="checkbox-group-card-desc">{option.description}</span>
            )}
          </button>
        ))}
      </div>
      {hint && <p className="setting-hint">{hint}</p>}
    </div>
  )
})

CheckboxGroupItem.displayName = 'CheckboxGroupItem'
