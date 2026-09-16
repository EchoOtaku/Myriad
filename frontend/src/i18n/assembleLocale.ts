export type LocaleCore = typeof import('./en-US.json')
export type LocaleConfig = typeof import('./config.en-US.json')
export type LocaleTapp = typeof import('./tapp.en-US.json')
export type LocalePhantasi = typeof import('./phantasi.en-US.json')
export type LocaleMerope = typeof import('./merope.en-US.json')
export type LocaleErrors = typeof import('./errors.en-US.json')
export type LocaleAgentCaps = typeof import('./agentCaps.en-US.json')

export type TranslationKeys = LocaleCore & {
  config: LocaleConfig
  tapp: LocaleTapp
  phantasi: LocalePhantasi
  merope: LocaleMerope
  errors: LocaleErrors
  agentCaps: LocaleAgentCaps
}

export type ShellTranslationKeys = Omit<TranslationKeys, 'config'> & {
  config: typeof import('./configService.en-US.json')
}

export function assembleLocale(
  core: LocaleCore,
  namespaces: {
    config: LocaleConfig
    tapp: LocaleTapp
    phantasi: LocalePhantasi
    merope: LocaleMerope
    errors: LocaleErrors
    agentCaps: LocaleAgentCaps
  },
): TranslationKeys {
  return {
    ...core,
    ...namespaces,
  }
}
