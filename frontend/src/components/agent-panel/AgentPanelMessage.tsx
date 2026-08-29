/**
 * 一条消息。
 *
 * 助手说的话可能带着四样东西：走过的步骤、反过来问你的话、产出的图、答完之后的
 * 建议。**顺序是有讲究的** —— 过程在最上（读之前先知道它怎么来的），正文在中间，
 * 需要你动手的（问题、建议）在最下，因为那是读完之后才轮到的事。
 * 复制、收藏、重试不进气泡，统一挂在右侧外面。
 */

import type { AgentMessage } from './agentMessages'
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { agentService } from '../../services/agent'
import { invalidateComposerFavorites } from './composerFavorites'
import { AgentMarkdown } from './AgentMarkdown'
import { AgentPanelThinking } from './AgentPanelThinking'
import {
  BUBBLE_GROW_MS,
  BUBBLE_SIZE_EASE,
  messageHasAnswer,
  THINKING_FOLD_MS,
} from './agentThinking'

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

function motionAllowed(): boolean {
  if (typeof document === 'undefined') return false
  if (document.documentElement.dataset.perfMode === 'exlight') return false
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 高度跟内容走。上一帧的高度记下来，这一帧布局若已经跳了，
 * 从记下的值接到新值，空档才不会停在气泡里。
 */
function useBubbleHeight() {
  const ref = useRef<HTMLDivElement>(null)
  const primed = useRef(false)
  const prevH = useRef(0)
  const animRef = useRef<Animation | null>(null)

  useLayoutEffect(
    () => () => {
      animRef.current?.cancel()
      animRef.current = null
    },
    [],
  )

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const unlock = () => {
      animRef.current?.cancel()
      animRef.current = null
      el.style.height = ''
      el.style.overflow = ''
    }

    if (!motionAllowed()) {
      primed.current = true
      prevH.current = 0
      unlock()
      return
    }

    const target = Math.round(el.scrollHeight)
    const visual = el.getBoundingClientRect().height
    if (!primed.current) {
      primed.current = true
      prevH.current = visual
      return
    }

    const running =
      animRef.current !== null && animRef.current.playState === 'running'
    const from = running ? visual : Math.max(visual, prevH.current)
    if (Math.abs(target - from) < 0.5) {
      if (!running) {
        unlock()
        prevH.current = target
      }
      return
    }

    el.style.height = `${from}px`
    animRef.current?.cancel()
    const shrinking = target < from
    el.style.overflow = shrinking ? 'hidden' : 'visible'
    const duration = shrinking ? THINKING_FOLD_MS : BUBBLE_GROW_MS
    const next = el.animate(
      [{ height: `${from}px` }, { height: `${target}px` }],
      {
        duration,
        easing: BUBBLE_SIZE_EASE,
        fill: 'forwards',
      },
    )
    animRef.current = next
    prevH.current = target
    const settle = () => {
      if (animRef.current !== next) return
      el.style.height = ''
      el.style.overflow = ''
      animRef.current = null
      prevH.current = el.getBoundingClientRect().height
    }
    const failSafe = window.setTimeout(settle, duration + 48)
    void next.finished.then(
      () => {
        window.clearTimeout(failSafe)
        settle()
      },
      () => {
        window.clearTimeout(failSafe)
      },
    )
  })

  return ref
}

function useHeldOpen(open: boolean, holdMs: number): boolean {
  const [held, setHeld] = useState(open)
  useEffect(() => {
    if (open) {
      setHeld(true)
      return undefined
    }
    const wait = motionAllowed() ? holdMs : 0
    const timer = setTimeout(() => setHeld(false), wait)
    return () => clearTimeout(timer)
  }, [holdMs, open])
  return open || held
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
    const hasAnswer = messageHasAnswer(message)
    const showsFooter = message.state !== 'streaming' && hasAnswer
    const showsThinking =
      isAssistant &&
      !hasAnswer &&
      !!(message.steps || message.thought || message.state === 'streaming')
    const keepThinking = useHeldOpen(showsThinking, THINKING_FOLD_MS)
    const bubbleRef = useBubbleHeight()
    const showsBody =
      message.role === 'user'
        ? !!(message.content || message.attachments?.length)
        : hasAnswer || showsThinking || keepThinking

    return (
      <div
        className="agent-panel-message"
        data-role={message.role}
        data-state={message.state ?? 'settled'}
      >
        {showsBody ? (
          <div
            ref={bubbleRef}
            className={
              message.role === 'system'
                ? 'agent-panel-message-body'
                : 'agent-panel-message-body glass'
            }
          >
            <div className="agent-panel-message-grow">
              {keepThinking ? (
                <div
                  className="agent-panel-thinking-slot"
                  data-open={showsThinking ? 'true' : 'false'}
                >
                  <div className="agent-panel-thinking-slot-body">
                    <AgentPanelThinking
                      steps={message.steps ?? []}
                      thought={message.thought}
                      live={message.state === 'streaming'}
                    />
                  </div>
                </div>
              ) : null}
              {hasAnswer ? (
                <div className="agent-panel-message-answer">
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
                              <span key={item.id} className="agent-panel-tag">
                                <span className="agent-panel-tag-text">
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
                      <p className="agent-panel-question-text">
                        {question.text}
                      </p>
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
                              className={
                                question.answered
                                  ? 'agent-panel-tag'
                                  : 'agent-panel-tag agent-panel-tag-strong'
                              }
                              data-active={
                                question.answered === option.value
                                  ? 'true'
                                  : 'false'
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
                          <span className="agent-panel-tag-text">
                            {suggestion}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
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
              <span className="agent-panel-tag-text">
                {copied ? t.agentPanel.copied : t.agentPanel.copy}
              </span>
            </button>
            {!isAssistant && (
              <button
                type="button"
                className="agent-panel-tag"
                onClick={save}
                disabled={saved}
              >
                <span className="agent-panel-tag-text">
                  {saved ? t.agentPanel.saved : t.agentPanel.save}
                </span>
              </button>
            )}
            {message.state === 'error' && onRetry ? (
              <button
                type="button"
                className="agent-panel-tag"
                onClick={onRetry}
              >
                <span className="agent-panel-tag-text">
                  {t.agentPanel.retry}
                </span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  },
  (prev, next) => prev.message === next.message,
)
