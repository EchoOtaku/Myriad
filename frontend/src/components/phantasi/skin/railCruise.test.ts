import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  friendsSiteAutoOn,
  friendsStoryAutoOn,
  railCruiseCol,
  railCruiseNextCol,
  railLoopCol,
} from './railCruise.ts'

describe('friendsSiteAutoOn / railCruiseNextCol', () => {
  it('友联超过 16 条才巡航，文章两张起就巡航', () => {
    assert.equal(friendsSiteAutoOn(16), false)
    assert.equal(friendsSiteAutoOn(17), true)
    assert.equal(friendsSiteAutoOn(0), false)
    assert.equal(friendsStoryAutoOn(1), false)
    assert.equal(friendsStoryAutoOn(2), true)
  })

  it('按列坐下一槽，最后一格经复制列折回', () => {
    assert.equal(railCruiseCol(0, 300), 1)
    assert.equal(railCruiseCol(300, 300), 2)
    assert.equal(railCruiseCol(149, 300), 1)
    assert.equal(railCruiseCol(151, 300), 2)
    assert.equal(railLoopCol(13, 12), 1)
    assert.equal(railLoopCol(24, 12), 12)
    assert.deepEqual(railCruiseNextCol(1, 12), { align: 2, reset: null })
    assert.deepEqual(railCruiseNextCol(11, 12), { align: 12, reset: null })
    assert.deepEqual(railCruiseNextCol(12, 12), { align: 13, reset: 1 })
    assert.deepEqual(railCruiseNextCol(13, 12), { align: 2, reset: null })
  })
})
