import { API_URL } from '../../../config'

export function normalizeHttpsMediaUrl(url?: string | null): string | null {
  if (!url || typeof url !== 'string') return null
  let u = url.trim()
  if (!u) return null
  if (u.startsWith('//')) u = `https:${u}`
  if (u.startsWith('http://')) u = `https://${u.slice(7)}`
  return u
}

/**
 * Xbox / MS 商店图常给 http:// 或非 SSL 域名，HTTPS 页面会因混合内容被拦。
 * 统一升到 https，并把 images-eds → images-eds-ssl。
 */
export function normalizeXboxMediaUrl(url?: string | null): string | null {
  const base = normalizeHttpsMediaUrl(url)
  if (!base) return null
  return base.replace(
    '://images-eds.xboxlive.com',
    '://images-eds-ssl.xboxlive.com',
  )
}

export function getBilibiliProxyUrl(cover?: string, title?: string): string {
  if (!cover) {
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(title || 'B')}&size=400&background=00A1D6&color=fff`
  }
  if (cover.startsWith('/api/proxy/')) return cover
  if (cover.includes('hdslb.com') || cover.includes('bilibili.com')) {
    return `${API_URL || ''}/api/proxy/image?url=${encodeURIComponent(cover)}`
  }
  return cover
}
