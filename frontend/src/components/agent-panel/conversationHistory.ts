import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

const HISTORY_PAGE_SIZE = 40

export function historyStart(count: number): number {
  return Math.max(0, count - HISTORY_PAGE_SIZE)
}

export function revealEarlierHistory(start: number): number {
  return Math.max(0, start - HISTORY_PAGE_SIZE)
}

/** Keep revealed rows mounted so variable-height cards retain their pan anchors. */
export function useConversationHistory(ids: readonly string[]) {
  const identity = ids[0]
  const [window, setWindow] = useState(() => ({
    identity,
    start: historyStart(ids.length),
  }))
  const pending = useRef(false)
  const start =
    window.identity === identity ? window.start : historyStart(ids.length)
  if (window.identity !== identity) setWindow({ identity, start })
  useLayoutEffect(() => {
    pending.current = false
  }, [identity, start])
  const onNearStart = useCallback(() => {
    if (pending.current || start === 0) return
    pending.current = true
    setWindow({ identity, start: revealEarlierHistory(start) })
  }, [identity, start])
  const visibleIds = useMemo(() => ids.slice(start), [ids, start])
  return { visibleIds, onNearStart }
}
