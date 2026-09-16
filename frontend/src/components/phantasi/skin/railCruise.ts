/** 朋友们网站卡超过这个数才巡航，16 及以下只手滑。 */
export const FRIENDS_SITE_AUTO_MIN = 16

export const RAIL_CRUISE_START_MS = 2400
export const RAIL_CRUISE_SEAT_MS = 1100
export const RAIL_CRUISE_HOLD_MS = 8000
export const RAIL_CRUISE_RESUME_MS = 8000

export function friendsSiteAutoOn(count: number): boolean {
  return count > FRIENDS_SITE_AUTO_MIN
}

/** 随机文章一列一张，两张起就可以循环坐槽。 */
export function friendsStoryAutoOn(count: number): boolean {
  return count > 1
}

/** 1-based 列折回一圈。 */
export function railLoopCol(col: number, loopCols: number): number {
  if (loopCols <= 0) return 1
  return ((((Math.max(1, col) - 1) % loopCols) + loopCols) % loopCols) + 1
}

export function railCruiseCol(scroll: number, colW: number): number {
  if (colW <= 1) return 1
  return Math.max(1, Math.round(Math.max(0, scroll) / colW) + 1)
}

/** 下一槽。最后一格先坐到复制列，再瞬移回第 1 格。 */
export function railCruiseNextCol(
  col: number,
  loopCols: number,
): { align: number; reset: number | null } {
  if (loopCols <= 0) return { align: 1, reset: null }
  const at = railLoopCol(col, loopCols)
  if (at >= loopCols) return { align: loopCols + 1, reset: 1 }
  return { align: at + 1, reset: null }
}
