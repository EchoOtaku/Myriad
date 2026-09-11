import type { Locale } from '../../../i18n'
import { createLocaleLoader } from '../../../i18n/createLocaleLoader'
import type { SettingGuidesCatalog } from './types'
import en from './catalog.en.json'

const loader = createLocaleLoader<SettingGuidesCatalog>({
  'zh-CN': () => import('./catalog.zh.json').then((m) => m.default),
  'en-US': async () => en,
  'ja-JP': () => import('./catalog.ja.json').then((m) => m.default),
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
