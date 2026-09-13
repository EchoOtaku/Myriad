/** 不进 skin。 */

import type { ToastType } from '../Toast'
import { ApiError } from '../../services/api'
import { showToast } from '../../utils/toastManager'
import { userFacingError } from '../../utils/userFacingError'

/** 手记编辑器通知共用一个槽，自动保存失败不会叠一串。 */
export const NOTE_TOAST_KEY = 'brew-note'

export function showNoteNotice(
  message: string | null,
  type: ToastType = 'error',
): void {
  if (!message) return
  showToast({
    message,
    type,
    replaceKey: NOTE_TOAST_KEY,
  })
}

/** 取消的请求不是错；429 已经由 httpRateLimitToast 提示过一次，不再每个请求叠一条。 */
export function brewErrorIsQuiet(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AbortError') return true
  return err instanceof ApiError && err.status === 429
}

export function reportBrewError(
  err: unknown,
  fallback: string,
  setError: (message: string) => void,
): void {
  if (brewErrorIsQuiet(err)) return
  console.error(fallback, err)
  setError(userFacingError(err, fallback))
}

export async function showBrewError(
  err: unknown,
  fallback: string,
): Promise<void> {
  if (brewErrorIsQuiet(err)) return
  console.error(fallback, err)
  try {
    const { showToast } = await import('../../utils/toastManager')
    showToast({
      message: userFacingError(err, fallback),
      type: 'error',
    })
  } catch {
    /* toast optional */
  }
}
