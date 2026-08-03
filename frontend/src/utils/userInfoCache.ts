/**
 * CSRF Token 内存缓存。
 *
 * ⚠️ 安全：CSRF Token 存内存不存 localStorage，刷新即失效。
 *
 * 历史：本文件曾另有一份「站长展示信息」的 30 分钟 localStorage 缓存，
 * 只在登录/登出时失效——站长换了头像来源或重抓平台数据后，首页信息条最长
 * 半小时不更新。现已改为 HTTP 层缓存（后端 Cache-Control + 内容 ETag）+
 * `avatar-changed` 广播，见 hooks/useSiteOwnerProfile.ts。
 */

/**
 * 获取 CSRF Token（带内存缓存）
 * 与 csrf.ts sessionStorage 对齐：session 被 clearCSRFToken 清掉后，
 * 内存缓存也必须失效（监听 csrf-token-cleared）。
 */
let csrfTokenCache: { token: string; timestamp: number } | null = null
const CSRF_CACHE_DURATION = 10 * 60 * 1000 // CSRF Token 缓存 10 分钟

if (typeof window !== 'undefined') {
  window.addEventListener('csrf-token-cleared', () => {
    csrfTokenCache = null
  })
}

export async function getCsrfTokenWithCache(
  forceRefresh = false,
): Promise<string> {
  // Prefer sessionStorage if present and matches memory (post-axios-rotate)
  let sessionToken: string | null = null
  try {
    sessionToken = sessionStorage.getItem('csrf_token')
  } catch {
    /* ignore */
  }

  if (
    !forceRefresh &&
    csrfTokenCache &&
    Date.now() - csrfTokenCache.timestamp < CSRF_CACHE_DURATION
  ) {
    // Stale if sessionStorage was rotated/cleared to a different value
    if (!sessionToken || sessionToken === csrfTokenCache.token) {
      if (sessionToken) return csrfTokenCache.token
    }
    csrfTokenCache = null
  }

  try {
    // Use shared getCSRFToken so sessionStorage + server stay one source of truth
    const { getCSRFToken } = await import('./csrf')
    const token = await getCSRFToken(forceRefresh || !sessionToken)
    if (token) {
      csrfTokenCache = { token, timestamp: Date.now() }
      return token
    }
    csrfTokenCache = null
    return ''
  } catch (e) {
    console.warn('获取 CSRF Token 失败:', e)
  }

  return ''
}

/**
 * 清除 CSRF Token 内存缓存（sessionStorage 由 clearCSRFToken 负责）
 */
export function invalidateCsrfCache(): void {
  csrfTokenCache = null
}

/**
 * 清除本模块持有的全部用户相关缓存。
 *
 * 登出 / 缓存清理面板会调用；站长展示信息已不再由前端缓存，这里只剩 CSRF。
 */
export function clearAllUserCache(): void {
  invalidateCsrfCache()
}
