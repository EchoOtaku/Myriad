/** Peek 只属于当前可交互的文章卡；指针坐标仅用于换树后的重新命中。 */
export const PHANTASI_PEEK_LANE =
  '[data-phantasi-peek-lane], [data-phantasi-rail-track="items"]'

let pointer: { x: number; y: number } | null = null

export function resetPeekPointer(): void { pointer = null }

export function notePeekPointer(event: {
  pointerType?: string
  clientX: number
  clientY: number
}): void {
  if (event.pointerType === 'touch') { resetPeekPointer(); return }
  pointer = { x: event.clientX, y: event.clientY }
}

export function peekLaneIsLive(target: EventTarget | null): boolean {
  const node = target as Element | null
  return !!node?.isConnected && typeof node.closest === 'function'
    && !node.closest('[inert], [data-chip-phase="exit"], .is-rail-grabbing, .is-picking')
}

export function peekStoryNode(target: EventTarget | null): HTMLElement | null {
  const node = (target as Element | null)?.closest?.('.phantasi-story') as HTMLElement | null
  return node && !node.classList.contains('phantasi-story--slot') ? node : null
}

export function peekLaneKeepsAir(from: EventTarget | null, to: EventTarget | null): boolean {
  const lane = (from as Element | null)?.closest?.(PHANTASI_PEEK_LANE)
  const next = peekStoryNode(to)
  return !!(lane && next && lane.contains(next) && peekLaneIsLive(next))
}

export function peekNodeFromPoint(): HTMLElement | null {
  if (!pointer || typeof document === 'undefined') return null
  const node = peekStoryNode(document.elementFromPoint(pointer.x, pointer.y))
  return node && peekLaneIsLive(node) ? node : null
}

export interface PeekStoryPreview {
  id: number
  title: string
  image?: string | null
  source_name?: string | null
  source_icon?: string | null
}

export function peekPreviewFromStory(node: HTMLElement): PeekStoryPreview | null {
  const id = Number(node.dataset.railId)
  if (!Number.isFinite(id) || id <= 0) return null
  const title = node.querySelector('.phantasi-story__title')?.textContent?.trim() ?? ''
  if (!title) return null
  const thumb = node.querySelector('.phantasi-story__thumb')
  const image =
    thumb?.querySelector('img')?.getAttribute('data-src') ||
    thumb?.querySelector('img')?.getAttribute('src') ||
    thumb?.getAttribute('data-src') ||
    null
  const icon = node.querySelector('.phantasi-story__source img')
  const sourceIcon =
    icon?.getAttribute('data-src') || icon?.getAttribute('src') || null
  const sourceName =
    node.querySelector('.phantasi-story__source span:last-child')?.textContent?.trim() ||
    null
  return {
    id,
    title,
    image,
    source_name: sourceName,
    source_icon: sourceIcon,
  }
}
