import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

const HISTORY_PAGE_SIZE = 40
const HISTORY_WINDOW_SIZE = 80

export function historyStart(count: number): number {
  return Math.max(0, count - HISTORY_PAGE_SIZE)
}

export function revealEarlierHistory(start: number): number {
  return Math.max(0, start - HISTORY_PAGE_SIZE)
}

export function conversationWindow(start: number, count: number) {
  return { start, end: Math.min(count, start + HISTORY_WINDOW_SIZE) }
}

/** Both directions replace a bounded page; newer messages follow the live tail. */
export function useConversationHistory(ids: readonly string[]) {
  const identity = ids[0]
  const [window, setWindow] = useState(() => ({ identity, start: historyStart(ids.length), count: ids.length }))
  const pending = useRef(false)
  const follow = window.start + HISTORY_WINDOW_SIZE >= window.count
  const start = window.identity !== identity || (follow && window.count !== ids.length)
    ? historyStart(ids.length) : window.start
  if (window.identity !== identity || window.count !== ids.length) {
    setWindow({ identity, start, count: ids.length })
  }
  useLayoutEffect(() => { pending.current = false }, [identity, start])
  const onNearStart = useCallback(() => {
    if (pending.current || start === 0) return
    pending.current = true
    setWindow({ identity, start: revealEarlierHistory(start), count: ids.length })
  }, [identity, start, ids.length])
  const onNewer = useCallback(() => {
    setWindow({ identity, start: Math.min(historyStart(ids.length), start + HISTORY_PAGE_SIZE), count: ids.length })
  }, [identity, start, ids.length])
  const { end } = conversationWindow(start, ids.length)
  const visibleIds = useMemo(() => ids.slice(start, end), [ids, start, end])
  return { visibleIds, onNearStart, onNewer, hasNewer: end < ids.length }
}
