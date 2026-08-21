import type { MotionCharacterState } from './motion'
import type { CompanionRigManifest, RigTransform } from './types'
import { rigBoneIndexes } from './runtimeIndex'

export type GeneratedMotionPhase = 'anticipation' | 'action' | 'settle'

export interface GeneratedMotionInstance {
  seed: number
  phase: GeneratedMotionPhase
  tempoScale: number
  amplitudeScale: number
  lateralBias: number
  verticalBias: number
  fluidity: number
  overshoot: number
  hold: number
}

export interface GenerateMotionInstanceRequest {
  clipId: string
  seed: number
  phase?: GeneratedMotionPhase
  state?: Partial<MotionCharacterState>
  maxAmplitudeScale?: number
}

export interface SelectMotionInstanceRequest extends GenerateMotionInstanceRequest {
  previous?: GeneratedMotionInstance | null
  attempts?: number
}

/**
 * Turns a semantic clip into a deterministic performance instance. The clip
 * remains the authored source of truth; these bounded parameters stop repeated
 * uses from having identical timing, weight and silhouette.
 */
export function generateMotionInstance(
  request: GenerateMotionInstanceRequest,
): GeneratedMotionInstance {
  let cursor = mixSeed(hashString(request.clipId), request.seed)
  const next = () => {
    cursor = (Math.imul(cursor >>> 0, 1_664_525) + 1_013_904_223) >>> 0
    return cursor / 4_294_967_296
  }
  const energy = unit(request.state?.energy)
  const affection = unit(request.state?.affection)
  const phase = request.phase || 'action'
  const phaseTempo =
    phase === 'anticipation' ? 0.9 : phase === 'settle' ? 0.82 : 1
  const phaseAmplitude =
    phase === 'anticipation' ? 0.78 : phase === 'settle' ? 0.7 : 1
  const maxAmplitudeScale = clamp(request.maxAmplitudeScale ?? 1.24, 0.62, 1.24)
  const amplitudeScale = clamp(
    phaseAmplitude * (0.9 + next() * 0.2) * (0.88 + energy * 0.24),
    0.62,
    maxAmplitudeScale,
  )
  return {
    seed: cursor,
    phase,
    tempoScale: clamp(
      phaseTempo * (0.92 + next() * 0.16) * (0.9 + energy * 0.2),
      0.7,
      1.25,
    ),
    amplitudeScale,
    lateralBias: (next() * 2 - 1) * 0.014,
    verticalBias: (next() * 2 - 1) * 0.006,
    fluidity: clamp(0.52 + affection * 0.26 + next() * 0.16, 0.45, 0.92),
    overshoot: clamp(0.035 + energy * 0.045 + next() * 0.035, 0.03, 0.12),
    hold: clamp(0.04 + (1 - energy) * 0.08 + next() * 0.035, 0.035, 0.15),
  }
}

/**
 * Keeps repeated performances of the same semantic clip visibly distinct.
 * The selection stays deterministic: it walks a bounded seed sequence and
 * chooses the candidate furthest from the previous performance.
 */
export function selectDistinctMotionInstance(
  request: SelectMotionInstanceRequest,
): GeneratedMotionInstance {
  const attempts = Math.max(1, Math.min(12, request.attempts ?? 6))
  let selected = generateMotionInstance(request)
  if (!request.previous) return selected
  let selectedDistance = motionInstanceDistance(selected, request.previous)
  for (let offset = 1; offset < attempts; offset += 1) {
    const candidate = generateMotionInstance({
      ...request,
      seed: (request.seed + Math.imul(offset, 2_654_435_761)) >>> 0,
    })
    const distance = motionInstanceDistance(candidate, request.previous)
    if (distance > selectedDistance) {
      selected = candidate
      selectedDistance = distance
    }
  }
  return selected
}

