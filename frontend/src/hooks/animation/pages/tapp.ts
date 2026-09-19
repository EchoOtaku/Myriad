import { AnimationPriority } from '../types'
import { useStaggerAnimation } from '../useStaggerAnimation'

/** TAPP keeps its cadence/priority; admission and lifetime are shared globally. */
export function useTappStagger(
  index: number,
  { baseDelay = 60, enabled = true }: { baseDelay?: number, enabled?: boolean } = {},
) {
  return useStaggerAnimation({
    groupId: 'tapp-card',
    index,
    baseDelay,
    enabled,
    priority: AnimationPriority.COMPONENT,
  })
}
