import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  revealFeedsTree,
  SITE_RAIL_OP,
  siteRestOpacity,
} from './flipCards.ts'

describe('flipCards', () => {
  it('换树揭入场树时空根是空操作', () => {
    revealFeedsTree(null)
    revealFeedsTree(undefined)
  })

  it('落点透明度跟皮肤走', () => {
    assert.equal(siteRestOpacity(false), SITE_RAIL_OP)
    assert.equal(siteRestOpacity(true), 1)
  })
})
