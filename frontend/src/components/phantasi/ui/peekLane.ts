/** 还在同一条文章轨 / 宫格里时，换卡不退壁纸。 */

export const PHANTASI_PEEK_LANE =
  '[data-phantasi-peek-lane], [data-phantasi-rail-track="items"]'

export function peekLaneKeepsAir(
  from: EventTarget | null,
  to: EventTarget | null,
): boolean {
  if (!from || typeof (from as Element).closest !== 'function') return false
  const lane = (from as Element).closest(PHANTASI_PEEK_LANE)
  return !!(
    lane &&
    to &&
    typeof (to as Node).nodeType === 'number' &&
    lane.contains(to as Node)
  )
}
