import { API_URL } from '../config'

/** Resolve backend-owned paths for display only; never rewrite stored asset identity. */
export function siteMediaUrl(src: string, apiUrl = API_URL): string {
  const path = src.trim()
  if (
    path.startsWith('/api/') ||
    path.startsWith('/media/assets/') ||
    path.startsWith('/media/federation/')
  ) {
    return `${apiUrl.replace(/\/$/, '')}${path}`
  }
  return path
}
