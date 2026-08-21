import type { CompanionRigManifest, RigTransform } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createOutfitProfile } from './outfit'
import { PosePipeline } from './posePipeline'

const manifest = {
  defaultClip: 'idle',
  bones: [
    { id: 'root', parent: null, pivot: { x: 0.5, y: 0.8 } },
    { id: 'body', parent: 'root', pivot: { x: 0.5, y: 0.5 } },
    { id: 'head', parent: 'body', pivot: { x: 0.5, y: 0.25 } },
  ],
  outfitProfile: createOutfitProfile(['armor']),
} as CompanionRigManifest

function pose(): RigTransform[] {
  return manifest.bones.map(() => ({
    translation: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  }))
}

test('final pose stages stay finite and capture one coherent handoff history', () => {
  const pipeline = new PosePipeline(manifest)
  const output = pose()
  output[1].rotation = 0.4
  pipeline.finalizeInto(output, 16, 'idle', [false, true, false], 0)
  pipeline.finalizeInto(output, 32, 'idle', [false, true, false], 0)
  assert.ok(output.every((transform) => Number.isFinite(transform.rotation)))
  assert.ok(Math.abs(output[1].rotation) < 0.4)

  const handoffPose = pose()
  const velocity = pose()
  assert.equal(pipeline.captureHandoffInto(handoffPose, velocity), true)
  assert.deepEqual(handoffPose, output)
})

test('clock reset invalidates stale handoff history', () => {
  const pipeline = new PosePipeline(manifest)
  const output = pose()
  pipeline.finalizeInto(output, 16, 'idle', [false, false, false], 0)
  pipeline.finalizeInto(output, 32, 'idle', [false, false, false], 0)
  pipeline.resetClock(10_000)
  assert.equal(pipeline.captureHandoffInto(pose(), pose()), false)
})

test('the first sampled expansion frame keeps continuity across a missed tick', () => {
  const pipeline = new PosePipeline(manifest)
  const retained = pose()
  pipeline.finalizeInto(retained, 100, 'idle', [false, true, false], 0)
  pipeline.finalizeInto(retained, 200, 'idle', [false, true, false], 0)

  pipeline.setExpanded(false)
  pipeline.setExpanded(true)
  pipeline.prepareExpansion(500)
  const catchUp = pose()
  catchUp[1].rotation = 2
  pipeline.finalizeInto(catchUp, 516, 'idle', [false, true, false], 0)

  assert.ok(
    Math.abs(catchUp[1].rotation - retained[1].rotation) <= 1.4 + 1e-9,
    'the >120ms source gap cannot bypass the bounded expansion frame',
  )
  assert.ok(catchUp[1].rotation < 2)
})

test('collapsed visibility resume consumes one bounded tick without resetting continuity', () => {
  const pipeline = new PosePipeline(manifest)
  const retained = pose()
  pipeline.setExpanded(false)
  pipeline.finalizeInto(retained, 100, 'idle', [false, true, false], 0)
  pipeline.finalizeInto(retained, 200, 'idle', [false, true, false], 0)

  pipeline.prepareCollapsedVisibilityResume()
  const resumed = pose()
  resumed[1].rotation = 2
  pipeline.finalizeInto(resumed, 10 * 60_000, 'idle', [false, true, false], 0)

  assert.ok(
    Math.abs(resumed[1].rotation - retained[1].rotation) <= 0.8 + 1e-9,
    'the hidden gap is treated as one 100ms collapsed continuity step',
  )
  assert.ok(resumed[1].rotation < 2)
  assert.equal(
    pipeline.captureHandoffInto(pose(), pose()),
    true,
    'collapsed resume preserves pose history instead of resetClock invalidation',
  )
})

test('expansion can take ownership before the collapsed visibility tick without exposing the hidden gap', () => {
  const pipeline = new PosePipeline(manifest)
  const retained = pose()
  pipeline.setExpanded(false)
  pipeline.finalizeInto(retained, 100, 'idle', [false, true, false], 0)
  pipeline.finalizeInto(retained, 200, 'idle', [false, true, false], 0)

  pipeline.prepareCollapsedVisibilityResume()
  pipeline.setExpanded(true, 60_200)
  pipeline.prepareExpansion(60_200)
  const firstExpanded = pose()
  firstExpanded[1].rotation = 2
  pipeline.finalizeInto(firstExpanded, 60_200, 'idle', [false, true, false], 0)

  assert.ok(
    Math.abs(firstExpanded[1].rotation - retained[1].rotation) <= 0.8 + 1e-9,
    'the expansion render consumes the pending collapsed 100ms slot itself',
  )
  assert.ok(firstExpanded[1].rotation < 2)
  assert.equal(
    pipeline.captureHandoffInto(pose(), pose()),
    true,
    'the race preserves the retained spring and velocity baseline',
  )
})

test('every delayed collapsed sample keeps final continuity inside one 100ms tick', () => {
  const pipeline = new PosePipeline(manifest)
  const retained = pose()
  pipeline.setExpanded(false)
  pipeline.finalizeInto(retained, 100, 'idle', [false, true, false], 0)
  pipeline.finalizeInto(retained, 200, 'idle', [false, true, false], 0)

  const delayed = pose()
  delayed[1].rotation = 2
  pipeline.finalizeInto(delayed, 1_250, 'idle', [false, true, false], 0)

  assert.ok(
    Math.abs(delayed[1].rotation - retained[1].rotation) <= 0.8 + 1e-9,
    'a delayed poll/render cannot bypass collapsed final-pose continuity',
  )
  assert.ok(delayed[1].rotation < 2)
})

test('expansion after more than ten collapsed minutes clips an impossible first pose', () => {
  const pipeline = new PosePipeline(manifest)
  const retained = pose()
  pipeline.setExpanded(false)
  pipeline.finalizeInto(retained, 600_000, 'idle', [false, true, false], 0)
  pipeline.finalizeInto(retained, 600_100, 'idle', [false, true, false], 0)

  pipeline.setExpanded(true)
  pipeline.prepareExpansion(600_500)
  const firstExpanded = pose()
  firstExpanded[1].rotation = 2
  pipeline.finalizeInto(firstExpanded, 600_516, 'idle', [false, true, false], 0)

  assert.ok(
    Math.abs(firstExpanded[1].rotation - retained[1].rotation) <= 0.8 + 1e-9,
    'the first sampled expansion pose stays inside one collapsed continuity step',
  )
  assert.ok(firstExpanded[1].rotation < 2)
})
