import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  __coverDecodeSlotStatsForTest,
  acquireCoverDecodeSlot,
} from './libraryCardMedia'

describe('acquireCoverDecodeSlot', () => {
  it('caps concurrent grants and drains the wait queue', async () => {
    const releases: Array<() => void> = []
    for (let i = 0; i < 8; i++) {
      releases.push(await acquireCoverDecodeSlot())
    }
    assert.equal(__coverDecodeSlotStatsForTest().active, 8)

    let ninthResolved = false
    const ninthPromise = acquireCoverDecodeSlot().then((release) => {
      ninthResolved = true
      releases.push(release)
    })
    await Promise.resolve()
    assert.equal(ninthResolved, false)
    assert.equal(__coverDecodeSlotStatsForTest().waiting, 1)

    releases[0]()
    await ninthPromise
    assert.equal(ninthResolved, true)
    assert.equal(__coverDecodeSlotStatsForTest().active, 8)

    for (const release of releases) release()
    assert.equal(__coverDecodeSlotStatsForTest().active, 0)
    assert.equal(__coverDecodeSlotStatsForTest().waiting, 0)
  })
})

describe('cover cancellation', () => {
  it('removes aborted waiters and releases aborted active loads', async () => {
    const controller = new AbortController()
    const releases = await Promise.all(Array.from({ length: 8 }, () => acquireCoverDecodeSlot()))
    const queued = acquireCoverDecodeSlot(controller.signal)
    const rejected = assert.rejects(queued, { name: 'AbortError' })
    controller.abort()
    try {
      assert.equal(__coverDecodeSlotStatsForTest().waiting, 0)
      await rejected
    } finally { releases.forEach((release) => release()) }
    const active = new AbortController()
    const release = await acquireCoverDecodeSlot(active.signal)
    active.abort()
    assert.equal(__coverDecodeSlotStatsForTest().active, 0)
    release()
  })
})
