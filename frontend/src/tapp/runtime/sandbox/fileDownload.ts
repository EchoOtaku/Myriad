/**
 * Host-side save-as for Tapp.file.download.
 *
 * Modes (exactly one source):
 * - `content`: UTF-8 text the sandbox already holds
 * - `url`: this site's image-cache or public 3D asset path (host fetches;
 *   sandbox connect-src cannot). Arbitrary http(s) is rejected (SSRF).
 * - `base64`: binary the sandbox already holds (TTS audio, data URLs, blob
 *   reads). The iframe has no allow-downloads.
 */

export const FILE_DOWNLOAD_CONTENT_MAX_BYTES = 32 * 1024 * 1024
export const FILE_DOWNLOAD_BLOB_MAX_BYTES = 32 * 1024 * 1024

const IMAGE_CACHE_FILE =
  /^\/api\/brew\/image-cache\/([0-9a-f]{2})\/([0-9a-f]{64})\.(jpg|jpeg|png|gif|webp)$/i
const MODEL3D_ASSET =
  /^\/api\/model3d\/assets\/([0-9a-f]{64})$/i

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

export type HostDownloadRef = {
  path: string
  defaultFilename: string
  mimeType: string
}

function sitePathFromUrl(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) {
    return null
  }
  const withoutQuery = url.split('#')[0]?.split('?')[0] ?? url
  const cacheAt = withoutQuery.indexOf('/api/brew/image-cache/')
  if (cacheAt >= 0) return withoutQuery.slice(cacheAt)
  const modelAt = withoutQuery.indexOf('/api/model3d/assets/')
  if (modelAt >= 0) return withoutQuery.slice(modelAt)
  return null
}

/** Resolve a public generated-asset URL to the site-relative path the host may fetch. */
export function parseHostDownloadUrl(url: string): HostDownloadRef | null {
  const path = sitePathFromUrl(url)
  if (!path) return null

  const image = IMAGE_CACHE_FILE.exec(path)
  if (image) {
    const subdir = image[1].toLowerCase()
    const stem = image[2].toLowerCase()
    const ext = image[3].toLowerCase()
    if (!stem.startsWith(subdir)) return null
    return {
      path: `/api/brew/image-cache/${subdir}/${stem}.${ext}`,
      defaultFilename: `image.${ext}`,
      mimeType: MIME_BY_EXT[ext] ?? 'application/octet-stream',
    }
  }

  const model = MODEL3D_ASSET.exec(path)
  if (model) {
    const assetId = model[1].toLowerCase()
    return {
      path: `/api/model3d/assets/${assetId}`,
      defaultFilename: 'model.glb',
      mimeType: 'model/gltf-binary',
    }
  }

  return null
}

export function parseLocalImageCacheUrl(url: string): HostDownloadRef | null {
  const parsed = parseHostDownloadUrl(url)
  if (!parsed?.path.startsWith('/api/brew/image-cache/')) return null
  return parsed
}

export function isSafeDownloadFilename(filename: string): boolean {
  return (
    typeof filename === 'string' &&
    filename.length > 0 &&
    filename.length <= 1024 &&
    !filename.includes('..') &&
    !filename.includes('/') &&
    !filename.includes('\\')
  )
}

export function decodeDownloadBase64(
  value: string,
): { bytes: Uint8Array; mimeType?: string } | null {
  if (typeof value !== 'string' || value.length === 0) return null
  if (value.length > FILE_DOWNLOAD_CONTENT_MAX_BYTES) return null
  let mimeType: string | undefined
  let payload = value.trim()
  const dataUrl = /^data:([^;,]+);base64,([\s\S]+)$/.exec(payload)
  if (dataUrl) {
    mimeType = dataUrl[1]
    payload = dataUrl[2]
  }
  const compact = payload.replace(/\s/g, '')
  if (!compact) return null
  try {
    const binary = atob(compact)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    if (bytes.length === 0 || bytes.length > FILE_DOWNLOAD_BLOB_MAX_BYTES) {
      return null
    }
    return { bytes, mimeType }
  } catch {
    return null
  }
}

export function validateFileDownloadOptions(options: unknown): {
  valid: boolean
  error?: string
} {
  const invalid = {
    valid: false as const,
    error: `Invalid or oversized file payload (max ${FILE_DOWNLOAD_CONTENT_MAX_BYTES} bytes)`,
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    return invalid
  }
  const record = options as Record<string, unknown>
  const hasContent = typeof record.content === 'string'
  const hasUrl = typeof record.url === 'string'
  const hasBase64 = typeof record.base64 === 'string'
  const sources = Number(hasContent) + Number(hasUrl) + Number(hasBase64)
  if (sources !== 1) return invalid
  if (
    record.mimeType !== undefined &&
    (typeof record.mimeType !== 'string' || record.mimeType.length > 256)
  ) {
    return invalid
  }
  if (hasUrl) {
    if (!parseHostDownloadUrl(record.url as string)) return invalid
    if (
      record.filename !== undefined &&
      !isSafeDownloadFilename(String(record.filename))
    ) {
      return invalid
    }
    return { valid: true }
  }
  if (!isSafeDownloadFilename(String(record.filename ?? ''))) return invalid
  if (hasBase64) {
    const raw = record.base64 as string
    if (raw.length === 0 || raw.length > FILE_DOWNLOAD_CONTENT_MAX_BYTES) {
      return invalid
    }
    return { valid: true }
  }
  if (new Blob([record.content as string]).size > FILE_DOWNLOAD_CONTENT_MAX_BYTES) {
    return invalid
  }
  return { valid: true }
}

export function triggerBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  setTimeout(() => {
    if (anchor.parentNode) anchor.parentNode.removeChild(anchor)
    URL.revokeObjectURL(objectUrl)
  }, 100)
}
