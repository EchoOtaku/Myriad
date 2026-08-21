import type { CompanionRigManifest } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createPoseBuffer } from './animation'
import { preservePoseContinuityInto } from './poseContinuity'

function manifest(ids: string[]): CompanionRigManifest {
  return {
    schemaVersion: 2,
    atlasUrl: '/atlas.png',
    viewport: { width: 1, height: 1 },
    bones: ids.map((id, index) => ({
      id,
      parent: index === 0 ? null : ids[0],
      pivot: { x: 0, y: 0 },
    })),
    parts: [],
    clips: [],
    defaultClip: 'idle',
  }
}

test('normal authored deltas pass through unchanged', () => {
  const rig = manifest(['root', 'a25d-handwear'])
  const previous = createPoseBuffer(2)
  const pose = createPoseBuffer(2)
  pose[1].rotation = 0.1
  pose[1].translation.x = 0.01

  const result = preservePoseContinuityInto(pose, previous, rig, 1 / 60)

  assert.equal(result.limitedChannels, 0)
  assert.equal(pose[1].rotation, 0.1)
  assert.equal(pose[1].translation.x, 0.01)
})

test('implausible body jumps are bounded by elapsed time', () => {
  const rig = manifest(['root', 'a25d-handwear'])
  const previous = createPoseBuffer(2)
  const pose = createPoseBuffer(2)
  pose[1].rotation = 2
  pose[1].translation.x = 0.5

  const result = preservePoseContinuityInto(pose, previous, rig, 1 / 60)

  assert.equal(result.limitedBones, 1)
  assert.ok(Math.abs(pose[1].rotation - 14 / 60) < 1e-9)
  assert.ok(Math.abs(pose[1].translation.x - 0.9 / 60) < 1e-9)
})

test('facial channels retain fast blink scale changes', () => {
  const rig = manifest(['root', 'left-eye'])
  const previous = createPoseBuffer(2)
  const pose = createPoseBuffer(2)
  pose[1].scale.y = 0.4

  preservePoseContinuityInto(pose, previous, rig, 1 / 60)

  assert.equal(pose[1].scale.y, 0.4)
})

test('long frame gaps reset continuity instead of dragging stale poses', () => {
  const rig = manifest(['root'])
  const previous = createPoseBuffer(1)
  const pose = createPoseBuffer(1)
  pose[0].rotation = 2

  const result = preservePoseContinuityInto(pose, previous, rig, 0.2)

  assert.equal(result.limitedChannels, 0)
  assert.equal(pose[0].rotation, 2)
})

test('body direction changes preserve bounded angular acceleration', () => {
  const rig = manifest(['root', 'a25d-handwear'])
  const earlier = createPoseBuffer(2)
  const previous = createPoseBuffer(2)
  const pose = createPoseBuffer(2)
  previous[1].rotation = 0.1
  pose[1].rotation = -0.1

  const result = preservePoseContinuityInto(
    pose,
    previous,
    rig,
    1 / 60,
    earlier,
    1 / 60,
  )

  assert.equal(result.limitedAccelerationChannels, 1)
  assert.ok(Math.abs(pose[1].rotation - (0.1 + 2 / 60)) < 1e-9)
})
