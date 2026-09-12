import type { Locale } from '../../../i18n'
import type { SettingGuidesCatalog } from './types'
import { createLocaleLoader } from '../../../i18n/createLocaleLoader'
import en from './catalog.en-US.json'

const loader = createLocaleLoader<SettingGuidesCatalog>({
  'zh-CN': () => import('./catalog.zh-CN.json').then((m) => m.default),
  'zh-TW': () => import('./catalog.zh-TW.json').then((m) => m.default),
  'en-US': async () => en,
  'ja-JP': () => import('./catalog.ja-JP.json').then((m) => m.default),
  'ko-KR': () => import('./catalog.ko-KR.json').then((m) => m.default),
  'fr-FR': () => import('./catalog.fr-FR.json').then((m) => m.default),
  'de-DE': () => import('./catalog.de-DE.json').then((m) => m.default),
})
loader.seed('en-US', en)

export function loadSettingGuidesCatalog(
  locale: Locale,
): Promise<SettingGuidesCatalog> {
  return loader.load(locale)
}

export function getSettingGuidesCatalog(locale: Locale): SettingGuidesCatalog {
  const cached = loader.getCached(locale)
  if (cached) return cached
  void loadSettingGuidesCatalog(locale)
  return loader.getCached(locale) ?? en
}

export type { SettingGuideEntry, SettingGuidesCatalog } from './types'
