/**
 * Full 层 —— 三档里最大的那一档。
 *
 * 只有真的有话要读的时候才走到这里：复杂对话、长任务、翻回去看之前说了什么。
 * 它仍然贴在底部，仍然是同一块东西长出来的，不是另一个页面。
 *
 * 现在只负责**读**：消息由执行引擎放进 `agentMessages`，这里取出来画。
 * 对话不再套在一块玻璃底上，每条自己是一颗独立胶囊。
 *
 * 运行状态在输入框里。新话题和历史跟上下文贴同一行。
 * 看哪一面（对话 / 历史 / 设置）由外壳持有 —— 「设置那一面没有输入框」这条
 * 规矩得由摆放它的人执行。
 */

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
import { AgentPanelSessions, useAgentSessionList } from './AgentPanelSessions'
import { AGENT_ROW_EXIT_MS, AGENT_ROW_STAGGER_MS } from './agentPanelStage'
import { AgentPresence, AgentPresenceList } from './useAgentPresence'
import { useConversationPan } from './useConversationPan'

function useHeldView(view: AgentPanelFullView): {
  held: AgentPanelFullView
  exiting: boolean
} {
  const [held, setHeld] = useState(view)
  const [exiting, setExiting] = useState(false)
  useEffect(() => {
    if (view === held) {
      setExiting(false)
      return
    }
    if (held === 'manage' || view === 'manage') {
      setHeld(view)
      setExiting(false)
      return
    }
    setExiting(true)
    const timer = setTimeout(
      () => {
        setHeld(view)
        setExiting(false)
      },
      AGENT_ROW_EXIT_MS + AGENT_ROW_STAGGER_MS * 2,
    )
    return () => clearTimeout(timer)
  }, [held, view])
  return { held, exiting }
}

/** 同一档里的三面：读当前对话、翻历史、改设置。 */
export type AgentPanelFullView = 'messages' | 'sessions' | 'manage'

export interface AgentPanelFullProps {
  view: AgentPanelFullView
  onView: (view: AgentPanelFullView) => void
  onSubmit: (text: string) => void
  /** 设置那一面没有输入框，操作贴改由这里自己摆 */
  showChrome?: boolean
}

export const AgentPanelSessionChrome: React.FC<{
  view: AgentPanelFullView
  onView: (view: AgentPanelFullView) => void
}> = ({ view, onView }) => {
  const { t } = useI18n()
  const showsSessions = view === 'sessions'
  const viewLabel = view === 'manage' ? t.agentPanel.manage.title : null

  return (
    <>
      {viewLabel && (
        <span className="agent-panel-tag">
          <span className="agent-panel-tag-text">{viewLabel}</span>
        </span>
      )}
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
    </>
  )
}

export const AgentPanelFull: React.FC<AgentPanelFullProps> = ({
  view,
  onView,
  onSubmit,
  showChrome = false,
}) => {
  const { t } = useI18n()
  const messages = useAgentMessages()
  const sessionId = useAgentSessionId()
  const { held, exiting } = useHeldView(view)
  const sessionList = useAgentSessionList(
    view === 'sessions' || held === 'sessions',
  )
  const [zoomed, setZoomed] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  useConversationPan(
    listRef,
    trackRef,
    held === 'messages' && !zoomed,
    sessionId,
  )

  const conversation =
    held === 'sessions' ? (
      <AgentPanelSessions
        activeSessionId={sessionId}
        exiting={exiting}
        sessions={sessionList.sessions}
        error={sessionList.error}
        onNearStart={sessionList.onNearStart}
        removeSession={sessionList.removeSession}
        onSelect={(id) => {
          dispatchAgentPanelOpenSession(id)
          onView('messages')
        }}
      />
    ) : held === 'manage' ? (
      <div className="agent-panel-overlay agent-panel-full glass">
        <AgentPanelManage />
      </div>
    ) : (
      <div
        className="agent-panel-messages-slot"
        data-exiting={exiting ? 'true' : undefined}
      >
        <div className="agent-panel-messages agent-panel-full" ref={listRef}>
          <div className="agent-panel-messages-track" ref={trackRef}>
            <AgentPresenceList
              items={messages}
              keyOf={(message) => message.id}
              kind="row"
              from="composer"
            >
              {(message) => (
                <AgentPanelMessage
                  message={message}
                  onAnswer={dispatchAgentPanelAnswer}
                  onSuggest={onSubmit}
                  onZoomImage={setZoomed}
                  onRetry={() => {
                    const index = messages.findIndex(
                      (item) => item.id === message.id,
                    )
                    const asked = messages
                      .slice(0, index)
                      .reverse()
                      .find((item) => item.role === 'user')
                    if (asked) onSubmit(asked.content)
                  }}
                />
              )}
            </AgentPresenceList>
          </div>
          <AgentPresence open={!!zoomed} kind="swap" from="self">
            {zoomed ? (
              <button
                type="button"
                className="agent-panel-lightbox"
                onClick={() => setZoomed(null)}
                aria-label={t.agentPanel.closeImage}
              >
                <img src={zoomed} alt="" />
              </button>
            ) : null}
          </AgentPresence>
        </div>
      </div>
    )

  return (
    <>
      {conversation}
      {showChrome ? (
        <div className="agent-panel-tag-rail">
          <div className="agent-panel-tag-actions">
            <AgentPanelSessionChrome view={view} onView={onView} />
          </div>
        </div>
      ) : null}
    </>
  )
}

export default AgentPanelFull
