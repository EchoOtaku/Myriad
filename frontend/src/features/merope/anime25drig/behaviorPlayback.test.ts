import assert from 'node:assert/strict'
import test from 'node:test'
import { reconcilePlayedBehaviorCues } from './behaviorPlayback'

test('a removed cue resets playback even while the global plan stays alive', () => {
  const played = new Set(['performance:a', 'performance:b'])
  assert.equal(reconcilePlayedBehaviorCues(played, ['performance:b']), true)
  assert.equal(played.size, 0)
})

test('an additive revision keeps already playing cues intact', () => {
  const played = new Set(['performance:a'])
  assert.equal(
    reconcilePlayedBehaviorCues(played, ['performance:a', 'performance:b']),
    false,
  )
  assert.deepEqual([...played], ['performance:a'])
})
