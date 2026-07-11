import type { NotificationCenterState } from '../hooks/useNotificationCenter'
import type { AppNotification } from '../services/notificationApi'
/**
 * 通知列表面板（智能岛「通知」tab 的内容区）
 *
 * iOS 通知中心模型：无已读概念，通知堆积直到被清除。
 * 页头为问候语 + 日期，右侧清理按钮先展示 X 图标，
 * 点击后变为文本二次确认（3 秒未确认自动还原）。
 * 点击通知直接跳转对应内容（任务类 → Arael 会话），无落点时展开详情。
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../contexts/I18nContext'
import { NOTIFICATION_TYPE_ICONS } from '../services/notificationApi'
import { getGreeting } from '../utils/dynamicContent'

/** 发信源图标底色（iOS App 图标风格的着色圆角方块） */
const SOURCE_ICON_BG: Record<string, string> = {
  task_completed: 'bg-green-500/15',
  task_failed: 'bg-red-500/15',
  heartbeat_result: 'bg-pink-500/15',
  mcp_server_status: 'bg-indigo-500/15',
  system_info: 'bg-gray-500/15',
  agent_clarification: 'bg-orange-500/15',
}

/** Apple 风格胶囊按钮基础样式 */
const PILL_BTN =
  'rounded-full px-3 py-1 text-xs font-medium transition-colors ' +
  'bg-black/5 text-gray-600 hover:bg-black/9 ' +
  'dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/15'

/** 通知的跳转目标 */
type NotifTarget = { kind: 'session'; sessionId: string } | null

/** 解析点击落点：任务类通知带 session_id 时跳回对应 Arael 会话 */
function resolveTarget(n: AppNotification): NotifTarget {
  if (
    n.notification_type === 'task_completed' ||
    n.notification_type === 'task_failed' ||
    n.notification_type === 'agent_clarification'
  ) {
    const sid = n.metadata?.session_id
    if (typeof sid === 'string' && sid) {
      return { kind: 'session', sessionId: sid }
    }
  }
  return null
}

interface Props {
  center: NotificationCenterState
  /** 填满父容器高度（覆盖层模式：继承控制面板高度，列表内部滚动） */
  fill?: boolean
  /** 打开 Arael 会话（由 GlobalControlPanel 注入：收起面板 + 派发打开事件） */
  onOpenSession?: (sessionId: string) => void
}

