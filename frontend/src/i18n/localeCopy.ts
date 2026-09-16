import type { ShellTranslationKeys } from './assembleLocale'
import type { Locale } from './locales'
import agentCaps from './agentCaps.en-US.json' with { type: 'json' }
import config from './configService.en-US.json' with { type: 'json' }
import core from './en-US.json' with { type: 'json' }
import errors from './errors.en-US.json' with { type: 'json' }
import { formatMessage } from './formatMessage'
import { getCachedShellLocale, loadShellLocale } from './loadLocale'
import { getDefaultLocale, localeOrFallback } from './locales'
import merope from './merope.en-US.json' with { type: 'json' }
import phantasi from './phantasi.en-US.json' with { type: 'json' }
import tapp from './tapp.en-US.json' with { type: 'json' }

/** Service callers only need settings errors, not the settings editor catalog. */
export type ServiceCopy = ShellTranslationKeys

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
  const cached = getCachedShellLocale(target)
  if (cached) return { locale: target, t: cached }
  void loadShellLocale(target).catch(() => {})
  const loaded = getCachedShellLocale(target)
  if (loaded) return { locale: target, t: loaded }
  return { locale: 'en-US', t: getCachedShellLocale('en-US') ?? enUS }
}

/** ja/zh stay out of the static graph; English is the sync fallback until loadLocale resolves. */
export function copyForLocale(locale: string): ServiceCopy {
  const key = asLocale(locale)
  const cached = getCachedShellLocale(key)
  if (cached) return cached
  void loadShellLocale(key).catch(() => {})
  return getCachedShellLocale(key) ?? getCachedShellLocale('en-US') ?? enUS
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
