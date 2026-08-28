/**
 * 之前聊过的。
 *
 * 不是另一块面板：每段对话自己是一张卡片，和当前对话的气泡同一套语言。
 * 选中之后只发一条事件，真正去取消息的仍然是执行方。
 *
 * 滚动和对话同一套：轨道位移，越界整张化开，不设 overflow。
 * 最近的在下面贴着输入行；往上滑才是更早的，顶上再去取一页。
 */

import type { SessionInfo } from '../../services/agent'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import { agentService } from '../../services/agent'
import { relativeTimeBucket } from './agentRelativeTime'
import { AgentPresence, AgentPresenceList } from './useAgentPresence'
import { useConversationPan } from './useConversationPan'

export interface AgentPanelSessionsProps {
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
}

const SESSION_PAGE = 20

export const AgentPanelSessions: React.FC<AgentPanelSessionsProps> = ({
  activeSessionId,
  onSelect,
}) => {
  const { t, format, locale } = useI18n()
  const { isAuthenticated } = useAuth()
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const hasMoreRef = useRef(false)
  const fetchingRef = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      setSessions([])
      setError(t.agentPanel.sessions.needLogin)
      hasMoreRef.current = false
      return
    }
    let cancelled = false
    fetchingRef.current = true
    void (async () => {
      try {
        const list = await agentService.listSessions(page, SESSION_PAGE)
        if (cancelled) return
        const fresh = list.filter((item) => item.messageCount > 0)
        hasMoreRef.current = list.length >= SESSION_PAGE
        setSessions((current) => {
          if (page === 1 || !current) return fresh
          const seen = new Set(current.map((item) => item.id))
          return current.concat(fresh.filter((item) => !seen.has(item.id)))
        })
        setError(null)
      } catch {
        if (cancelled) return
        if (page === 1) setSessions([])
        hasMoreRef.current = false
        setError(t.agentPanel.sessions.loadFailed)
      } finally {
        fetchingRef.current = false
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

  const onNearStart = useCallback(() => {
    if (fetchingRef.current || !hasMoreRef.current) return
    fetchingRef.current = true
    setPage((current) => current + 1)
  }, [])

  useConversationPan(
    listRef,
    trackRef,
    !!sessions && sessions.length > 0,
    'sessions',
    '.agent-panel-session',
    onNearStart,
  )

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

  const visible = useMemo(
    () => (sessions ? [...sessions].reverse() : []),
    [sessions],
  )

  return (
    <div className="agent-panel-messages-slot">
      <div className="agent-panel-messages" ref={listRef}>
        <div className="agent-panel-messages-track" ref={trackRef}>
          <AgentPresence open={!!error} kind="row" from="composer">
            <div className="agent-panel-session glass" data-tone="alert">
              <span className="agent-panel-session-title">{error}</span>
            </div>
          </AgentPresence>
          <AgentPresence
            open={!error && sessions !== null && sessions.length === 0}
            kind="row"
            from="composer"
          >
            <div className="agent-panel-session glass">
              <span className="agent-panel-session-time">
                {t.agentPanel.sessions.empty}
              </span>
            </div>
          </AgentPresence>
          <AgentPresenceList
            items={visible}
            keyOf={(session) => session.id}
            kind="row"
            from="place"
          >
            {(session) => {
              const when = describe(session)
              return (
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
                      if (!window.confirm(t.agentPanel.confirmRemoveSession)) {
                        return
                      }
                      setSessions(
                        (current) =>
                          current?.filter((item) => item.id !== session.id) ??
                          current,
                      )
                      void agentService.archiveSession(session.id).catch(() => {
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
              )
            }}
          </AgentPresenceList>
        </div>
      </div>
    </div>
  )
}

export default AgentPanelSessions
