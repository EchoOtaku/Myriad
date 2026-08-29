/**
 * 一条消息。
 *
 * 助手说的话可能带着四样东西：走过的步骤、反过来问你的话、产出的图、答完之后的
 * 建议。**顺序是有讲究的** —— 过程在最上（读之前先知道它怎么来的），正文在中间，
 * 需要你动手的（问题、建议）在最下，因为那是读完之后才轮到的事。
 * 复制、收藏、重试不进气泡，统一挂在右侧外面。
 */

import type { AgentMessage } from './agentMessages'
import React, { useCallback, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { agentService } from '../../services/agent'
import { invalidateComposerFavorites } from './composerFavorites'
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

export const AgentPanelMessage: React.FC<AgentPanelMessageProps> = React.memo(
  ({ message, onRetry, onAnswer, onSuggest, onZoomImage }) => {
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
      invalidateComposerFavorites()
      void agentService.addToFavorites(message.content).catch(() => {
        setSaved(false)
      })
    }, [message.content])

    const isAssistant = message.role === 'assistant'
    const question = message.question
    const showsFooter = message.state !== 'streaming' && !!message.content
    const hasAnswer = !!(
      message.content ||
      message.imageUrls?.length ||
      question ||
      message.suggestions?.length
    )
    const showsThinking =
      isAssistant &&
      !hasAnswer &&
      !!(message.steps || message.thought || message.state === 'streaming')
    const showsBody =
      message.role === 'user'
        ? !!(message.content || message.attachments?.length)
        : hasAnswer || showsThinking

    return (
      <div
        className="agent-panel-message"
        data-role={message.role}
        data-state={message.state ?? 'settled'}
      >
        {showsBody ? (
          <div
            className={
              message.role === 'system'
                ? 'agent-panel-message-body'
                : 'agent-panel-message-body glass'
            }
          >
            {showsThinking ? (
              <AgentPanelThinking
                steps={message.steps ?? []}
                thought={message.thought}
                live={message.state === 'streaming'}
              />
            ) : null}
            {message.role === 'user' ? (
              <>
                {message.attachments && message.attachments.length > 0 ? (
                  <div className="agent-panel-message-attach">
                    {message.attachments.map((item) => {
                      const preview = item.previewUrl
                      return preview ? (
                        <button
                          key={item.id}
                          type="button"
                          className="agent-panel-image-open"
                          onClick={() => onZoomImage(preview)}
                          aria-label={item.name}
                        >
                          <img src={preview} alt={item.name} />
                        </button>
                      ) : (
                        <span key={item.id} className="agent-panel-attach-chip">
                          <span className="agent-panel-attach-chip-name">
                            {item.name}
                          </span>
                        </span>
                      )
                    })}
                  </div>
                ) : null}
                {message.content ? (
                  // 用户自己打的字不当 Markdown 认 —— 他写的星号就是星号
                  <p className="agent-md-p">{message.content}</p>
                ) : null}
              </>
            ) : message.content ? (
              <AgentMarkdown text={message.content} />
            ) : null}

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

            {question ? (
              <div className="agent-panel-question">
                <p className="agent-panel-question-text">{question.text}</p>
                {question.context ? (
                  <p className="agent-panel-question-context">
                    {question.context}
                  </p>
                ) : null}
                {question.options && question.options.length > 0 ? (
                  <div className="agent-panel-question-options">
                    {question.options.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className="agent-panel-tag"
                        data-active={
                          question.answered === option.value ? 'true' : 'false'
                        }
                        disabled={!!question.answered}
                        title={option.description}
                        onClick={() => onAnswer(message.id, option.value)}
                      >
                        <span className="agent-panel-tag-text">
                          {option.label}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {message.suggestions && message.suggestions.length > 0 ? (
              <div className="agent-panel-question-options">
                {message.suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="agent-panel-tag"
                    onClick={() => onSuggest(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {showsFooter ? (
          <div className="agent-panel-message-footer">
            {message.at && (
              <span className="agent-panel-message-time">
                {formatTime(message.at, locale)}
              </span>
            )}
            <button
              type="button"
              className="agent-panel-tag"
              onClick={copy}
              title={copied ? t.agentPanel.copied : t.agentPanel.copy}
              aria-label={copied ? t.agentPanel.copied : t.agentPanel.copy}
            >
              {copied ? t.agentPanel.copied : t.agentPanel.copy}
            </button>
            {!isAssistant && (
              <button
                type="button"
                className="agent-panel-tag"
                onClick={save}
                disabled={saved}
              >
                {saved ? t.agentPanel.saved : t.agentPanel.save}
              </button>
            )}
            {message.state === 'error' && onRetry ? (
              <button
                type="button"
                className="agent-panel-tag"
                onClick={onRetry}
              >
                {t.agentPanel.retry}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  },
  (prev, next) => prev.message === next.message,
)
