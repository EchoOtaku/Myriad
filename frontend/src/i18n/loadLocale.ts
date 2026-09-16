import type { LocaleConfig, ShellTranslationKeys, TranslationKeys } from './assembleLocale'
import type { Locale } from './locales'
import { createLocaleLoader } from './createLocaleLoader'

// Vite serves `*.json?import` as JS. A JSON import attribute makes the
// browser require application/json and reject the module.

async function loadShellPack(locale: Locale): Promise<ShellTranslationKeys> {
  switch (locale) {
    case 'zh-CN': {
      const [core, config, tapp, phantasi, merope, errors, agentCaps] = await Promise.all([
        import('./zh-CN.json'),
        import('./configService.zh-CN.json'),
        import('./tapp.zh-CN.json'),
        import('./phantasi.zh-CN.json'),
        import('./merope.zh-CN.json'),
        import('./errors.zh-CN.json'),
        import('./agentCaps.zh-CN.json'),
      ])
      return {
        ...core.default,
        config: config.default,
        tapp: tapp.default,
        phantasi: phantasi.default,
        merope: merope.default,
        errors: errors.default,
        agentCaps: agentCaps.default,
      }
    }
    case 'en-US': {
      const [core, config, tapp, phantasi, merope, errors, agentCaps] = await Promise.all([
        import('./en-US.json'),
        import('./configService.en-US.json'),
        import('./tapp.en-US.json'),
        import('./phantasi.en-US.json'),
        import('./merope.en-US.json'),
        import('./errors.en-US.json'),
        import('./agentCaps.en-US.json'),
      ])
      return {
        ...core.default,
        config: config.default,
        tapp: tapp.default,
        phantasi: phantasi.default,
        merope: merope.default,
        errors: errors.default,
        agentCaps: agentCaps.default,
      }
    }
    case 'ja-JP': {
      const [core, config, tapp, phantasi, merope, errors, agentCaps] = await Promise.all([
        import('./ja-JP.json'),
        import('./configService.ja-JP.json'),
        import('./tapp.ja-JP.json'),
        import('./phantasi.ja-JP.json'),
        import('./merope.ja-JP.json'),
        import('./errors.ja-JP.json'),
        import('./agentCaps.ja-JP.json'),
      ])
      return {
        ...core.default,
        config: config.default,
        tapp: tapp.default,
        phantasi: phantasi.default,
        merope: merope.default,
        errors: errors.default,
        agentCaps: agentCaps.default,
      }
    }
    case 'zh-TW': {
      const [core, config, tapp, phantasi, merope, errors, agentCaps] = await Promise.all([
        import('./zh-TW.json'),
        import('./configService.zh-TW.json'),
        import('./tapp.zh-TW.json'),
        import('./phantasi.zh-TW.json'),
        import('./merope.zh-TW.json'),
        import('./errors.zh-TW.json'),
        import('./agentCaps.zh-TW.json'),
      ])
      return {
        ...core.default,
        config: config.default,
        tapp: tapp.default,
        phantasi: phantasi.default,
        merope: merope.default,
        errors: errors.default,
        agentCaps: agentCaps.default,
      }
    }
    case 'ko-KR': {
      const [core, config, tapp, phantasi, merope, errors, agentCaps] = await Promise.all([
        import('./ko-KR.json'),
        import('./configService.ko-KR.json'),
        import('./tapp.ko-KR.json'),
        import('./phantasi.ko-KR.json'),
        import('./merope.ko-KR.json'),
        import('./errors.ko-KR.json'),
        import('./agentCaps.ko-KR.json'),
      ])
      return {
        ...core.default,
        config: config.default,
        tapp: tapp.default,
        phantasi: phantasi.default,
        merope: merope.default,
        errors: errors.default,
        agentCaps: agentCaps.default,
      }
    }
    case 'fr-FR': {
      const [core, config, tapp, phantasi, merope, errors, agentCaps] = await Promise.all([
        import('./fr-FR.json'),
        import('./configService.fr-FR.json'),
        import('./tapp.fr-FR.json'),
        import('./phantasi.fr-FR.json'),
        import('./merope.fr-FR.json'),
        import('./errors.fr-FR.json'),
        import('./agentCaps.fr-FR.json'),
      ])
      return {
        ...core.default,
        config: config.default,
        tapp: tapp.default,
        phantasi: phantasi.default,
        merope: merope.default,
        errors: errors.default,
        agentCaps: agentCaps.default,
      }
    }
    case 'de-DE': {
      const [core, config, tapp, phantasi, merope, errors, agentCaps] = await Promise.all([
        import('./de-DE.json'),
        import('./configService.de-DE.json'),
        import('./tapp.de-DE.json'),
        import('./phantasi.de-DE.json'),
        import('./merope.de-DE.json'),
        import('./errors.de-DE.json'),
        import('./agentCaps.de-DE.json'),
      ])
      return {
        ...core.default,
        config: config.default,
        tapp: tapp.default,
        phantasi: phantasi.default,
        merope: merope.default,
        errors: errors.default,
        agentCaps: agentCaps.default,
      }
    }
    default: {
      const _exhaustive: never = locale
      throw new Error(`Unknown locale: ${_exhaustive}`)
    }
  }
}

