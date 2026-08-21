import type { GeneratedMotionPhase } from './generation'
import type { MotionInterruptPolicy } from './planner'
import type {
  CompanionRigManifest,
  RigClip,
  RigPoint,
  RigTransform,
} from './types'
import { copyPoseInto, mixPoseByMaskInto } from './animation'

export type CompanionActivity = 'idle' | 'thinking' | 'talking'
export type MotionChannel = 'face' | 'head' | 'upper' | 'full'

export const RIG_ACTION_PRIORITY = {
  ambientFidget: 12,
  pointerGaze: 40,
  greeting: 80,
  wake: 1_000,
} as const

export function isAmbientFidgetPriority(priority: number): boolean {
  return priority <= RIG_ACTION_PRIORITY.ambientFidget
}

export function pointerGazeOwnsBone(
  activePriority: number | undefined,
): boolean {
  return (
    (activePriority ?? Number.NEGATIVE_INFINITY) <
    RIG_ACTION_PRIORITY.pointerGaze
  )
}

export function ambientFidgetAllowed(
  wakeWeight: number,
  settleDelayMs = 0,
  greetingActive = false,
  idleGlanceActive = false,
  restStillness = 0,
): boolean {
  return (
    wakeWeight >= 1 &&
    settleDelayMs <= 0 &&
    !greetingActive &&
    !idleGlanceActive &&
    restStillness <= 0.08
  )
}

export interface RigOneShotStyle {
  intensity?: number
  tempo?: number
  fadeInMs?: number
  fadeOutMs?: number
  transitionMs?: number
  interrupt?: MotionInterruptPolicy
  allowLooping?: boolean
  exclusive?: boolean
  variationSeed?: number
  phase?: GeneratedMotionPhase
  wakeBefore?: boolean
  locksIdle?: boolean
}

export interface RigTransformVelocity {
  translation: RigPoint
  rotation: number
  scale: RigPoint
}

export interface OneShotHandoffProfile {
  transitionMs: number
  fadeInMs: number
  fadeOutMs: number
}

export function activityTransitionDuration(
  from: CompanionActivity,
  to: CompanionActivity,
): number {
  if (from === to) return 0
  if (from === 'talking' || to === 'talking') return 220
  return 280
}

export function activityTransitionWeight(progress: number): number {
  return smootherstep(Math.max(0, Math.min(1, progress)))
}

export function shouldQueueOneShot(
  activePriority: number | null,
  nextPriority: number,
  interrupt: MotionInterruptPolicy,
): boolean {
  if (activePriority === null) return false
  return (
    interrupt === 'queue' ||
    (interrupt === 'if-lower' && nextPriority < activePriority)
  )
}

export function canQueueOneShotGroup(
  queuedPriorities: readonly (number | null)[],
  nextPriority: number,
): boolean {
  return queuedPriorities.every(
    (queuedPriority) =>
      queuedPriority === null || nextPriority >= queuedPriority,
  )
}

export function canSupersedePendingWakeActions(
  pendingPriorities: readonly number[],
  nextPriority: number,
): boolean {
  return pendingPriorities.every((priority) => priority <= nextPriority)
}

export function motionChannelForBone(boneId: string): MotionChannel {
  const id = boneId.toLowerCase()
  if (/eye|brow|mouth|lip|jaw|cheek|nose|face/.test(id)) return 'face'
  if (/handwear|chest|torso|body/.test(id)) return 'upper'
  if (/head|hair|bang|braid|ear|ahoge|hat|ribbon|scarf/.test(id)) return 'head'
  return 'full'
}

export function motionChannelMasks(
  manifest: CompanionRigManifest,
  clip: RigClip,
): Array<{ channel: MotionChannel; mask: boolean[] }> {
  const tracked = new Set(clip.tracks.map((track) => track.boneId))
  const channels = new Map<MotionChannel, boolean[]>()
  manifest.bones.forEach((bone, index) => {
    if (!tracked.has(bone.id)) return
    const channel = motionChannelForBone(bone.id)
    const mask = channels.get(channel) || manifest.bones.map(() => false)
    mask[index] = true
    channels.set(channel, mask)
  })
  return Array.from(channels, ([channel, mask]) => ({ channel, mask }))
}

