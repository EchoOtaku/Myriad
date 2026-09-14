import { useEffect } from 'react'

export function usePhantasiNavExpand(setExpanded: (open: boolean) => void) {
  useEffect(() => {
    const onExpand = (event: Event) => {
      const path = (event as CustomEvent<{ path: string }>).detail?.path
      if (path === '/phantasi') setExpanded(true)
    }
    window.addEventListener('nav-expand-secondary', onExpand)
    return () => {
      window.removeEventListener('nav-expand-secondary', onExpand)
    }
  }, [setExpanded])
}
