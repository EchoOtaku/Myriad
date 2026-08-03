/**
 * Multi-window query + sticky session (keep multi tree when viewport shrinks).
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useBreakpoints } from '../../hooks/useSharedEventListener'
import { isWebKit } from '../../utils/platformDetect'

export function useTappMultiWindowSession(): boolean {
  const [searchParams] = useSearchParams()
  const { isMobile } = useBreakpoints()
  const multiParam = searchParams.get('multi') === 'true' && !isWebKit

  // Once multi mounted on a wide viewport, keep the multi tree when the window
  // shrinks — swapping would destroy iframes and lose Tapp state.
  const [multiSessionActive, setMultiSessionActive] = useState(false)
  useEffect(() => {
    if (multiParam && !isMobile) {
      setMultiSessionActive(true)
    }
    if (!multiParam) {
      setMultiSessionActive(false)
    }
  }, [multiParam, isMobile])

  return multiParam && (!isMobile || multiSessionActive)
}
