import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  itemListHasMore,
  itemListRequest,
} from './itemList.ts'

describe('item list cursor', () => {
  it('prefers next_cursor over item count', () => {
    assert.equal(itemListHasMore('1:2', 1, 20), true)
    assert.equal(itemListHasMore(null, 20, 20), false)
    assert.equal(itemListHasMore(undefined, 20, 20), true)
    assert.equal(itemListHasMore(undefined, 3, 20), false)
  })

  it('passes opaque cursors through and drops page', () => {
    assert.deepEqual(itemListRequest({ cursor: 'us:1700000000123456:2', page: 3, perPage: 20 }), {
      cursor: 'us:1700000000123456:2',
      per_page: 20,
    })
    assert.deepEqual(
      itemListRequest({ cursor: ' opaque-v2-token ', page: 3, perPage: 20 }),
      {
        cursor: 'opaque-v2-token',
        per_page: 20,
      },
    )
    assert.deepEqual(itemListRequest({ cursor: ' ', page: 3, perPage: 20 }), {
      page: 3,
      per_page: 20,
    })
    assert.deepEqual(itemListRequest({ page: 1, perPage: 20 }), {
      page: 1,
      per_page: 20,
    })
  })
})
