import type {
  PerformanceCue,
  PerformanceDirective,
} from '../../../services/agent/types'
import type { MotionChannel } from './channels'
import { cueDriverPatch } from '../anime25drig/performanceMotion'

const HEAD_BODY_KEYS = ['body', 'armY', 'armPos'] as const

/** Cues whose expression offset drives the eyes away from where they look. */
const GAZE_INTENTS = new Set<PerformanceCue['intent']>(['think'])

export function cueOccupiesHeadBody(cue: PerformanceCue): boolean {
  const patch = cueDriverPatch(cue)
  return HEAD_BODY_KEYS.some((key) => typeof patch[key] === 'number')
}

export function cueOccupiesGaze(cue: PerformanceCue): boolean {
  return GAZE_INTENTS.has(cue.intent)
}

/**
 * Channels a Lite plan actually writes. Face plans do not take the body;
 * posture and body cues do. Mouth stays speech/music owned.
 * Timed occupancy lives in performanceLeaseWindows — this is classification.
 */
export function performanceOccupiedChannels(
  directive: PerformanceDirective,
): MotionChannel[] {
  const channels = new Set<MotionChannel>()
  const baseline = directive.plan.baseline
  if (baseline && baseline.posture !== 'neutral') channels.add('headBody')
  for (const cue of directive.plan.cues) {
    channels.add('expression')
    if (cueOccupiesHeadBody(cue)) channels.add('headBody')
    // `think` writes eyeX/eyeY; it was moving the eyes without owning gaze.
    if (cueOccupiesGaze(cue)) channels.add('gaze')
  }
  return [...channels]
}
