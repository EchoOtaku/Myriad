import type { CompanionRigManifest, RigTransform } from './types'
import { ANIME25D_LAYER_DEPTH } from './anime25d'

export interface Anime25DDepthBinding {
  index: number
  depthDelta: number
}

export interface Anime25DRuntimeIndex {
  enabled: boolean
  depthBindings: Anime25DDepthBinding[]
  chestIndex: number
  handwearIndex: number
  handwearLeftIndex: number
  handwearRightIndex: number
}

export interface Anime25DMotionInput {
  headTurnX: number
  headTurnY: number
  breath: number
  breathAmplitude: number
  weightShift: number
  idleAccent: number
  chestBounce: number
  handwearSway: number
  ambientScale: number
}

export interface Anime25DHairSpringProfile {
  frequencyScale: number
  dampingScale: number
  responseScale: number
  maxRotation: number
}

const UPSTREAM_BLINK_CLOSE_SECONDS = 0.08
const UPSTREAM_BLINK_HOLD_END_SECONDS = 0.42
const UPSTREAM_BLINK_END_SECONDS = 0.58
export const MAX_RIGID_ARM_ROTATION = Math.PI / 12

/** Closed-lid weight matching Anime2.5DRig's 0.08/0.34/0.16 blink phases. */
export function anime25DBlinkClosure(progress: number): number {
  const elapsed = clamp(progress, 0, 1) * UPSTREAM_BLINK_END_SECONDS
  if (elapsed < UPSTREAM_BLINK_CLOSE_SECONDS) {
    return smootherstep(elapsed / UPSTREAM_BLINK_CLOSE_SECONDS)
  }
  if (elapsed < UPSTREAM_BLINK_HOLD_END_SECONDS) return 1
  return (
    1 -
    smootherstep(
      (elapsed - UPSTREAM_BLINK_HOLD_END_SECONDS) /
        (UPSTREAM_BLINK_END_SECONDS - UPSTREAM_BLINK_HOLD_END_SECONDS),
    )
  )
}

/** Stiff roots and softer tips, matching the upstream double-spring intent. */
export function anime25DHairSpringProfile(
  boneId: string,
): Anime25DHairSpringProfile | null {
  if (!boneId.startsWith('a25d-')) return null
  if (boneId.endsWith('-hair-root')) {
    return {
      frequencyScale: 1.06,
      dampingScale: 1.08,
      responseScale: 0.7,
      maxRotation: 0.15,
    }
  }
  if (boneId.endsWith('-hair-tip')) {
    return {
      frequencyScale: 0.68,
      dampingScale: 0.94,
      responseScale: 1.05,
      maxRotation: 0.3,
    }
  }
  return null
}

export function anime25DBoneDepth(id: string): number | null {
  const normalized = id.toLowerCase()
  if (normalized === 'face') return ANIME25D_LAYER_DEPTH.face
  if (normalized === 'left-eye' || normalized === 'right-eye') {
    return ANIME25D_LAYER_DEPTH.irides
  }
  if (normalized === 'mouth') return ANIME25D_LAYER_DEPTH['mouth-open']
  if (normalized.includes('front-hair'))
    return ANIME25D_LAYER_DEPTH['front-hair']
  if (normalized.includes('back-hair')) return ANIME25D_LAYER_DEPTH['back-hair']
  if (normalized.startsWith('a25d-eyewhite-'))
    return ANIME25D_LAYER_DEPTH.eyewhite
  if (normalized.startsWith('a25d-irides-')) return ANIME25D_LAYER_DEPTH.irides
  if (normalized.startsWith('a25d-eyelash-'))
    return ANIME25D_LAYER_DEPTH.eyelash
  if (normalized.startsWith('a25d-eyebrow-'))
    return ANIME25D_LAYER_DEPTH.eyebrow
  for (const [role, depth] of Object.entries(ANIME25D_LAYER_DEPTH)) {
    if (normalized === `a25d-${role}`) return depth
  }
  return null
}

