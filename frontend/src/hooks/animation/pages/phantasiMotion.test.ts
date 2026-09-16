import type { PhantasiMotionLane } from './phantasiMotion.ts'
import assert from 'node:assert/strict'

import { describe, it } from 'node:test'
import { coordinator } from '../coordinator.ts'
import { AnimationState } from '../types.ts'
import {
  onPhantasiMotion,
  PHANTASI_MOTION_SLOT,
  phantasiMotionBusy,
  phantasiMotionClaim,
  phantasiMotionLane,

  phantasiMotionOwns,
  phantasiMotionQuiet,
  phantasiMotionRelease,
  phantasiMotionReset,
  whenPhantasiMotionIdle,
  whenPhantasiPeekReady,
} from './phantasiMotion.ts'

function readyPhantasiPage(): void {
  coordinator.reset()
  coordinator.startPageTransition('phantasi')
  coordinator.completePageTransition('phantasi')
}

describe('phantasiMotion', () => {
  it('后来的占位作废前一次', () => {
    phantasiMotionReset()
    const intro = phantasiMotionClaim('intro')
    const flip = phantasiMotionClaim('flip')
    assert.equal(phantasiMotionOwns(intro), false)
    assert.equal(phantasiMotionOwns(flip), true)
    assert.equal(phantasiMotionLane(), 'flip')
    phantasiMotionRelease(intro)
    assert.equal(phantasiMotionLane(), 'flip')
    phantasiMotionRelease(flip)
    assert.equal(phantasiMotionLane(), 'idle')
  })

  it('栏上换波次不占 lane，开合仍持有', () => {
    phantasiMotionReset()
    const flip = phantasiMotionClaim('flip')
    assert.equal(phantasiMotionLane(), 'flip')
    assert.equal(phantasiMotionOwns(flip), true)
    phantasiMotionRelease(flip)
    assert.equal(phantasiMotionLane(), 'idle')
  })

  it('换树占开合之后开合不能再收尾', () => {
    phantasiMotionReset()
    const flip = phantasiMotionClaim('flip')
    const lane = phantasiMotionClaim('lane')
    assert.equal(phantasiMotionOwns(flip), false)
    assert.equal(phantasiMotionOwns(lane), true)
    assert.equal(phantasiMotionLane(), 'lane')
    phantasiMotionRelease(lane)
    assert.equal(phantasiMotionLane(), 'idle')
  })

  it('入场被开合作废后不能再收 DOM', () => {
    phantasiMotionReset()
    const intro = phantasiMotionClaim('intro')
    const flip = phantasiMotionClaim('flip')
    assert.equal(phantasiMotionOwns(intro), false)
    assert.equal(phantasiMotionOwns(flip), true)
    phantasiMotionRelease(intro)
    assert.equal(phantasiMotionOwns(flip), true)
    phantasiMotionRelease(flip)
  })

  it('无 window 当静音', () => {
    assert.equal(phantasiMotionQuiet(), true)
  })

  it('peek 不能抢走换树，换树能顶掉 peek', () => {
    phantasiMotionReset()
    const lane = phantasiMotionClaim('lane')
    assert.equal(phantasiMotionClaim('peek'), 0)
    assert.equal(phantasiMotionOwns(lane), true)
    assert.equal(phantasiMotionBusy(), true)
    phantasiMotionRelease(lane)
    const peek = phantasiMotionClaim('peek')
    assert.equal(phantasiMotionOwns(peek), true)
    assert.equal(phantasiMotionBusy(), false)
    const nextLane = phantasiMotionClaim('lane')
    assert.equal(phantasiMotionOwns(peek), false)
    assert.equal(phantasiMotionOwns(nextLane), true)
    phantasiMotionRelease(nextLane)
  })

  it('空闲或 peek 时立刻跑，换树结束再跑', () => {
    phantasiMotionReset()
    let idleHits = 0
    whenPhantasiMotionIdle(() => {
      idleHits += 1
    })
    assert.equal(idleHits, 1)
    const lane = phantasiMotionClaim('lane')
    let after = 0
    const stop = whenPhantasiMotionIdle(() => {
      after += 1
    })
    assert.equal(after, 0)
    phantasiMotionRelease(lane)
    assert.equal(after, 1)
    stop()
  })

  it('peek 被换树顶掉后空闲再通知', () => {
    phantasiMotionReset()
    const peek = phantasiMotionClaim('peek')
    const stolen: PhantasiMotionLane[] = []
    const stop = onPhantasiMotion((lane) => {
      stolen.push(lane)
    })
    const lane = phantasiMotionClaim('lane')
    assert.equal(phantasiMotionOwns(peek), false)
    assert.deepEqual(stolen, ['lane'])
    let resumed = 0
    whenPhantasiMotionIdle(() => {
      resumed += 1
    })
    assert.equal(resumed, 0)
    phantasiMotionRelease(lane)
    assert.equal(resumed, 1)
    stop()
  })

  it('占位走 coordinator，peek 是 ELEMENT，换树 skip peek', () => {
    readyPhantasiPage()
    phantasiMotionReset()
    const peek = phantasiMotionClaim('peek')
    assert.equal(phantasiMotionOwns(peek), true)
    assert.equal(
      coordinator.getState(PHANTASI_MOTION_SLOT.peek),
      AnimationState.READY,
    )
    const lane = phantasiMotionClaim('lane')
    assert.equal(phantasiMotionOwns(peek), false)
    assert.equal(
      coordinator.getState(PHANTASI_MOTION_SLOT.peek),
      AnimationState.SKIPPED,
    )
    assert.equal(
      coordinator.getState(PHANTASI_MOTION_SLOT.lane),
      AnimationState.READY,
    )
    phantasiMotionRelease(lane)
    assert.equal(
      coordinator.getState(PHANTASI_MOTION_SLOT.lane),
      AnimationState.COMPLETED,
    )
  })

  it('coordinator 放行 peek 槽后再画', async () => {
    readyPhantasiPage()
    phantasiMotionReset()
    phantasiMotionClaim('peek')
    let painted = 0
    whenPhantasiPeekReady(() => {
      painted += 1
    })
    assert.equal(painted, 0)
    await Promise.resolve()
    assert.equal(painted, 1)
    assert.equal(
      coordinator.getState(PHANTASI_MOTION_SLOT.peek),
      AnimationState.RUNNING,
    )
  })
})
