import {
  areOAuthSettingsEqual,
  cloneOAuthSettings,
  DEFAULT_OAUTH_SETTINGS,
  fetchOAuthSettings,
  writeOAuthSettings,
} from '../../../../utils/oauthSettings'
import { useConfigDomain } from '../useConfigDomain'

export function useOAuthDomain() {
  return useConfigDomain({
    id: 'oauth',
    sections: ['oauth', 'users'],
    initial: DEFAULT_OAUTH_SETTINGS,
    equal: areOAuthSettingsEqual,
    load: fetchOAuthSettings,
    readBack: true,
    persist: async (draft) => {
      await writeOAuthSettings(draft)
      return draft
    },
    reset: (saved, scope) => {
      if (scope === 'all') return cloneOAuthSettings(DEFAULT_OAUTH_SETTINGS)
      if (scope === 'oauth') return { ...saved, providers: [] }
      if (scope === 'users') {
        return {
          ...saved,
          allowLocalRegistration: DEFAULT_OAUTH_SETTINGS.allowLocalRegistration,
          privateTappInstallCleanup:
            DEFAULT_OAUTH_SETTINGS.privateTappInstallCleanup,
          privateTappInstallInactivityDays:
            DEFAULT_OAUTH_SETTINGS.privateTappInstallInactivityDays,
        }
      }
    },
  })
}
