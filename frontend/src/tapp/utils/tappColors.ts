/**
 * Tapp 颜色工具
 * 根据 Tapp 类别和配置提供一致的颜色方案
 */

import type { CSSProperties } from 'react'
import type { TappCategory, TappPermission } from '../types'
import { hasStandaloneTappIcon } from '../components/TappIcon'
import { normalizeTappCategory } from './tappCategories'

/** 类别颜色配置 */
export const CATEGORY_COLORS: Record<
  TappCategory,
  { from: string; to: string; fromHex: string; toHex: string }
> = {
  // 实用工具
  utility: {
    from: 'from-emerald-500',
    to: 'to-teal-500',
    fromHex: '#10b981',
    toHex: '#14b8a6',
  },
  // 效率
  productivity: {
    from: 'from-orange-500',
    to: 'to-amber-500',
    fromHex: '#f97316',
    toHex: '#f59e0b',
  },
  // 游戏
  game: {
    from: 'from-rose-500',
    to: 'to-pink-500',
    fromHex: '#f43f5e',
    toHex: '#ec4899',
  },
  // 社交
  social: {
    from: 'from-sky-500',
    to: 'to-cyan-500',
    fromHex: '#0ea5e9',
    toHex: '#06b6d4',
  },
  // 开发
  developer: {
    from: 'from-slate-600',
    to: 'to-zinc-500',
    fromHex: '#475569',
    toHex: '#71717a',
  },
  // 媒体
  media: {
    from: 'from-red-500',
    to: 'to-orange-500',
    fromHex: '#ef4444',
    toHex: '#f97316',
  },
  // AI
  ai: {
    from: 'from-violet-500',
    to: 'to-purple-500',
    fromHex: '#8b5cf6',
    toHex: '#a855f7',
  },
  // 数据
  data: {
    from: 'from-teal-500',
    to: 'to-cyan-500',
    fromHex: '#14b8a6',
    toHex: '#06b6d4',
  },
}

/** 默认使用全局壁纸色 */
export const DEFAULT_TAPP_BG =
  'bg-[var(--bg-accent,rgb(var(--color-accent,16_185_129)))]'

/** 图标样式返回类型 */
export interface IconStyle {
  className: string
  style?: CSSProperties
  /**
   * Self-contained app icon — paint no tinted shell / shine behind it.
   * Accent className/style still describe brand color for non-icon surfaces.
   */
  standalone: boolean
}

/** Minimal fields needed for shell / accent resolution. */
export interface TappIconStyleSource {
  icon?: string
  iconSvg?: string
  themeColor?: string
  category?: string
  id?: string
  permissions?: readonly TappPermission[] | string[]
}

/**
 * 根据 manifest / 商店条目获取图标色壳样式。
 * `standalone` 时调用方应铺满自有图标，不再套分类/主题色底。
 */
export function getTappIconStyle(source: TappIconStyleSource): IconStyle {
  const standalone = hasStandaloneTappIcon(source)

  // 1. 优先使用自定义主题色
  if (source.themeColor) {
    return {
      className: 'bg-linear-to-br',
      style: {
        background: `linear-gradient(to bottom right, ${source.themeColor}, ${source.themeColor}99)`,
      },
      standalone,
    }
  }

  // 2. 使用分类 / 权限推断的渐变色
  return {
    className: getTappIconGradient(source),
    standalone,
  }
}

/**
 * 根据 Tapp manifest 获取图标背景渐变色（类名方式，不支持自定义颜色）
 * 注意：自定义 themeColor 需要使用 getTappIconStyle 函数
 */
export function getTappIconGradient(source: TappIconStyleSource): string {
  // 注意：themeColor 不能通过 Tailwind 动态类名支持，需使用 getTappIconStyle

  // 1. Manifest 的用途分类是图标色的权威来源。
  if (source.category) {
    return getCategoryGradient(source.category)
  }

  // 2. 旧 Manifest 缺少 category 时，尝试从 ID 推断。
  const id = source.id || ''
  const idParts = id.split('.')
  const lastPart = idParts[idParts.length - 1]?.toLowerCase() || ''
  const idLower = id.toLowerCase()

  // 检查 ID 中是否包含类别关键词
  for (const [category, colors] of Object.entries(CATEGORY_COLORS)) {
    if (lastPart.includes(category) || idLower.includes(category)) {
      return `bg-linear-to-br ${colors.from} ${colors.to}`
    }
  }

  // 3. 尝试从权限推断类型
  const permissions = source.permissions || []
  if (
    permissions.includes('ai:generate') ||
    permissions.includes('ai:chat') ||
    permissions.includes('ai:image')
  ) {
    return `bg-linear-to-br ${CATEGORY_COLORS.ai.from} ${CATEGORY_COLORS.ai.to}`
  }
  if (
    permissions.includes('media:control') ||
    permissions.includes('media:read')
  ) {
    return `bg-linear-to-br ${CATEGORY_COLORS.media.from} ${CATEGORY_COLORS.media.to}`
  }
  if (permissions.includes('platform:register')) {
    return `bg-linear-to-br ${CATEGORY_COLORS.data.from} ${CATEGORY_COLORS.data.to}`
  }
  if (permissions.includes('widget:register')) {
    return `bg-linear-to-br ${CATEGORY_COLORS.utility.from} ${CATEGORY_COLORS.utility.to}`
  }

  // 4. 默认使用全局壁纸色
  return DEFAULT_TAPP_BG
}

/**
 * 根据类别名称获取颜色
 */
export function getCategoryGradient(category: string | undefined): string {
  if (!category) return DEFAULT_TAPP_BG

  const normalized = normalizeTappCategory(category)
  const colors = CATEGORY_COLORS[normalized]
  return `bg-linear-to-br ${colors.from} ${colors.to}`
}
