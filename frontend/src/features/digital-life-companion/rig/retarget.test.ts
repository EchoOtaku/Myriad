import type { CompanionRigManifest } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyRigRetargetingInto,
  rigRetargetProfile,
} from './retarget'

function manifest(scale: number): CompanionRigManifest {
  const bodyY = 0.8 - 0.25 * scale
  return {
    canvas: { width: 1, height: 1.5 },
    bones: [
      { id: 'root', parent: null, pivot: { x: 0.5, y: 0.8 } },
      { id: 'body', parent: 'root', pivot: { x: 0.5, y: bodyY } },
      {
        id: 'head',
        parent: 'body',
        pivot: { x: 0.5, y: bodyY - 0.185 * scale },
      },
      {
        id: 'a25d-handwear',
        parent: 'body',
        pivot: { x: 0.5, y: 0.68 },
      },
    ],
  } as CompanionRigManifest
}

test('derives and caches a bounded upper-body proportion', () => {
  const compact = manifest(0.72)
  const profile = rigRetargetProfile(compact)
  assert.equal(profile, rigRetargetProfile(compact))
  assert.ok(profile.torsoScale >= 0.72)
  assert.ok(profile.torsoScale < 1)
})

test('retargets translation only on the active torso chain', () => {
  const compact = manifest(0.72)
  const pose = compact.bones.map(() => ({
    translation: { x: 0.1, y: 0.1 },
    rotation: 0.4,
    scale: { x: 1, y: 1 },
  }))
  assert.equal(
    applyRigRetargetingInto(
      pose,
      compact,
      compact.bones.map(() => true),
    ),
    true,
  )
  assert.ok(pose[1].translation.x < 0.1)
  assert.equal(pose[1].rotation, 0.4)
  assert.equal(pose[3].translation.x, 0.1)
})
