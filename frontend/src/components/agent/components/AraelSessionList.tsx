/**
 * AraelSessionList - 会话列表组件
 *
 * 现代化设计，显示：
 * - 最近会话（标题 + 消息数 + 最后活跃时间）
 * - 点击会话加载消息
 * - 新建对话按钮
 */

import type { ChatSession } from '../types'
import React, { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { agentService } from '../../../services/agent'

/** 格式化相对时间 */
function formatRelativeTime(dateStr: string, arael: { timeJustNow: string; timeMinutesAgo: string; timeHoursAgo: string; timeDaysAgo: string }, fmt: (template: string, params: Record<string, string | number>) => string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1)
    return arael.timeJustNow
  if (diffMin < 60)
    return fmt(arael.timeMinutesAgo, { n: diffMin })
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24)
    return fmt(arael.timeHoursAgo, { n: diffHour })
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 7)
    return fmt(arael.timeDaysAgo, { n: diffDay })
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export interface AraelSessionListProps {
  onSelectSession: (session: ChatSession) => void
  onNewSession: () => void
  activeSessionId?: string | null
}

export const AraelSessionList: React.FC<AraelSessionListProps> = ({
  onSelectSession,
  onNewSession,
  activeSessionId,
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [loading, setLoading] = useState(false)
  const { t, format } = useI18n()

  const loadSessions = useCallback(async () => {
    setLoading(true)
    try {
      const list = await agentService.listSessions(1, 30)
      setSessions(list.map(s => ({
        id: s.id,
        title: s.title,
        messageCount: s.messageCount,
        lastActiveAt: s.lastActiveAt,
        createdAt: s.createdAt,
      })))
    }
    catch {
      // silent
    }
    finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  return (
    <div className="arael-sessions">
      {/* Loading */}
      {loading && (
        <div className="arael-sessions-loading">
          <span className="arael-spinner-small" />
        </div>
      )}

      {/* List */}
      <div className="arael-sessions-items">
        {sessions.map(session => (
          <button
            key={session.id}
            className={`arael-sessions-item${session.id === activeSessionId ? ' active' : ''}`}
            onClick={() => onSelectSession(session)}
          >
            <div className="arael-sessions-item-row">
              <svg className="arael-sessions-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="arael-sessions-item-title">
                {session.title || t.arael.unnamedConversation}
              </span>
              <span className="arael-sessions-item-time">
                {formatRelativeTime(session.lastActiveAt, t.arael, format)}
              </span>
            </div>
            <div className="arael-sessions-item-sub">
              {format(t.arael.messageCount, { count: session.messageCount })}
            </div>
          </button>
        ))}

        {!loading && sessions.length === 0 && (
          <div className="arael-sessions-empty">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span>{t.arael.noHistory}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default AraelSessionList
