import type { ShellTranslationKeys } from './assembleLocale'
import type { Locale } from './locales'
import config from './configService.en-US.json' with { type: 'json' }
import core from './en-US.json' with { type: 'json' }
import errors from './errors.en-US.json' with { type: 'json' }
import { formatMessage } from './formatMessage'
import {
  getCachedShellLocale,
  getCachedShellNamespace,
  loadShellLocale,
} from './loadLocale'
import { getDefaultLocale, localeOrFallback } from './locales'
import service from './service.en-US.json' with { type: 'json' }

/** Service callers only need settings errors, not the settings editor catalog. */
export type ServiceCopy = ShellTranslationKeys

const enChrome = {
  ...core,
  config,
  errors,
}

function asLocale(value: string) {
  return localeOrFallback(value)
}

function assembleServiceCopy(locale: Locale, chrome: typeof enChrome): ServiceCopy {
  const tapp =
    getCachedShellNamespace('tapp', locale) ??
    getCachedShellNamespace('tapp', 'en-US') ??
    service.tapp
  const phantasi =
    getCachedShellNamespace('phantasi', locale) ??
    getCachedShellNamespace('phantasi', 'en-US') ??
    service.phantasi
  const merope =
    getCachedShellNamespace('merope', locale) ??
    getCachedShellNamespace('merope', 'en-US') ??
    service.merope
  const agentCaps =
    getCachedShellNamespace('agentCaps', locale) ??
    getCachedShellNamespace('agentCaps', 'en-US') ??
    {}
  return {
    ...chrome,
    tapp,
    phantasi,
    merope,
    agentCaps,
  } as ShellTranslationKeys
}

function resolveServiceCopy(): { locale: Locale; t: ServiceCopy } {
  const target = getDefaultLocale()
  const cached = getCachedShellLocale(target)
  if (cached) return { locale: target, t: assembleServiceCopy(target, cached) }
  void loadShellLocale(target).catch(() => {})
  const loaded = getCachedShellLocale(target)
  if (loaded) return { locale: target, t: assembleServiceCopy(target, loaded) }
  const en = getCachedShellLocale('en-US')
  return { locale: 'en-US', t: assembleServiceCopy('en-US', en ?? enChrome) }
}

/** ja/zh stay out of the static graph; English is the sync fallback until loadLocale resolves. */
export function copyForLocale(locale: string): ServiceCopy {
  const key = asLocale(locale)
  const cached = getCachedShellLocale(key)
  if (cached) return assembleServiceCopy(key, cached)
  void loadShellLocale(key).catch(() => {})
  const loaded = getCachedShellLocale(key)
  if (loaded) return assembleServiceCopy(key, loaded)
  const en = getCachedShellLocale('en-US')
  return assembleServiceCopy('en-US', en ?? enChrome)
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
