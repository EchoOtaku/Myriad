import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildLibraryListIndex, queryLibraryListWindow } from './libraryListWindow'

test('large lists keep their full height while only mounting the viewport and overscan', () => {
  const items = Array.from({ length: 10_000 }, (_, i) => ({ id: String(i) }))
  const layouts = new Map(items.map((item, i) => [item.id, {
    top: Math.floor(i / 4) * 200, height: 180,
  }]))
  const index = buildLibraryListIndex(items, layouts)
  assert.equal(index.height, 500_000)
  const middle = queryLibraryListWindow(index, 200_000, 800)
  assert.ok(middle.length <= 48, `mounted ${middle.length} items`)
  assert.ok(middle.some(item => item.id === '4000'))
  assert.ok(!middle.some(item => item.id === '0'))
  assert.deepEqual(queryLibraryListWindow(index, 0, 800).slice(0, 4), items.slice(0, 4))
})

test('tall cards straddling bins are returned once, in layout order', () => {
  const items = [{ id: 'tall' }, { id: 'short' }, { id: 'far' }]
  const index = buildLibraryListIndex(items, new Map([
    ['tall', { top: 0, height: 3000 }],
    ['short', { top: 1800, height: 100 }],
    ['far', { top: 6000, height: 100 }],
  ]))
  assert.deepEqual(queryLibraryListWindow(index, 1900, 200), items.slice(0, 2))
  assert.deepEqual(queryLibraryListWindow(index, 10_000, 800), [])
})

test('empty and partially loaded lists preserve the loaded extent only', () => {
  assert.equal(buildLibraryListIndex([], new Map()).height, 400)
  const layouts = new Map([
    ['first', { top: 0, height: 180 }],
    ['unloaded', { top: 8000, height: 180 }],
  ])
  const index = buildLibraryListIndex([{ id: 'first' }], layouts)
  assert.equal(index.height, 400)
  assert.deepEqual(queryLibraryListWindow(index, -1000, 200), [])
})
