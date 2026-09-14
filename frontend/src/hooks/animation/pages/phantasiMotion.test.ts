import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  phantasiMotionClaim,
  phantasiMotionLane,
  phantasiMotionOwns,
  phantasiMotionQuiet,
  phantasiMotionRelease,
  phantasiMotionReset,
} from './phantasiMotion.ts'

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
})
