import type { CompanionRigManifest, RigTransform } from './types'

export interface PoseContinuityResult {
  limitedBones: number
  limitedChannels: number
  limitedAccelerationChannels: number
}

interface VelocityLimits {
  translation: number
  rotation: number
  scale: number
  translationAcceleration: number
  rotationAcceleration: number
  scaleAcceleration: number
}

const BODY_LIMITS: VelocityLimits = {
  translation: 0.9,
  rotation: 14,
  scale: 5,
  translationAcceleration: 18,
  rotationAcceleration: 240,
  scaleAcceleration: 80,
}
const CORE_LIMITS: VelocityLimits = {
  translation: 0.55,
  rotation: 8,
  scale: 3.5,
  translationAcceleration: 10,
  rotationAcceleration: 120,
  scaleAcceleration: 50,
}
const FACE_LIMITS: VelocityLimits = {
  translation: 2.5,
  rotation: 32,
  scale: 42,
  translationAcceleration: 100,
  rotationAcceleration: 1_200,
  scaleAcceleration: 2_400,
}
const LIMITS_CACHE = new WeakMap<
  CompanionRigManifest['bones'],
  readonly VelocityLimits[]
>()

/**
 * Caps only implausible frame-to-frame discontinuities after pose composition.
 * Normal authored motion passes through bit-for-bit; facial channels retain the
 * higher rates required by blinks, visemes, and expression changes.
 */
export function preservePoseContinuityInto(
  pose: RigTransform[],
  previous: readonly RigTransform[],
  manifest: CompanionRigManifest,
  elapsedSeconds: number,
  beforePrevious?: readonly RigTransform[],
  previousElapsedSeconds?: number,
  output?: PoseContinuityResult,
): PoseContinuityResult {
  const result = output ?? {
    limitedBones: 0,
    limitedChannels: 0,
    limitedAccelerationChannels: 0,
  }
  result.limitedBones = 0
  result.limitedChannels = 0
  result.limitedAccelerationChannels = 0
  if (
    elapsedSeconds <= 0 ||
    elapsedSeconds > 0.12 ||
    previous.length !== pose.length
  ) {
    return result
  }

  const cachedLimits = continuityLimits(manifest)
  for (let index = 0; index < pose.length; index += 1) {
    const current = pose[index]
    const before = previous[index]
    const earlier = beforePrevious?.[index]
    const limits = cachedLimits[index] ?? BODY_LIMITS
    let channels = 0

    channels += limitScalar(
      current.translation,
      'x',
      before.translation.x,
      limits.translation * elapsedSeconds,
    )
    channels += limitScalar(
      current.translation,
      'y',
      before.translation.y,
      limits.translation * elapsedSeconds,
    )

    const rotationDelta = normalizeAngle(current.rotation - before.rotation)
    const limitedRotation = clampDelta(
      rotationDelta,
      limits.rotation * elapsedSeconds,
    )
    if (limitedRotation !== rotationDelta) {
      current.rotation = before.rotation + limitedRotation
      channels += 1
    }

    channels += limitScalar(
      current.scale,
      'x',
      before.scale.x,
      limits.scale * elapsedSeconds,
    )
    channels += limitScalar(
      current.scale,
      'y',
      before.scale.y,
      limits.scale * elapsedSeconds,
    )

    if (
      earlier &&
      previousElapsedSeconds &&
      previousElapsedSeconds > 0 &&
      previousElapsedSeconds <= 0.12
    ) {
      const accelerationChannels = limitAccelerationInto(
        current,
        before,
        earlier,
        elapsedSeconds,
        previousElapsedSeconds,
        limits,
      )
      channels += accelerationChannels
      result.limitedAccelerationChannels += accelerationChannels
    }

    if (channels > 0) {
      result.limitedBones += 1
      result.limitedChannels += channels
    }
  }
  return result
}

