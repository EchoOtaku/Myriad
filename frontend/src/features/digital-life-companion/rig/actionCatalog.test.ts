import type { RigClip } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableRigActionPresetGroups,
  labelMotionId,
  RIG_PREVIEW_INTENTS,
  sortRigClipsForDemo,
} from './actionCatalog'

function clip(id: string): RigClip {
  return {
    id,
    duration: 1,
    looping: false,
    tracks: [],
  }
}

test('catalog keeps upper-body presets and preview intents', () => {
  assert.deepEqual(RIG_PREVIEW_INTENTS, [
    'greet',
    'respond',
    'question',
    'delight',
    'emphasize',
    'notify',
  ])
  assert.deepEqual(
    availableRigActionPresetGroups([
      clip('happy'),
      clip('nod'),
      clip('greet'),
      clip('idle'),
    ]),
    [
      { label: 'motionPresetCommunication', clipIds: ['greet', 'nod'] },
      { label: 'motionPresetExpression', clipIds: ['happy'] },
      { label: 'motionPresetAmbient', clipIds: ['idle'] },
    ],
  )
})

test('asset sweep order is deterministic and preserves unknown clips last', () => {
  assert.deepEqual(
    sortRigClipsForDemo([
      clip('custom-action'),
      clip('idle'),
      clip('nod'),
      clip('talking'),
    ]).map(({ id }) => id),
    ['nod', 'talking', 'idle', 'custom-action'],
  )
})

test('upper-body authored actions stay in communication, emotion and ambient groups', () => {
  assert.deepEqual(
    availableRigActionPresetGroups([
      clip('deep-breath'),
      clip('shy'),
      clip('bow'),
    ]),
    [
      { label: 'motionPresetCommunication', clipIds: ['bow'] },
      { label: 'motionPresetEmotion', clipIds: ['shy'] },
      { label: 'motionPresetAmbient', clipIds: ['deep-breath'] },
    ],
  )
})

test('labelMotionId strips the anime25d prefix and title-cases the rest', () => {
  assert.equal(labelMotionId('idle-accent'), 'Idle Accent')
  assert.equal(labelMotionId('a25d-front-hair-1-root'), 'Front Hair 1 Root')
})
