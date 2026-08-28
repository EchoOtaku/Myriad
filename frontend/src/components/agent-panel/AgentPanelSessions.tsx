/**
 * 之前聊过的。
 *
 * 不是另一块面板：每段对话自己是一张卡片，和当前对话的气泡同一套语言。
 * 选中之后只发一条事件，真正去取消息的仍然是执行方。
 */

import type { SessionInfo } from '../../services/agent'
import React, { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import { agentService } from '../../services/agent'
import { relativeTimeBucket } from './agentRelativeTime'
import { AgentPresence, AgentSwap } from './useAgentPresence'

export interface AgentPanelSessionsProps {
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  page: number
  onHasMore?: (more: boolean) => void
  onEmptyPage?: () => void
}

const SESSION_PAGE = 6

export const AgentPanelSessions: React.FC<AgentPanelSessionsProps> = ({
  activeSessionId,
  onSelect,
  page,
  onHasMore,
  onEmptyPage,
}) => {
  const { t, format, locale } = useI18n()
  const { isAuthenticated } = useAuth()
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onHasMoreRef = useRef(onHasMore)
  onHasMoreRef.current = onHasMore

  useEffect(() => {
    // 会话接口只认 JWT，游客直接说清楚，不去撞一个必然的 401
    if (!isAuthenticated) {
      setSessions([])
      setError(t.agentPanel.sessions.needLogin)
      onHasMoreRef.current?.(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const list = await agentService.listSessions(page, SESSION_PAGE)
        if (cancelled) return
        setSessions(
          list.filter((item) => !item.archived && item.messageCount > 0),
        )
        onHasMoreRef.current?.(list.length >= SESSION_PAGE)
        setError(null)
      } catch {
        if (cancelled) return
        setSessions([])
        onHasMoreRef.current?.(false)
        setError(t.agentPanel.sessions.loadFailed)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    isAuthenticated,
    page,
    t.agentPanel.sessions.needLogin,
    t.agentPanel.sessions.loadFailed,
  ])

  const describe = (session: SessionInfo): string => {
    const bucket = relativeTimeBucket(session.lastActiveAt, Date.now())
    if (!bucket) return ''
    switch (bucket.kind) {
      case 'justNow':
        return t.agentPanel.sessions.justNow
      case 'minutes':
        return format(t.agentPanel.sessions.minutesAgo, { value: bucket.value })
      case 'hours':
        return format(t.agentPanel.sessions.hoursAgo, { value: bucket.value })
      case 'days':
        return format(t.agentPanel.sessions.daysAgo, { value: bucket.value })
      default:
        return bucket.date.toLocaleDateString(locale || undefined)
    }
  }

  return (
    <div className="agent-panel-sessions agent-panel-full">
      <AgentPresence open={!!error} kind="row" from="place">
        <div className="agent-panel-session glass" data-tone="alert">
          <span className="agent-panel-session-title">{error}</span>
        </div>
      </AgentPresence>
      <AgentPresence
        open={!error && sessions !== null && sessions.length === 0}
        kind="row"
        from="place"
      >
        <div className="agent-panel-session glass">
          <span className="agent-panel-session-time">
            {t.agentPanel.sessions.empty}
          </span>
        </div>
      </AgentPresence>
      {sessions && sessions.length > 0
        ? Array.from({ length: SESSION_PAGE }, (_, slot) => {
            const session = sessions[slot]
            const when = session ? describe(session) : ''
            return (
              <AgentSwap
                key={slot}
                id={session?.id ?? `vacant-${page}-${slot}`}
                from="place"
              >
                {session ? (
                  <div
                    className="agent-panel-session glass"
                    data-active={
                      session.id === activeSessionId ? 'true' : 'false'
                    }
                  >
                    <button
                      type="button"
                      className="agent-panel-session-open"
                      onClick={() => onSelect(session.id)}
                    >
                      <span className="agent-panel-session-title">
                        {session.title || t.agentPanel.sessions.untitled}
                      </span>
                      {when ? (
                        <span className="agent-panel-session-time">{when}</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="agent-panel-tag-dismiss"
                      title={t.agentPanel.removeSession}
                      aria-label={t.agentPanel.removeSession}
                      onClick={() => {
                        if (
                          !window.confirm(t.agentPanel.confirmRemoveSession)
                        ) {
                          return
                        }
                        setSessions((current) => {
                          const next =
                            current?.filter((item) => item.id !== session.id) ??
                            current
                          if (next && next.length === 0 && page > 1) {
                            onEmptyPage?.()
                          }
                          return next
                        })
                        void agentService
                          .archiveSession(session.id)
                          .catch(() => {
                            setError(t.agentPanel.sessions.loadFailed)
                          })
                      }}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M6 6l12 12M18 6l-12 12" />
                      </svg>
                    </button>
                  </div>
                ) : null}
              </AgentSwap>
            )
          })
        : null}
    </div>
  )
}

export default AgentPanelSessions