function continuityLimits(
  manifest: CompanionRigManifest,
): readonly VelocityLimits[] {
  const cached = LIMITS_CACHE.get(manifest.bones)
  if (cached) return cached
  const limits = manifest.bones.map((bone) => limitsForBone(bone.id))
  LIMITS_CACHE.set(manifest.bones, limits)
  return limits
}

function limitAccelerationInto(
  current: RigTransform,
  previous: RigTransform,
  earlier: RigTransform,
  elapsedSeconds: number,
  previousElapsedSeconds: number,
  limits: VelocityLimits,
): number {
  let channels = 0
  channels += limitScalarAcceleration(
    current.translation,
    previous.translation,
    earlier.translation,
    'x',
    elapsedSeconds,
    previousElapsedSeconds,
    limits.translationAcceleration,
  )
  channels += limitScalarAcceleration(
    current.translation,
    previous.translation,
    earlier.translation,
    'y',
    elapsedSeconds,
    previousElapsedSeconds,
    limits.translationAcceleration,
  )
  const priorRotationVelocity =
    normalizeAngle(previous.rotation - earlier.rotation) /
    previousElapsedSeconds
  const desiredRotationVelocity =
    normalizeAngle(current.rotation - previous.rotation) / elapsedSeconds
  const limitedRotationVelocity = limitVelocityChange(
    desiredRotationVelocity,
    priorRotationVelocity,
    limits.rotationAcceleration * elapsedSeconds,
  )
  if (limitedRotationVelocity !== desiredRotationVelocity) {
    current.rotation =
      previous.rotation + limitedRotationVelocity * elapsedSeconds
    channels += 1
  }
  channels += limitScalarAcceleration(
    current.scale,
    previous.scale,
    earlier.scale,
    'x',
    elapsedSeconds,
    previousElapsedSeconds,
    limits.scaleAcceleration,
  )
  channels += limitScalarAcceleration(
    current.scale,
    previous.scale,
    earlier.scale,
    'y',
    elapsedSeconds,
    previousElapsedSeconds,
    limits.scaleAcceleration,
  )
  return channels
}

function limitScalarAcceleration<T extends { x: number; y: number }>(
  current: T,
  previous: T,
  earlier: T,
  channel: 'x' | 'y',
  elapsedSeconds: number,
  previousElapsedSeconds: number,
  maximumAcceleration: number,
): 0 | 1 {
  const priorVelocity =
    (previous[channel] - earlier[channel]) / previousElapsedSeconds
  const desiredVelocity =
    (current[channel] - previous[channel]) / elapsedSeconds
  const limitedVelocity = limitVelocityChange(
    desiredVelocity,
    priorVelocity,
    maximumAcceleration * elapsedSeconds,
  )
  if (limitedVelocity === desiredVelocity) return 0
  current[channel] = previous[channel] + limitedVelocity * elapsedSeconds
  return 1
}

function limitVelocityChange(
  desired: number,
  previous: number,
  maximumDelta: number,
): number {
  return previous + clampDelta(desired - previous, maximumDelta)
}

function limitsForBone(boneId: string): VelocityLimits {
  if (/eye|mouth|brow|lip|viseme|expression/i.test(boneId)) return FACE_LIMITS
  if (/root|body|hips|pelvis|chest|head/i.test(boneId)) return CORE_LIMITS
  return BODY_LIMITS
}

function limitScalar<T extends { x: number; y: number }>(
  target: T,
  channel: 'x' | 'y',
  previous: number,
  maximumDelta: number,
): 0 | 1 {
  const delta = target[channel] - previous
  const limited = clampDelta(delta, maximumDelta)
  if (limited === delta) return 0
  target[channel] = previous + limited
  return 1
}

function clampDelta(delta: number, maximum: number): number {
  return Math.max(-maximum, Math.min(maximum, delta))
}

function normalizeAngle(value: number): number {
  const turn = Math.PI * 2
  return ((((value + Math.PI) % turn) + turn) % turn) - Math.PI
}
