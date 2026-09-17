import { requestCache } from '../utils/requestCache'

export const PHANTASI_FEED_STORIES_CACHE_PREFIX = 'phantasi:feed-stories:'
export const PHANTASI_BOARD_NOTES_CACHE_PREFIX = 'phantasi:board-notes:'

export const phantasiCacheKeys = {
  sources: 'phantasi:sources',
  sourceCatalog: 'phantasi:sources:catalog',
  sourceList: (view?: 'catalog', category?: string, board?: string) => {
    const base =
      view === 'catalog'
        ? phantasiCacheKeys.sourceCatalog
        : phantasiCacheKeys.sources
    const cat = category?.trim()
    const slice = board?.trim()
    const withCat = cat ? `${base}:cat:${cat}` : base
    return slice ? `${withCat}:board:${slice}` : withCat
  },
  stats: 'phantasi:stats',
  categories: 'phantasi:categories',
  topicCatalog: 'phantasi:topic-catalog',
  noteDocs: 'phantasi:note-docs',
  item: (id: number) => `phantasi:item:${id}`,
  feedStories: (sourceId: number, stamp: number) =>
    `${PHANTASI_FEED_STORIES_CACHE_PREFIX}${sourceId}:${stamp}`,
  feedStoriesForSource: (sourceId: number) =>
    `${PHANTASI_FEED_STORIES_CACHE_PREFIX}${sourceId}:`,
  boardNotes: (sourceIds: readonly number[]) =>
    `${PHANTASI_BOARD_NOTES_CACHE_PREFIX}${sourceIds.join(',')}`,
} as const

export function invalidatePhantasiStatsCache(): void {
  requestCache.delete(phantasiCacheKeys.stats)
}

export function invalidatePhantasiSourcesCache(): void {
  requestCache.deleteByPrefix('phantasi:sources')
  invalidatePhantasiStatsCache()
}

export function invalidatePhantasiBoardCache(): void {
  requestCache.deleteByPrefix(PHANTASI_FEED_STORIES_CACHE_PREFIX)
  requestCache.deleteByPrefix(PHANTASI_BOARD_NOTES_CACHE_PREFIX)
  invalidatePhantasiNoteDocsCache()
}

export function invalidatePhantasiNoteDocsCache(): void {
  requestCache.delete(phantasiCacheKeys.noteDocs)
}
