export type Locale = 'zh-CN' | 'en-US' | 'ja-JP'

export type { TranslationKeys } from './assembleLocale'

/** localStorage → navigator language → en-US */
export function getDefaultLocale(): Locale {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('locale')
    if (saved === 'zh-CN' || saved === 'en-US' || saved === 'ja-JP') {
      return saved
    }
  }

  if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
    const browserLang = navigator.language || (navigator as any).userLanguage
    if (browserLang) {
      if (browserLang.startsWith('zh')) {
        return 'zh-CN'
      }
      if (browserLang.startsWith('ja')) {
        return 'ja-JP'
      }
    }
  }

  return 'en-US'
}

export function saveLocale(locale: Locale): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('locale', locale)
  }
}

/** Event keys are domain enums, not TranslationKeys. */
export {
  getNotificationCopy,
  type NotificationCopy,
  type NotificationSourceCopy,
  type NotificationUiCopy,
} from './notificationCatalog'
