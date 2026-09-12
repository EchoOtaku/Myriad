import {
  areModuleVisibilityPreferencesEqual,
  DEFAULT_MODULE_VISIBILITY_PREFERENCES,
  dispatchModuleVisibilityPreferencesUpdated,
  fetchModuleVisibilityPreferences,
  normalizeModuleVisibilityPreferences,
  updateModuleVisibilityPreferences,
} from '../../../../utils/moduleVisibility'
import { useConfigDomain } from '../useConfigDomain'

export function useModuleVisibilityDomain() {
  return useConfigDomain({
    id: 'visibility',
    sections: ['modules'],
    initial: DEFAULT_MODULE_VISIBILITY_PREFERENCES,
    equal: areModuleVisibilityPreferencesEqual,
    load: fetchModuleVisibilityPreferences,
    persist: async (draft) =>
      normalizeModuleVisibilityPreferences(
        await updateModuleVisibilityPreferences(draft),
      ),
    reset: (_saved, scope) =>
      scope === 'modules' || scope === 'all'
        ? structuredClone(DEFAULT_MODULE_VISIBILITY_PREFERENCES)
        : undefined,
    effects: (saved) => [
      {
        id: 'visibility',
        run: () => dispatchModuleVisibilityPreferencesUpdated(saved),
      },
    ],
  })
}
