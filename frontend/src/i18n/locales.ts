export const LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP'] as const

export type Locale = (typeof LOCALES)[number]

export function isLocale(value: unknown): value is Locale {
  return (
    value === 'zh-CN' ||
    value === 'zh-TW' ||
    value === 'en-US' ||
    value === 'ja-JP'
  )
}

function mapLanguageTag(tag: string): Locale | null {
  const raw = tag.trim().replace(/_/g, '-')
  if (!raw) return null
  if (isLocale(raw)) return raw
  const lower = raw.toLowerCase()
  if (
    lower.startsWith('zh-tw') ||
    lower.startsWith('zh-hk') ||
    lower.startsWith('zh-mo') ||
    lower.includes('hant')
  ) {
    return 'zh-TW'
  }
  if (lower.startsWith('zh')) return 'zh-CN'
  if (lower.startsWith('ja')) return 'ja-JP'
  if (lower.startsWith('en')) return 'en-US'
  return null
}

function parseLanguageList(
  raw: string,
): Array<{ tag: string; q: number }> {
  return raw
    .split(',')
    .map((part, index) => {
      const [tagPart, ...params] = part.trim().split(';')
      let q = 1
      for (const param of params) {
        const match = param.trim().match(/^q=([0-9.]+)$/i)
        if (!match) continue
        const value = Number(match[1])
        q = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
      }
      return { tag: (tagPart ?? '').trim(), q, index }
    })
    .filter((item) => item.tag && item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
}

/** Map a BCP 47 tag or Accept-Language list onto a host UI locale. */
export function parseLocale(raw: string | null | undefined): Locale | null {
  const tag = raw?.trim() ?? ''
  if (!tag) return null
  if (isLocale(tag)) return tag
  for (const item of parseLanguageList(tag)) {
    const mapped = mapLanguageTag(item.tag)
    if (mapped) return mapped
  }
  return null
}

export function localeOrFallback(
  raw: string | null | undefined,
  fallback: Locale = 'en-US',
): Locale {
  return parseLocale(raw) ?? fallback
}

/** localStorage → navigator languages (q-aware) → en-US */
export function getDefaultLocale(): Locale {
  if (typeof window !== 'undefined') {
    const saved = parseLocale(localStorage.getItem('locale'))
    if (saved) return saved
  }

  if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
    const languages = Array.isArray(navigator.languages)
      ? navigator.languages
      : []
    for (const language of languages) {
      const parsed = parseLocale(language)
      if (parsed) return parsed
    }
    const browserLang =
      navigator.language || (navigator as { userLanguage?: string }).userLanguage
    const parsed = parseLocale(browserLang)
    if (parsed) return parsed
  }

  return 'en-US'
}

export function saveLocale(locale: Locale): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('locale', locale)
  }
}

export function htmlLang(locale: Locale): string {
  switch (locale) {
    case 'zh-CN':
      return 'zh-CN'
    case 'zh-TW':
      return 'zh-TW'
    case 'ja-JP':
      return 'ja-JP'
    default:
      return 'en'
  }
}
