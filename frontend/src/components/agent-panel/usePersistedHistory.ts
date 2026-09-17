import type { AgentMessage } from './agentMessages'
import { useEffect, useState } from 'react'
import { agentService } from '../../services/agent'
import { authSubject } from '../../utils/authSubject'
import { boundMessage } from './messageBudget'
import { projectAgentMessage } from './projectAgentMessage'
import { restoreSessionMessage } from './sessionHistoryMessage'

export const PERSISTED_HISTORY_PAGE = 40

/** A single disk-backed page, separate from the live execution state. */
export function usePersistedHistory(sessionId: string | null) {
  const [selection, setSelection] = useState<{
    sessionId: string
    page: number
  } | null>(null)
  const [result, setResult] = useState<{
    selection: typeof selection
    rows: AgentMessage[]
    error: boolean
  } | null>(null)
  const selected = selection?.sessionId === sessionId ? selection : null
  useEffect(() => {
    if (!selected) {
      setResult(null)
      return
    }
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, authSubject.signal])
    setResult(null)
    void agentService
      .getSessionMessages(
        selected.sessionId,
        selected.page,
        PERSISTED_HISTORY_PAGE,
        signal,
      )
      .then((rows) => {
        if (signal.aborted) return
        setResult({
          selection: selected,
          rows: rows.map((row) =>
            projectAgentMessage(
              boundMessage(restoreSessionMessage(row, selected.sessionId)),
            ),
          ),
          error: false,
        })
      })
      .catch(() => {
        if (!signal.aborted)
          setResult({ selection: selected, rows: [], error: true })
      })
    return () => controller.abort()
  }, [selected])
  const current = result?.selection === selected ? result : null
  return {
    page: selected?.page ?? null,
    rows: current?.rows ?? [],
    loading: !!selected && !current,
    error: current?.error ?? false,
    hasNext: current?.rows.length === PERSISTED_HISTORY_PAGE,
    select: (page: number | null) =>
      setSelection(sessionId && page ? { sessionId, page } : null),
  }
}
