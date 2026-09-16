import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resizedDimensions, validateMediaEditData, validMediaDimensions } from './mediaEdit'

test('rejects canvas dimensions that are empty, fractional or exceed the pixel budget', () => {
  for (const [w, h] of [[0, 10], [10, -1], [1.5, 10], [Infinity, 10], [8192, 8192]]) assert.equal(validMediaDimensions(w, h), false)
  assert.equal(validMediaDimensions(3840, 2160), true)
})
test('locked aspect preserves the source ratio when either dimension changes', () => {
  assert.deepEqual(resizedDimensions('width', 100, { width: 400, height: 200 }), { width: 100, height: 50 })
  assert.deepEqual(resizedDimensions('height', 75, { width: 400, height: 200 }), { width: 150, height: 75 })
})

test('oversized edited images are rejected before they can be offered for saving', () => {
  assert.doesNotThrow(() => validateMediaEditData('data:image/png;base64,YWJj'))
  assert.throws(() => validateMediaEditData(`data:image/png;base64,${'A'.repeat(7 * 1024 * 1024)}`), /MEDIA_EDIT_TOO_LARGE/)
})
