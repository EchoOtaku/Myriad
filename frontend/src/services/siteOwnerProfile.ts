/** 站长公开资料请求；HTTP 缓存与并发刷新不依赖组件生命周期。 */
import { API_URL } from '../config'
import { proxyImageUrl } from '../utils/proxyImageUrl'

export interface SiteOwnerProfile {
  name: string

  /** 可能为 null：由调用方 / <Avatar> 生成本地兜底，不在这里编造地址。 */
  avatar: string | null
  bio: string
  platform?: string | null
}

export interface FetchSiteOwnerProfileOptions {

  /** 绕过浏览器 HTTP 缓存与 in-flight 复用。仅 mutation 后刷新；冷启动访客走默认缓存。 */
  force?: boolean
}

/** 并发挂载多个消费者时只发一次非强制请求。 */
let inflight: Promise<SiteOwnerProfile | null> | null = null

/** 并发 force 合并为一次（avatar-changed 与 profile-display-changed 常双发）。 */
let forceInflight: Promise<SiteOwnerProfile | null> | null = null

/** @internal */
export function __resetSiteOwnerProfileInflightForTests(): void {
  inflight = null
  forceInflight = null
}

const PLACEHOLDER_BIOS = new Set([
  'No bio available',
  '这家伙很懒，没有介绍呢',
])

function normalizeOwnerBio(bio: string): string {
  const trimmed = bio.trim()
  return !trimmed || PLACEHOLDER_BIOS.has(trimmed) ? '' : trimmed
}

function parseProfilePayload(data: unknown): SiteOwnerProfile | null {
  if (!data || typeof data !== 'object') return null
  const root = data as { success?: unknown; user_info?: unknown }
  if (!root.success || !root.user_info || typeof root.user_info !== 'object') {
    return null
  }
  const info = root.user_info as Record<string, unknown>
  return {
    name: typeof info.name === 'string' ? info.name : '',

    // 后端已代理；这里兜底旧响应里的直链。
    avatar: proxyImageUrl(info.avatar as string | null | undefined) ?? null,
    bio: normalizeOwnerBio(typeof info.bio === 'string' ? info.bio : ''),
    platform: typeof info.platform === 'string' ? info.platform : null,
  }
}

/** force: cache:'no-store' + _ts query，忽略 max-age / 陈旧 ETag。 */
export async function fetchSiteOwnerProfile(
  options: FetchSiteOwnerProfileOptions = {},
): Promise<SiteOwnerProfile | null> {
  const force = options.force === true

  // 新消费者也必须跟随 mutation 后的刷新，不能复用刷新前的冷请求。
  if (forceInflight) return forceInflight
  if (!force && inflight) return inflight
  if (force) inflight = null

  const run = (async (): Promise<SiteOwnerProfile | null> => {
    try {
      // force 附带 _ts：部分中间层不尊重 Request.cache，靠唯一 URL 破缓存。
      const url = force
        ? `${API_URL}/api/profile/user-info?_ts=${Date.now()}`
        : `${API_URL}/api/profile/user-info`

      const response = await fetch(url, {
        credentials: 'include',

        // 仅 mutation 刷新绕过 HTTP 缓存；冷路径保留 public max-age。
        ...(force ? { cache: 'no-store' as RequestCache } : {}),
      })
      if (!response.ok) return null
      const data: unknown = await response.json()
      return parseProfilePayload(data)
    } catch {
      return null
    }
  })()

  if (force) {
    const pending = run.finally(() => {
      if (forceInflight === pending) forceInflight = null
    })
    forceInflight = pending
    return pending
  }

  const pending = run.finally(() => {
    if (inflight === pending) inflight = null
  })
  inflight = pending
  return pending
}
