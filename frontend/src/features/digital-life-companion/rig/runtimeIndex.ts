import type { CompanionRigManifest, RigClip, RigTrack } from './types'

interface RigRuntimeIndex {
  readonly boneById: ReadonlyMap<string, number>
  readonly boneOrder: readonly number[]
  readonly boneParents: readonly number[]
  readonly tracksByClip: ReadonlyMap<RigClip, readonly (RigTrack | undefined)[]>
}

export interface RigBoneHierarchy {
  readonly boneById: ReadonlyMap<string, number>
  readonly boneOrder: readonly number[]
  readonly boneParents: readonly number[]
}

const RUNTIME_INDEX_CACHE = new WeakMap<CompanionRigManifest, RigRuntimeIndex>()
const BONE_INDEX_CACHE = new WeakMap<
  CompanionRigManifest['bones'],
  ReadonlyMap<string, number>
>()
const BONE_HIERARCHY_CACHE = new WeakMap<
  CompanionRigManifest['bones'],
  RigBoneHierarchy
>()

/** Shared immutable indexes for setup and every frame of a compiled rig. */
export function rigRuntimeIndex(manifest: CompanionRigManifest): RigRuntimeIndex {
  const cached = RUNTIME_INDEX_CACHE.get(manifest)
  if (cached) return cached

  const { boneById, boneOrder, boneParents } = rigBoneHierarchy(manifest)
  const tracksByClip = new Map(
    manifest.clips.map((clip) => {
      const byBone = new Map(clip.tracks.map((track) => [track.boneId, track]))
      return [clip, manifest.bones.map((bone) => byBone.get(bone.id))] as const
    }),
  )
  const index = { boneById, boneOrder, boneParents, tracksByClip }
  RUNTIME_INDEX_CACHE.set(manifest, index)
  return index
}

/** Hierarchy-only cache for kinematics that must not depend on clip storage. */
export function rigBoneHierarchy(
  manifest: CompanionRigManifest,
): RigBoneHierarchy {
  const cached = BONE_HIERARCHY_CACHE.get(manifest.bones)
  if (cached) return cached
  const boneById = rigBoneIndexes(manifest)
  const boneOrder = evaluationOrder(manifest, boneById)
  const boneParents = manifest.bones.map((bone) =>
    bone.parent === null ? -1 : (boneById.get(bone.parent) ?? -1),
  )
  const hierarchy = { boneById, boneOrder, boneParents }
  BONE_HIERARCHY_CACHE.set(manifest.bones, hierarchy)
  return hierarchy
}

export function rigBoneIndexes(
  manifest: CompanionRigManifest,
): ReadonlyMap<string, number> {
  const cached = BONE_INDEX_CACHE.get(manifest.bones)
  if (cached) return cached
  const indexes = new Map(manifest.bones.map((bone, index) => [bone.id, index]))
  BONE_INDEX_CACHE.set(manifest.bones, indexes)
  return indexes
}

function evaluationOrder(
  manifest: CompanionRigManifest,
  indexes: ReadonlyMap<string, number>,
): number[] {
  const complete = new Set<number>()
  const visiting = new Set<number>()
  const order: number[] = []
  const visit = (index: number) => {
    if (complete.has(index) || visiting.has(index)) return
    visiting.add(index)
    const parent = manifest.bones[index].parent
    if (parent !== null) {
      const parentIndex = indexes.get(parent)
      if (parentIndex !== undefined) visit(parentIndex)
    }
    visiting.delete(index)
    complete.add(index)
    order.push(index)
  }
  manifest.bones.forEach((_, index) => visit(index))
  return order
}
