import type { CompanionRigManifest } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyGeneratedMotionDynamicsInto,
  generatedMotionProgress,
  generateMotionInstance,
  motionInstanceDistance,
  motionInstanceSignature,
  selectDistinctMotionInstance,
} from './generation'

test('generates repeatable but visibly distinct instances of one clip', () => {
  const first = generateMotionInstance({ clipId: 'greet', seed: 7 })
  const repeated = generateMotionInstance({ clipId: 'greet', seed: 7 })
  const next = generateMotionInstance({ clipId: 'greet', seed: 8 })
  assert.deepEqual(first, repeated)
  assert.notEqual(motionInstanceSignature(first), motionInstanceSignature(next))
  assert.ok(first.tempoScale >= 0.7 && first.tempoScale <= 1.25)
  assert.ok(first.amplitudeScale >= 0.62 && first.amplitudeScale <= 1.24)
})

test('character state and performance phase shape generated timing and weight', () => {
  const calm = generateMotionInstance({
    clipId: 'greet',
    seed: 3,
    phase: 'settle',
    state: { energy: 8, affection: 80 },
  })
  const lively = generateMotionInstance({
    clipId: 'greet',
    seed: 3,
    phase: 'action',
    state: { energy: 95, affection: 80 },
  })
  assert.ok(lively.tempoScale > calm.tempoScale)
  assert.ok(lively.amplitudeScale > calm.amplitudeScale)
})

test('selects the furthest deterministic variant after a repeated clip', () => {
  const previous = generateMotionInstance({ clipId: 'greet', seed: 11 })
  const selected = selectDistinctMotionInstance({
    clipId: 'greet',
    seed: 11,
    previous,
    attempts: 8,
  })
  const repeated = selectDistinctMotionInstance({
    clipId: 'greet',
    seed: 11,
    previous,
    attempts: 8,
  })
  assert.deepEqual(selected, repeated)
  assert.ok(motionInstanceDistance(selected, previous) > 0.08)
  assert.notEqual(
    motionInstanceSignature(selected),
    motionInstanceSignature(previous),
  )
})

test('clip-owned generation envelopes cap arbitrary wide silhouettes', () => {
  for (let seed = 0; seed < 32; seed += 1) {
    const instance = generateMotionInstance({
      clipId: 'generated-wide-pose',
      seed,
      state: { energy: 100 },
      maxAmplitudeScale: 1.02,
    })
    assert.ok(instance.amplitudeScale <= 1.02)
  }
})

test('generated phase clock has continuous endpoints and a held action apex', () => {
  const instance = generateMotionInstance({ clipId: 'greet', seed: 5 })
  assert.equal(generatedMotionProgress(0, instance), 0)
  assert.equal(generatedMotionProgress(1, instance), 1)
  assert.ok(generatedMotionProgress(0.5, instance) > 0.35)
  assert.ok(generatedMotionProgress(0.8, instance) > 0.85)
})

test('adds counter motion only to support bones not authored by the clip', () => {
  const manifest = {
    bones: [
      { id: 'root' },
      { id: 'body' },
      { id: 'head' },
      { id: 'a25d-handwear' },
    ],
  } as CompanionRigManifest
  const pose = manifest.bones.map(() => ({
    translation: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  }))
  const instance = generateMotionInstance({ clipId: 'greet', seed: 9 })
  assert.equal(
    applyGeneratedMotionDynamicsInto(
      pose,
      manifest,
      [false, true, false, true],
      0.7,
      1,
      instance,
    ),
    true,
  )
  assert.equal(pose[1].rotation, 0)
  assert.notEqual(pose[0].translation.x, 0)
  assert.notEqual(pose[2].rotation, 0)
})
