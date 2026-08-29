import type { PerformanceDirective } from '../../../services/agent/types'
import type { MotionChannel } from './channels'
import { cueDriverPatch } from '../anime25drig/performanceMotion'

const HEAD_BODY_KEYS = ['body', 'armY', 'armPos'] as const

/**
 * Channels a Lite plan actually occupies. Face plans do not take the body;
 * posture and body cues do. Mouth stays speech/music owned.
 */
export function performanceOccupiedChannels(
  directive: PerformanceDirective,
): MotionChannel[] {
  const channels = new Set<MotionChannel>(['expression'])
  const baseline = directive.plan.baseline
  if (baseline && baseline.posture !== 'neutral') channels.add('headBody')
  for (const cue of directive.plan.cues) {
    const patch = cueDriverPatch(cue)
    if (HEAD_BODY_KEYS.some((key) => typeof patch[key] === 'number')) {
      channels.add('headBody')
    }
  }
  return [...channels]
}
