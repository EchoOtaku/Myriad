import type { RigClip } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import { authorPresentationEnvelope } from './clipAuthoring'

const clip: RigClip = {
  id: 'generated-rhythm',
  duration: 2,
  looping: false,
  tracks: [],
  presentation: { expression: 'happy' },
  events: [{ progress: 0.8, kind: 'accent-body', intensity: 0.4 }],
  generation: { maxAmplitudeScale: 1.02 },
}

test('authors a presentation envelope without dropping clip metadata', () => {
  const authored = authorPresentationEnvelope(clip)
  assert.deepEqual(
    authored.presentation?.keyframes?.map((frame) => frame.progress),
    [0, 0.16, 0.82, 1],
  )
  assert.equal(authored.presentation?.keyframes?.[0].expression, 'neutral')
  assert.equal(authored.presentation?.keyframes?.[1].expression, 'happy')
  assert.deepEqual(authored.events, clip.events)
  assert.deepEqual(authored.generation, clip.generation)
  assert.throws(
    () => authorPresentationEnvelope({ ...clip, presentation: undefined }),
    /no static presentation intent/,
  )
})
