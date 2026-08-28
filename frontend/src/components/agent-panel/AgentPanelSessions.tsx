/**
 * 之前聊过的。
 *
 * Full 层里的另一面 —— 不是另一档，是同一档换了内容：翻历史和读当前对话是同一
 * 件事的两个方向，不该把面板再撑大一号。
 *
 * 选中之后只发一条事件，真正去取消息的仍然是执行方。
 */

import type { SessionInfo } from '../../services/agent'
import React, { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useI18n } from '../../contexts/I18nContext'
import { agentService } from '../../services/agent'
import { relativeTimeBucket } from './agentRelativeTime'

export interface AgentPanelSessionsProps {
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
}

export const AgentPanelSessions: React.FC<AgentPanelSessionsProps> = ({
  activeSessionId,
  onSelect,
}) => {
  const { t, format, locale } = useI18n()
  const { isAuthenticated } = useAuth()
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // 会话接口只认 JWT，游客直接说清楚，不去撞一个必然的 401
    if (!isAuthenticated) {
      setSessions([])
      setError(t.agentPanel.sessions.needLogin)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const list = await agentService.listSessions(1, 20)
        if (cancelled) return
        setSessions(list.filter((s) => !s.archived && s.messageCount > 0))
        setError(null)
      } catch {
        if (cancelled) return
        setSessions([])
        setError(t.agentPanel.sessions.loadFailed)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    isAuthenticated,
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
    <div className="agent-panel-sessions">
      {error && (
        <span className="agent-panel-tag" data-block="true" data-tone="alert">
          {error}
        </span>
      )}
      {!error && sessions !== null && sessions.length === 0 && (
        <span className="agent-panel-tag" data-block="true">
          {t.agentPanel.sessions.empty}
        </span>
      )}
      {sessions?.map((session) => (
        <div
          key={session.id}
          className="agent-panel-session-row"
          data-active={session.id === activeSessionId ? 'true' : 'false'}
        >
          <button
            type="button"
            className="agent-panel-session"
            onClick={() => onSelect(session.id)}
          >
            <span className="agent-panel-session-title">
              {session.title || t.agentPanel.sessions.untitled}
            </span>
            <span className="agent-panel-session-time">
              {describe(session)}
            </span>
          </button>
          <button
            type="button"
            className="agent-panel-manage-remove"
            title={t.agentPanel.removeSession}
            aria-label={t.agentPanel.removeSession}
            onClick={() => {
              if (!window.confirm(t.agentPanel.confirmRemoveSession)) return
              // 先从列表里拿掉 —— 归档是幂等的，失败了下次进来自然会回来
              setSessions(
                (current) =>
                  current?.filter((item) => item.id !== session.id) ?? current,
              )
              void agentService.archiveSession(session.id).catch(() => {
                setError(t.agentPanel.sessions.loadFailed)
              })
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export default AgentPanelSessions
