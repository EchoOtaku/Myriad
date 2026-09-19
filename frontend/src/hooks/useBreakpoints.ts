import { useMemo } from 'react'
import { VIEWPORT_MQ } from '../utils/viewportBands'
import { useMediaQuery } from './useMediaQuery'

export function useBreakpoints() {
  const isMobile = useMediaQuery(VIEWPORT_MQ.phone)
  const isTablet = useMediaQuery(VIEWPORT_MQ.tablet)
  const isDesktop = useMediaQuery(VIEWPORT_MQ.desktop)
  const isLargeDesktop = useMediaQuery('(min-width: 1280px)')

  return useMemo(
    () => ({
      isMobile,
      isTablet,
      isDesktop,
      isLargeDesktop,
      isTouchDevice: isMobile || isTablet,
    }),
    [isMobile, isTablet, isDesktop, isLargeDesktop],
  )
}

/** Keep the server's desktop layout during hydration; client mounts read the actual band. */
export function useDesktopLayoutBand(): boolean {
  return useMediaQuery(VIEWPORT_MQ.desktop, true)
}
