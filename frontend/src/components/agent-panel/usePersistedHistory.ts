import type { AgentMessage } from './agentMessages'
import { useEffect, useState } from 'react'
import { agentService } from '../../services/agent'
import { authSubject } from '../../utils/authSubject'
import { releaseMessageBody } from './messageBody'
import { boundMessage } from './messageBudget'
import { prepareChatBody } from './prepareChatBody'
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
    const stored: import('./messageBody').MessageBodyRef[] = []
    void agentService
      .getSessionMessages(
        selected.sessionId,
        selected.page,
        PERSISTED_HISTORY_PAGE,
        signal,
      )
      .then(async rows => {
        const restored: AgentMessage[] = []
        for (const row of rows) {
          const message = await prepareChatBody(restoreSessionMessage(row, selected.sessionId), signal)
          for (const body of [message.body, message.taskExecution?.reasoningBody]) { if (body) stored.push(body)
}
          if (signal.aborted) {
            for (const body of stored) void releaseMessageBody(body).catch(() => {})
            return
          }
          restored.push(projectAgentMessage(boundMessage(message)))
        }
        if (!signal.aborted) setResult({ selection: selected, rows: restored, error: false })
      })
      .catch(() => {
        for (const body of stored) void releaseMessageBody(body).catch(() => {})
        stored.length = 0
        if (!signal.aborted)
          setResult({ selection: selected, rows: [], error: true })
      })
    return () => {
      controller.abort()
      for (const body of stored) void releaseMessageBody(body).catch(() => {})
    }
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
