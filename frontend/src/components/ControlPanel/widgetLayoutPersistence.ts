import type { WidgetConfig } from '../widgetGridTypes'
import { API_URL } from '../../config'
import { currentCopy } from '../../i18n/localeCopy'
import { authSubject } from '../../utils/authSubject'
import { awaitAbortable } from '../../utils/awaitAbortable'
import { getCSRFToken } from '../../utils/csrf'
import { DebouncedLatestWriter } from '../../utils/debouncedLatestWriter'
import { formatUserFacingError } from '../../utils/formatUserFacingError'
import { clearDedupCache } from '../../utils/requestDedup'
import { showError } from '../../utils/toastManager'

let writer: { signal: AbortSignal, queue: DebouncedLatestWriter<string> } | null = null

/** Saving belongs to the account, and survives attention moving away from the panel. */
export function saveControlPanelLayout(layout: WidgetConfig[], rows: number): void {
  const signal = authSubject.signal
  if (!writer || writer.signal !== signal) {
    writer = { signal, queue: new DebouncedLatestWriter({
      signal,
      delay: 500,
      write: async (body: string, owner: AbortSignal) => {
        owner.throwIfAborted()
        const token = await awaitAbortable(getCSRFToken(true), owner)
        owner.throwIfAborted()
        if (!token) throw new Error(currentCopy().errors.csrfUnavailable)
        const response = await fetch(`${API_URL}/api/config/control-panel`, {
          method: 'POST',
          credentials: 'include',
          signal: owner,
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
          body,
        })
        if (!response.ok) throw new Error(`Failed to save control panel: HTTP ${response.status}`)
        owner.throwIfAborted()
        clearDedupCache(`${API_URL}/api/config/ui`)
      },
      onError: async (error, owner) => {
        const message = await formatUserFacingError(error, currentCopy().errors.controlPanelSaveFailed)
        if (!owner.aborted) showError(message)
      },
    }) }
  }
  // Freeze the snapshot now; later edits must not mutate the queued request.
  writer.queue.enqueue(JSON.stringify({ control_panel_layout: JSON.stringify(layout), control_panel_rows: rows }))
}
