/**
 * 数字输入组设置项组件
 * 将多个数字输入选项组合为卡片组，共享标签和描述
 */

import React, { useCallback } from 'react'

import './SettingItem.css'

export interface NumberGroupOption {
  /** 唯一标识 */
  key: string
  /** 选项显示文本 */
  label: string
  /** 选项说明文本 */
  description?: string
  /** 当前值 */
  value: number
  /** 最小值 */
  min?: number
  /** 最大值 */
  max?: number
  /** 步进 */
  step?: number
  /** 单位 */
  unit?: string
}

export interface NumberGroupItemProps {
  /** 组标签 */
  label: string
  /** 描述说明 */
  description?: string
  /** 提示文本 */
  hint?: string
  /** 选项列表 */
  options: NumberGroupOption[]
  /** 值变化回调 */
  onChange: (key: string, value: number) => void
  /** 是否禁用 */
  disabled?: boolean
  /** 自定义 class */
  className?: string
}

export const NumberGroupItem = React.memo<NumberGroupItemProps>(
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
      (key: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!disabled) {
          const numValue = Number.parseFloat(e.target.value) || 0
          onChange(key, numValue)
        }
      },
      [onChange, disabled],
    )

    return (
      <div
        className={`setting-item setting-vertical ${className} ${disabled ? 'disabled' : ''}`}
      >
        <div className="setting-label">
          <span className="setting-label-text">{label}</span>
          {description && (
            <span className="setting-description">{description}</span>
          )}
        </div>
        <div className="number-group-options">
          {options.map((option) => (
            <div key={option.key} className="number-group-card">
              <span className="number-group-card-label">{option.label}</span>
              {option.description && (
                <span className="number-group-card-desc">
                  {option.description}
                </span>
              )}
              <div className="number-group-card-input">
                <input
                  type="number"
                  value={option.value}
                  onChange={handleChange(option.key)}
                  min={option.min}
                  max={option.max}
                  step={option.step ?? 1}
                  disabled={disabled}
                  className="field-input"
                  aria-label={option.label}
                  autoComplete="one-time-code"
                  data-form-type="other"
                  data-lpignore="true"
                  data-1p-ignore="true"
                />
                {option.unit && (
                  <span className="number-group-card-unit">{option.unit}</span>
                )}
              </div>
            </div>
          ))}
        </div>
        {hint && <p className="setting-hint">{hint}</p>}
      </div>
    )
  },
)

NumberGroupItem.displayName = 'NumberGroupItem'
