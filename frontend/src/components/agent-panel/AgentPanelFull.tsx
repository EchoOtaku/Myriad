/**
 * Full 层 —— 三档里最大的那一档。
 *
 * 只有真的有话要读的时候才走到这里：复杂对话、长任务、翻回去看之前说了什么。
 * 它仍然贴在底部，仍然是那块岛长出来的，不是另一个页面。
 *
 * 现在只负责**读**：消息由执行引擎放进 `agentMessages`，这里取出来画。
 *
 * 看哪一面（对话 / 历史 / 设置）由外壳持有 —— 输入那一行已经搬到卡片外面，
 * 而「设置那一面没有输入框」这条规矩得由摆放它的人执行，所以档位不能藏在这里。
 */

import type { AgentPanelPhase } from './agentPanelStage'
import React, { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../contexts/I18nContext'
import { useAgentMessages, useAgentSessionId } from './agentMessages'
import {
  dispatchAgentPanelAnswer,
  dispatchAgentPanelCommand,
  dispatchAgentPanelOpenSession,
} from './agentPanelEvents'
import { AgentPanelManage } from './AgentPanelManage'
import { AgentPanelMessage } from './AgentPanelMessage'
import { AgentPanelSessions } from './AgentPanelSessions'
import { AgentStatusGlyph } from './AgentStatusGlyph'
import { useAgentStatus } from './agentStatusStore'

/** 同一档里的三面：读当前对话、翻历史、改设置。 */
export type AgentPanelFullView = 'messages' | 'sessions' | 'manage'

export interface AgentPanelFullProps {
  phase: AgentPanelPhase
  view: AgentPanelFullView
  onView: (view: AgentPanelFullView) => void
  onSubmit: (text: string) => void
  onCollapse: () => void
}

export const AgentPanelFull: React.FC<AgentPanelFullProps> = ({
  phase,
  view,
  onView,
  onSubmit,
  onCollapse,
}) => {
  const { t } = useI18n()
  const messages = useAgentMessages()
  const sessionId = useAgentSessionId()
  const { status, detail } = useAgentStatus()
  const [zoomed, setZoomed] = useState<string | null>(null)
  const showsSessions = view === 'sessions'
  const endRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)

  // 只有本来就在底部时才跟着滚 —— 用户往回翻的时候不该被拽回来
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const onScroll = () => {
      nearBottomRef.current =
        list.scrollHeight - list.scrollTop - list.clientHeight < 80
    }
    list.addEventListener('scroll', onScroll, { passive: true })
    return () => list.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (view !== 'messages') return
    if (nearBottomRef.current) {
      endRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [messages, view])

  return (
    <div
      className="agent-panel-overlay agent-panel-full glass"
      data-phase={phase}
    >
      <div className="agent-panel-tag-row">
        <span className="agent-panel-tag">
          <AgentStatusGlyph status={status} className="agent-panel-tag-glyph" />
          <span className="agent-panel-tag-text">
            {view === 'sessions'
              ? t.agentPanel.sessions.title
              : view === 'manage'
                ? t.agentPanel.manage.title
                : detail || t.agentPanel.status[status]}
          </span>
        </span>
        <div className="agent-panel-tag-actions">
          <button
            type="button"
            className="agent-panel-tag"
            data-icon="true"
            onClick={() => {
              dispatchAgentPanelCommand('new-session')
              onView('messages')
            }}
            title={t.agentPanel.newSession}
            aria-label={t.agentPanel.newSession}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            className="agent-panel-tag"
            data-icon="true"
            data-tone={showsSessions ? 'primary' : 'neutral'}
            onClick={() => onView(showsSessions ? 'messages' : 'sessions')}
            title={t.agentPanel.sessions.title}
            aria-label={t.agentPanel.sessions.title}
            aria-pressed={showsSessions}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </button>
          <button
            type="button"
            className="agent-panel-tag"
            data-icon="true"
            data-tone={view === 'manage' ? 'primary' : 'neutral'}
            onClick={() => onView(view === 'manage' ? 'messages' : 'manage')}
            title={t.agentPanel.manage.title}
            aria-label={t.agentPanel.manage.title}
            aria-pressed={view === 'manage'}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
            </svg>
          </button>
          <button
            type="button"
            className="agent-panel-tag"
            data-icon="true"
            onClick={onCollapse}
            title={t.agentPanel.collapse}
            aria-label={t.agentPanel.collapse}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      </div>

      {view === 'sessions' ? (
        <AgentPanelSessions
          activeSessionId={sessionId}
          onSelect={(id) => {
            dispatchAgentPanelOpenSession(id)
            onView('messages')
          }}
        />
      ) : view === 'manage' ? (
        <AgentPanelManage />
      ) : (
        <div className="agent-panel-messages" ref={listRef}>
          {messages.map((message, index) => (
            <AgentPanelMessage
              key={message.id}
              message={message}
              onAnswer={dispatchAgentPanelAnswer}
              onSuggest={onSubmit}
              onZoomImage={setZoomed}
              onRetry={() => {
                // 重发的是这条回复之前那句用户的话 —— 助手自己的话重发没有意义
                const asked = [...messages.slice(0, index)]
                  .reverse()
                  .find((m) => m.role === 'user')
                if (asked) onSubmit(asked.content)
              }}
            />
          ))}
          <div ref={endRef} />
        </div>
      )}

      {zoomed && (
        // 看大图：铺满这块面板而不是整个页面 —— 它仍然只是这一层里的一件事
        <button
          type="button"
          className="agent-panel-lightbox"
          onClick={() => setZoomed(null)}
          aria-label={t.agentPanel.closeImage}
        >
          <img src={zoomed} alt="" />
        </button>
      )}
    </div>
  )
}

export default AgentPanelFull
