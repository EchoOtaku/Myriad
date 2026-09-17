/** Homepage tiles share the overlay cache; unmount only drops the apply. */

import type { PhantasiSource } from '../../../types/phantasi'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getSources } from '../../../services/phantasiApi'
import { RequestTurn } from '../logic/requestTurn'

export function useWidgetSources(
  isPreview: boolean,
  failLabel: string,
): PhantasiSource[] {
  const [sources, setSources] = useState<PhantasiSource[]>([])
  const turns = useRef(new RequestTurn())

  const load = useCallback(async () => {
    if (isPreview) return
    const signal = turns.current.begin()
    try {
      const next = await getSources()
      if (!signal.aborted) setSources(next)
    } catch (error) {
      if (!signal.aborted) {
        console.error(`${failLabel} failed to load sources:`, error)
      }
    }
  }, [failLabel, isPreview])

  useEffect(() => {
    void load()
    return () => turns.current.cancel()
  }, [load])

  return sources
}
