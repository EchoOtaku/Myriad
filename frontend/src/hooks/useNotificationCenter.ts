import type {
  AppNotification,
  NotificationStreamEvent,
} from '../services/notificationApi'
/**
 * 通知中心状态 hook
 *
 * 封装 SSE 订阅、历史加载与删除/清空操作。
 * 无已读概念（iOS 通知中心模型）：通知堆积直到被清除，计数即列表长度。
 * 由 GlobalControlPanel（智能岛）独占消费——保持单一 SSE 连接。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import notificationApi from '../services/notificationApi'

/** 列表长度上限：历史加载 50 条，SSE 增量在此封顶，防止长会话无限增长 */
const MAX_ITEMS = 100

export interface UseNotificationCenterOptions {
  /** 是否启用（未登录时应为 false） */
  enabled: boolean
  /** 新通知到达回调（用于轮播展示 / 系统通知 / toast） */
  onNew?: (notification: AppNotification) => void
}

export function useNotificationCenter({
  enabled,
  onNew,
}: UseNotificationCenterOptions) {
  const [items, setItems] = useState<AppNotification[]>([])
  const [loaded, setLoaded] = useState(false)
  const onNewRef = useRef(onNew)
  onNewRef.current = onNew
  // enabled 镜像：丢弃登出后才到达的历史响应，避免污染下一个用户的状态
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  // SSE 订阅（断线自动重连）
  useEffect(() => {
    if (!enabled) {
      // 登出即清空，避免下一个登录用户短暂看到上一用户的通知
      setItems([])
      setLoaded(false)
      return
    }
    const close = notificationApi.subscribe(
      (event: NotificationStreamEvent) => {
        if (event.event === 'new_notification') {
          const n = event.notification
          setItems((prev) =>
            prev.some((p) => p.id === n.id)
              ? prev
              : [n, ...prev].slice(0, MAX_ITEMS),
          )
          onNewRef.current?.(n)
        } else if (event.event === 'notification_deleted') {
          setItems((prev) => prev.filter((p) => p.id !== event.id))
        } else if (event.event === 'notifications_cleared') {
          setItems([])
        }
        // init / notification_read / notifications_read_all：
        // 已读概念已移除，忽略（后端事件保留以兼容其他客户端）
      },
    )
    return close
  }, [enabled])

  const loadHistory = useCallback(async () => {
    try {
      const res = await notificationApi.list(50)
      if (!enabledRef.current) return
      setItems(res.notifications)
      setLoaded(true)
    } catch (e) {
      console.warn('[NotificationCenter] Failed to load history:', e)
    }
  }, [])

  // 启用即拉取历史：此前列表要等打开通知页才加载，
  // 页面刷新后的历史通知完全无感知
  useEffect(() => {
    if (enabled) void loadHistory()
  }, [enabled, loadHistory])

  const removeItem = useCallback(async (n: AppNotification) => {
    setItems((prev) => prev.filter((p) => p.id !== n.id))
    try {
      await notificationApi.remove(n.id)
    } catch (e) {
      console.warn('[NotificationCenter] delete failed:', e)
    }
  }, [])

  const clearAll = useCallback(async () => {
    setItems([])
    try {
      await notificationApi.clearAll()
    } catch (e) {
      console.warn('[NotificationCenter] clear all failed:', e)
    }
  }, [])

  // 稳定引用：所有操作均为 useCallback([])，仅数据变化时才产生新对象，
  // 使下游 NotificationPanelList 的 memo 生效
  return useMemo(
    () => ({
      items,
      loaded,
      loadHistory,
      removeItem,
      clearAll,
    }),
    [items, loaded, loadHistory, removeItem, clearAll],
  )
}

export type NotificationCenterState = ReturnType<typeof useNotificationCenter>
