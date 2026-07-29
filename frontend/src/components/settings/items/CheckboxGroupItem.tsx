/**
 * 复选框组设置项组件
 * 将多个 CheckboxCard 组合成一组，共享标签和描述（权限下放等同款卡片风格）
 */

import React, { useCallback } from 'react'
import { CheckboxCard } from './CheckboxCard'
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

export const CheckboxGroupItem = React.memo<CheckboxGroupItemProps>(
  ({
    label,
    description,
    hint,
    options,
    onChange,
    disabled = false,
    className = '',
  }) => {
    const handleChange = useCallback(
      (key: string) => (value: boolean) => {
        if (!disabled) onChange(key, value)
      },
      [onChange, disabled],
    )

    const showLabel = Boolean(label) || Boolean(description)

    return (
      <div
        className={`setting-item setting-vertical ${className} ${disabled ? 'disabled' : ''}`}
      >
        {showLabel && (
          <div className="setting-label">
            {label ? (
              <span className="setting-label-text">{label}</span>
            ) : null}
            {description && (
              <span className="setting-description">{description}</span>
            )}
          </div>
        )}
        <div className="checkbox-group-options">
          {options.map((option) => (
            <CheckboxCard
              key={option.key}
              label={option.label}
              checked={option.value}
              onChange={handleChange(option.key)}
              description={option.description}
              icon={option.icon}
              disabled={disabled}
            />
          ))}
        </div>
        {hint && <p className="setting-hint">{hint}</p>}
      </div>
    )
  },
)

CheckboxGroupItem.displayName = 'CheckboxGroupItem'
