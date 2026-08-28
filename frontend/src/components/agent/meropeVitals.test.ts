import assert from 'node:assert/strict'
import test from 'node:test'
import { activityKey, moodBand } from './meropeVitals'

test('moodBand matches Merope tone thresholds', () => {
  assert.equal(moodBand(0), 'floor')
  assert.equal(moodBand(10), 'floor')
  assert.equal(moodBand(39.9), 'low')
  assert.equal(moodBand(40), 'normal')
  assert.equal(moodBand(70), 'normal')
  assert.equal(moodBand(84.9), 'normal')
  assert.equal(moodBand(85), 'high')
  assert.equal(moodBand(undefined), 'normal')
})

test('activityKey treats unknown and stale labels as idle', () => {
  assert.equal(activityKey('working'), 'working')
  assert.equal(activityKey('thinking'), 'thinking')
  assert.equal(activityKey('talking'), 'talking')
  assert.equal(activityKey('idle'), 'idle')
  assert.equal(activityKey('napping'), 'idle')
  assert.equal(activityKey(undefined), 'idle')
})