export function buildAnime25DRuntimeIndex(
  manifest: CompanionRigManifest,
): Anime25DRuntimeIndex {
  const enabled = (manifest.parts || []).some((part) =>
    part.id.startsWith('a25d-'),
  )
  if (!enabled) {
    return {
      enabled: false,
      depthBindings: [],
      chestIndex: -1,
      handwearIndex: -1,
      handwearLeftIndex: -1,
      handwearRightIndex: -1,
    }
  }
  const indexes = new Map(manifest.bones.map((bone, index) => [bone.id, index]))
  const bonesById = new Map(manifest.bones.map((bone) => [bone.id, bone]))
  const depths = new Map<string, number>()
  const depthOf = (id: string | null): number => {
    if (!id) return 1
    const cached = depths.get(id)
    if (cached !== undefined) return cached
    const depth = anime25DBoneDepth(id) ?? 1
    depths.set(id, depth)
    return depth
  }
  const depthBindings = manifest.bones.flatMap((bone, index) => {
    const depth = anime25DBoneDepth(bone.id)
    if (depth === null) return []
    let ancestor = bone.parent
    let followsHead = bone.id === 'face'
    for (let guard = 0; ancestor && guard < manifest.bones.length; guard += 1) {
      if (ancestor === 'head' || ancestor === 'face') {
        followsHead = true
        break
      }
      ancestor = bonesById.get(ancestor)?.parent ?? null
    }
    if (!followsHead) return []
    const parentDepth = depthOf(bone.parent)
    const depthDelta = depth - parentDepth
    return Math.abs(depthDelta) > 0.0001 ? [{ index, depthDelta }] : []
  })
  return {
    enabled: true,
    depthBindings,
    chestIndex: indexes.get('a25d-chest') ?? -1,
    handwearIndex: indexes.get('a25d-handwear') ?? -1,
    handwearLeftIndex: indexes.get('a25d-handwear-left') ?? -1,
    handwearRightIndex: indexes.get('a25d-handwear-right') ?? -1,
  }
}

/** Applies only Anime2.5DRig layer-space motion; flat fallback rigs are untouched. */
export function applyAnime25DMotionInto(
  pose: RigTransform[],
  index: Anime25DRuntimeIndex,
  input: Anime25DMotionInput,
): void {
  if (!index.enabled) return
  const turnX = clamp(input.headTurnX, -1, 1)
  const turnY = clamp(input.headTurnY, -1, 1)
  for (const binding of index.depthBindings) {
    const transform = pose[binding.index]
    if (!transform) continue
    // Upstream uses 40 px of layer-depth parallax on a 768 px reference face.
    // Binding the delta relative to the parent prevents nested face/eye/iris
    // bones from applying the same displacement twice.
    transform.translation.x += turnX * binding.depthDelta * 0.052
    transform.translation.y -= turnY * binding.depthDelta * 0.039
    transform.rotation += turnX * binding.depthDelta * 0.014
  }
  if (index.chestIndex >= 0) {
    const chest = pose[index.chestIndex]
    const breath = input.breath * input.breathAmplitude
    chest.translation.y -= breath * 0.72 + input.chestBounce
    chest.scale.x *= 1 + input.breath * 0.003
    chest.scale.y *= 1 + input.breath * 0.0014
  }
  if (index.handwearIndex >= 0) {
    const handwear = pose[index.handwearIndex]
    const sway =
      clamp(input.handwearSway, -1, 1) * clamp(input.ambientScale, 0, 1)
    // The parent moves both painted arm fragments together. Optional left and
    // right children are rigid sprite pivots, not shoulder/elbow/wrist chains.
    handwear.translation.x += sway * 0.004
    handwear.translation.y +=
      Math.abs(sway) * 0.0006 -
      input.breath * input.breathAmplitude * 0.1 * input.ambientScale
    const hasSideLayers =
      index.handwearLeftIndex >= 0 || index.handwearRightIndex >= 0
    if (!hasSideLayers) {
      // A legacy combined handwear drawing contains both sides, so visible
      // rotation reads as the whole upper body twisting. Keep only a small
      // compatibility tail; independent side fragments own the real arm swing.
      handwear.rotation = clamp(
        handwear.rotation + sway * 0.012,
        -MAX_RIGID_ARM_ROTATION,
        MAX_RIGID_ARM_ROTATION,
      )
    }
    if (index.handwearLeftIndex >= 0) {
      const left = pose[index.handwearLeftIndex]
      left.rotation = clamp(
        left.rotation + sway * 0.035,
        -MAX_RIGID_ARM_ROTATION,
        MAX_RIGID_ARM_ROTATION,
      )
    }
    if (index.handwearRightIndex >= 0) {
      const right = pose[index.handwearRightIndex]
      right.rotation = clamp(
        right.rotation - sway * 0.035,
        -MAX_RIGID_ARM_ROTATION,
        MAX_RIGID_ARM_ROTATION,
      )
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}

function smootherstep(value: number): number {
  const bounded = clamp(value, 0, 1)
  return bounded * bounded * bounded * (bounded * (bounded * 6 - 15) + 10)
}
