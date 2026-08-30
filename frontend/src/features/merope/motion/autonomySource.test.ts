import type { AutonomyClock } from './autonomySource'
import assert from 'node:assert/strict'
import test from 'node:test'
import { AutonomyMotionSource } from './autonomySource'
import { RigMotionCoordinator } from './coordinator'

function manualClock(): AutonomyClock & {
  nowMs: number
  timers: number
} {
  let nowMs = 0
  const timers = new Map<number, { at: number; cb: () => void }>()
  let seq = 1
  return {
    get nowMs() {
      return nowMs
    },
    set nowMs(value: number) {
      nowMs = value
    },
    get timers() {
      return timers.size
    },
    now: () => nowMs,
    setTimeout: (callback, delayMs) => {
      const id = seq
      seq += 1
      timers.set(id, { at: nowMs + delayMs, cb: callback })
      return id
    },
    clearTimeout: (timer) => {
      timers.delete(timer as number)
    },
  }
}

test('autonomy claims expression and gaze, never the mouth or music body', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('music', ['mouth', 'headBody'], { nowMs: 0 })
  const clock = manualClock()
  const intents: Array<string | null> = []
  const source = new AutonomyMotionSource(
    coordinator,
    (intent) => {
      intents.push(intent?.directive?.plan.cues[0]?.intent ?? null)
    },
    () => false,
    clock,
    () => 0,
  )
  source.start()
  source.consider(0)
  assert.equal(coordinator.owner('expression', 0), 'autonomy')
  assert.equal(coordinator.owner('gaze', 0), 'autonomy')
  assert.equal(coordinator.owner('mouth', 0), 'music')
  assert.equal(coordinator.owner('headBody', 0), 'music')
  assert.deepEqual(intents, ['think'])
  source.stop()
  assert.equal(coordinator.owner('expression', 0), 'idle')
  assert.equal(intents.at(-1), null)
})

test('speech and explicit performance keep autonomy off the face', () => {
  const coordinator = new RigMotionCoordinator()
  const clock = manualClock()
  const source = new AutonomyMotionSource(
    coordinator,
    () => {},
    () => true,
    clock,
    () => 0.9,
  )
  source.start()
  source.consider(0)
  assert.equal(coordinator.owner('expression', 0), 'idle')

  const busy = new AutonomyMotionSource(
    coordinator,
    () => {},
    () => false,
    clock,
    () => 0.9,
  )
  coordinator.claim('performance', ['expression'], { nowMs: 1 })
  busy.start()
  busy.consider(1)
  assert.equal(coordinator.owner('expression', 1), 'performance')
  assert.equal(coordinator.owner('gaze', 1), 'idle')
  busy.stop()
  source.stop()
})

test('a listen pulse still leaves singing on the body', () => {
  const coordinator = new RigMotionCoordinator()
  coordinator.claim('music', ['mouth', 'headBody'], { nowMs: 5 })
  const clock = manualClock()
  const source = new AutonomyMotionSource(
    coordinator,
    () => {},
    () => false,
    clock,
    () => 0.9,
  )
  source.start()
  source.consider(5)
  assert.equal(source.current()?.directive?.plan.cues[0]?.intent, 'listen')
  assert.equal(coordinator.owner('headBody', 5), 'music')
  assert.equal(coordinator.owner('mouth', 5), 'music')
  source.stop()
})
