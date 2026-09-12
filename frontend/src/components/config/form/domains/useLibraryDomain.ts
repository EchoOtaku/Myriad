import type { LibrarySourcePreferences } from '../../../../utils/librarySourcePreferences'
import type { SaveLibrarySourcePreferencesResponse } from '../types'
import apiService from '../../../../services/api'
import { dispatchLibraryPreferencesUpdated } from '../../../../utils/libraryPreferences'
import {
  areLibrarySourcePreferencesEqual,
  DEFAULT_LIBRARY_SOURCE_PREFERENCES,
  normalizeLibraryPreferences,
} from '../../../../utils/librarySourcePreferences'
import { clearLibraryDataCache } from '../../../../utils/requestDedup'
import { useConfigDomain } from '../useConfigDomain'

export function useLibraryDomain(messages: {
  librarySourceLoadFailed: string
  librarySourceSaveFailed: string
}) {
  return useConfigDomain<LibrarySourcePreferences>({
    id: 'library',
    sections: ['modules'],
    initial: DEFAULT_LIBRARY_SOURCE_PREFERENCES,
    equal: areLibrarySourcePreferencesEqual,
    load: async () => {
      const response =
        await apiService.get<SaveLibrarySourcePreferencesResponse>(
          '/library/preferences',
        )
      if (!response.success)
        throw new Error(response.message || messages.librarySourceLoadFailed)
      return normalizeLibraryPreferences(response.preferences)
    },
    persist: async (draft) => {
      const response =
        await apiService.put<SaveLibrarySourcePreferencesResponse>(
          '/library/preferences',
          draft,
        )
      if (!response.success)
        throw new Error(response.message || messages.librarySourceSaveFailed)
      return normalizeLibraryPreferences(response.preferences)
    },
    reset: (_saved, scope) =>
      scope === 'modules' || scope === 'all'
        ? structuredClone(DEFAULT_LIBRARY_SOURCE_PREFERENCES)
        : undefined,
    effects: (saved) => [
      {
        id: 'library',
        run: () => {
          clearLibraryDataCache()
          dispatchLibraryPreferencesUpdated({
            categories: saved.categories,
            layout: saved.layout,
          })
        },
      },
    ],
  })
}
