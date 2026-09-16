import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

import {
  isPageVisible,
  onVisibility,
  resume,
  runPageCleanup,
  startPage,
} from './core'
import { pageIdFromPath } from './pageId'

export { pageIdFromPath } from './pageId'

/** 路由顶层调用：切页时清旧页资源并 startPage。 */
export function useRouteScheduler(): void {
  const location = useLocation()
  const lastPageIdRef = useRef<string | null>(null)

  useEffect(() => {
    const pageId = pageIdFromPath(location.pathname)

    if (pageId === lastPageIdRef.current) return

    if (lastPageIdRef.current) {
      runPageCleanup(lastPageIdRef.current)
    }

    lastPageIdRef.current = pageId
    startPage(pageId)
  }, [location.pathname])

  useEffect(() => {
    if (isPageVisible()) resume()

    const unsubscribeVisibility = onVisibility((visible) => {
      if (visible) resume()
    })

    return () => {
      unsubscribeVisibility()
      if (lastPageIdRef.current) {
        runPageCleanup(lastPageIdRef.current)
      }
    }
  }, [])
}
