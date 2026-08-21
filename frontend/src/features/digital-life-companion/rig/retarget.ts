import type {
  CompanionRigManifest,
  RigPoint,
  RigTransform,
} from './types'
import { rigBoneIndexes } from './runtimeIndex'
import { semanticChain } from './semantics'

export interface RigRetargetProfile {
  torsoScale: number
}

const profileCache = new WeakMap<CompanionRigManifest, RigRetargetProfile>()
const membershipCache = new WeakMap<
  CompanionRigManifest,
  {
    torso: ReadonlySet<string>
  }
>()

/** Derives bounded motion scales from the character's actual rest skeleton. */
export function rigRetargetProfile(
  manifest: CompanionRigManifest,
): RigRetargetProfile {
  const cached = profileCache.get(manifest)
  if (cached) return cached
  const indexes = rigBoneIndexes(manifest)
  const torso = chainLength(manifest, indexes, semanticChain(manifest, 'torso'))
  const height = Math.max(0.001, manifest.canvas.height)
  const profile = {
    torsoScale: boundedRatio(torso / height, 0.29),
  }
  profileCache.set(manifest, profile)
  return profile
}

/**
 * Retargets authored translation deltas; rotations and semantic IK continue to
 * use the real character joints, avoiding double-scaling reach constraints.
 */
export function applyRigRetargetingInto(
  pose: RigTransform[],
  manifest: CompanionRigManifest,
  activeMask: readonly boolean[],
): boolean {
  const profile = rigRetargetProfile(manifest)
  const membership = retargetMembership(manifest)
  let changed = false
  for (const [index, bone] of manifest.bones.entries()) {
    if (!activeMask[index]) continue
    const scale = semanticScale(bone.id, profile, membership)
    if (Math.abs(scale - 1) < 0.001) continue
    pose[index].translation.x *= scale
    pose[index].translation.y *= scale
    changed = true
  }
  return changed
}

function semanticScale(
  id: string,
  profile: RigRetargetProfile,
  membership: {
    torso: ReadonlySet<string>
  },
): number {
  if (membership.torso.has(id)) return profile.torsoScale
  return 1
}

function retargetMembership(manifest: CompanionRigManifest) {
  const cached = membershipCache.get(manifest)
  if (cached) return cached
  const membership = {
    torso: new Set(semanticChain(manifest, 'torso')),
  }
  membershipCache.set(manifest, membership)
  return membership
}

function chainLength(
  manifest: CompanionRigManifest,
  indexes: ReadonlyMap<string, number>,
  chain: readonly string[],
): number {
  let length = 0
  for (let index = 1; index < chain.length; index += 1) {
    const from = pivot(manifest, indexes, chain[index - 1])
    const to = pivot(manifest, indexes, chain[index])
    if (!from || !to) return 0
    length += Math.hypot(to.x - from.x, to.y - from.y)
  }
  return length
}

function pivot(
  manifest: CompanionRigManifest,
  indexes: ReadonlyMap<string, number>,
  id: string,
): RigPoint | undefined {
  const index = indexes.get(id)
  return index === undefined ? undefined : manifest.bones[index]?.pivot
}

function boundedRatio(actual: number, canonical: number): number {
  if (!Number.isFinite(actual) || actual <= 0) return 1
  return Math.max(0.72, Math.min(1.28, actual / canonical))
}
