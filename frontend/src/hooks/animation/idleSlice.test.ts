import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  IDLE_TIMEOUT_BATCH,
  runIdleSlice,
  TASK_FLUSH_BATCH,
} from './idleSlice'

describe('runIdleSlice', () => {
  it('does not drain the queue when requestIdleCallback times out', () => {
    const queue = [1, 2, 3, 4, 5]
    const ran: number[] = []
    runIdleSlice(
      queue,
      { didTimeout: true, timeRemaining: () => 0 },
      (item) => ran.push(item),
    )
    assert.deepEqual(ran, [1])
    assert.equal(ran.length, IDLE_TIMEOUT_BATCH)
    assert.deepEqual(queue, [2, 3, 4, 5])
  })

  it('keeps taking work while the idle deadline has budget', () => {
    const queue = [1, 2, 3]
    const ran: number[] = []
    let remaining = 12
    runIdleSlice(
      queue,
      {
        didTimeout: false,
        timeRemaining: () => remaining,
      },
      (item) => {
        ran.push(item)
        remaining -= 5
      },
      2,
    )
    assert.deepEqual(ran, [1, 2])
    assert.deepEqual(queue, [3])
  })

  it('stops before a task when the remaining budget is already spent', () => {
    const queue = [1, 2]
    const ran: number[] = []
    runIdleSlice(
      queue,
      { didTimeout: false, timeRemaining: () => 2 },
      (item) => ran.push(item),
      2,
    )
    assert.deepEqual(ran, [])
    assert.deepEqual(queue, [1, 2])
  })
})

describe('TASK_FLUSH_BATCH', () => {
  it('stays small enough to keep a MessageChannel flush off the Long Task budget', () => {
    assert.equal(TASK_FLUSH_BATCH, 8)
  })
})
