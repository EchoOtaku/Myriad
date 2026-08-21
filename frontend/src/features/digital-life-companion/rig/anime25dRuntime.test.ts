import assert from 'node:assert/strict'
import test from 'node:test'
import {
  anime25DBlinkClosure,
  anime25DBoneDepth,
  anime25DHairSpringProfile,
  applyAnime25DMotionInto,
  buildAnime25DRuntimeIndex,
  MAX_RIGID_ARM_ROTATION,
} from './anime25dRuntime'

test('uses the upstream close, hold, and reopen blink phases', () => {
  assert.equal(anime25DBlinkClosure(0), 0)
  assert.equal(anime25DBlinkClosure(0.08 / 0.58), 1)
  assert.equal(anime25DBlinkClosure(0.42 / 0.58), 1)
  assert.ok(anime25DBlinkClosure(0.5 / 0.58) > 0)
  assert.equal(anime25DBlinkClosure(1), 0)
})

test('keeps detected hair roots stiffer than their softer tips', () => {
  const root = anime25DHairSpringProfile('a25d-front-hair-strand-1-hair-root')!
  const tip = anime25DHairSpringProfile('a25d-front-hair-strand-1-hair-tip')!
  assert.ok(root.frequencyScale > tip.frequencyScale)
  assert.ok(root.responseScale < tip.responseScale)
  assert.ok(root.maxRotation < tip.maxRotation)
  assert.equal(anime25DHairSpringProfile('front-hair'), null)
})

test('uses the upstream name-based depth table for layered head parts', () => {
  assert.equal(anime25DBoneDepth('a25d-nose'), 1.15)
  assert.equal(anime25DBoneDepth('a25d-front-hair-2-strand-1-hair-root'), 1.28)
  assert.equal(anime25DBoneDepth('a25d-back-hair-strand-1-hair-tip'), 0.55)
  assert.equal(anime25DBoneDepth('left-eye'), 1.08)
  assert.equal(anime25DBoneDepth('a25d-eyewhite-left'), 1.06)
  assert.equal(anime25DBoneDepth('a25d-eyelash-left'), 1.12)
  assert.equal(anime25DBoneDepth('a25d-handwear'), 0.86)
})

test('separates fixed eye whites and lashes from gaze-driven irises', () => {
  const manifest = {
    parts: [{ id: 'a25d-face' }],
    bones: [
      { id: 'root', parent: null },
      { id: 'body', parent: 'root' },
      { id: 'head', parent: 'body' },
      { id: 'face', parent: 'head' },
      { id: 'left-eye', parent: 'face' },
      { id: 'a25d-eyewhite-left', parent: 'face' },
      { id: 'a25d-eyelash-left', parent: 'face' },
      { id: 'a25d-irides-left', parent: 'left-eye' },
    ],
  } as never
  const bindings = new Map(
    buildAnime25DRuntimeIndex(manifest).depthBindings.map((binding) => [
      manifest.bones[binding.index].id,
      binding.depthDelta,
    ]),
  )
  assert.ok(Math.abs(bindings.get('left-eye')! - 0.08) < 1e-9)
  assert.ok(Math.abs(bindings.get('a25d-eyewhite-left')! - 0.06) < 1e-9)
  assert.ok(Math.abs(bindings.get('a25d-eyelash-left')! - 0.12) < 1e-9)
  assert.equal(bindings.has('a25d-irides-left'), false)
})

test('layer depth and chest move while rigid arm fragments sway without limb chains', () => {
  const manifest = {
    parts: [{ id: 'a25d-face' }],
    bones: [
      { id: 'root', parent: null },
      { id: 'body', parent: 'root' },
      { id: 'head', parent: 'body' },
      { id: 'face', parent: 'head' },
      { id: 'a25d-nose', parent: 'head' },
      { id: 'a25d-chest', parent: 'body' },
      { id: 'a25d-handwear', parent: 'body' },
      { id: 'a25d-handwear-left', parent: 'a25d-handwear' },
      { id: 'a25d-handwear-right', parent: 'a25d-handwear' },
    ],
  } as never
  const index = buildAnime25DRuntimeIndex(manifest)
  const pose = manifest.bones.map(() => ({
    translation: { x: 0, y: 0 },
    rotation: 0,
    scale: { x: 1, y: 1 },
  }))
  applyAnime25DMotionInto(pose, index, {
    headTurnX: 1,
    headTurnY: -0.5,
    breath: 1,
    breathAmplitude: 0.004,
    weightShift: 0.5,
    idleAccent: 0.4,
    chestBounce: 0.001,
    handwearSway: 0.5,
    ambientScale: 1,
  })
  assert.ok(pose[4].translation.x > 0)
  assert.ok(pose[5].translation.y < 0)
  assert.ok(pose[6].translation.x > 0)
  assert.ok(Math.abs(pose[6].translation.x) <= 0.004)
  assert.ok(Math.abs(pose[6].translation.y) < 0.001)
  assert.equal(pose[6].rotation, 0)
  assert.ok(pose[7].rotation > 0)
  assert.ok(pose[8].rotation < 0)
  assert.ok(Math.abs(pose[7].rotation) <= MAX_RIGID_ARM_ROTATION)
  assert.ok(Math.abs(pose[8].rotation) <= MAX_RIGID_ARM_ROTATION)
  assert.deepEqual(pose[6].scale, { x: 1, y: 1 })
  assert.equal(
    manifest.bones.some(({ id }) => /arm|forearm|wrist/.test(id)),
    false,
  )
})

test('rigid arm fragments are clamped to plus or minus fifteen degrees after composition', () => {
  const manifest = {
    parts: [{ id: 'a25d-handwear-left' }],
    bones: [
      { id: 'root', parent: null },
      { id: 'body', parent: 'root' },
      { id: 'a25d-handwear', parent: 'body' },
      { id: 'a25d-handwear-left', parent: 'a25d-handwear' },
      { id: 'a25d-handwear-right', parent: 'a25d-handwear' },
    ],
  } as never
  const index = buildAnime25DRuntimeIndex(manifest)
  const pose = manifest.bones.map(() => ({
    translation: { x: 0, y: 0 },
    rotation: 1,
    scale: { x: 1, y: 1 },
  }))
  applyAnime25DMotionInto(pose, index, {
    headTurnX: 0,
    headTurnY: 0,
    breath: 0,
    breathAmplitude: 0,
    weightShift: 0,
    idleAccent: 0,
    chestBounce: 0,
    handwearSway: 1,
    ambientScale: 1,
  })
  assert.equal(pose[3].rotation, MAX_RIGID_ARM_ROTATION)
  assert.equal(pose[4].rotation, MAX_RIGID_ARM_ROTATION)
})
