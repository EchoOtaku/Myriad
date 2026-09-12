import type { LocaleConfig } from '../../../i18n/assembleLocale'
import type { ConfigNavSection } from './configNavPersistence'
import { CONFIG_NAV_SECTIONS } from './configNavPersistence'

type SectionTextKey =
  | 'basic'
  | 'basicDesc'
  | 'platforms'
  | 'platformsDesc'
  | 'ai'
  | 'aiDesc'
  | 'agent'
  | 'agentDesc'
  | 'lab'
  | 'labDesc'
  | 'oauth'
  | 'oauthDesc'
  | 'users'
  | 'usersDesc'
  | 'permissions'
  | 'permissionsDesc'
  | 'federation'
  | 'federationDesc'
  | 'moduleSettings'
  | 'moduleSettingsDesc'
  | 'advanced'
  | 'advancedDesc'
  | 'about'
  | 'aboutDesc'
export interface ConfigSectionCopy {
  config: Pick<LocaleConfig, SectionTextKey | 'searchKeywords'>
  notificationCenter: { title: string; settingsDesc: string }
}

/** Navigation and search consume the same visible pages and localized names. */
export function configSectionCatalog(
  t: ConfigSectionCopy,
  isAdmin: boolean,
  agentTitle = t.config.agent,
) {
  const titles: Record<ConfigNavSection, [string, string]> = {
    basic: [t.config.basic, t.config.basicDesc],
    platforms: [t.config.platforms, t.config.platformsDesc],
    ai: [t.config.ai, t.config.aiDesc],
    agent: [agentTitle, t.config.agentDesc],
    lab: [t.config.lab, t.config.labDesc],
    notifications: [
      t.notificationCenter.title,
      t.notificationCenter.settingsDesc,
    ],
    oauth: [t.config.oauth, t.config.oauthDesc],
    users: [t.config.users, t.config.usersDesc],
    permissions: [t.config.permissions, t.config.permissionsDesc],
    federation: [t.config.federation, t.config.federationDesc],
    modules: [t.config.moduleSettings, t.config.moduleSettingsDesc],
    advanced: [t.config.advanced, t.config.advancedDesc],
    about: [t.config.about, t.config.aboutDesc],
  }
  return CONFIG_NAV_SECTIONS.filter((id) => id !== 'federation' || isAdmin).map(
    (id) => ({
      id,
      title: titles[id][0],
      description: titles[id][1],
      keywords: [...t.config.searchKeywords[id]],
      showReset: !['about', 'platforms', 'oauth', 'users'].includes(id),
    }),
  )
}
