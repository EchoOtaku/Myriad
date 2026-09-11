import { API_URL } from '../config'
import { ApiError } from '../services/api'
import { normalizeJsonMediaUrls } from './proxyImageUrl'
import { httpStatusMessage } from './userFacingError'

const pendingRequests = new Map<string, Promise<any>>()

const resultCache = new Map<string, { data: any; timestamp: number }>()

/** Generation++ on clear; in-flight responses must not refill the cache. */
const cacheGeneration = new Map<string, number>()

const MAX_CACHE_SIZE = 50
/** Generation table has its own cap (survives clear). */
const MAX_GENERATION_KEYS = 200

const DEFAULT_CACHE_TTL = 30 * 1000

function generationOf(key: string): number {
  return cacheGeneration.get(key) ?? 0
}

function bumpGeneration(key: string): void {
  const next = generationOf(key) + 1
  cacheGeneration.delete(key)
  cacheGeneration.set(key, next)
  pruneGenerationStore()
}

function pruneGenerationStore(): void {
  if (cacheGeneration.size <= MAX_GENERATION_KEYS) return
  for (const key of cacheGeneration.keys()) {
    if (cacheGeneration.size <= MAX_GENERATION_KEYS) break
    if (pendingRequests.has(key)) continue
    cacheGeneration.delete(key)
  }
}

function ensureCacheSize() {
  if (resultCache.size <= MAX_CACHE_SIZE) return

  // Map insertion order = LRU.
  const keysToDelete: string[] = []
  const deleteCount = resultCache.size - MAX_CACHE_SIZE

  let count = 0
  for (const key of resultCache.keys()) {
    if (count >= deleteCount) break
    keysToDelete.push(key)
    count++
  }

  keysToDelete.forEach((key) => resultCache.delete(key))
}

function getCacheWithLRU(
  key: string,
): { data: any; timestamp: number } | undefined {
  const cached = resultCache.get(key)
  if (cached) {
    resultCache.delete(key)
    resultCache.set(key, cached)
  }
  return cached
}

export interface DedupOptions {
  /** TTL ms; default 30s */
  cacheTTL?: number
  forceRefresh?: boolean
  cacheKey?: string
}

export async function dedupedFetch<T>(
  url: string,
  fetchFn: () => Promise<T>,
  options: DedupOptions = {},
): Promise<T> {
  const {
    cacheTTL = DEFAULT_CACHE_TTL,
    forceRefresh = false,
    cacheKey = url,
  } = options

  if (!forceRefresh) {
    const cached = getCacheWithLRU(cacheKey)
    if (cached && Date.now() - cached.timestamp < cacheTTL) {
      return cached.data as T
    }
  }

  const pending = pendingRequests.get(cacheKey)
  if (pending) {
    return pending as Promise<T>
  }

  // Stale responses after clear must not land.
  const genAtStart = generationOf(cacheKey)
  const requestPromise = fetchFn()
    .then((data) => {
      if (generationOf(cacheKey) === genAtStart) {
        ensureCacheSize()
        resultCache.set(cacheKey, { data, timestamp: Date.now() })
      }
      return data
    })
    .finally(() => {
      // Drop only this request's pending slot.
      if (pendingRequests.get(cacheKey) === requestPromise) {
        pendingRequests.delete(cacheKey)
      }
    })

  pendingRequests.set(cacheKey, requestPromise)

  return requestPromise
}

export function clearDedupCache(url?: string): void {
  if (url) {
    bumpGeneration(url)
    resultCache.delete(url)
    pendingRequests.delete(url)
  } else {
    for (const key of resultCache.keys()) bumpGeneration(key)
    for (const key of pendingRequests.keys()) bumpGeneration(key)
    resultCache.clear()
    pendingRequests.clear()
  }
}

/** Invalidate variants and in-flight requests for this endpoint. */
export function clearDedupCacheByPrefix(prefix: string): void {
  const keys = new Set<string>()
  for (const key of resultCache.keys()) {
    if (key.startsWith(prefix)) keys.add(key)
  }
  for (const key of pendingRequests.keys()) {
    if (key.startsWith(prefix)) keys.add(key)
  }
  for (const key of keys) {
    bumpGeneration(key)
    resultCache.delete(key)
    pendingRequests.delete(key)
  }
}

export function clearLibraryDataCache(): void {
  const endpoint = `${API_URL}/api/library`
  clearDedupCache(endpoint)
  clearDedupCacheByPrefix(`${endpoint}?`)
}

export async function getUIConfigDeduped(): Promise<any> {
  return dedupedFetch(
    `${API_URL}/api/config/ui`,
    async () => {
      const response = await fetch(`${API_URL}/api/config/ui`)
      if (!response.ok) {
        throw new ApiError(httpStatusMessage(response.status), response.status)
      }
      return response.json()
    },
    { cacheTTL: 30 * 1000 },
  )
}

export async function getLatestReportDeduped(
  options: { forceRefresh?: boolean } = {},
): Promise<any> {
  const cacheKey = `${API_URL}/api/reports/latest`
  const data = await dedupedFetch(
    cacheKey,
    async () => {
      const response = await fetch(`${API_URL}/api/reports/latest`, {
        credentials: 'include',
      })
      if (!response.ok) {
        throw new ApiError(httpStatusMessage(response.status), response.status)
      }
      return response.json()
    },
    { cacheTTL: 30 * 1000, forceRefresh: options.forceRefresh },
  )

  // Do not cache empty/failed payloads.
  const reports = data?.platform_reports
  const empty =
    !data ||
    data.success === false ||
    !Array.isArray(reports) ||
    reports.length === 0
  if (empty) {
    clearDedupCache(cacheKey)
  }
  return data
}

export function invalidateLatestReportCache(): void {
  clearDedupCache(`${API_URL}/api/reports/latest`)
}

export async function getPublicConfigDeduped(): Promise<any> {
  return dedupedFetch(
    `${API_URL}/api/config/public`,
    async () => {
      const response = await fetch(`${API_URL}/api/config/public`)
      if (!response.ok) {
        throw new ApiError(httpStatusMessage(response.status), response.status)
      }
      return response.json()
    },
    { cacheTTL: 30 * 1000 },
  )
}

export function invalidatePublicConfigCache(): void {
  clearDedupCache(`${API_URL}/api/config/public`)
}

export async function getLibraryDataDeduped(): Promise<any> {
  return dedupedFetch(
    `${API_URL}/api/library`,
    async () => {
      const response = await fetch(`${API_URL}/api/library`, {
        credentials: 'include',
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) {
        throw new ApiError(httpStatusMessage(response.status), response.status)
      }
      const data = await response.json()
      return normalizeJsonMediaUrls(data)
    },
    { cacheTTL: 2 * 60 * 1000 },
  )
}

export async function getLibraryDataPageDeduped(
  offset: number,
  limit: number,
  itemType?: string,
): Promise<any> {
  const safeOffset = Math.max(0, Math.floor(offset))
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)))
  const params = new URLSearchParams({
    offset: String(safeOffset),
    limit: String(safeLimit),
  })
  if (itemType && itemType !== 'all') params.set('type', itemType)
  const url = `${API_URL}/api/library?${params.toString()}`
  return dedupedFetch(
    url,
    async () => {
      const response = await fetch(url, {
        credentials: 'include',
        signal: AbortSignal.timeout(30000),
      })
      if (!response.ok) {
        throw new ApiError(httpStatusMessage(response.status), response.status)
      }
      const data = await response.json()
      return normalizeJsonMediaUrls(data)
    },
    { cacheTTL: 2 * 60 * 1000 },
  )
}
