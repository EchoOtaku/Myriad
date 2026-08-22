import type { CompanionRigManifest } from './types'

const cache = new WeakMap<CompanionRigManifest, ReadonlyMap<string, number>>()

export function rigBoneIndexes(
  manifest: CompanionRigManifest,
): ReadonlyMap<string, number> {
  const cached = cache.get(manifest)
  if (cached) return cached
  const indexes = new Map(
    manifest.bones.map((bone, index) => [bone.id, index]),
  )
  cache.set(manifest, indexes)
  return indexes
}
