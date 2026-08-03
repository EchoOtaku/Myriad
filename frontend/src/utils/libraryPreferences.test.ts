import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { resolveLibraryLayoutMode } from './libraryPreferences'

describe('resolveLibraryLayoutMode', () => {
  it('keeps canvas only when preferred and high hardware', () => {
    assert.equal(resolveLibraryLayoutMode('canvas', true), 'canvas')
  })

  it('falls back to list on low-end even if canvas preferred', () => {
    assert.equal(resolveLibraryLayoutMode('canvas', false), 'list')
  })

  it('keeps list when preferred is list', () => {
    assert.equal(resolveLibraryLayoutMode('list', true), 'list')
    assert.equal(resolveLibraryLayoutMode('list', false), 'list')
  })

  it('defaults to list for missing preference', () => {
    assert.equal(resolveLibraryLayoutMode(undefined, true), 'list')
    assert.equal(resolveLibraryLayoutMode(null, true), 'list')
  })
})
