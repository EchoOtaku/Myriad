import type { GuideRect } from '../settings/settingTitleGuideLogic'
import type { TourAudience, TourDefinition, TourStepDef } from './tourTypes'
import { clamp } from '../settings/settingTitleGuideLogic'

export const TOUR_HOLE_PAD = 8
export const TOUR_VIEWPORT_PAD = 16
export const TOUR_CARD_GAP = 14
export const TOUR_ACTIVE_EVENT = 'myriad-tour-active'
export const TOUR_ACTIVE_ATTR = 'tourActive'

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'dock'

export interface TourCardPos {
  top: number
  left: number
  placement: TourPlacement
  /** Offset along the pointing edge, so the caret aims at the hole. */
  caret: number
}

/** Hole larger than this share of the viewport uses a ring + docked card. */
export const TOUR_LARGE_HOLE = 0.35

export interface Box {
  top: number
  left: number
  width: number
  height: number
}

export function inflateRect(
  box: Box,
  pad: number = TOUR_HOLE_PAD,
): GuideRect {
  const top = box.top - pad
  const left = box.left - pad
  const width = box.width + pad * 2
  const height = box.height + pad * 2
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }
}

export function unionBoxes(boxes: readonly Box[]): Box | null {
  let top = Infinity
  let left = Infinity
  let right = -Infinity
  let bottom = -Infinity
  let any = false
  for (const box of boxes) {
    if (box.width < 1 || box.height < 1) continue
    any = true
    top = Math.min(top, box.top)
    left = Math.min(left, box.left)
    right = Math.max(right, box.left + box.width)
    bottom = Math.max(bottom, box.top + box.height)
  }
  if (!any) return null
  return { top, left, width: right - left, height: bottom - top }
}

export function isDegenerateBox(box: Box, min = 24): boolean {
  return box.width < min || box.height < min
}

export function readTourBox(node: HTMLElement): Box {
  const fit = node.getAttribute('data-tour-fit')
  if (fit) {
    const union = unionBoxes(
      Array.from(node.querySelectorAll(fit), (el) => {
        const r = el.getBoundingClientRect()
        return { top: r.top, left: r.left, width: r.width, height: r.height }
      }),
    )
    if (union && !isDegenerateBox(union)) return union
  }
  const r = node.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

export function filterVisibleSteps<T extends { anchor: string }>(
  steps: T[],
  hasAnchor: (anchor: string) => boolean,
): T[] {
  return steps.filter((step) => hasAnchor(step.anchor))
}

export function normalizeTourPath(pathname: string): string {
  if (!pathname) return '/'
  if (pathname.length > 1 && pathname.endsWith('/')) {
    const trimmed = pathname.replace(/\/+$/, '')
    return trimmed.length > 0 ? trimmed : '/'
  }
  return pathname
}

export function pickTour(
  tours: readonly TourDefinition[],
  pathname: string,
  isOwner: boolean,
): TourDefinition | null {
  const path = normalizeTourPath(pathname)
  const audience: TourAudience = isOwner ? 'owner' : 'visitor'
  return (
    tours.find((tour) => tour.route === path && tour.audience === audience) ??
    null
  )
}

export function firstVisibleIndex(
  steps: readonly TourStepDef[],
  hasAnchor: (anchor: string) => boolean,
  from = 0,
): number {
  for (let i = from; i < steps.length; i += 1) {
    if (hasAnchor(steps[i]!.anchor)) return i
  }
  return -1
}

export function previousVisibleIndex(
  steps: readonly TourStepDef[],
  hasAnchor: (anchor: string) => boolean,
  from: number,
): number {
  for (let i = from - 1; i >= 0; i -= 1) {
    if (hasAnchor(steps[i]!.anchor)) return i
  }
  return -1
}

export function visibleBoxArea(box: Box, vw: number, vh: number): number {
  const visW = Math.min(box.left + box.width, vw) - Math.max(box.left, 0)
  const visH = Math.min(box.top + box.height, vh) - Math.max(box.top, 0)
  return Math.max(0, visW) * Math.max(0, visH)
}

export function pickLargestVisible<T>(
  items: readonly T[],
  getBox: (item: T) => Box,
  vw: number,
  vh: number,
): T | undefined {
  let best: T | undefined
  let bestArea = -1
  for (const item of items) {
    const area = visibleBoxArea(getBox(item), vw, vh)
    if (area > bestArea) {
      bestArea = area
      best = item
    }
  }
  return best
}

export function queryTourAnchor(anchor: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(anchor)
      : anchor
  const nodes = [
    ...document.querySelectorAll<HTMLElement>(`[data-tour="${escaped}"]`),
  ]
  if (nodes.length <= 1) return nodes[0] ?? null
  return (
    pickLargestVisible(
      nodes,
      (node) => {
        const r = node.getBoundingClientRect()
        return { top: r.top, left: r.left, width: r.width, height: r.height }
      },
      window.innerWidth,
      window.innerHeight,
    ) ?? null
  )
}

export function hasTourAnchor(anchor: string): boolean {
  return queryTourAnchor(anchor) != null
}

export function isTourDomActive(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.dataset[TOUR_ACTIVE_ATTR] === '1'
}

export function setTourDomActive(active: boolean): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (active) root.dataset[TOUR_ACTIVE_ATTR] = '1'
  else delete root.dataset[TOUR_ACTIVE_ATTR]
  window.dispatchEvent(new Event(TOUR_ACTIVE_EVENT))
}

