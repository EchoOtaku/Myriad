import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isSourceSortMode,
  readSourceSortMode,
  writeSourceSortMode,
} from './sourceSort.ts'

/** node:test 没有 localStorage。 */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  return store
}

describe('sourceSort', () => {
  it('只认四种排序，写盘后再读回来', () => {
    installStorage()
    assert.equal(isSourceSortMode('smart'), true)
    assert.equal(isSourceSortMode('settings'), false)
    writeSourceSortMode('pinyin')
    assert.equal(readSourceSortMode(), 'pinyin')
    writeSourceSortMode('smart')
    assert.equal(readSourceSortMode(), 'smart')
  })
})
