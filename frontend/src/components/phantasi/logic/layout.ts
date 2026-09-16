/** 窄屏降档只在这里做。内容磁贴最小 2x2；2x1 仅入口型。 */

import type { CardSize, PhantasiSource } from '../../../types/phantasi'
import type { ViewportBand } from '../../../utils/viewportBands'
import type { WidgetSize } from '../../widgetGridTypes'
import type { PhantasiViewerRole } from './score'
import { isSiteSource } from './board'
import { daysSinceLastPublish } from './score'

export type PhantasiTileSize = '2x1' | '2x2' | '4x2' | '4x4'

export const PHANTASI_TILE_SIZES = ['2x1', '2x2', '4x2', '4x4'] as const satisfies
  readonly WidgetSize[]

export const CONTENT_TILE_SIZES = ['2x2', '4x2', '4x4'] as const satisfies
  readonly PhantasiTileSize[]

/** 入口型默认横条 2x1。 */
export const SITE_TILE_SIZES = ['2x1', '2x2', '4x2'] as const satisfies
  readonly PhantasiTileSize[]

export function allowedTileSizes(
  s: Pick<PhantasiSource, 'source_type'>,
): readonly PhantasiTileSize[] {
  return isSiteSource(s) ? SITE_TILE_SIZES : CONTENT_TILE_SIZES
}

export type PhantasiTileLayout = 'feature' | 'list' | 'cadence' | 'numeric' | 'icon'

const NUMERIC_UNREAD_MIN = 20
const CADENCE_QUIET_DAYS = 60
/** pulses 不足则 cadence 降级 feature。 */
const CADENCE_MIN_PULSES = 6
const FEATURE_MAX_ITEMS = 2
/** 无封面源少于此条数不配 4x4。 */
const FULL_TILE_MIN_ITEMS = 5

/** 源少于此数一律撑满。 */
const FULL_BLEED_SOURCE_COUNT = 6
const SIZE_SCORE_LARGE = 0.55
const SIZE_SCORE_MEDIUM = 0.3

/** `now` 必须注入。itemCount 要用补拉后的条数，默认 3 条预览会误判 feature。 */
export function tileLayout(
  s: PhantasiSource,
  role: PhantasiViewerRole,
  now: number,
  itemCount: number = s.recent_items?.length ?? 0,
): PhantasiTileLayout {
  if (s.source_type === 'link') return 'icon'

  // 显式排除游客，避免未读聚合数把游客送进 numeric。
  if (role !== 'guest' && s.unread_count >= NUMERIC_UNREAD_MIN) return 'numeric'

  // 没有时间戳不走 cadence。
  const quietDays = daysSinceLastPublish(s, now)
  if (quietDays !== null && quietDays > CADENCE_QUIET_DAYS) {
    // pulses 不足降级 feature，不进 list。
    return (s.pulses?.length ?? 0) >= CADENCE_MIN_PULSES ? 'cadence' : 'feature'
  }

  if (itemCount <= FEATURE_MAX_ITEMS) return 'feature'
  return 'list'
}

/** tablet / phone 没有 4x4。 */
export function downgradeForBand(
  size: PhantasiTileSize,
  band: ViewportBand,
): PhantasiTileSize {
  if (band === 'desktop') return size
  return size === '4x4' ? '4x2' : size
}

/** `card_size` 非空即用户锁定。 */
const CARD_SIZE_TO_TILE: Record<CardSize, PhantasiTileSize> = {
  bar: '2x1',
  tiny: '2x2',
  mini: '4x2',
  full: '4x4',
}

const TILE_TO_CARD_SIZE = Object.fromEntries(
  Object.entries(CARD_SIZE_TO_TILE).map(([card, tile]) => [tile, card]),
) as Record<PhantasiTileSize, CardSize>

export function lockedTileSize(
  s: Pick<PhantasiSource, 'card_size'>,
): PhantasiTileSize | null {
  return s.card_size ? (CARD_SIZE_TO_TILE[s.card_size] ?? null) : null
}

export function cardSizeForTile(size: PhantasiTileSize): CardSize {
  return TILE_TO_CARD_SIZE[size]
}

/** 认不出当前档时从头开始，不卡在原地。 */
export function nextLockedSize(
  current: PhantasiTileSize | null,
  allowed: readonly PhantasiTileSize[],
): PhantasiTileSize | null {
  if (allowed.length === 0) return null
  if (!current) return allowed[0]
  const i = allowed.indexOf(current)
  if (i < 0) return allowed[0]
  return i + 1 < allowed.length ? allowed[i + 1] : null
}

/** 锁定只套 band 降档，不被「源太少撑满」覆盖。 */
export function tileSize(
  score: number,
  s: PhantasiSource,
  band: ViewportBand,
  sourceCount: number,
): PhantasiTileSize {
  const locked = lockedTileSize(s)
  if (locked) return downgradeForBand(locked, band)

  // 入口型不进分数派生，且必须在「源太少撑满」之前。
  if (isSiteSource(s)) return downgradeForBand('2x1', band)

  if (sourceCount < FULL_BLEED_SOURCE_COUNT) {
    return downgradeForBand('4x4', band)
  }

  // 无封面且条数不够铺一页列表，不给 4x4。
  const count = s.recent_items?.length ?? 0
  const hasCover = Boolean(s.recent_items?.some((i) => i.image))
  // 4x4 只给满页列表或有封面的 feature；三四条小方图撑不起。
  const thin = count < FULL_TILE_MIN_ITEMS && !(count <= FEATURE_MAX_ITEMS && hasCover)
  if (score >= SIZE_SCORE_LARGE) {
    return downgradeForBand(thin ? '4x2' : '4x4', band)
  }
  if (score >= SIZE_SCORE_MEDIUM) return downgradeForBand('4x2', band)
  return downgradeForBand('2x2', band)
}

const TOPIC_LARGE_COUNT_SMART = 2
const TOPIC_LARGE_COUNT_TOPIC_MODE = 4

/** 主题卡最小 4x2，不进 2x2。 */
export function topicTileSize(
  index: number,
  mode: 'smart' | 'topic',
  band: ViewportBand,
): PhantasiTileSize {
  const largeCount =
    mode === 'topic' ? TOPIC_LARGE_COUNT_TOPIC_MODE : TOPIC_LARGE_COUNT_SMART
  const size: PhantasiTileSize = index < largeCount ? '4x4' : '4x2'
  return downgradeForBand(size, band)
}
