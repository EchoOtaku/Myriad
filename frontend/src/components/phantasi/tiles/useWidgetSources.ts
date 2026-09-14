/** Homepage tiles share the catalog cache; unmount only drops the apply. */

import type { PhantasiSource } from '../../../types/phantasi'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useHomeVisibilityInterval } from '../../../hooks/animation'
import { getSources } from '../../../services/phantasiApi'
import { RequestTurn } from '../logic/requestTurn'

export function useWidgetSources(
  isPreview: boolean,
  intervalMs: number,
  failLabel: string,
): PhantasiSource[] {
  const [sources, setSources] = useState<PhantasiSource[]>([])
  const turns = useRef(new RequestTurn())

  const load = useCallback(async () => {
    const signal = turns.current.begin()
    try {
      const next = await getSources()
      if (!signal.aborted) setSources(next)
    } catch (error) {
      if (!signal.aborted) {
        console.error(`${failLabel} failed to load sources:`, error)
      }
    }
  }, [failLabel])

  useEffect(() => {
    void load()
    return () => turns.current.cancel()
  }, [load])

  useHomeVisibilityInterval(load, intervalMs, !isPreview)
  return sources
}
