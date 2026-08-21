import type { CompanionRigManifest } from './types'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advancePerformanceTimeline,
  buildPerformanceTimeline,
  buildRigPerformanceSequences,
  performancePlaybackState,
} from './performance'

const ids = [
  'observe',
  'greet',
  'nod',
  'listen',
  'surprise',
  'proud',
  'thinking',
  'shake-head',
  'respond',
  'idle-accent',
  'shy',
  'sigh',
  'happy',
  'bow',
  'poke-reaction',
  'startle-settle',
]

const manifest = {
  clips: ids.map((id) => ({
    id,
    duration: 1.4,
    looping: id === 'thinking',
    tracks: [],
    events: [],
  })),
} as unknown as CompanionRigManifest

test('builds authored scene demos with anticipation, action and settle phases', () => {
  const sequences = buildRigPerformanceSequences(manifest)
  assert.equal(sequences.length, 9)
  for (const sequence of sequences) {
    assert.ok(sequence.cues.length >= 3)
    assert.equal(sequence.cues[0].phase, 'anticipation')
    assert.equal(sequence.cues.at(-1)?.phase, 'settle')
    assert.ok(sequence.cues.some((cue) => cue.phase === 'action'))
    assert.ok(sequence.cues.every((cue) => cue.atMs < sequence.durationMs))
    assert.ok(sequence.cues.every((cue) => cue.gaze !== undefined))
    assert.ok(sequence.cues.every((cue) => cue.gazeLeadMs > 0))
    assert.ok(sequence.cues.every((cue) => cue.expressionLeadMs > 0))
    assert.ok(sequence.cues.every((cue) => cue.actions.length > 0))
    assert.ok(
      sequence.cues
        .flatMap((cue) => cue.actions)
        .every(
          (action) =>
            action.fadeInMs > 0 &&
            action.fadeOutMs > 0 &&
            action.transitionMs > 0,
        ),
    )
    for (const cue of sequence.cues) {
      for (const action of cue.actions) {
        const clip = manifest.clips.find((item) => item.id === action.clipId)
        assert.ok(clip)
        assert.ok(
          action.contacts.every(
            (contact) =>
              cue.atMs + contact.atMs < sequence.durationMs &&
              contact.atMs < (clip.duration * 1_000) / action.tempo,
          ),
        )
      }
    }
  }
  assert.ok(
    sequences.some((sequence) =>
      sequence.cues.some((cue) => cue.actions.length > 1),
    ),
  )
})

test('builds gaze and expression leads before upper-body actions', () => {
  const celebration = buildRigPerformanceSequences(manifest).find(
    (sequence) => sequence.id === 'celebration',
  )
  assert.ok(celebration)
  const timeline = buildPerformanceTimeline(celebration)
  const actionIndex = celebration.cues.findIndex(
    (cue) => cue.phase === 'action',
  )
  const action = timeline.find(
    (event) => event.type === 'action' && event.cueIndex === actionIndex,
  )
  const gaze = timeline.find(
    (event) => event.type === 'gaze' && event.cueIndex === actionIndex,
  )
  const expression = timeline.find(
    (event) => event.type === 'expression' && event.cueIndex === actionIndex,
  )
  assert.ok(action)
  assert.ok(gaze)
  assert.ok(expression)
  assert.ok(gaze.atMs < action.atMs)
  assert.ok(expression.atMs < action.atMs)
  assert.equal(
    celebration.cues
      .flatMap((cue) => cue.actions)
      .some((item) => item.clipId === 'wave' || item.clipId === 'clap'),
    false,
  )
  assert.equal(timeline.at(-1)?.type, 'release')
  assert.equal(timeline.at(-1)?.atMs, celebration.durationMs)
})

test('layers a secondary upper-body action inside one authored beat', () => {
  const explanation = buildRigPerformanceSequences(manifest).find(
    (sequence) => sequence.id === 'explanation',
  )
  assert.ok(explanation)
  const layered = explanation.cues.find((cue) => cue.actions.length > 1)
  assert.ok(layered)
  assert.equal(layered.actions[0].exclusive, true)
  assert.ok(layered.actions.slice(1).every((action) => !action.exclusive))
})

test('timeline catch-up emits every due event once after a delayed frame', () => {
  const celebration = buildRigPerformanceSequences(manifest).find(
    (sequence) => sequence.id === 'celebration',
  )
  assert.ok(celebration)
  const timeline = buildPerformanceTimeline(celebration)
  const first = advancePerformanceTimeline(timeline, 0, 1_500)
  assert.ok(first.due.length > 4)
  const second = advancePerformanceTimeline(timeline, first.cursor, 1_500)
  assert.deepEqual(second.due, [])
  const completed = advancePerformanceTimeline(
    timeline,
    second.cursor,
    celebration.durationMs,
  )
  assert.equal(completed.cursor, timeline.length)
  assert.equal(completed.due.at(-1)?.type, 'release')
})

test('playback state exposes the current authored beat and clamps elapsed time', () => {
  const greeting = buildRigPerformanceSequences(manifest).find(
    (sequence) => sequence.id === 'greeting',
  )
  assert.ok(greeting)
  const state = performancePlaybackState(greeting, 2_300, true)
  assert.equal(state.cueIndex, 2)
  assert.equal(state.phase, 'action')
  assert.equal(state.running, true)
  assert.equal(
    performancePlaybackState(greeting, 99_000, false).elapsedMs,
    greeting.durationMs,
  )
})

test('omits scenes that cannot resolve at least three real clips', () => {
  const sparse = {
    ...manifest,
    clips: manifest.clips.filter((clip) => clip.id === 'nod'),
  }
  assert.deepEqual(buildRigPerformanceSequences(sparse), [])
})
