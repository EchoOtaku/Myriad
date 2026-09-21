import type { HomeDashboardLayouts } from './homeLayout'
import { isHomeStickerItem, parseDashboardLayoutJson } from './homeLayout'

/** Apply published URLs without overwriting edits made while a save was in flight. */
export function applyPublishedStickerUrls(
  current: HomeDashboardLayouts,
  submitted: HomeDashboardLayouts,
  savedLayout: unknown,
): HomeDashboardLayouts {
  if (typeof savedLayout !== 'string') return current
  const saved = parseDashboardLayoutJson(savedLayout)
  const before = new Map(
    submitted.free.filter(isHomeStickerItem).map(tile => [tile.id, tile.config?.imageUrl]),
  )
  const after = new Map(
    saved.free.filter(isHomeStickerItem).map(tile => [tile.id, tile.config?.imageUrl]),
  )
  let changed = false
  const free = current.free.map((tile) => {
    const url = after.get(tile.id)
    if (
      !isHomeStickerItem(tile) || typeof url !== 'string' || !url ||
      tile.config?.imageUrl !== before.get(tile.id) || tile.config?.imageUrl === url
    ) {
      return tile
    }
    changed = true
    return { ...tile, config: { ...tile.config, imageUrl: url } }
  })
  return changed ? { ...current, free } : current
}
