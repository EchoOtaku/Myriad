import type { Locale } from '../../../i18n'
import type { TappPermission } from '../../../tapp/types'
import type { SettingGuideEntry } from './types'
import { createLocaleLoader } from '../../../i18n/createLocaleLoader'
import en from './tappPermissionGuides.en-US.json'

export type TappPermissionGuides = Record<TappPermission, SettingGuideEntry>

export function tappPermissionGuidePath(permission: TappPermission): string {
  return `tapp.perm.${permission}`
}

const loader = createLocaleLoader<TappPermissionGuides>({
  'zh-CN': () =>
    import('./tappPermissionGuides.zh-CN.json').then((m) => m.default),
  'zh-TW': () =>
    import('./tappPermissionGuides.zh-TW.json').then((m) => m.default),
  'en-US': async () => en,
  'ja-JP': () =>
    import('./tappPermissionGuides.ja-JP.json').then((m) => m.default),
})
loader.seed('en-US', en)

export function loadTappPermissionGuides(
  locale: Locale,
): Promise<TappPermissionGuides> {
  return loader.load(locale)
}

export function getTappPermissionGuides(locale: Locale): TappPermissionGuides {
  const cached = loader.getCached(locale)
  if (cached) return cached
  void loadTappPermissionGuides(locale)
  return loader.getCached(locale) ?? en
}

export function getTappPermissionGuide(
  locale: Locale,
  permission: TappPermission,
): SettingGuideEntry {
  return getTappPermissionGuides(locale)[permission]
}
