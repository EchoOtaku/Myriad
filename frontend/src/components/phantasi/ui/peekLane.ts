/** 还在同一条文章轨 / 宫格里换到另一张文章卡时，不退壁纸。 */

import { phantasiMotionBusy } from '../../../hooks/animation/pages/phantasiMotion'

export const PHANTASI_PEEK_LANE =
  '[data-phantasi-peek-lane], [data-phantasi-rail-track="items"]'

export function peekStoryNode(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof (target as Element).closest !== 'function') return null
  const node = (target as Element).closest('.phantasi-story')
  if (
    !node ||
    typeof (node as HTMLElement).classList?.contains !== 'function' ||
    node.classList.contains('phantasi-story--slot')
  ) {
    return null
  }
  return node as HTMLElement
}

export function peekLaneKeepsAir(
  from: EventTarget | null,
  to: EventTarget | null,
): boolean {
  if (!from || typeof (from as Element).closest !== 'function') return false
  const lane = (from as Element).closest(PHANTASI_PEEK_LANE)
  const next = peekStoryNode(to)
  return !!(lane && next && lane.contains(next))
}

export function hoveredPhantasiStory(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return peekStoryNode(document.querySelector('.phantasi-story:hover'))
}

let peekPointerX = 0
let peekPointerY = 0
let peekPointerOn = false

export function notePeekPointer(event: {
  pointerType?: string
  clientX: number
  clientY: number
}): void {
  if (event.pointerType === 'touch') return
  peekPointerX = event.clientX
  peekPointerY = event.clientY
  peekPointerOn = true
}

export function peekNodeFromPoint(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const hovered = hoveredPhantasiStory()
  if (hovered) return hovered
  if (!peekPointerOn) return null
  return peekStoryNode(document.elementFromPoint(peekPointerX, peekPointerY))
}

function asHtml(node: EventTarget | null): HTMLElement | null {
  if (!node || typeof (node as HTMLElement).hasAttribute !== 'function') {
    return null
  }
  return node as HTMLElement
}

export function peekLaneIsSwapping(root?: ParentNode | null): boolean {
  if (phantasiMotionBusy()) return true
  const scope = root ?? (typeof document === 'undefined' ? null : document)
  if (!scope) return false
  for (const lane of scope.querySelectorAll('.phantasi-view-lane')) {
    const el = asHtml(lane)
    if (!el) continue
    if (el.dataset.chipPhase === 'exit' || el.hasAttribute('inert')) return true
  }
  return false
}

function peekHostFrozen(from: EventTarget | null): boolean {
  if (!from || typeof (from as Element).closest !== 'function') return false
  const host = asHtml(
    (from as Element).closest(
      '.phantasi-view-lane, [data-phantasi-peek-lane], [data-phantasi-rail-track]',
    ),
  )
  if (!host) return false
  if (host.dataset.chipPhase === 'exit' || host.hasAttribute('inert')) return true
  if (typeof host.ownerDocument?.defaultView?.getComputedStyle !== 'function') {
    return false
  }
  return (
    host.ownerDocument.defaultView.getComputedStyle(host).pointerEvents === 'none'
  )
}

/** 换页退场 / 节点被卸掉时先按住，进场后再接。 */
export function peekSwapHoldsAir(from: EventTarget | null): boolean {
  if (from && typeof (from as Node).isConnected === 'boolean' && !(from as Node).isConnected) {
    return true
  }
  if (peekHostFrozen(from) || peekLaneIsSwapping()) return true
  return peekNodeFromPoint() != null
}

export type PeekStoryPreview = {
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
