/**
 * 通知中心
 *
 * 悬浮铃铛 + 未读角标 + 下拉面板 + 高优先级 toast。
 * 通过 SSE 实时接收通知（Heartbeat 结果、任务完成/失败、澄清请求等），
 * 历史与已读状态由后端持久化。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../contexts/I18nContext'
import notificationApi, {
  type AppNotification,
  type NotificationStreamEvent,
} from '../services/notificationApi'

const TYPE_ICONS: Record<string, string> = {
  task_completed: '✅',
  task_failed: '❌',
  heartbeat_result: '💓',
  mcp_server_status: '🔌',
  system_info: 'ℹ️',
  agent_clarification: '❓',
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  normal: 'bg-blue-400',
  low: 'bg-gray-300 dark:bg-gray-600',
}

export default function NotificationCenter() {
  const { user } = useAuth()
  const { t, format } = useI18n()

  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [toasts, setToasts] = useState<AppNotification[]>([])
  const panelRef = useRef<HTMLDivElement>(null)

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((n) => n.id !== id))
  }, [])

  // SSE 订阅（登录后建立，断线自动重连）
  useEffect(() => {
    if (!user) return
    const close = notificationApi.subscribe(
      (event: NotificationStreamEvent) => {
        if (event.event === 'init') {
          setUnread(event.unread_count)
        } else if (event.event === 'new_notification') {
          const n = event.notification
          setItems((prev) =>
            prev.some((p) => p.id === n.id) ? prev : [n, ...prev],
          )
          if (!n.read) setUnread((c) => c + 1)
          // 高优先级弹 toast，低优先级安静进面板
          if (n.priority === 'high' || n.priority === 'urgent') {
            setToasts((prev) => [...prev.slice(-2), n])
            setTimeout(() => dismissToast(n.id), 6000)
          }
        } else if (event.event === 'notification_read') {
          setItems((prev) =>
            prev.map((p) => (p.id === event.id ? { ...p, read: true } : p)),
          )
        }
      },
    )
    return close
  }, [user, dismissToast])

  // 首次打开时加载历史
  const loadHistory = useCallback(async () => {
    try {
      const res = await notificationApi.list(50)
      setItems(res.notifications)
      setUnread(res.unread_count)
      setLoaded(true)
    } catch (e) {
      console.warn('[NotificationCenter] Failed to load history:', e)
    }
  }, [])

  const togglePanel = useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      if (next && !loaded) void loadHistory()
      return next
    })
  }, [loaded, loadHistory])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  const markRead = useCallback(async (n: AppNotification) => {
    if (n.read) return
    setItems((prev) =>
      prev.map((p) => (p.id === n.id ? { ...p, read: true } : p)),
    )
    setUnread((c) => Math.max(0, c - 1))
    try {
      await notificationApi.markRead(n.id)
    } catch {
      /* SSE 的 notification_read 事件会兜底同步 */
    }
  }, [])

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((p) => ({ ...p, read: true })))
    setUnread(0)
    try {
      await notificationApi.markAllRead()
    } catch (e) {
      console.warn('[NotificationCenter] mark all read failed:', e)
    }
  }, [])

  const handleItemClick = useCallback(
    (n: AppNotification) => {
      setExpandedId((prev) => (prev === n.id ? null : n.id))
      void markRead(n)
    },
    [markRead],
  )

  const relativeTime = useCallback(
    (iso: string): string => {
      const diffMs = Date.now() - new Date(iso).getTime()
      const minutes = Math.floor(diffMs / 60000)
      if (minutes < 1) return t.notificationCenter.justNow
      if (minutes < 60)
        return format(t.notificationCenter.minutesAgo, { n: minutes })
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return format(t.notificationCenter.hoursAgo, { n: hours })
      return format(t.notificationCenter.daysAgo, {
        n: Math.floor(hours / 24),
      })
    },
    [t, format],
  )

  const typeLabel = useCallback(
    (type: string): string => {
      const labels: Record<string, string> = {
        task_completed: t.notificationCenter.typeTaskCompleted,
        task_failed: t.notificationCenter.typeTaskFailed,
        heartbeat_result: t.notificationCenter.typeHeartbeat,
        mcp_server_status: t.notificationCenter.typeMcp,
        system_info: t.notificationCenter.typeSystem,
        agent_clarification: t.notificationCenter.typeClarification,
      }
      return labels[type] ?? t.notificationCenter.typeSystem
    },
    [t],
  )

  if (!user) return null

  return (
    <div ref={panelRef} className="fixed top-[4.25rem] right-4 z-9000">
      {/* 铃铛按钮 */}
      <button
        type="button"
        onClick={togglePanel}
        aria-label={t.notificationCenter.title}
        className="relative w-10 h-10 rounded-full glass shadow-md border border-white/40 dark:border-white/10
          bg-white/80 dark:bg-gray-900/80 backdrop-blur-md
          flex items-center justify-center
          text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white
          transition-all hover:shadow-lg active:scale-95"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.4-1.4a2 2 0 01-.6-1.4V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-4.5 h-4.5 px-1 rounded-full bg-red-500 text-white
              text-[10px] font-bold flex items-center justify-center shadow-sm"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {/* 通知面板 */}
      {open && (
        <div
          className="absolute top-12 right-0 w-[min(24rem,calc(100vw-2rem))] max-h-[70vh]
            glass rounded-2xl shadow-xl border border-white/40 dark:border-white/10
            bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl
            flex flex-col overflow-hidden animate-fade-in"
        >
          {/* 头部 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200/50 dark:border-gray-700/50">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {t.notificationCenter.title}
              {unread > 0 && (
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {unread}
                </span>
              )}
            </h3>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markAllRead()}
                className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 transition-colors"
              >
                {t.notificationCenter.markAllRead}
              </button>
            )}
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {items.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400 dark:text-gray-500">
                {t.notificationCenter.empty}
              </div>
            ) : (
              items.map((n) => (
                <button
                  type="button"
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100/60 dark:border-gray-800/60
                    transition-colors hover:bg-gray-50/60 dark:hover:bg-gray-800/40
                    ${n.read ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-base leading-5 shrink-0">
                      {TYPE_ICONS[n.notification_type] ?? 'ℹ️'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {!n.read && (
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_COLORS[n.priority] ?? PRIORITY_COLORS.normal}`}
                          />
                        )}
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                          {n.title}
                        </span>
                      </div>
                      <p
                        className={`mt-0.5 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words ${
                          expandedId === n.id ? '' : 'line-clamp-2'
                        }`}
                      >
                        {n.body}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
                        <span>{typeLabel(n.notification_type)}</span>
                        <span>·</span>
                        <span>{relativeTime(n.created_at)}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* 高优先级 toast（面板关闭时也可见） */}
      <div className="absolute top-12 right-0 flex flex-col gap-2 pointer-events-none">
        {!open &&
          toasts.map((n) => (
            <button
              type="button"
              key={n.id}
              onClick={() => {
                dismissToast(n.id)
                togglePanel()
              }}
              className="pointer-events-auto w-72 text-left glass rounded-xl shadow-lg
                border border-white/40 dark:border-white/10
                bg-white/90 dark:bg-gray-900/90 backdrop-blur-md
                px-3.5 py-2.5 animate-fade-in"
            >
              <div className="flex items-start gap-2">
                <span className="text-base leading-5">
                  {TYPE_ICONS[n.notification_type] ?? 'ℹ️'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                    {n.title}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
                    {n.body}
                  </p>
                </div>
              </div>
            </button>
          ))}
      </div>
    </div>
  )
}
