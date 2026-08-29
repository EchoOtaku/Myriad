import type {
  PerformanceCue,
  PerformanceDirective,
} from '../../../services/agent/types'
import type { MotionChannel } from './channels'
import { cueDriverPatch } from '../anime25drig/performanceMotion'

const HEAD_BODY_KEYS = ['body', 'armY', 'armPos'] as const

export function cueOccupiesHeadBody(cue: PerformanceCue): boolean {
  const patch = cueDriverPatch(cue)
  return HEAD_BODY_KEYS.some((key) => typeof patch[key] === 'number')
}

/**
 * Channels a Lite plan actually writes. Face plans do not take the body;
 * posture and body cues do. Mouth stays speech/music owned.
 * Timed occupancy lives in performanceLeaseWindows — this is classification.
 */
export function performanceOccupiedChannels(
  directive: PerformanceDirective,
): MotionChannel[] {
  const channels = new Set<MotionChannel>(['expression'])
  const baseline = directive.plan.baseline
  if (baseline && baseline.posture !== 'neutral') channels.add('headBody')
  for (const cue of directive.plan.cues) {
    if (cueOccupiesHeadBody(cue)) channels.add('headBody')
  }
  return [...channels]
}
