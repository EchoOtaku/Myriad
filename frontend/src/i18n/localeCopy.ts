import type { Locale, TranslationKeys } from './index'
import enUS from './en-US.json'
import { getDefaultLocale } from './index'
import { getCachedLocale, loadLocale } from './loadLocale'

function asLocale(value: string): Locale {
  if (value === 'zh-CN' || value === 'ja-JP') return value
  return 'en-US'
}

/** ja/zh stay out of the static graph; English is the sync fallback until loadLocale resolves. */
export function copyForLocale(locale: string): TranslationKeys {
  const key = asLocale(locale)
  const cached = getCachedLocale(key)
  if (cached) return cached
  void loadLocale(key)
  return getCachedLocale(key) ?? getCachedLocale('en-US') ?? enUS
}

/** Non-React service-layer copy. */
export function currentCopy(): TranslationKeys {
  return copyForLocale(getDefaultLocale())
}
