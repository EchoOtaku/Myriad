import type { CompanionRigManifest } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  boneEvaluationOrder,
  clipForActivity,
  createPoseBuffer,
  curveTransform,
  mixPoseByMask,
  mixTransform,
  sampleClip,
  sampleClipInto,
  scalePoseDeltaInto,
} from './animation'

const manifest: CompanionRigManifest = {
  schemaVersion: 1,
  quality: 'portrait-fallback',
  canvas: { width: 1, height: 1 },
  textures: [{ id: 'portrait', url: '/portrait.png', width: 1, height: 1 }],
  bones: [{ id: 'root', parent: null, pivot: { x: 0.5, y: 0.5 } }],
  parts: [],
  clips: [
    {
      id: 'idle',
      duration: 2,
      looping: true,
      tracks: [
        {
          boneId: 'root',
          keyframes: [
            {
              time: 0,
              transform: {
                translation: { x: 0, y: 0 },
                rotation: 0,
                scale: { x: 1, y: 1 },
              },
            },
            {
              time: 2,
              transform: {
                translation: { x: 0.2, y: 0 },
                rotation: 0.2,
                scale: { x: 1, y: 1 },
              },
            },
          ],
        },
      ],
    },
  ],
  defaultClip: 'idle',
}

test('samples looping clips deterministically', () => {
  const clip = clipForActivity(manifest, 'thinking')
  const first = sampleClip(manifest, clip, 1)[0]
  const looped = sampleClip(manifest, clip, 3)[0]
  assert.equal(first.translation.x, looped.translation.x)
  assert.equal(first.rotation, looped.rotation)
})

test('holds the final keyframe when a track ends before the clip', () => {
  const clip = {
    ...manifest.clips[0],
    looping: false,
    tracks: [
      {
        ...manifest.clips[0].tracks[0],
        keyframes: manifest.clips[0].tracks[0].keyframes.map((keyframe) => ({
          ...keyframe,
          time: keyframe.time / 2,
        })),
      },
    ],
  }
  const tail = sampleClip(manifest, clip, 1.75)[0]
  assert.equal(tail.translation.x, 0.2)
  assert.equal(tail.rotation, 0.2)
})

test('reuses pose objects on the animation hot path', () => {
  const clip = manifest.clips[0]
  const output = createPoseBuffer(manifest.bones.length)
  const root = output[0]
  assert.equal(sampleClipInto(output, manifest, clip, 0.25), output)
  assert.equal(sampleClipInto(output, manifest, clip, 0.75)[0], root)
})

test('mixes transforms without overshooting', () => {
  const mixed = mixTransform(
    {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    {
      translation: { x: 1, y: -1 },
      rotation: 0.4,
      scale: { x: 1.2, y: 0.8 },
    },
    0.5,
  )
  assert.deepEqual(mixed.translation, { x: 0.5, y: -0.5 })
  assert.ok(Math.abs(mixed.rotation - 0.2) < 0.000001)
  assert.deepEqual(mixed.scale, { x: 1.1, y: 0.9 })
})

test('one-shot masks preserve activity motion on unrelated bones', () => {
  const base = [
    {
      translation: { x: 0.1, y: -0.1 },
      rotation: 0.2,
      scale: { x: 1, y: 1 },
    },
    {
      translation: { x: 0, y: 0 },
      rotation: -0.1,
      scale: { x: 1, y: 1 },
    },
  ]
  const gesture = [
    {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    {
      translation: { x: 0, y: 0 },
      rotation: 0.7,
      scale: { x: 1, y: 1 },
    },
  ]
  const mixed = mixPoseByMask(base, gesture, 1, [false, true])
  assert.equal(mixed[0], base[0])
  assert.ok(Math.abs(mixed[1].rotation - 0.7) < 0.000001)
})

test('evaluates parents before children even when storage order is reversed', () => {
  const reordered: CompanionRigManifest = {
    ...manifest,
    bones: [
      { id: 'hand', parent: 'arm', pivot: { x: 0.8, y: 0.5 } },
      { id: 'root', parent: null, pivot: { x: 0.5, y: 0.8 } },
      { id: 'arm', parent: 'root', pivot: { x: 0.65, y: 0.5 } },
    ],
  }
  assert.deepEqual(boneEvaluationOrder(reordered), [1, 2, 0])
})

test('curved keyframe interpolation stays inside the segment bounds', () => {
  const pose = curveTransform(
    {
      translation: { x: -2, y: 2 },
      rotation: -1,
      scale: { x: 0.5, y: 1.5 },
    },
    {
      translation: { x: 0, y: 0 },
      rotation: 0,
      scale: { x: 1, y: 1 },
    },
    {
      translation: { x: 1, y: -1 },
      rotation: 0.5,
      scale: { x: 1.2, y: 0.8 },
    },
    {
      translation: { x: 3, y: -3 },
      rotation: 1.2,
      scale: { x: 1.8, y: 0.4 },
    },
    0.5,
  )
  assert.ok(pose.translation.x >= 0 && pose.translation.x <= 1)
  assert.ok(pose.translation.y >= -1 && pose.translation.y <= 0)
  assert.ok(pose.scale.x >= 1 && pose.scale.x <= 1.2)
  assert.ok(pose.scale.y >= 0.8 && pose.scale.y <= 1)
})

test('one-shot endpoints ease in without jumping off the rest pose', () => {
  const clip = {
    ...manifest.clips[0],
    looping: false,
  }
  const early = sampleClip(manifest, clip, 0.02)[0]
  const linearAtSameTime = 0.002
  assert.ok(early.translation.x < linearAtSameTime)
  assert.ok(early.translation.x >= 0)
})

test('scales semantic action deltas without moving identity channels', () => {
  const output = [
    {
      translation: { x: 0.1, y: -0.2 },
      rotation: 0.4,
      scale: { x: 1.2, y: 0.8 },
    },
    {
      translation: { x: 0.3, y: 0.2 },
      rotation: -0.2,
      scale: { x: 0.9, y: 1.1 },
    },
  ]
  scalePoseDeltaInto(output, 0.5, [true, false])
  assert.deepEqual(output[0].translation, { x: 0.05, y: -0.1 })
  assert.equal(output[0].rotation, 0.2)
  assert.deepEqual(output[0].scale, { x: 1.1, y: 0.9 })
  assert.equal(output[1].rotation, -0.2)
})