export function motionInstanceDistance(
  left: GeneratedMotionInstance,
  right: GeneratedMotionInstance,
): number {
  const phaseDistance = left.phase === right.phase ? 0 : 0.18
  return (
    Math.abs(left.tempoScale - right.tempoScale) * 0.3 +
    Math.abs(left.amplitudeScale - right.amplitudeScale) * 0.32 +
    Math.abs(left.lateralBias - right.lateralBias) * 8 +
    Math.abs(left.verticalBias - right.verticalBias) * 6 +
    Math.abs(left.fluidity - right.fluidity) * 0.16 +
    Math.abs(left.overshoot - right.overshoot) * 0.4 +
    Math.abs(left.hold - right.hold) * 0.25 +
    phaseDistance
  )
}

/** Maps wall-clock progress to an anticipation/strike/settle rhythm. */
export function generatedMotionProgress(
  progress: number,
  instance: Pick<GeneratedMotionInstance, 'fluidity' | 'overshoot' | 'hold'>,
): number {
  const value = clamp(progress, 0, 1)
  const anticipationEnd = 0.12 + instance.fluidity * 0.08
  const holdEnd = clamp(0.72 + instance.hold, 0.74, 0.88)
  if (value < anticipationEnd) {
    const local = value / anticipationEnd
    return smootherstep(local) * 0.1
  }
  if (value < holdEnd) {
    const local = (value - anticipationEnd) / (holdEnd - anticipationEnd)
    const strike = smootherstep(local)
    const overshoot = Math.sin(strike * Math.PI) * instance.overshoot
    return clamp(0.1 + strike * 0.82 + overshoot, 0, 1)
  }
  const local = (value - holdEnd) / Math.max(0.001, 1 - holdEnd)
  return 0.92 + smootherstep(local) * 0.08
}

/**
 * Adds restrained whole-body preparation and follow-through around authored
 * tracks. It only touches untracked support bones, so artist-authored motion
 * and semantic IK retain priority.
 */
export function applyGeneratedMotionDynamicsInto(
  pose: RigTransform[],
  manifest: CompanionRigManifest,
  activeMask: readonly boolean[],
  progress: number,
  amount: number,
  instance: GeneratedMotionInstance,
): boolean {
  if (amount <= 0) return false
  const indexes = rigBoneIndexes(manifest)
  const rootIndex = indexes.get('root')
  const bodyIndex = indexes.get('body')
  const headIndex = indexes.get('head')
  const phase = clamp(progress, 0, 1)
  const anticipation = phase < 0.22 ? Math.sin((phase / 0.22) * Math.PI) : 0
  const follow = phase > 0.55 ? Math.sin(((phase - 0.55) / 0.45) * Math.PI) : 0
  const impulse = (follow - anticipation * 0.72) * amount
  const direction = instance.lateralBias >= 0 ? 1 : -1
  let applied = false

  if (rootIndex !== undefined && !activeMask[rootIndex]) {
    pose[rootIndex].translation.x +=
      instance.lateralBias * (0.35 + Math.abs(impulse))
    pose[rootIndex].translation.y +=
      instance.verticalBias * (0.25 + Math.abs(impulse))
    applied = true
  }
  if (bodyIndex !== undefined && !activeMask[bodyIndex]) {
    pose[bodyIndex].rotation += impulse * direction * 0.018
    pose[bodyIndex].translation.x += impulse * direction * 0.0025
    applied = true
  }
  if (headIndex !== undefined && !activeMask[headIndex]) {
    const delayed = phase > 0.06 ? impulse : 0
    pose[headIndex].rotation -= delayed * direction * 0.013
    pose[headIndex].translation.x -= delayed * direction * 0.0014
    applied = true
  }
  return applied
}

export function motionInstanceSignature(
  instance: GeneratedMotionInstance,
): string {
  return [
    instance.phase,
    instance.seed >>> 0,
    instance.tempoScale.toFixed(3),
    instance.amplitudeScale.toFixed(3),
    instance.lateralBias.toFixed(4),
  ].join(':')
}

function hashString(value: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function mixSeed(left: number, right: number): number {
  return (left ^ Math.imul(right >>> 0, 2_246_822_519)) >>> 0
}

function unit(value: number | undefined): number {
  return clamp(Number.isFinite(value) ? (value || 0) / 100 : 0.5, 0, 1)
}

function smootherstep(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10)
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
