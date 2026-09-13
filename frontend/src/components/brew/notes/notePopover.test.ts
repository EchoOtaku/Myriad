import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { placePopover } from './notePopover'

const viewport = { width: 1000, height: 800 }

describe('placePopover', () => {
  it('默认贴在触发器下面、左边对齐', () => {
    const placed = placePopover(
      { top: 100, left: 40, bottom: 136, width: 36 },
      { width: 220, height: 300 },
      viewport,
    )
    assert.equal(placed.placement, 'bottom')
    assert.equal(placed.left, 40)
    assert.equal(placed.top, 136 + 6)
  })

  it('下面放不下就翻到上面', () => {
    const placed = placePopover(
      { top: 700, left: 40, bottom: 736, width: 36 },
      { width: 220, height: 300 },
      viewport,
    )
    assert.equal(placed.placement, 'top')
    assert.equal(placed.top, 700 - 6 - 300)
  })

  it('右边出界就往回夹，最少留 8px', () => {
    const placed = placePopover(
      { top: 100, left: 900, bottom: 136, width: 36 },
      { width: 220, height: 300 },
      viewport,
    )
    assert.equal(placed.left, 1000 - 220 - 8)
  })
})
