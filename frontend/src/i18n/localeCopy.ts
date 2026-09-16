import type { TranslationKeys } from './assembleLocale'
import type { Locale } from './locales'
import agentCaps from './agentCaps.en-US.json' with { type: 'json' }
import config from './configService.en-US.json' with { type: 'json' }
import core from './en-US.json' with { type: 'json' }
import errors from './errors.en-US.json' with { type: 'json' }
import { formatMessage } from './formatMessage'
import { getCachedLocale, loadLocale } from './loadLocale'
import { getDefaultLocale, localeOrFallback } from './locales'
import merope from './merope.en-US.json' with { type: 'json' }
import phantasi from './phantasi.en-US.json' with { type: 'json' }
import tapp from './tapp.en-US.json' with { type: 'json' }

/** Service callers only need settings errors, not the settings editor catalog. */
export type ServiceCopy = Omit<TranslationKeys, 'config'> & { config: typeof config }

const enUS: ServiceCopy = {
  ...core,
  config,
  tapp,
  phantasi,
  merope,
  errors,
  agentCaps,
}

function asLocale(value: string) {
  return localeOrFallback(value)
}

function resolveServiceCopy(): { locale: Locale; t: ServiceCopy } {
  const target = getDefaultLocale()
  const cached = getCachedLocale(target)
  if (cached) return { locale: target, t: cached }
  void loadLocale(target).catch(() => {})
  const loaded = getCachedLocale(target)
  if (loaded) return { locale: target, t: loaded }
  return { locale: 'en-US', t: getCachedLocale('en-US') ?? enUS }
}

/** ja/zh stay out of the static graph; English is the sync fallback until loadLocale resolves. */
export function copyForLocale(locale: string): ServiceCopy {
  const key = asLocale(locale)
  const cached = getCachedLocale(key)
  if (cached) return cached
  void loadLocale(key).catch(() => {})
  return getCachedLocale(key) ?? getCachedLocale('en-US') ?? enUS
}

/** Non-React service-layer copy. Same pack `formatCurrent` formats against. */
export function currentCopy(): ServiceCopy {
  return resolveServiceCopy().t
}

/** ICU against the catalog `currentCopy()` actually returned, not the in-flight target. */
export function formatCurrent(
  template: string,
  params: Record<string, string | number> = {},
): string {
  return formatMessage(resolveServiceCopy().locale, template, params)
}
