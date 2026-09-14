import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isAllSelected,
  nextSelectAllIds,
  pruneSelectedIds,
  toggleSelectedId,
} from './listSelect.ts'

describe('listSelect', () => {
  it('勾选和取消勾选', () => {
    const one = toggleSelectedId(new Set<number>(), 2)
    assert.deepEqual([...one], [2])
    assert.deepEqual([...toggleSelectedId(one, 2)], [])
    assert.deepEqual([...toggleSelectedId(one, 3)].sort(), [2, 3])
  })

  it('全选已全中则清空，否则收成当前列表', () => {
    const ids = [1, 2, 3]
    assert.deepEqual([...nextSelectAllIds(new Set(), ids)], ids)
    assert.deepEqual([...nextSelectAllIds(new Set([1]), ids)], ids)
    assert.deepEqual([...nextSelectAllIds(new Set(ids), ids)], [])
    assert.equal(isAllSelected(new Set(ids), ids), true)
    assert.equal(isAllSelected(new Set([1, 2]), ids), false)
    assert.equal(isAllSelected(new Set(), []), false)
  })

  it('过滤后丢掉看不见的选中，没变则沿用原集合', () => {
    const current = new Set([1, 2, 4])
    const pruned = pruneSelectedIds(current, new Set([2, 3, 4]))
    assert.deepEqual([...pruned].sort(), [2, 4])
    const same = new Set([2, 4])
    assert.equal(pruneSelectedIds(same, new Set([2, 4])), same)
  })
})
