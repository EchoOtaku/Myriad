/**
 * 一条消息。
 *
 * 助手说的话可能带着四样东西：走过的步骤、反过来问你的话、产出的图、答完之后的
 * 建议。**顺序是有讲究的** —— 过程在最上（读之前先知道它怎么来的），正文在中间，
 * 需要你动手的（问题、建议）在最下，因为那是读完之后才轮到的事。
 */

import type { AgentMessage } from './agentMessages'
import React, { useCallback, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { agentService } from '../../services/agent'
import { AgentMarkdown } from './AgentMarkdown'
import { AgentPanelThinking } from './AgentPanelThinking'

export interface AgentPanelMessageProps {
  message: AgentMessage
  /** 点建议、点选项之外的重发 */
  onRetry?: () => void
  onAnswer: (messageId: string, answer: string) => void
  onSuggest: (text: string) => void
  onZoomImage: (url: string) => void
}

function formatTime(at: number, locale?: string): string {
  return new Date(at).toLocaleTimeString(locale || undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

export const AgentPanelMessage: React.FC<AgentPanelMessageProps> = ({
  message,
  onRetry,
  onAnswer,
  onSuggest,
  onZoomImage,
}) => {
  const { t, locale } = useI18n()
  const [copied, setCopied] = useState(false)

  const copy = useCallback(() => {
    void navigator.clipboard
      ?.writeText(message.content)
      .then(() => {
        setCopied(true)
        // 只是给个「收到」的回执，不需要一直亮着
        setTimeout(setCopied, 1600, false)
      })
      .catch(() => {
        // 剪贴板被浏览器挡住时不谎报成功
      })
  }, [message.content])

  const [saved, setSaved] = useState(false)

  const save = useCallback(() => {
    setSaved(true)
    void agentService.addToFavorites(message.content).catch(() => {
      setSaved(false)
    })
  }, [message.content])

  const isAssistant = message.role === 'assistant'
  const question = message.question
  const showsFooter = message.state !== 'streaming' && !!message.content

  return (
    <div
      className="agent-panel-message"
      data-role={message.role}
      data-state={message.state ?? 'settled'}
    >
      <div className="agent-panel-message-body">
        {isAssistant && message.steps && (
          <AgentPanelThinking steps={message.steps} />
        )}

        {message.role === 'user' ? (
          // 用户自己打的字不当 Markdown 认 —— 他写的星号就是星号
          <p className="agent-md-p">{message.content}</p>
        ) : (
          <AgentMarkdown text={message.content} />
        )}

        {message.imageUrls && message.imageUrls.length > 0 && (
          <div className="agent-panel-message-images">
            {message.imageUrls.map((url) => (
              <button
                key={url}
                type="button"
                className="agent-panel-image-open"
                onClick={() => onZoomImage(url)}
                aria-label={t.agentPanel.zoomImage}
              >
                <img src={url} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        )}

        {question && (
          <div className="agent-panel-question">
            <p className="agent-panel-question-text">{question.text}</p>
            {question.context && (
              <span className="agent-panel-tag agent-panel-question-context">
                {question.context}
              </span>
            )}
            {question.options && question.options.length > 0 && (
              <div className="agent-panel-question-options">
                {question.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="agent-panel-chip"
                    // 答过之后按钮冻结，但仍然看得见当时选了什么
                    data-active={
                      question.answered === option.value ? 'true' : 'false'
                    }
                    disabled={!!question.answered}
                    title={option.description}
                    onClick={() => onAnswer(message.id, option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {message.suggestions && message.suggestions.length > 0 && (
          <div className="agent-panel-question-options">
            {message.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="agent-panel-chip"
                onClick={() => onSuggest(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {showsFooter && (
          <div className="agent-panel-message-footer">
            {message.at && (
              <span className="agent-panel-message-time">
                {formatTime(message.at, locale)}
              </span>
            )}
            <button
              type="button"
              className="agent-panel-message-action"
              onClick={copy}
              title={copied ? t.agentPanel.copied : t.agentPanel.copy}
              aria-label={copied ? t.agentPanel.copied : t.agentPanel.copy}
            >
              {copied ? t.agentPanel.copied : t.agentPanel.copy}
            </button>
            {/* 存成常用只对自己说过的话有意义 —— 收藏的是问法，不是答案 */}
            {!isAssistant && (
              <button
                type="button"
                className="agent-panel-message-action"
                onClick={save}
                disabled={saved}
              >
                {saved ? t.agentPanel.saved : t.agentPanel.save}
              </button>
            )}
            {message.state === 'error' && onRetry && (
              <button
                type="button"
                className="agent-panel-message-action"
                onClick={onRetry}
              >
                {t.agentPanel.retry}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default AgentPanelMessage
