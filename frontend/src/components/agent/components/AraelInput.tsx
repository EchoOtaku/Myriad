/**
 * AraelInput - 输入区域组件
 *
 * 与 AraelPanel.tsx 源文件的输入区域保持一致
 * 使用 .arael-* CSS 类
 */

import React, { useEffect, useRef } from 'react'

/** 输入组件 Props */
export interface AraelInputProps {
  /** 输入值 */
  value: string
  /** 值变更回调 */
  onChange: (value: string) => void
  /** 提交回调 */
  onSubmit: () => void
  /** 键盘事件回调 */
  onKeyDown: (e: React.KeyboardEvent) => void
  /** 是否正在加载 */
  isLoading?: boolean
  /** 是否禁用 */
  disabled?: boolean
  /** 占位符 */
  placeholder?: string
  /** 是否自动聚焦 */
  autoFocus?: boolean

  // 语音相关
  /** 是否正在录音 */
  isRecording?: boolean
  /** 是否正在处理语音 */
  isProcessingVoice?: boolean
  /** 切换录音 */
  onToggleRecording?: () => void

  /** input ref */
  inputRef?: React.RefObject<HTMLInputElement>
}

/**
 * 输入区域组件 - 与源文件一致
 */
export const AraelInput: React.FC<AraelInputProps> = ({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  isLoading = false,
  disabled = false,
  placeholder = '有什么可以帮你？',
  autoFocus = false,
  isRecording = false,
  isProcessingVoice = false,
  onToggleRecording,
  inputRef: externalInputRef,
}) => {
  const internalRef = useRef<HTMLInputElement>(null)
  const inputRef = externalInputRef || internalRef

  // 自动聚焦
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus()
    }
  }, [autoFocus, inputRef])

  // 动态占位符
  const dynamicPlaceholder = isRecording
    ? '正在录音...'
    : isProcessingVoice
      ? '识别中...'
      : placeholder

  return (
    <div className="arael-input-section">
      <div className="arael-input-wrapper">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={dynamicPlaceholder}
          className="arael-input"
          disabled={isLoading || isRecording || isProcessingVoice || disabled}
        />
        {onToggleRecording && (
          <button
            className={`arael-voice-btn ${isRecording ? 'arael-voice-recording' : ''} ${isProcessingVoice ? 'arael-voice-processing' : ''}`}
            onClick={onToggleRecording}
            disabled={isLoading || isProcessingVoice}
            title={isRecording ? '点击停止录音' : isProcessingVoice ? '正在识别...' : '语音输入'}
          >
            {isProcessingVoice
              ? (
                  <span className="arael-spinner-small" />
                )
              : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                    <line x1="12" x2="12" y1="19" y2="22" />
                  </svg>
                )}
          </button>
        )}
        <button
          className="arael-send-btn"
          onClick={onSubmit}
          disabled={!value.trim() || isLoading}
        >
          {isLoading
            ? (
                <span className="arael-spinner" />
              )
            : (
                <span>↑</span>
              )}
        </button>
      </div>
    </div>
  )
}

export default AraelInput
