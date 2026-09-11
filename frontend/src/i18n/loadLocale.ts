import type { Locale, TranslationKeys } from './index'
import { assembleLocale } from './assembleLocale'
import { createLocaleLoader } from './createLocaleLoader'

async function loadPack(locale: Locale): Promise<TranslationKeys> {
  switch (locale) {
    case 'zh-CN': {
      const [core, config, tapp, brew, merope, errors, agentCaps] = await Promise.all([
        import('./zh-CN.json'),
        import('./config.zh-CN.json'),
        import('./tapp.zh-CN.json'),
        import('./brew.zh-CN.json'),
        import('./merope.zh-CN.json'),
        import('./errors.zh-CN.json'),
        import('./agentCaps.zh-CN.json'),
      ])
      return assembleLocale(core.default, {
        config: config.default,
        tapp: tapp.default,
        brew: brew.default,
        merope: merope.default,
        errors: errors.default,
        agentCaps: agentCaps.default,
      })
    }
    case 'en-US': {
      const [core, config, tapp, brew, merope, errors, agentCaps] = await Promise.all([
        import('./en-US.json'),
        import('./config.en-US.json'),
        import('./tapp.en-US.json'),
        import('./brew.en-US.json'),
        import('./merope.en-US.json'),
        import('./errors.en-US.json'),
        import('./agentCaps.en-US.json'),
      ])
      return assembleLocale(core.default, {
        config: config.default,
        tapp: tapp.default,
        brew: brew.default,
        merope: merope.default,
        errors: errors.default,
        agentCaps: agentCaps.default,
      })
    }
    case 'ja-JP': {
      const [core, config, tapp, brew, merope, errors, agentCaps] = await Promise.all([
        import('./ja-JP.json'),
        import('./config.ja-JP.json'),
        import('./tapp.ja-JP.json'),
        import('./brew.ja-JP.json'),
        import('./merope.ja-JP.json'),
        import('./errors.ja-JP.json'),
        import('./agentCaps.ja-JP.json'),
      ])
      return assembleLocale(core.default, {
        config: config.default,
        tapp: tapp.default,
        brew: brew.default,
        merope: merope.default,
        errors: errors.default,
        agentCaps: agentCaps.default,
      })
    }
    default: {
      const _exhaustive: never = locale
      throw new Error(`Unknown locale: ${_exhaustive}`)
    }
  }
}

const loader = createLocaleLoader<TranslationKeys>({
  'zh-CN': () => loadPack('zh-CN'),
  'en-US': () => loadPack('en-US'),
  'ja-JP': () => loadPack('ja-JP'),
})

/** Cache + in-flight dedupe; unused locales stay out of the main bundle. */
export function loadLocale(locale: Locale): Promise<TranslationKeys> {
  return loader.load(locale)
}

export function getCachedLocale(locale: Locale): TranslationKeys | null {
  return loader.getCached(locale)
}
