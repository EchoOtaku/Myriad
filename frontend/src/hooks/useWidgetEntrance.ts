import type { EntrancePhase } from '../lib/motionEntrance'
import { useCallback, useEffect, useState } from 'react'
import { useStaggerAnimation } from './animation/useStaggerAnimation'

/** Own the grid's one-shot admission/completion lifecycle, not content policy. */
export function useWidgetEntrance(index: number, disabled: boolean) {
  const [complete, setComplete] = useState(disabled)
  const { canAnimate, onComplete: completeSlot } = useStaggerAnimation({
    groupId: 'widget-grid',
    index,
    baseDelay: 115,
    enabled: !disabled,
  })

  // Content already shown in edit/reduced mode must not replay on a preference change.
  useEffect(() => {
    if (disabled) setComplete(true)
  }, [disabled])

  const onComplete = useCallback(() => {
    completeSlot()
    if (canAnimate) setComplete(true)
  }, [canAnimate, completeSlot])

  const phase: EntrancePhase = disabled
    ? 'disabled'
    : complete
      ? 'complete'
      : canAnimate
        ? 'running'
        : 'waiting'

  return { phase, canAnimate, onComplete }
}
