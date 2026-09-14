/** 订阅列表上的抓取状态。入口和笔记源不抓，不算成败。 */

import { WORKBENCH_HOME_FAIL_SOURCE_ERRORS } from './workbenchHome'

export type WorkbenchSourceStatus =
  | 'idle'
  | 'paused'
  | 'refreshing'
  | 'failed'
  | 'error'
  | 'pending'
  | 'ok'

export type WorkbenchSourceStatusTone =
  | 'success'
  | 'warn'
  | 'danger'
  | 'muted'
  | 'active'

export function workbenchSourceFetches(source: {
  source_type: string
}): boolean {
  return source.source_type !== 'link' && source.source_type !== 'note'
}

export function workbenchSourceStatus(
  source: {
    source_type: string
    enabled: boolean
    last_error: string | null
    error_count: number
    last_success_at: number | null
  },
  refreshing = false,
): WorkbenchSourceStatus {
  if (!workbenchSourceFetches(source)) return 'idle'
  if (refreshing) return 'refreshing'
  if (!source.enabled) return 'paused'
  if (
    source.last_error &&
    source.error_count >= WORKBENCH_HOME_FAIL_SOURCE_ERRORS
  ) {
    return 'failed'
  }
  if (source.last_error) return 'error'
  if (source.last_success_at == null) return 'pending'
  return 'ok'
}

export function workbenchSourceStatusTone(
  status: WorkbenchSourceStatus,
): WorkbenchSourceStatusTone | null {
  if (status === 'ok') return 'success'
  if (status === 'paused' || status === 'error') return 'warn'
  if (status === 'failed') return 'danger'
  if (status === 'pending') return 'muted'
  if (status === 'refreshing') return 'active'
  return null
}