const CHANNEL_TRANSITION_MS: Readonly<Record<MotionChannel, number>> = {
  face: 150,
  head: 190,
  upper: 230,
  full: 270,
}

export function oneShotTransitionDuration(
  channels: readonly MotionChannel[],
  requested?: number,
): number {
  if (requested !== undefined) return Math.max(100, Math.min(520, requested))
  return Math.max(
    180,
    ...channels.map((channel) => CHANNEL_TRANSITION_MS[channel]),
  )
}

export function oneShotHandoffProfile(
  clipId: string,
  channels: readonly MotionChannel[],
  style: Pick<RigOneShotStyle, 'transitionMs' | 'fadeInMs' | 'fadeOutMs'> = {},
): OneShotHandoffProfile {
  const id = clipId.toLowerCase()
  const family = /deep-breath/.test(id)
    ? { transitionMs: 420, fadeInMs: 260, fadeOutMs: 420 }
    : /greet/.test(id)
      ? { transitionMs: 330, fadeInMs: 190, fadeOutMs: 330 }
      : /nod|bow|shake-head/.test(id)
        ? { transitionMs: 310, fadeInMs: 170, fadeOutMs: 310 }
        : /surprise|proud|shy|poke-reaction|startle-settle/.test(id)
          ? { transitionMs: 330, fadeInMs: 190, fadeOutMs: 330 }
          : /sigh/.test(id)
            ? { transitionMs: 310, fadeInMs: 190, fadeOutMs: 310 }
            : { transitionMs: 0, fadeInMs: 150, fadeOutMs: 220 }
  const channelDuration = oneShotTransitionDuration(channels)
  return {
    transitionMs:
      style.transitionMs === undefined
        ? Math.max(channelDuration, family.transitionMs)
        : oneShotTransitionDuration(channels, style.transitionMs),
    fadeInMs: clampMilliseconds(style.fadeInMs ?? family.fadeInMs, 40, 600),
    fadeOutMs: clampMilliseconds(style.fadeOutMs ?? family.fadeOutMs, 60, 800),
  }
}

export function oneShotBlendWeight(
  elapsedSeconds: number,
  durationSeconds: number,
  fadeInMs: number,
  fadeOutMs: number,
): number {
  if (
    durationSeconds <= 0 ||
    elapsedSeconds < 0 ||
    elapsedSeconds >= durationSeconds
  ) {
    return 0
  }
  const fadeIn = Math.min(1, elapsedSeconds / Math.max(0.001, fadeInMs / 1_000))
  const fadeOut = Math.min(
    1,
    (durationSeconds - elapsedSeconds) / Math.max(0.001, fadeOutMs / 1_000),
  )
  return smootherstep(Math.max(0, Math.min(fadeIn, fadeOut)))
}

export function oneShotNaturalReleaseLeadSeconds(
  durationSeconds: number,
  fadeOutMs: number,
): number {
  const duration = Math.max(0, durationSeconds)
  return Math.min(Math.max(0, fadeOutMs) / 1_000, duration * 0.35)
}

export function oneShotReleaseWeight(
  sourceBlend: number,
  transitionProgress: number,
): number {
  const progress = Math.max(0, Math.min(1, transitionProgress))
  return Math.max(0, Math.min(1, sourceBlend)) * (1 - smootherstep(progress))
}

export function dampedVelocityDisplacement(
  elapsedSeconds: number,
  settleSeconds = 0.12,
): number {
  const elapsed = Math.max(0, elapsedSeconds)
  const settle = Math.max(0.001, settleSeconds)
  return settle * (1 - Math.exp(-elapsed / settle))
}

export function writePoseVelocity(
  output: RigTransformVelocity[],
  previous: readonly RigTransform[],
  current: readonly RigTransform[],
  elapsedSeconds: number,
): RigTransformVelocity[] {
  const inverseElapsed = 1 / Math.max(0.001, elapsedSeconds)
  for (let index = 0; index < output.length; index += 1) {
    const before = previous[index]
    const after = current[index]
    const velocity = output[index]
    if (!before || !after) continue
    velocity.translation.x = clampVelocity(
      (after.translation.x - before.translation.x) * inverseElapsed,
      2,
    )
    velocity.translation.y = clampVelocity(
      (after.translation.y - before.translation.y) * inverseElapsed,
      2,
    )
    velocity.rotation = clampVelocity(
      Math.atan2(
        Math.sin(after.rotation - before.rotation),
        Math.cos(after.rotation - before.rotation),
      ) * inverseElapsed,
      8,
    )
    velocity.scale.x = clampVelocity(
      (after.scale.x - before.scale.x) * inverseElapsed,
      4,
    )
    velocity.scale.y = clampVelocity(
      (after.scale.y - before.scale.y) * inverseElapsed,
      4,
    )
  }
  return output
}

