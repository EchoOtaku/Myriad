import { useCallback, useSyncExternalStore } from 'react'
import { SharedMediaQueryStore } from '../utils/sharedMediaQuery'

const mediaQueries = new SharedMediaQueryStore(query =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null,
)

export function useMediaQuery(query: string, serverMatches = false): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => mediaQueries.subscribe(query, onStoreChange),
    [query],
  )
  const getSnapshot = useCallback(() => mediaQueries.read(query), [query])
  const getServerSnapshot = useCallback(() => serverMatches, [serverMatches])
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
