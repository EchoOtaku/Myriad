/** Host UI locale parsing. No TypeScript — first-paint inlines this file. */

export function isLocale(value) {
  return (
    value === 'zh-CN' ||
    value === 'zh-TW' ||
    value === 'en-US' ||
    value === 'ja-JP'
  )
}

export function mapLanguageTag(tag) {
  const raw = String(tag || '')
    .trim()
    .replace(/_/g, '-')
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

export function parseLanguageList(raw) {
  return String(raw || '')
    .split(',')
    .map((part, index) => {
      const bits = part.trim().split(';')
      let q = 1
      for (let i = 1; i < bits.length; i++) {
        const match = bits[i].trim().match(/^q=([0-9.]+)$/i)
        if (!match) continue
        const value = Number(match[1])
        q = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
      }
      return { tag: (bits[0] || '').trim(), q, index }
    })
    .filter((item) => item.tag && item.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
}

export function parseLocale(raw) {
  const tag = raw == null ? '' : String(raw).trim()
  if (!tag) return null
  if (isLocale(tag)) return tag
  const items = parseLanguageList(tag)
  for (let i = 0; i < items.length; i++) {
    const mapped = mapLanguageTag(items[i].tag)
    if (mapped) return mapped
  }
  return null
}

export function parseLocaleCookie(cookie) {
  const parts = String(cookie || '').split(';')
  for (let i = 0; i < parts.length; i++) {
    const trimmed = parts[i].trim()
    if (trimmed.startsWith('locale=')) {
      try {
        return decodeURIComponent(trimmed.slice('locale='.length))
      } catch {
        return trimmed.slice('locale='.length)
      }
    }
  }
  return null
}

export function resolveHostLocale(stored, cookie, languageList) {
  return (
    parseLocale(stored) ||
    parseLocale(cookie) ||
    parseLocale(languageList) ||
    'en-US'
  )
}

export function htmlLang(locale) {
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
