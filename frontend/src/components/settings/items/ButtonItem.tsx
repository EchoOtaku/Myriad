/**
 * 按钮设置项组件
 */

import React, { useCallback, useState, ReactNode } from 'react';
import type { ButtonSettingConfig } from '../types';
import { ButtonSpinner } from '../../Spinner';
import './SettingItem.css';

export interface ButtonItemProps extends Omit<ButtonSettingConfig, 'type'> {
  /** 异步操作 */
  asyncAction?: boolean;
  /** 加载中的文本 */
  loadingText?: string;
  /** 操作结果 */
  result?: {
    success: boolean;
    message: string;
  } | null;
  /** 自定义结果渲染 */
  renderResult?: (result: { success: boolean; message: string }) => ReactNode;
}

export const ButtonItem = React.memo<ButtonItemProps>(({
  key: itemKey,
  label,
  description,
  hint,
  onClick,
  buttonText,
  buttonIcon,
  variant = 'secondary',
  disabled = false,
  loading: externalLoading = false,
  size = 'md',
  layout = 'vertical',
  asyncAction = false,
  loadingText,
  result,
  renderResult,
  className = '',
}) => {
  const [internalLoading, setInternalLoading] = useState(false);
  const loading = externalLoading || internalLoading;

  const handleClick = useCallback(async () => {
    if (disabled || loading) return;
    
    if (asyncAction) {
      setInternalLoading(true);
      try {
        await onClick();
      } finally {
        setInternalLoading(false);
      }
    } else {
      onClick();
    }
  }, [onClick, disabled, loading, asyncAction]);

  const renderIcon = () => {
    if (loading) {
      return <ButtonSpinner />;
    }
    if (!buttonIcon) return null;
    if (typeof buttonIcon === 'string') {
      return <span>{buttonIcon}</span>;
    }
    return buttonIcon;
  };

  const variantClass = `btn-${variant}`;

  return (
    <div 
      className={`setting-item setting-item-button setting-${layout} setting-${size} ${className}`}
    >
      {label && (
        <div className="setting-label">
          <span className="setting-label-text">{label}</span>
          {description && (
            <span className="setting-description">{description}</span>
          )}
        </div>
      )}
      
      <div className="setting-control">
        <div className="setting-button-row">
          <button
            type="button"
            onClick={handleClick}
            disabled={disabled || loading}
            className={`btn-base ${variantClass}`}
          >
            {renderIcon()}
            <span>{loading && loadingText ? loadingText : buttonText}</span>
          </button>
          {result && (
            renderResult ? renderResult(result) : (
              <span className={`test-result ${result.success ? 'success' : 'error'}`}>
                {result.message}
              </span>
            )
          )}
        </div>
        {hint && <p className="setting-hint">{hint}</p>}
      </div>
    </div>
  );
});

ButtonItem.displayName = 'ButtonItem';
