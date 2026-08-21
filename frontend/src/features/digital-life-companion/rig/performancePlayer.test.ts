import type { PerformanceAnimationClock } from './performancePlayer'
import type {
  RigPerformanceSequence,
  RigPerformanceTimelineEvent,
} from './performanceTypes'
import assert from 'node:assert/strict'
import test from 'node:test'
import { RigPerformancePlayer } from './performancePlayer'

class FakeAnimationClock implements PerformanceAnimationClock {
  current = 0
  nextFrameId = 1
  frames = new Map<number, (now: number) => void>()

  now = () => this.current

  requestFrame = (callback: (now: number) => void) => {
    const id = this.nextFrameId++
    this.frames.set(id, callback)
    return id
  }

  cancelFrame = (frameId: number) => {
    this.frames.delete(frameId)
  }

  step(now: number): void {
    this.current = now
    const callbacks = [...this.frames.values()]
    this.frames.clear()
    callbacks.forEach((callback) => callback(now))
  }
}

const sequence: RigPerformanceSequence = {
  id: 'celebration',
  durationMs: 1_000,
  cues: [
    {
      atMs: 0,
      phase: 'anticipation',
      actions: [performanceAction('surprise')],
      gaze: { x: 0, y: -0.1, attention: 1 },
      gazeLeadMs: 80,
      expression: 'surprise',
      expressionLeadMs: 60,
    },
    {
      atMs: 400,
      phase: 'action',
      actions: [
        {
          ...performanceAction('greet'),
          contacts: [
            { atMs: 300, kind: 'accent-body', intensity: 0.9 },
            { atMs: 520, kind: 'accent-body', intensity: 0.8 },
          ],
        },
      ],
      gaze: { x: 0.2, y: 0, attention: 1 },
      gazeLeadMs: 100,
      expression: 'happy',
      expressionLeadMs: 80,
    },
  ],
}

function performanceAction(clipId: string) {
  return {
    clipId,
    priority: 200,
    intensity: 1,
    tempo: 1,
    fadeInMs: 120,
    fadeOutMs: 240,
    transitionMs: 200,
    interrupt: 'replace' as const,
    exclusive: true,
    contacts: [],
  }
}

test('player catches up due events and completes on the monotonic clock', () => {
  const clock = new FakeAnimationClock()
  const player = new RigPerformancePlayer(clock)
  const events: RigPerformanceTimelineEvent[] = []
  const progress: number[] = []
  player.play(sequence, {
    onEvent: (_, event) => events.push(event),
    onProgress: (state) => progress.push(state.elapsedMs),
  })
  assert.deepEqual(
    events.map(({ type }) => type),
    ['gaze', 'expression', 'action'],
  )
  clock.step(750)
  assert.ok(events.some(({ type }) => type === 'contact'))
  clock.step(1_000)
  assert.equal(events.at(-1)?.type, 'release')
  assert.equal(progress.at(-1), 1_000)
  assert.equal(clock.frames.size, 0)
})

test('replay cancels the previous frame generation', () => {
  const clock = new FakeAnimationClock()
  const player = new RigPerformancePlayer(clock)
  let firstEvents = 0
  let secondEvents = 0
  player.play(sequence, { onEvent: () => (firstEvents += 1) })
  const staleFrameIds = [...clock.frames.keys()]
  clock.current = 200
  player.play(sequence, { onEvent: () => (secondEvents += 1) })
  assert.ok(staleFrameIds.every((id) => !clock.frames.has(id)))
  clock.step(500)
  assert.equal(firstEvents, 3)
  assert.ok(secondEvents > 3)
})

test('stop cancels playback and reports a terminal state once', () => {
  const clock = new FakeAnimationClock()
  const player = new RigPerformancePlayer(clock)
  const running: boolean[] = []
  player.play(sequence, {
    onEvent: () => {},
    onProgress: (state) => running.push(state.running),
  })
  clock.current = 240
  player.stop()
  assert.deepEqual(running, [true, false])
  assert.equal(clock.frames.size, 0)
})
