/**
 * Stamp site title/icon into the SPA document and web app manifest.
 *  Fail-open: invalid or missing brand leaves build-time defaults.
 *  Metadata URL is operator-configured only; never taken from the request.
 *
 *  Crawler / share HTML is not stamped here. Backend `load_site_branding`
 *  writes those shells; this module only paints documents the frontend emits.
 */

export const DEFAULT_BRAND_TITLE = 'Myriad - A myriad of lights, in one place.'
export const DEFAULT_BRAND_DESCRIPTION = 'A myriad of lights, in one place.'
export const DEFAULT_BRAND_FAVICON = '/favicon.webp'
export const SITE_ICON_API_PATH = '/api/config/site-icon'
/** Keep in sync with frontend/src/utils/siteMetadataKeys.ts */
export const SITE_BRAND_ELEMENT_ID = 'myriad-site-brand'

const TITLE_MAX = 500
const DESC_MAX = 2000
const FAVICON_MAX = 1_500_000

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function isAllowedMetadataUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return false
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (url.username || url.password) return false
    if (url.search || url.hash) return false
    return url.pathname === '/api/config/metadata'
  } catch {
    return false
  }
}

function isSchemeSmuggledPath(value) {
  if (!(value.startsWith('/') && !value.startsWith('//'))) return false
  const rest = value.slice(1)
  const colon = rest.indexOf(':')
  if (colon <= 0) return false
  return /^[a-z][a-z0-9+.-]*$/i.test(rest.slice(0, colon))
}

function sanitizeHttpUrl(raw) {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    if (url.username || url.password) return ''
    return url.toString()
  } catch {
    return ''
  }
}

