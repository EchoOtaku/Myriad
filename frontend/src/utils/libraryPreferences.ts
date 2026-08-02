export type LibraryLayoutMode = 'list' | 'canvas'

export const LIBRARY_PREFERENCES_UPDATED_EVENT = 'library-preferences-updated'

export interface LibraryPreferencesUpdatedDetail {
  categories?: Record<string, string[]>
  layout: LibraryLayoutMode
}

export function dispatchLibraryPreferencesUpdated(
  detail: LibraryPreferencesUpdatedDetail,
): void {
  window.dispatchEvent(
    new CustomEvent<LibraryPreferencesUpdatedDetail>(
      LIBRARY_PREFERENCES_UPDATED_EVENT,
      { detail },
    ),
  )
}
