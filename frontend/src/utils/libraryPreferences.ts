export type LibraryLayoutMode = 'list' | 'canvas'

export const LIBRARY_PREFERENCES_UPDATED_EVENT = 'library-preferences-updated'

export interface LibraryPreferencesUpdatedDetail {
  categories?: Record<string, string[]>
  layout: LibraryLayoutMode
}

/**
 * Resolve effective library card layout for the current device.
 * Infinite canvas is only used when the preference is canvas **and** the
 * device meets the high-hardware tier; otherwise fall back to list.
 */
export function resolveLibraryLayoutMode(
  preferred: LibraryLayoutMode | undefined | null,
  highHardware: boolean,
): LibraryLayoutMode {
  if (preferred === 'canvas' && highHardware) return 'canvas'
  return 'list'
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
