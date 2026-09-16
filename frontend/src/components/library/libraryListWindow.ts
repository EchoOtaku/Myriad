const BIN_HEIGHT = 512
const OVERSCAN = 600

interface ListEntry<T> {
  item: T
  order: number
  top: number
  bottom: number
}

export interface LibraryListIndex<T> {
  bins: Map<number, ListEntry<T>[]>
  itemsById: Map<string, T>
  height: number
}

/** Index only revealed items; pagination, scroll extent and card positions stay unchanged. */
export function buildLibraryListIndex<T extends { id: string }>(
  items: readonly T[],
  layouts: ReadonlyMap<string, { top: number; height: number }>,
): LibraryListIndex<T> {
  const bins = new Map<number, ListEntry<T>[]>()
  const itemsById = new Map<string, T>()
  let height = 400
  items.forEach((item, order) => {
    const layout = layouts.get(item.id)
    if (!layout) return
    itemsById.set(item.id, item)
    const entry = { item, order, top: layout.top, bottom: layout.top + layout.height }
    height = Math.max(height, entry.bottom + 20)
    for (let bin = Math.floor(entry.top / BIN_HEIGHT); bin <= Math.floor(entry.bottom / BIN_HEIGHT); bin++) {
      const entries = bins.get(bin) ?? []
      entries.push(entry)
      bins.set(bin, entries)
    }
  })
  return { bins, itemsById, height }
}

export function queryLibraryListWindow<T>(
  index: LibraryListIndex<T>,
  top: number,
  viewportHeight: number,
): T[] {
  const start = top - OVERSCAN
  const end = top + viewportHeight + OVERSCAN
  const entries = new Set<ListEntry<T>>()
  for (let bin = Math.floor(start / BIN_HEIGHT); bin <= Math.floor(end / BIN_HEIGHT); bin++) {
    for (const entry of index.bins.get(bin) ?? []) {
      if (entry.bottom >= start && entry.top <= end) entries.add(entry)
    }
  }
  return [...entries].sort((a, b) => a.order - b.order).map(entry => entry.item)
}
