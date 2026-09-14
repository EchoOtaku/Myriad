import type { TimeTranslations } from '../types'

import { useMemo } from 'react'
import { useI18n } from '../../../contexts/I18nContext'
import { formatMessage, localeOrFallback } from '../../../i18n'

export function usePhantasiTimes(): TimeTranslations {
  const { t } = useI18n()
  return useMemo(
    () => ({
      justNow: t.phantasi.justNow,
      minutesAgo: t.phantasi.minutesAgo,
      hoursAgo: t.phantasi.hoursAgo,
      daysAgo: t.phantasi.daysAgo,
    }),
    [t.phantasi.justNow, t.phantasi.minutesAgo, t.phantasi.hoursAgo, t.phantasi.daysAgo],
  )
}

export function phantasiRelativeTime(
  timestamp: number | null | undefined,
  translations: TimeTranslations,
  locale: string,
): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const diff = Date.now() - date.getTime()

  if (diff < 60_000) return translations.justNow
  const loc = localeOrFallback(locale)
  if (diff < 3_600_000) {
    return formatMessage(loc, translations.minutesAgo, {
      minutes: Math.floor(diff / 60_000),
    })
  }
  if (diff < 86_400_000) {
    return formatMessage(loc, translations.hoursAgo, {
      hours: Math.floor(diff / 3_600_000),
    })
  }
  if (diff < 604_800_000) {
    return formatMessage(loc, translations.daysAgo, {
      days: Math.floor(diff / 86_400_000),
    })
  }

  const dateLocale = locale
  return date.toLocaleDateString(dateLocale, {
    month: 'short',
    day: 'numeric',
  })
}
