import type { Locale } from '../../../i18n'
import type { BrewGuidesCatalog } from './types'
import { createLocaleLoader } from '../../../i18n/createLocaleLoader'
import en from './catalog.en-US.json' with { type: 'json' }

const loader = createLocaleLoader<BrewGuidesCatalog>({
  'zh-CN': async () =>
    (await import('./catalog.zh-CN.json')).default,
  'zh-TW': async () =>
    (await import('./catalog.zh-TW.json')).default,
  'en-US': async () => en,
  'ja-JP': async () =>
    (await import('./catalog.ja-JP.json')).default,
  'ko-KR': async () =>
    (await import('./catalog.ko-KR.json')).default,
  'fr-FR': async () =>
    (await import('./catalog.fr-FR.json')).default,
  'de-DE': async () =>
    (await import('./catalog.de-DE.json')).default,
})
loader.seed('en-US', en)

export function loadBrewGuidesCatalog(
  locale: Locale,
): Promise<BrewGuidesCatalog> {
  return loader.load(locale)
}

export function getBrewGuidesCatalog(locale: Locale): BrewGuidesCatalog {
  const cached = loader.getCached(locale)
  if (cached) return cached
  void loadBrewGuidesCatalog(locale)
  return loader.getCached(locale) ?? en
}

export type { BrewGuidesCatalog, SettingGuideEntry } from './types'
