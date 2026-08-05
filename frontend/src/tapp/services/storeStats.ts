/**
 * Official Tapp store install stats (edge service).
 * Default: https://stats.store.myriad.you
 *
 * Dual-path beacons:
 * - Backend store install/update → myriad-backend (server)
 * - Browser fallback only → myriad-browser (this module)
 */

export const DEFAULT_STORE_STATS_URL = 'https://stats.store.myriad.you'

const STATS_TTL_MS = 60_000

export type StoreStatsEvent = 'install' | 'update'

export interface StoreAppStats {
  installs: number
  updates: number
  downloads: number
}

export interface StoreStatsResponse {
  updated_at: string
  apps: Record<string, StoreAppStats>
  ranked?: Array<{ id: string } & StoreAppStats>
}

let cachedAt = 0
let cachedMap: Record<string, number> = {}

function statsBaseUrl(): string | null {
  const fromEnv =
    typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string> }).env?.VITE_TAPP_STORE_STATS_URL
  const raw = (fromEnv || DEFAULT_STORE_STATS_URL).trim()
  if (!raw || raw === '0' || raw === 'false' || raw === 'off') return null
  return raw.replace(/\/+$/, '')
}

export function isStoreStatsEnabled(): boolean {
  return statsBaseUrl() !== null
}

/** Merge download counts for the given app ids (batch ≤ 100). */
export async function fetchStoreDownloadCounts(
  appIds: string[],
): Promise<Record<string, number>> {
  const base = statsBaseUrl()
  if (!base || appIds.length === 0) return {}

  const unique = [...new Set(appIds.filter(Boolean))]
  const now = Date.now()
  if (now - cachedAt < STATS_TTL_MS) {
    const hit: Record<string, number> = {}
    let allCached = true
    for (const id of unique) {
      if (cachedMap[id] !== undefined) hit[id] = cachedMap[id]
      else allCached = false
    }
    if (allCached) return hit
  }

  const out: Record<string, number> = {}
  const batchSize = 100
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize)
    try {
      const url = `${base}/v1/stats?apps=${encodeURIComponent(batch.join(','))}`
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) continue
      const data = (await res.json()) as StoreStatsResponse
      for (const [id, entry] of Object.entries(data.apps || {})) {
        const n = entry?.downloads ?? entry?.installs ?? 0
        if (typeof n === 'number' && n > 0) {
          out[id] = n
          cachedMap[id] = n
        }
      }
    } catch {
      // stats failure must never break store UI
    }
  }
  cachedAt = Date.now()
  return out
}

export function clearStoreStatsCache(): void {
  cachedAt = 0
  cachedMap = {}
}

export interface ReportStoreHitInput {
  appId: string
  version: string
  event: StoreStatsEvent
  /** Session-unique; defaults to random UUID */
  idempotencyKey?: string
}

/**
 * Browser-only beacon after client-fallback install/update success.
 * Silent on failure.
 */
export function reportStoreInstallHit(input: ReportStoreHitInput): void {
  const base = statsBaseUrl()
  if (!base) return

  const idempotency_key =
    input.idempotencyKey ||
    (typeof crypto !== 'undefined' && crypto.randomUUID
      ? `fe-${input.event}-${crypto.randomUUID()}`
      : `fe-${input.event}-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  const body = JSON.stringify({
    app_id: input.appId,
    version: input.version,
    event: input.event,
    idempotency_key,
    client: 'myriad-browser',
    source: 'official',
  })

  const url = `${base}/v1/hit`
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' })
      if (navigator.sendBeacon(url, blob)) return
    }
  } catch {
    // fall through
  }

  void fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {})
}