export function extrapolateDampedPoseInto(
  output: RigTransform[],
  source: readonly RigTransform[],
  velocity: readonly RigTransformVelocity[],
  elapsedSeconds: number,
  settleSeconds: number | readonly number[] = 0.12,
): RigTransform[] {
  copyPoseInto(output, source)
  for (let index = 0; index < output.length; index += 1) {
    const transform = output[index]
    const rate = velocity[index]
    if (!rate) continue
    const displacement = dampedVelocityDisplacement(
      elapsedSeconds,
      typeof settleSeconds === 'number'
        ? settleSeconds
        : (settleSeconds[index] ?? 0.12),
    )
    transform.translation.x += rate.translation.x * displacement
    transform.translation.y += rate.translation.y * displacement
    transform.rotation += rate.rotation * displacement
    transform.scale.x = Math.max(
      0.2,
      Math.min(2, transform.scale.x + rate.scale.x * displacement),
    )
    transform.scale.y = Math.max(
      0.2,
      Math.min(2, transform.scale.y + rate.scale.y * displacement),
    )
  }
  return output
}

/**
 * Secondary chains retain angular travel longer than rigid core bones during a
 * clip handoff. This is deliberately based on rig semantics rather than clip
 * names, so every activity and one-shot transition gets the same treatment.
 */
export function handoffSettleSecondsForBone(boneId: string): number {
  const id = boneId.toLowerCase()
  if (/hair|ahoge|bang|braid|ribbon|scarf|skirt|cloth|coat|cape/.test(id)) {
    return 0.24
  }
  if (/head|handwear|chest|torso|body/.test(id)) return 0.17
  return 0.12
}

export function transitionPresentationClip(
  outgoingClipId: string | null,
  incomingClipId: string,
  transitionProgress: number,
): string {
  return outgoingClipId && transitionProgress < 0.5
    ? outgoingClipId
    : incomingClipId
}

export function oneShotHandoffMask(
  incomingMask: readonly boolean[],
  outgoingMask: readonly boolean[] | undefined,
  transitionProgress: number,
): readonly boolean[] {
  return outgoingMask && transitionProgress < 1 ? outgoingMask : incomingMask
}

export function writeOneShotHandoffMask(
  output: boolean[],
  incomingMask: readonly boolean[],
  outgoingMask?: readonly boolean[],
): boolean[] {
  for (let index = 0; index < output.length; index += 1) {
    output[index] =
      Boolean(incomingMask[index]) || Boolean(outgoingMask?.[index])
  }
  return output
}

export function composeOneShotHandoffInto(
  output: RigTransform[],
  outgoingComposite: RigTransform[],
  basePose: readonly RigTransform[],
  outgoingPose: readonly RigTransform[],
  incomingPose: readonly RigTransform[],
  sourceBlend: number,
  transitionProgress: number,
  handoffMask: readonly boolean[],
  incomingMask: readonly boolean[] = handoffMask,
): RigTransform[] {
  mixPoseByMaskInto(
    outgoingComposite,
    basePose,
    outgoingPose,
    sourceBlend,
    handoffMask,
  )
  // Build the incoming composite over the live base pose first. Bones owned
  // only by the interrupted action then release to base during the union-mask
  // handoff instead of remaining frozen until the mask disappears.
  mixPoseByMaskInto(output, basePose, incomingPose, 1, incomingMask)
  return mixPoseByMaskInto(
    output,
    outgoingComposite,
    output,
    transitionProgress,
    handoffMask,
  )
}

function smootherstep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10)
}

function clampVelocity(value: number, maximum: number): number {
  return Math.max(-maximum, Math.min(maximum, value))
}

function clampMilliseconds(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.max(minimum, Math.min(maximum, value))
}
