import assert from 'node:assert/strict'
import test from 'node:test'
import {
  estimateSpeechDurationMs,
  planVisemes,
  visemeAt,
  visemeForUnit,
} from './articulation'

test('maps multilingual speech units into stable mouth shapes', () => {
  assert.equal(visemeForUnit('m'), 'closed')
  assert.equal(visemeForUnit('o'), 'round')
  assert.equal(visemeForUnit('i'), 'wide')
  assert.equal(visemeForUnit('。'), 'rest')
  assert.notEqual(visemeForUnit('你'), 'rest')
})

test('builds a duration-aligned viseme timeline with punctuation pauses', () => {
  const cues = planVisemes('Hi, 你好', 1_400)
  assert.ok(cues.length >= 4)
  assert.equal(visemeAt(cues, -1), 'rest')
  assert.equal(visemeAt(cues, 2_000), 'rest')
  const end = cues[cues.length - 1].atMs + cues[cues.length - 1].durationMs
  assert.ok(Math.abs(end - 1_400) < 1)
})

test('speech duration estimate supports unspaced CJK and spaced languages', () => {
  assert.ok(estimateSpeechDurationMs('这是一个测试') > 900)
  assert.ok(estimateSpeechDurationMs('this is a test') > 900)
})
