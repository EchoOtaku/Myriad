import { API_URL } from '../config'
import { currentCopy } from '../i18n/localeCopy'
import { authSubject } from '../utils/authSubject'
import { DebouncedLatestWriter } from '../utils/debouncedLatestWriter'
import { formatUserFacingError } from '../utils/formatUserFacingError'
import { clearDedupCache } from '../utils/requestDedup'
import { showError } from '../utils/toastManager'

export type DashboardAppearancePatch = Partial<{
  title_font: string
  title_font_size: number
  title_color: string
  widget_theme: string
}>

type SaveErrorKey = 'titleStyleSaveFailed' | 'widgetThemeSaveFailed'

function createWriter(signal: AbortSignal) {
  let pending: DashboardAppearancePatch = {}
  let activeErrorKey: SaveErrorKey = 'titleStyleSaveFailed'
  const queue = new DebouncedLatestWriter<{ settings: DashboardAppearancePatch, token: string, errorKey: SaveErrorKey }>({
    signal,
    delay: 500,
    write: async ({ settings, token, errorKey }, owner) => {
      pending = {}
      activeErrorKey = errorKey
      owner.throwIfAborted()
      const response = await fetch(`${API_URL}/api/config/dashboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
        credentials: 'include',
        signal: owner,
        body: JSON.stringify(settings),
      })
      if (!response.ok) throw new Error(`Failed to save dashboard appearance: HTTP ${response.status}`)
      owner.throwIfAborted()
      clearDedupCache(`${API_URL}/api/config/ui`)
    },
    onError: async (error, owner) => {
      const message = await formatUserFacingError(error, currentCopy().errors[activeErrorKey])
      if (!owner.aborted) showError(message)
    },
  })
  return {
    signal,
    enqueue(settings: DashboardAppearancePatch, token: string, errorKey: SaveErrorKey) {
      pending = { ...pending, ...settings }
      queue.enqueue({ settings: pending, token, errorKey })
    },
  }
}

let writer: ReturnType<typeof createWriter> | null = null

/** Account-owned writes survive panel closure; a subject change cancels pending work. */
export function saveDashboardAppearance(csrfToken: string, settings: DashboardAppearancePatch, errorKey: SaveErrorKey, owner = authSubject.signal) {
  if (owner.aborted || owner !== authSubject.signal) return
  if (!writer || writer.signal !== owner) writer = createWriter(owner)
  writer.enqueue(settings, csrfToken, errorKey)
}