export function holePadForBox(box: Box): number {
  const minSide = Math.min(box.width, box.height)
  if (minSide >= 280) return 6
  if (minSide <= 48) return 10
  return TOUR_HOLE_PAD
}

export function holeRadiusFor(rawRadius: number, hole: Box): number {
  const cap = Math.min(hole.width, hole.height) / 2
  const floor = Math.min(8, cap)
  return clamp(rawRadius, floor, cap)
}

function centerOnRange(
  start: number,
  size: number,
  item: number,
  min: number,
  max: number,
): number {
  return clamp(start + size / 2 - item / 2, min, max)
}

function caretAlong(
  holeCenter: number,
  cardStart: number,
  cardSize: number,
  inset = 22,
): number {
  return clamp(holeCenter - cardStart, inset, Math.max(inset, cardSize - inset))
}

export function isLargeHole(
  hole: GuideRect,
  viewportW: number,
  viewportH: number,
): boolean {
  const viewport = viewportW * viewportH
  if (viewport <= 0) return false
  return (hole.width * hole.height) / viewport >= TOUR_LARGE_HOLE
}

function dockCard(
  cardW: number,
  cardH: number,
  viewportW: number,
  viewportH: number,
  pad: number,
): TourCardPos {
  const maxLeft = Math.max(pad, viewportW - cardW - pad)
  const maxTop = Math.max(pad, viewportH - cardH - pad)
  return {
    placement: 'dock',
    left: clamp((viewportW - cardW) / 2, pad, maxLeft),
    top: clamp(viewportH - cardH - 28, pad, maxTop),
    caret: 0,
  }
}

/**
 * Sit the card against the hole on the roomiest side, close enough that
 * the caret still points at it. Tall rails prefer right; wide bars prefer
 * below/above. If no side can hold the card (a near-full grid), dock it
 * to the bottom of the viewport — never drop it into the hole.
 */
export function computeTourCardPosition(
  hole: GuideRect,
  cardW: number,
  cardH: number,
  viewportW: number,
  viewportH: number,
  pad: number = TOUR_VIEWPORT_PAD,
  gap: number = TOUR_CARD_GAP,
): TourCardPos {
  if (isLargeHole(hole, viewportW, viewportH)) {
    return dockCard(cardW, cardH, viewportW, viewportH, pad)
  }

  const maxLeft = Math.max(pad, viewportW - cardW - pad)
  const maxTop = Math.max(pad, viewportH - cardH - pad)

  const space = {
    top: hole.top - pad,
    bottom: viewportH - hole.bottom - pad,
    left: hole.left - pad,
    right: viewportW - hole.right - pad,
  }
  const needV = cardH + gap
  const needH = cardW + gap
  const need = {
    top: needV,
    bottom: needV,
    left: needH,
    right: needH,
  }

  const tall = hole.height > hole.width * 1.35
  const wide = hole.width > hole.height * 1.35
  const bonus = {
    top: wide ? 80 : 0,
    bottom: wide ? 100 : 0,
    left: tall ? 40 : 0,
    right: tall ? 100 : 0,
  }

  let best: Exclude<TourPlacement, 'dock'> | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  const sides = ['right', 'bottom', 'left', 'top'] as const
  for (const side of sides) {
    if (space[side] < need[side]) continue
    const score = space[side] + bonus[side]
    if (score > bestScore) {
      bestScore = score
      best = side
    }
  }

  if (!best) {
    return dockCard(cardW, cardH, viewportW, viewportH, pad)
  }

  let top = 0
  let left = 0
  switch (best) {
    case 'top':
      top = hole.top - gap - cardH
      left = centerOnRange(hole.left, hole.width, cardW, pad, maxLeft)
      break
    case 'bottom':
      top = hole.bottom + gap
      left = centerOnRange(hole.left, hole.width, cardW, pad, maxLeft)
      break
    case 'left':
      left = hole.left - gap - cardW
      top = centerOnRange(hole.top, hole.height, cardH, pad, maxTop)
      break
    case 'right':
      left = hole.right + gap
      top = centerOnRange(hole.top, hole.height, cardH, pad, maxTop)
      break
  }

  left = clamp(left, pad, maxLeft)
  top = clamp(top, pad, maxTop)
  const holeCx = hole.left + hole.width / 2
  const holeCy = hole.top + hole.height / 2
  const caret =
    best === 'left' || best === 'right'
      ? caretAlong(holeCy, top, cardH)
      : caretAlong(holeCx, left, cardW)

  return { placement: best, left, top, caret }
}
