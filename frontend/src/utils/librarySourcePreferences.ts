export type LibraryItemType =
  'game' | 'video' | 'music' | 'anime' | 'tv_series' | 'book'

export interface LibrarySourcePreferences {
  layout: 'list' | 'canvas'
  categories: Record<LibraryItemType, string[]>
}

export const LIBRARY_ITEM_TYPES: LibraryItemType[] = [
  'game',
  'video',
  'music',
  'anime',
  'tv_series',
  'book',
]

export const DEFAULT_LIBRARY_SOURCE_PREFERENCES: LibrarySourcePreferences = {
  layout: 'list',
  categories: {
    game: ['Steam', 'Bangumi'],
    video: ['Bilibili', 'Bangumi'],
    music: ['Netease', 'Bangumi'],
    anime: ['Bangumi', 'Bilibili', 'MyAnimeList'],
    tv_series: ['Bangumi', 'Bilibili'],
    book: ['Bangumi', 'MyAnimeList'],
  },
}

export function normalizeLibraryPreferences(
  preferences?: LibrarySourcePreferences,
): LibrarySourcePreferences {
  return {
    layout: preferences?.layout === 'canvas' ? 'canvas' : 'list',
    categories: LIBRARY_ITEM_TYPES.reduce(
      (acc, type) => {
        acc[type] = [
          ...(preferences?.categories?.[type] ??
            DEFAULT_LIBRARY_SOURCE_PREFERENCES.categories[type]),
        ]
        return acc
      },
      {} as Record<LibraryItemType, string[]>,
    ),
  }
}

export function areLibrarySourcePreferencesEqual(
  left: LibrarySourcePreferences,
  right: LibrarySourcePreferences,
) {
  return (
    left.layout === right.layout &&
    LIBRARY_ITEM_TYPES.every((type) => {
      const leftSources = left.categories[type] ?? []
      const rightSources = right.categories[type] ?? []
      return (
        leftSources.length === rightSources.length &&
        leftSources.every((source, index) => source === rightSources[index])
      )
    })
  )
}
