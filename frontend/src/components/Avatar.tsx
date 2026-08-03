/**
 * 头像 —— 全站唯一渲染入口。
 *
 * 此前首页信息条、控制面板用户区、用户弹窗（三处）、设置页用户列表各写一份
 * `<img onError>`，兜底地址、referrerPolicy、是否代理都不一致；防盗链 CDN 的
 * 头像在漏补的地方直接裂图。这里统一：
 *
 * - 地址一律过 `resolveAvatar`（站内代理 + 本地兜底，不依赖 ui-avatars.com）
 * - `onError` 只回落一次，避免兜底图自身失败时无限触发 error → 请求风暴
 * - `referrerPolicy="no-referrer"`：部分 CDN 见到 Referer 会二次校验后 403
 */

import type { CSSProperties } from 'react'

import { useEffect, useState } from 'react'
import { localFallbackAvatar, resolveAvatar } from '../utils/avatar'

interface AvatarProps {
  /** 后端返回的头像地址，允许 null/undefined */
  src?: string | null
  /** 显示名 —— 同时作为 alt 与兜底图的种子 */
  name?: string | null
  /** 方形边长（px）。需要非方形或响应式尺寸时用 className 覆盖 */
  size?: number
  className?: string
  style?: CSSProperties
  /** 纯装饰（外层已有可读文本）时传 true，渲染 alt="" */
  decorative?: boolean
}

export function Avatar({
  src,
  name,
  size,
  className,
  style,
  decorative = false,
}: AvatarProps) {
  const seed = name ?? undefined
  const [failed, setFailed] = useState(false)

  // src 变了要给新地址一次机会，否则切换画像源后永远停在兜底图
  useEffect(() => {
    setFailed(false)
  }, [src])

  const resolved = failed ? localFallbackAvatar(seed) : resolveAvatar(src, seed)

  return (
    <img
      src={resolved}
      alt={decorative ? '' : (name ?? '')}
      width={size}
      height={size}
      className={className}
      style={style}
      referrerPolicy="no-referrer"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

export default Avatar