export function sanitizeStampFavicon(raw) {
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  if (!value || value.length > FAVICON_MAX) return ''
  if (value.startsWith('//')) return ''
  if (value.startsWith('/') && !value.startsWith('//')) {
    return isSchemeSmuggledPath(value) ? '' : value
  }
  if (/^https?:\/\//i.test(value)) return sanitizeHttpUrl(value)
  if (/^data:image\//i.test(value)) return value
  return ''
}

/** OG image: path or http(s). No data: (unlike favicon). */
export function sanitizeStampOgImage(raw) {
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  if (!value || value.length > 2000) return ''
  if (value.startsWith('//')) return ''
  if (value.startsWith('/') && !value.startsWith('//')) {
    return isSchemeSmuggledPath(value) ? '' : value
  }
  if (/^https?:\/\//i.test(value)) return sanitizeHttpUrl(value)
  return ''
}

export function shortBrandName(title, max = 12) {
  const trimmed = String(title || '').trim()
  if (!trimmed) return 'Myriad'
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

export function normalizeStampBrand(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const title = String(source.site_title || '')
    .trim()
    .slice(0, TITLE_MAX)
  const description = String(source.site_description || '')
    .trim()
    .slice(0, DESC_MAX)
  const favicon =
    sanitizeStampFavicon(source.site_favicon) || DEFAULT_BRAND_FAVICON
  return {
    site_title: title || DEFAULT_BRAND_TITLE,
    site_description: description || DEFAULT_BRAND_DESCRIPTION,
    site_favicon: favicon,
    site_og_image: sanitizeStampOgImage(source.site_og_image),
  }
}

function brandSlotRe(slot, flags = 'i') {
  return new RegExp(`\\bdata-myriad-brand="${slot}"(?=[\\s>])`, flags)
}

function replaceBrandAttr(html, slot, attr, value) {
  const tagRe = new RegExp(
    `<([a-zA-Z][\\w-]*)\\b[^>]*${brandSlotRe(slot).source}[^>]*>`,
    'i',
  )
  return html.replace(tagRe, (tag) => {
    if (new RegExp(`\\b${attr}\\s*=`, 'i').test(tag)) {
      return tag.replace(
        new RegExp(`(\\b${attr}\\s*=\\s*)("[^"]*"|'[^']*')`, 'i'),
        `$1"${value}"`,
      )
    }
    return tag.replace(/>$/, ` ${attr}="${value}">`)
  })
}

function replaceBrandInner(html, slot, inner) {
  const re = new RegExp(
    `(<script\\b[^>]*${brandSlotRe(slot).source}[^>]*>)[\\s\\S]*?(</script>)`,
    'i',
  )
  return html.replace(re, `$1${inner}$2`)
}

function escapeJsonForScript(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
}

export function brandJsonForDocument(brand) {
  const next = normalizeStampBrand(brand)
  const payload = {
    site_title: next.site_title,
    site_description: next.site_description,
    site_favicon: next.site_favicon,
  }
  if (next.site_og_image) payload.site_og_image = next.site_og_image
  return escapeJsonForScript(payload)
}

function stampJsonLd(html, brand) {
  const next = normalizeStampBrand(brand)
  return html.replace(
    new RegExp(
      `(<script\\b[^>]*${brandSlotRe('json-ld').source}[^>]*>)([\\s\\S]*?)(</script>)`,
      'i',
    ),
    (full, open, body, close) => {
      try {
        const data = JSON.parse(body)
        if (!data || typeof data !== 'object') return full
        data.name = next.site_title
        data.description = next.site_description
        return `${open}${escapeJsonForScript(data)}${close}`
      } catch {
        return full
      }
    },
  )
}

export function stampDocumentHtml(html, brand) {
  const next = normalizeStampBrand(brand)
  const title = escapeHtml(next.site_title)
  const description = escapeHtml(next.site_description)
  const icon = escapeHtml(next.site_favicon)
  const appTitle = escapeHtml(shortBrandName(next.site_title))
  const ogImage = escapeHtml(next.site_og_image)

  let out = String(html)
  out = out.replace(
    /(<title\b[^>]+\bdata-myriad-brand="title"(?=[\s>])[^>]*>)[\s\S]*?(<\/title>)/i,
    `$1${title}$2`,
  )
  out = replaceBrandAttr(out, 'description', 'content', description)
  out = replaceBrandAttr(out, 'favicon', 'href', icon)
  out = replaceBrandAttr(out, 'apple-touch', 'href', icon)
  out = replaceBrandAttr(out, 'app-title', 'content', appTitle)
  out = replaceBrandAttr(out, 'og-title', 'content', title)
  out = replaceBrandAttr(out, 'og-description', 'content', description)
  if (ogImage) {
    out = replaceBrandAttr(out, 'og-image', 'content', ogImage)
  } else {
    out = out.replace(
      new RegExp(`<meta\\b[^>]*${brandSlotRe('og-image').source}[^>]*>`, 'i'),
      '',
    )
  }
  out = replaceBrandInner(out, 'json', brandJsonForDocument(next))
  out = stampJsonLd(out, next)
  return out
}

export function resolveManifestIconSrc(favicon) {
  const icon = sanitizeStampFavicon(favicon)
  if (!icon) return DEFAULT_BRAND_FAVICON
  if (icon.startsWith('data:') || icon.startsWith('/')) return icon
  return SITE_ICON_API_PATH
}

export function stampWebManifest(base, brand) {
  const next = normalizeStampBrand(brand)
  const manifest =
    base && typeof base === 'object' ? { ...base } : {}
  manifest.name = next.site_title
  manifest.short_name = shortBrandName(next.site_title)
  manifest.description = next.site_description

  if (next.site_favicon !== DEFAULT_BRAND_FAVICON) {
    const src = resolveManifestIconSrc(next.site_favicon)
    manifest.icons = [
      { src, sizes: 'any', purpose: 'any' },
      { src, sizes: '192x192', purpose: 'any' },
      { src, sizes: '512x512', purpose: 'any' },
    ]
  }
  return manifest
}

const METADATA_BODY_MAX = 64_000

export async function fetchStampBrand(metadataUrl, { timeoutMs = 800 } = {}) {
  if (!isAllowedMetadataUrl(metadataUrl)) return null
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(metadataUrl, {
      signal: ac.signal,
      redirect: 'error',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    const ctype = res.headers.get('content-type') || ''
    if (!ctype.includes('json')) return null
    const text = await res.text()
    if (text.length > METADATA_BODY_MAX) return null
    return normalizeStampBrand(JSON.parse(text))
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function createBrandLoader(metadataUrl, { ttlMs = 15_000, timeoutMs = 800 } = {}) {
  let cached = null
  let inflight = null
  return async function loadBrand() {
    const now = Date.now()
    if (cached && now - cached.at < ttlMs) return cached.brand
    if (!inflight) {
      inflight = fetchStampBrand(metadataUrl, { timeoutMs })
        .then((brand) => {
          if (brand) cached = { at: Date.now(), brand }
          return cached?.brand ?? null
        })
        .finally(() => {
          inflight = null
        })
    }
    return inflight
  }
}
