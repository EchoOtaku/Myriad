/**
 * 数字输入设置项组件
 */

import React, { useCallback } from 'react';
import type { NumberSettingConfig } from '../types';
import './SettingItem.css';

export interface NumberItemProps extends Omit<NumberSettingConfig, 'type'> {}

export const NumberItem = React.memo<NumberItemProps>(({
  key: itemKey,
  label,
  description,
  hint,
  value,
  onChange,
  disabled = false,
  loading = false,
  required = false,
  error,
  size = 'md',
  layout = 'horizontal',
  min,
  max,
  step = 1,
  unit,
  className = '',
}) => {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!disabled && !loading) {
      const numValue = parseFloat(e.target.value) || 0;
      onChange(numValue);
    }
  }, [onChange, disabled, loading]);

  const id = `setting-number-${itemKey}`;

  return (
    <div 
      className={`setting-item setting-item-number setting-${layout} setting-${size} ${className} ${disabled ? 'disabled' : ''}`}
    >
      <div className="setting-item-content">
        <label htmlFor={id} className="setting-label">
          <span className="setting-label-text">
            {label}
            {required && <span className="required">*</span>}
          </span>
          {description && (
            <span className="setting-description">{description}</span>
          )}
        </label>
        
        <div className="setting-control">
          <div className="number-input-wrapper">
            <input
              id={id}
              type="number"
              value={value}
              onChange={handleChange}
              min={min}
              max={max}
              step={step}
              disabled={disabled || loading}
              className={`field-input ${error ? 'has-error' : ''}`}
              aria-label={label}
            />
            {unit && <span className="number-unit">{unit}</span>}
          </div>
        </div>
      </div>
      {error && <p className="setting-error">{error}</p>}
      {hint && !error && <p className="setting-hint">{hint}</p>}
    </div>
  );
});

NumberItem.displayName = 'NumberItem';
