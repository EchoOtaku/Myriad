import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isSourceSortMode, normalizeSourceSortMode } from './sourceSort.ts'

describe('sourceSort', () => {
  it('accepts all configured modes and defaults invalid or legacy missing values to smart', () => {
    for (const mode of ['smart', 'update', 'category', 'pinyin']) {
      assert.equal(isSourceSortMode(mode), true)
      assert.equal(normalizeSourceSortMode(mode), mode)
    }
    for (const value of [undefined, null, 1, 'settings']) {
      assert.equal(isSourceSortMode(value), false)
      assert.equal(normalizeSourceSortMode(value), 'smart')
    }
  })
})
