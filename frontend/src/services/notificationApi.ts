/**
 * 通知中心 API
 *
 * 对接后端 /api/agent/notifications 系列端点：
 * - SSE 实时流（EventSource，cookie 认证）
 * - 历史列表 / 未读数
 * - 单条已读 / 全部已读
 */
import { API_URL } from '../config'
import apiService from './api'

export type NotificationType =
  | 'task_completed'
  | 'task_failed'
  | 'heartbeat_result'
  | 'mcp_server_status'
  | 'system_info'
  | 'agent_clarification'

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent'

export interface AppNotification {
  id: string
  notification_type: NotificationType
  priority: NotificationPriority
  title: string
  body: string
  user_id?: number | null
  metadata?: Record<string, unknown> | null
  created_at: string
  read: boolean
}

export interface NotificationListResponse {
  notifications: AppNotification[]
  unread_count: number
  total: number
}

/** 通知类型 → 展示图标（智能岛轮播 / 通知列表共用；后端新增类型时走兜底图标） */
export const NOTIFICATION_TYPE_ICONS: Record<string, string> = {
  task_completed: '✅',
  task_failed: '❌',
  heartbeat_result: '💓',
  mcp_server_status: '🔌',
  system_info: 'ℹ️',
  agent_clarification: '❓',
}

/** SSE 流事件（read_all / cleared 由后端按 user_id 过滤，只发给操作者本人） */
export type NotificationStreamEvent =
  | { event: 'init'; unread_count: number }
  | { event: 'new_notification'; notification: AppNotification }
  | { event: 'notification_read'; id: string }
  | { event: 'notifications_read_all' }
  | { event: 'notification_deleted'; id: string }
  | { event: 'notifications_cleared' }

const BASE = '/agent/notifications'

export const notificationApi = {
  async list(limit = 50): Promise<NotificationListResponse> {
    return apiService.get<NotificationListResponse>(`${BASE}?limit=${limit}`)
  },

  async remove(id: string): Promise<{ success: boolean }> {
    return apiService.delete(`${BASE}/${encodeURIComponent(id)}`)
  },

  async clearAll(): Promise<{ success: boolean; deleted: number }> {
    return apiService.post(`${BASE}/clear`)
  },

  /**
   * 订阅实时通知流。返回关闭函数。
   * EventSource 断线自动重连；认证走 cookie（withCredentials）。
   */
  subscribe(onEvent: (event: NotificationStreamEvent) => void): () => void {
    const source = new EventSource(`${API_URL}/api${BASE}/stream`, {
      withCredentials: true,
    })

    source.onmessage = (msg) => {
      if (!msg.data) return
      try {
        const event = JSON.parse(msg.data) as NotificationStreamEvent
        onEvent(event)
      } catch {
        // 忽略无法解析的心跳/保活行
      }
    }

    return () => source.close()
  },
}

export default notificationApi
