export type { TranslationKeys } from './assembleLocale'
export { formatDate, formatMessage, formatNumber } from './formatMessage'
export type { Locale } from './locales'

export {
  getDefaultLocale,
  htmlLang,
  isLocale,
  localeOrFallback,
  LOCALES,
  parseLocale,
  parseLocaleCookie,
  saveLocale,
} from './locales'

/** Event keys are domain enums, not TranslationKeys. */
export {
  getNotificationCopy,
  type NotificationCopy,
  type NotificationSourceCopy,
  type NotificationUiCopy,
} from './notificationCatalog'
