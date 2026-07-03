/**
 * Client for the Myriad updater.
 *
 * Two transports, selected by `mode` at call sites:
 *
 *  - 'backend' (default): goes through `/api/admin/updater/*`. The backend has admin-session
 *    auth + holds `UPDATE_TOKEN` server-side. Mutating calls go through the backend's
 *    `csrf_middleware`, so we attach `X-CSRF-Token` for POSTs.
 *
 *  - 'direct': goes through `/_updater/*` on the proxy. Requires the caller to supply
 *    `UPDATE_TOKEN` manually. Kept as a fallback for when the backend is down or the user
 *    is running an operator's rescue flow.
 *
 * See docs/updater-spec.md §13.
 */

import { getCSRFToken } from '../utils/csrf'

const BACKEND_BASE = '/api/admin/updater'
const DIRECT_BASE = '/_updater'

export type TransportMode = 'backend' | 'direct'

export interface LatestAvailable {
  version: string
  channel: string
  seen_at: string
  requires_self_update: boolean
  min_updater_version: string | null
  notes_url: string
}

export interface UpdaterStatus {
  schema_version: number
  updater_version: string
  current_version: string | null
  channel: string
  maintenance_active: boolean
  maintenance_phase: string
  job_in_flight: string | null
  // 字段从 updater 0.2 起出现，旧 updater 不返回；UI 必须按可选处理。
  latest_available?: LatestAvailable | null
  update_available?: boolean
  requires_self_update?: boolean
  last_checked_at?: string | null
}

export interface ImageRef {
  ref: string
  digest: string
}

export interface ReleaseManifest {
  schema_version: number
  version: string
  channel: string
  released_at: string
  min_from_version?: string
  images: Record<string, ImageRef>
  env: {
    required: string[]
    new: Array<{
      name: string
      required: boolean
      default?: string
      description?: string
    }>
    removed: string[]
  }
  migrations: {
    irreversible: boolean
    estimated_seconds: number
    requires_full_backup: boolean
  }
  updater: { min_updater_version: string; self_update_required: boolean }
  postgres: { min_pg_version: string; max_pg_version: string }
  notes_url: string
  signature: string | null
}

export interface SnapshotMeta {
  id: string
  created_at: string
  source_version: string | null
  size_bytes: number
  file_count: number
  keep: boolean
  sample_sha256: string | null
}

export interface SnapshotsResponse {
  schema_version: number
  items: SnapshotMeta[]
}

export interface JobStep {
  phase: string
  started_at: string
  finished_at: string | null
  ok: boolean | null
  log_tail: string
  error: string | null
}

export interface Job {
  id: string
  kind: 'update' | 'rollback' | 'self_update'
  created_at: string
  finished_at: string | null
  from_version: string | null
  to_version: string | null
  snapshot_id: string | null
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'needs_manual'
  steps: JobStep[]
}

interface CallOptions {
  mode?: TransportMode
  token?: string
  idempotencyKey?: string
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: CallOptions = {},
): Promise<T> {
  const mode: TransportMode = opts.mode ?? 'backend'
  const base = mode === 'backend' ? BACKEND_BASE : DIRECT_BASE

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (opts.token) headers['X-Update-Token'] = opts.token
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey

  // Backend mode + state-changing methods go through backend csrf_middleware.
  // Direct mode bypasses backend entirely so no CSRF token is required.
  const stateChanging =
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE'
  if (mode === 'backend' && stateChanging) {
    const csrf = await getCSRFToken().catch(() => null)
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  const resp = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    // backend mode rides on admin session cookie; direct mode is token-only.
    credentials: mode === 'backend' ? 'same-origin' : 'omit',
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    let detail = text
    try {
      detail = JSON.parse(text).error ?? text
    } catch {
      /* keep raw */
    }
    throw new UpdaterError(resp.status, detail || resp.statusText)
  }
  if (resp.status === 204) return undefined as T
  return (await resp.json()) as T
}

export class UpdaterError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'UpdaterError'
  }
}

/**
 * Builder so callers can pin a single transport mode + token once and reuse it.
 *
 * Usage:
 *   const api = makeUpdaterApi({ mode: 'backend' })       // default
 *   const api = makeUpdaterApi({ mode: 'direct', token }) // fallback
 */
export function makeUpdaterApi(
  opts: { mode?: TransportMode; token?: string } = {},
) {
  const mode = opts.mode ?? 'backend'
  const token = opts.token

  const wrap = <T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ) => call<T>(method, path, body, { mode, token, idempotencyKey })

  return {
    mode,
    status: () => wrap<UpdaterStatus>('GET', '/status'),
    available: (channel?: string) =>
      wrap<ReleaseManifest | null>(
        'GET',
        `/available${channel ? `?channel=${channel}` : ''}`,
      ),
    jobs: () => wrap<string[]>('GET', '/jobs'),
    job: (id: string) => wrap<Job>('GET', `/jobs/${id}`),
    snapshots: () => wrap<SnapshotsResponse>('GET', '/snapshots'),
    triggerUpdate: (target: string, idemKey?: string) =>
      wrap<{ job_id: string }>(
        'POST',
        '/update',
        { target_version: target },
        idemKey,
      ),
    rollback: (snapshotId: string) =>
      wrap<{ job_id: string }>('POST', '/rollback', {
        snapshot_id: snapshotId,
      }),
    diagnostics: () => wrap<unknown>('GET', '/diagnostics'),
    exitMaintenance: () =>
      wrap<{ ok: boolean }>('POST', '/rescue/exit-maintenance'),
    forgetCurrent: () =>
      wrap<{ ok: boolean }>('POST', '/rescue/forget-current'),
    /** 触发 updater 自更新；旧 updater 几秒后会被 helper container 替换。 */
    triggerSelfUpdate: () =>
      wrap<{
        ok: boolean
        helper_container_id: string
        new_updater_tag: string
      }>(
        'POST',
        // backend mode: 走 backend 代理；direct mode: 直接命中 updater /admin/self-update
        mode === 'backend' ? '/self-update' : '/admin/self-update',
      ),
  }
}

/** Default singleton — uses backend transport (admin session). */
export const updaterApi = makeUpdaterApi()

/**
 * Compare the browser-cached frontend version with what the backend currently reports.
 * The updater health flow ensures version matching at swap time, but a tab opened before
 * the swap will keep running the old bundle. Use this on app load to nudge a reload.
 */
export async function detectVersionDrift(): Promise<{
  current: string
  build: string
  drift: boolean
} | null> {
  try {
    const built = document
      .querySelector('meta[name="myriad-version"]')
      ?.getAttribute('content')
    if (!built) return null
    const resp = await fetch('/health', { credentials: 'omit' })
    if (!resp.ok) return null
    const health = await resp.json()
    const current = String(health?.version ?? '')
    if (!current) return null
    return {
      current,
      build: built,
      drift: current !== built && built !== 'dev',
    }
  } catch {
    return null
  }
}
