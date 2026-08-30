import assert from 'node:assert/strict'
import test from 'node:test'
import { sampleMouth } from './ttsPlayer'

test('audio energy maps to a rest viseme when the buffer is silence', () => {
  const bins = new Uint8Array(32)
  bins.fill(128)
  const sample = sampleMouth(bins)
  assert.equal(sample.viseme, 'rest')
  assert.ok((sample.energy ?? 0) < 0.06)
})

test('louder audio opens the mouth instead of staying at rest', () => {
  const bins = new Uint8Array(32)
  for (let i = 0; i < bins.length; i++) bins[i] = i % 2 === 0 ? 20 : 230
  const sample = sampleMouth(bins)
  assert.notEqual(sample.viseme, 'rest')
  assert.ok((sample.energy ?? 0) > 0.2)
})
