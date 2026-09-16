import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { API_URL } from '../config'
import {
  clearDedupCache,
  getLibraryStatsDeduped,
  libraryStatsFromResponse,
} from './requestDedup'

describe('library stats', () => {
  afterEach(() => clearDedupCache())

  it('reads preference-filtered type_counts and ignores item payloads', () => {
    const stats = libraryStatsFromResponse({
      success: true,
      items: [{ item_type: 'game' }, { item_type: 'music' }],
      total: 7,
      type_counts: {
        game: 2,
        video: 1,
        music: 3,
        anime: 1,
        tv_series: 0,
        book: 0,
      },
    })
    assert.deepEqual(stats, {
      total: 7,
      game: 2,
      video: 1,
      music: 3,
      anime: 1,
      tv_series: 0,
      book: 0,
    })
  })

  it('falls back to counting items when an old server still dumps the library', () => {
    assert.deepEqual(
      libraryStatsFromResponse({
        success: true,
        items: [
          { item_type: 'game' },
          { item_type: 'music' },
          { item_type: 'podcast' },
        ],
        total: 3,
      }),
      {
        total: 2,
        game: 1,
        video: 0,
        music: 1,
        anime: 0,
        tv_series: 0,
        book: 0,
      },
    )
  })

  it('fetches /api/library?counts_only=true instead of the unpaged dump', async () => {
    const originalFetch = globalThis.fetch
    const requested: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input))
      return new Response(
        JSON.stringify({
          success: true,
          items: [],
          total: 4,
          type_counts: {
            game: 4,
            video: 0,
            music: 0,
            anime: 0,
            tv_series: 0,
            book: 0,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    try {
      const stats = await getLibraryStatsDeduped()
      assert.equal(requested.length, 1)
      assert.equal(requested[0], `${API_URL}/api/library?counts_only=true`)
      assert.equal(stats.total, 4)
      assert.equal(stats.game, 4)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
