/**
 * 头像地址解析 —— 全站唯一入口。
 *
 * 后端各出口（/api/auth/me、/api/profile/user-info、/api/auth/identities、
 * /api/admin/users、/api/tapp/context/user）已统一过 `proxy_image_url`；这里再过
 * 一次 `proxyImageUrl` 是防御层，兜住旧缓存与前端自己拼的地址。
 *
 * 兜底不再打 ui-avatars.com：那是个外部依赖，墙内/离线环境整站头像全裂，
 * 而且此前散落在 8 处、参数各写各的（size/background/color 都不一致）。
 * 改为本地生成 SVG data URI —— 零网络、同一名字恒定同一张脸。
 */

import { proxyImageUrl } from './proxyImageUrl'

/** 与站内暗/亮主题都协调的一组低饱和底色 */
const FALLBACK_COLORS = [
  '#6366f1',
  '#0ea5e9',
  '#14b8a6',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#10b981',
] as const

/** 名字 → 稳定色相（同一个人每次进来都是同一张脸，不能用随机数） */
function hashSeed(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/**
 * 取首个「字位簇」作为字母，而不是 `seed[0]`。
 * emoji 与部分 CJK 是代理对，按 UTF-16 取单个 code unit 会得到半个字符（渲染成 ▯）。
 */
function initial(seed: string): string {
  const trimmed = seed.trim()
  if (!trimmed) return '?'
  const first = Array.from(trimmed)[0]
  return first.toUpperCase()
}

/**
 * 本地生成头像兜底（SVG data URI，无网络请求）。
 */
export function localFallbackAvatar(seed: string | null | undefined): string {
  const name = (seed ?? '').trim() || 'User'
  const color = FALLBACK_COLORS[hashSeed(name) % FALLBACK_COLORS.length]
  const letter = initial(name)
  // XML 里必须转义，否则名字带 & 或 < 会生成非法 SVG（浏览器直接不渲染）
  const safeLetter = letter
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif" font-size="30" fill="#fff">${safeLetter}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * 解析头像地址：有图走图（必要时套站内代理），没有就本地生成。
 *
 * @param src  后端给的头像地址，允许 null/undefined/空串
 * @param seed 生成兜底用的种子（显示名 / 用户名 / 平台名）
 */
export function resolveAvatar(
  src: string | null | undefined,
  seed?: string | null,
): string {
  return proxyImageUrl(src) ?? localFallbackAvatar(seed)
}
