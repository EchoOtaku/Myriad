import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_LIBRARY_SOURCE_PREFERENCES,
  normalizeLibraryPreferences,
} from '../../utils/librarySourcePreferences'

describe('normalizeLibraryPreferences', () => {
  it('preserves canvas and rejects unknown layout values', () => {
    const canvas = normalizeLibraryPreferences({
      ...DEFAULT_LIBRARY_SOURCE_PREFERENCES,
      layout: 'canvas',
    })
    const invalid = normalizeLibraryPreferences({
      ...DEFAULT_LIBRARY_SOURCE_PREFERENCES,
      layout: 'unknown' as 'list',
    })

    assert.equal(canvas.layout, 'canvas')
    assert.equal(invalid.layout, 'list')
  })

  it('fills missing category arrays without sharing defaults', () => {
    const normalized = normalizeLibraryPreferences({
      layout: 'list',
      categories: { game: ['Steam'] } as never,
    })
    assert.deepEqual(normalized.categories.game, ['Steam'])
    assert.deepEqual(
      normalized.categories.music,
      DEFAULT_LIBRARY_SOURCE_PREFERENCES.categories.music,
    )
    assert.notEqual(
      normalized.categories.music,
      DEFAULT_LIBRARY_SOURCE_PREFERENCES.categories.music,
    )
  })
})
