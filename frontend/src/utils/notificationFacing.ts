import type { AppNotification } from '../services/notificationApi'
import { currentCopy } from '../i18n/localeCopy'
import { userFacingError } from './userFacingError'

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? `{${key}}`)
}

function metaString(
  notification: AppNotification,
  key: string,
): string {
  const value = notification.metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

/** Localized title for the notification tray / toast / island. */
export function notificationFacingTitle(notification: AppNotification): string {
  const t = currentCopy().errors
  const eventKey =
    typeof notification.metadata?.event_key === 'string'
      ? notification.metadata.event_key
      : ''
  const name =
    metaString(notification, 'source_name') ||
    metaString(notification, 'platform') ||
    metaString(notification, 'server_id') ||
    metaString(notification, 'tapp_id')

  switch (eventKey) {
    case 'brew.source_error':
      return fill(t.noticeBrewSourceFailed, { name: name || 'RSS' })
    case 'platform.sync.failed':
      return fill(t.noticePlatformSyncFailed, { name: name || 'Steam' })
    case 'mcp.disconnected':
      return fill(t.noticeMcpFailed, { name: name || 'MCP' })
    case 'mcp.connected':
      return fill(t.noticeMcpConnected, { name: name || 'MCP' })
    case 'tapp.error':
      return t.noticeScheduleFailed
    case 'updater.succeeded':
      return t.noticeUpdaterSucceeded
    case 'updater.failed':
      return t.noticeUpdaterFailed
    case 'updater.needs_manual':
      return t.noticeUpdaterNeedsManual
    case 'updater.running':
      return t.noticeUpdaterRunning
    case 'updater.unknown':
      return t.noticeUpdaterUnknown
    case 'updater.submitted':
      return t.noticeUpdaterSubmitted
    default:
      break
  }

  const raw = notification.title || ''
  if (/连续抓取失败/.test(raw)) {
    return fill(t.noticeBrewSourceFailed, { name: name || raw.replace(/连续抓取失败/, '').trim() || 'RSS' })
  }
  if (/自动刷新失败/.test(raw)) {
    return fill(t.noticePlatformSyncFailed, { name: name || raw.replace(/自动刷新失败/, '').trim() })
  }
  if (/连接失败/.test(raw) && /MCP/.test(raw)) {
    return fill(t.noticeMcpFailed, { name: name || 'MCP' })
  }
  if (/定时任务失败/.test(raw)) return t.noticeScheduleFailed
  if (/系统更新任务失败/.test(raw)) return t.noticeUpdaterFailed
  if (/系统更新需要人工/.test(raw)) return t.noticeUpdaterNeedsManual
  if (/Tapp 通知/.test(raw)) return t.noticeTapp
  return raw
}

/** Localized, diagnosable body — strips leftover dumps. */
export function notificationFacingBody(notification: AppNotification): string {
  return userFacingError(notification.body, notification.body)
}