function NotificationPanelList({ center, fill, onOpenSession }: Props) {
  const { t, format, locale } = useI18n()
  const { items, removeItem, clearAll } = center

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [notifPermission, setNotifPermission] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  )
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // tab 切换 / 面板收起会卸载本组件，确认倒计时须随之清理
  useEffect(
    () => () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    },
    [],
  )

  // 问候语 + 本地化日期（组件随 tab 打开重挂载，时点足够新鲜）
  const { greetingText, dateText } = useMemo(() => {
    const greeting = getGreeting(
      undefined,
      {
        morning: t.greeting?.morning ?? 'Good morning',
        forenoon: t.greeting?.forenoon ?? t.greeting?.morning ?? 'Good morning',
        noon: t.greeting?.noon ?? 'Good afternoon',
        afternoon: t.greeting?.afternoon ?? 'Good afternoon',
        dusk: t.greeting?.dusk ?? t.greeting?.evening ?? 'Good evening',
        evening: t.greeting?.evening ?? 'Good evening',
        night: t.greeting?.night ?? 'Good night',
      },
      locale,
    )
    const date = new Intl.DateTimeFormat(locale, {
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(new Date())
    return { greetingText: greeting.text, dateText: date }
  }, [t, locale])

  const handleClearAll = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true)
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      confirmTimerRef.current = setTimeout(setConfirmClear, 3000, false)
      return
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
    setConfirmClear(false)
    void clearAll()
  }, [confirmClear, clearAll])

  const requestSystemNotif = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    const perm = await Notification.requestPermission()
    setNotifPermission(perm)
  }, [])

  const handleItemClick = useCallback(
    (n: AppNotification) => {
      const target = resolveTarget(n)
      if (target && onOpenSession) {
        onOpenSession(target.sessionId)
        return
      }
      // 无落点：展开/收起详情
      setExpandedId((prev) => (prev === n.id ? null : n.id))
    },
    [onOpenSession],
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

  /** 发信源名称（iOS 通知头行的 App 名位置） */
  const sourceLabels = useMemo<Record<string, string>>(
    () => ({
      task_completed: t.notificationCenter.sourceAgent,
      task_failed: t.notificationCenter.sourceAgent,
      agent_clarification: t.notificationCenter.sourceAgent,
      heartbeat_result: t.notificationCenter.sourceHeartbeat,
      mcp_server_status: t.notificationCenter.sourceMcp,
      system_info: t.notificationCenter.sourceSystem,
    }),
    [t],
  )

  return (
    <div className={`flex flex-col min-h-0 ${fill ? 'h-full' : ''}`}>
      {/* 页头：问候语 + 日期，右侧为系统通知开关与清理按钮 */}
      <div className="flex items-start justify-between gap-2 px-0.5 pb-2.5">
        <div className="min-w-0 leading-tight">
          <div className="text-xs font-medium text-gray-400 dark:text-gray-500">
            {dateText}
          </div>
          <div className="truncate text-lg font-bold text-gray-800 dark:text-gray-100">
            {greetingText}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {notifPermission === 'default' && (
            <button
              type="button"
              onClick={() => void requestSystemNotif()}
              className={PILL_BTN}
            >
              {t.notificationCenter.enableSystemNotif}
            </button>
          )}
          {items.length > 0 &&
            (confirmClear ? (
              // 二次确认态：与图标态同高（h-7），仅内容由图标换为文本，
              // 保持中性配色（不变红）——语气克制，符合 Apple 的清除确认调性
              <button
                type="button"
                onClick={handleClearAll}
                className="flex h-7 items-center rounded-full bg-black/5 px-3
                  text-xs font-medium text-gray-600 transition-colors hover:bg-black/9
                  dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/15"
              >
                {t.notificationCenter.clearConfirm}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleClearAll}
                aria-label={t.notificationCenter.clearAll}
                className="flex h-7 w-7 items-center justify-center rounded-full
                  bg-black/5 text-gray-500 transition-colors hover:bg-black/9
                  dark:bg-white/10 dark:text-gray-400 dark:hover:bg-white/15"
              >
                {/* 清空全部：用簸箕/垃圾桶图标，与单条删除的 X 区分语义 */}
                <svg
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                  />
                </svg>
              </button>
            ))}
        </div>
      </div>

      {/* 列表：覆盖层模式填满剩余空间内部滚动，否则回退到视口上限 */}
      <div
        className={`flex-1 overflow-y-auto overscroll-contain ${
          fill ? 'min-h-0' : 'max-h-[50vh]'
        }`}
      >
        {items.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
            {t.notificationCenter.empty}
          </div>
        ) : (
          items.map((n) => (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              onClick={() => handleItemClick(n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  handleItemClick(n)
                }
              }}
              className="group relative mb-1.5 flex w-full cursor-pointer items-start gap-2.5
                rounded-xl px-2.5 py-2.5 text-left transition-colors
                bg-black/3 hover:bg-black/6
                dark:bg-white/4 dark:hover:bg-white/8"
            >
              {/* 发信源图标：着色圆角方块 */}
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-base leading-none ${
                  SOURCE_ICON_BG[n.notification_type] ?? 'bg-gray-500/15'
                }`}
              >
                {NOTIFICATION_TYPE_ICONS[n.notification_type] ?? 'ℹ️'}
              </span>

              <div className="min-w-0 flex-1">
                {/* 头行：发信源名 + 时间 */}
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[10px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    {sourceLabels[n.notification_type] ??
                      t.notificationCenter.sourceSystem}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                    {relativeTime(n.created_at)}
                  </span>
                </div>

                <div className="mt-0.5 truncate text-sm font-semibold text-gray-800 dark:text-gray-100">
                  {n.title}
                </div>
                <p
                  className={`mt-0.5 text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap break-words ${
                    expandedId === n.id ? '' : 'line-clamp-2'
                  }`}
                >
                  {n.body}
                </p>
              </div>

              <button
                type="button"
                aria-label={t.common.delete}
                onClick={(e) => {
                  e.stopPropagation()
                  void removeItem(n)
                }}
                className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full
                  text-gray-300 dark:text-gray-600 hover:text-red-500 dark:hover:text-red-400
                  hover:bg-red-50 dark:hover:bg-red-950/40
                  opacity-0 group-hover:opacity-100 focus:opacity-100 max-sm:opacity-60
                  transition-all"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// memo：面板展开且音乐播放时父组件（GlobalControlPanel）每秒重渲染，
// center 已由 hook 端 useMemo 稳定，通知无变化时整个列表跳过重渲染
export default memo(NotificationPanelList)
