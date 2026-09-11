import type { Locale, TranslationKeys } from './index'
import { createLocaleLoader } from './createLocaleLoader'

const loader = createLocaleLoader<TranslationKeys>({
  'zh-CN': () => import('./zh-CN.json').then((m) => m.default),
  'en-US': () => import('./en-US.json').then((m) => m.default),
  'ja-JP': () => import('./ja-JP.json').then((m) => m.default),
})

/** Cache + in-flight dedupe; unused locales stay out of the main bundle. */
export function loadLocale(locale: Locale): Promise<TranslationKeys> {
  return loader.load(locale)
}

export function getCachedLocale(locale: Locale): TranslationKeys | null {
  return loader.getCached(locale)
}
