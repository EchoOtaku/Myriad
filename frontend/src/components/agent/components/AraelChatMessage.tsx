/**
 * AraelChatMessage - 现代聊天消息组件
 *
 * 根据 role 渲染不同样式：
 * - User: 右对齐气泡，主题色
 * - Assistant: 左对齐，底部紧凑进度提示
 * - System: 居中分隔线
 */

import type { ChatMessage } from '../types'
import React from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { AraelTraceDetail } from './AraelTraceDetail'

/** 渲染消息内容（纯文本） */
function renderMessageContent(message: string): React.ReactNode {
  return message
}

/** 格式化时间 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

/** 格式化耗时 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export interface AraelChatMessageProps {
  message: ChatMessage
  isExpanded: boolean
  onToggleExpand: () => void
  onRetry?: (content: string) => void
  onAnswerQuestion?: (messageId: string, answer: string) => void
}

export const AraelChatMessage: React.FC<AraelChatMessageProps> = ({
  message,
  isExpanded,
  onToggleExpand,
  onRetry,
  onAnswerQuestion,
}) => {
  const { t } = useI18n()

  // ============ User ============
  if (message.role === 'user') {
    return (
      <div className="arael-msg arael-msg-user">
        <div className="arael-msg-bubble">
          <div className="arael-msg-content">{message.content}</div>
          <div className="arael-msg-time">{formatTime(message.createdAt)}</div>
        </div>
      </div>
    )
  }

  // ============ System ============
  if (message.role === 'system') {
    return (
      <div className="arael-msg arael-msg-system">
        <div className="arael-msg-system-line" />
        <span className="arael-msg-system-text">{message.content}</span>
        <div className="arael-msg-system-line" />
      </div>
    )
  }

  // ============ Assistant ============
  const exec = message.taskExecution
  const isProcessing = exec?.status === 'processing'
  const isCompleted = exec?.status === 'completed'
  const isError = exec?.status === 'error'
  const isWaiting = exec?.status === 'waiting'

  // 计算总耗时
  const totalDurationMs = exec
    ? (exec.executionTrace?.totalDurationMs
      ?? exec.steps.reduce((sum, s) => sum + (s.durationMs ?? 0), 0))
    : 0

  // 找到对应的 user 消息内容用于重试（向上找同 session 最近的 user 消息）
  // 由于组件只接收单条消息，重试时使用当前消息的 content 发送
  const canRetry = (isCompleted || isError) && onRetry

  // 过程状态文本（仅在处理中且无最终内容时显示）
  const statusMessage = exec?.statusMessage
  const showStatus = (isProcessing || isWaiting) && statusMessage
  const hasContent = !!message.content

  return (
    <div className="arael-msg arael-msg-assistant">
      <div className="arael-msg-body">
        <div className="arael-msg-bubble">
          {/* 过程状态提示 — 处理中时显示 */}
          {showStatus && (
            <div className="arael-msg-status">
              <span>{statusMessage}</span>
            </div>
          )}

          {/* 消息文本 — AI 最终回复 */}
          {hasContent && (
            <div className="arael-msg-content">
              {renderMessageContent(message.content)}
            </div>
          )}

          {/* 图片结果（支持多张） */}
          {message.imageUrls && message.imageUrls.length > 0 && (
            <div className={`arael-msg-image${message.imageUrls.length > 1 ? ' arael-msg-image-grid' : ''}`}>
              {message.imageUrls.map((url, idx) => (
                <img
                  key={idx}
                  src={url}
                  alt="AI generated"
                  loading="lazy"
                  onError={e => (e.currentTarget.style.display = 'none')}
                />
              ))}
            </div>
          )}

          {/* 等待用户选择 */}
          {message.pendingQuestion?.options && onAnswerQuestion && (
            <div className="arael-question-options">
              {message.pendingQuestion.options.map((option, idx) => (
                <button
                  key={idx}
                  className="arael-option-btn"
                  onClick={() => onAnswerQuestion(message.id, option)}
                >
                  {option}
                </button>
              ))}
            </div>
          )}

          {/* 底部状态栏：进度/用时 + 重试 */}
          <div className="arael-msg-footer">
            <div className="arael-msg-time">{formatTime(message.createdAt)}</div>
            <div className="arael-msg-footer-right">
              {/* 任务进度紧凑提示 */}
              {exec && (
                <button className={`arael-exec-hint arael-exec-hint-${exec.status}`} onClick={onToggleExpand}>
                  {isProcessing && (
                    <>
                      <span>{exec.progress}%</span>
                    </>
                  )}
                  {isWaiting && (
                    <>
                      <span>{t.arael.waiting}</span>
                    </>
                  )}
                  {isCompleted && (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--arael-success, #10b981)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {totalDurationMs > 0 && <span>{formatDuration(totalDurationMs)}</span>}
                    </>
                  )}
                  {isError && (
                    <>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--arael-error, #ef4444)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      <span>{t.arael.failed}</span>
                    </>
                  )}
                </button>
              )}
              {/* 重新请求按钮 */}
              {canRetry && (
                <button
                  className="arael-retry-btn"
                  onClick={() => onRetry(message.content)}
                  title={t.arael.retryRequest}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          {/* 展开的详细执行信息 */}
          {exec && (
            <div
              className="arael-exec-details"
              data-expanded={isExpanded ? 'true' : 'false'}
            >
              <AraelTraceDetail task={exec} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AraelChatMessage