const shellLoader = createLocaleLoader<ShellTranslationKeys>({
  'zh-CN': () => loadShellPack('zh-CN'),
  'zh-TW': () => loadShellPack('zh-TW'),
  'en-US': () => loadShellPack('en-US'),
  'ja-JP': () => loadShellPack('ja-JP'),
  'ko-KR': () => loadShellPack('ko-KR'),
  'fr-FR': () => loadShellPack('fr-FR'),
  'de-DE': () => loadShellPack('de-DE'),
})

const configLoader = createLocaleLoader<LocaleConfig>({
  'zh-CN': () => import('./config.zh-CN.json').then(module => module.default),
  'zh-TW': () => import('./config.zh-TW.json').then(module => module.default),
  'en-US': () => import('./config.en-US.json').then(module => module.default),
  'ja-JP': () => import('./config.ja-JP.json').then(module => module.default),
  'ko-KR': () => import('./config.ko-KR.json').then(module => module.default),
  'fr-FR': () => import('./config.fr-FR.json').then(module => module.default),
  'de-DE': () => import('./config.de-DE.json').then(module => module.default),
})

export class LocaleNamespaceError extends Error {
  constructor(readonly locale: Locale, cause: unknown) {
    super(`Failed to load settings translations for ${locale}`, { cause })
    this.name = 'LocaleNamespaceError'
  }
}

async function loadFullPack(locale: Locale): Promise<TranslationKeys> {
  const [shell, config] = await Promise.all([
    shellLoader.load(locale),
    configLoader.load(locale).catch(cause => { throw new LocaleNamespaceError(locale, cause) }),
  ])
  const full = { ...shell, config }
  shellLoader.seed(locale, full)
  return full
}

const loader = createLocaleLoader<TranslationKeys>({
  'zh-CN': () => loadFullPack('zh-CN'),
  'zh-TW': () => loadFullPack('zh-TW'),
  'en-US': () => loadFullPack('en-US'),
  'ja-JP': () => loadFullPack('ja-JP'),
  'ko-KR': () => loadFullPack('ko-KR'),
  'fr-FR': () => loadFullPack('fr-FR'),
  'de-DE': () => loadFullPack('de-DE'),
})

/** The shell never requests the full settings catalog. */
export function loadShellLocale(locale: Locale): Promise<ShellTranslationKeys> {
  return shellLoader.load(locale)
}

export function getCachedShellLocale(locale: Locale): ShellTranslationKeys | null {
  return shellLoader.getCached(locale)
}

export function readShellLocale(locale: Locale): ShellTranslationKeys {
  return shellLoader.read(locale)
}

/** Settings consumers call this during render, before callbacks can use their copy. */
export function readConfigLocale(locale: Locale): TranslationKeys {
  return loader.read(locale)
}

/** Explicit full-pack API retained for consumers that need settings strings. */
export function loadLocale(locale: Locale): Promise<TranslationKeys> {
  return loader.load(locale)
}

export function getCachedLocale(locale: Locale): TranslationKeys | null {
  return loader.getCached(locale)
}
