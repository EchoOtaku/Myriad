import { useEffect } from 'react'

import { isJournalAppPath } from './logic/journalRoutes'

export function usePhantasiNavExpand(setExpanded: (open: boolean) => void) {
  useEffect(() => {
    const onExpand = (event: Event) => {
      const path = (event as CustomEvent<{ path: string }>).detail?.path
      if (path && isJournalAppPath(path)) {
        setExpanded(true)
      }
    }
    window.addEventListener('nav-expand-secondary', onExpand)
    return () => {
      window.removeEventListener('nav-expand-secondary', onExpand)
    }
  }, [setExpanded])
}
