import assert from 'node:assert/strict'
import { it } from 'node:test'
import { isStoreAppAvailable } from './storePolicy.ts'

it('hides every declared federation capability on a blocked server', () => {
  for (const permission of ['federation:read', 'federation:room', 'federation:future']) {
    assert.equal(isStoreAppAvailable({ permissions: ['network:fetch', permission] }, false), false)
  }
})

it('keeps ordinary apps available and federation apps on allowed servers', () => {
  assert.equal(isStoreAppAvailable({ permissions: ['network:fetch'] }, false), true)
  assert.equal(isStoreAppAvailable({}, false), true)
  assert.equal(isStoreAppAvailable({ permissions: ['federation:read'] }, true), true)
})
