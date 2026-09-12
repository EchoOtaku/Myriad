export type { Locale } from './locales'
export {
  LOCALES,
  getDefaultLocale,
  htmlLang,
  isLocale,
  localeOrFallback,
  parseLocale,
  saveLocale,
} from './locales'
export { formatDate, formatMessage, formatNumber } from './formatMessage'

export type { TranslationKeys } from './assembleLocale'

/** Event keys are domain enums, not TranslationKeys. */
export {
  getNotificationCopy,
  type NotificationCopy,
  type NotificationSourceCopy,
  type NotificationUiCopy,
} from './notificationCatalog'
