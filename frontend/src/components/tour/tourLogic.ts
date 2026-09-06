import type { GuideRect } from '../settings/settingTitleGuideLogic'
import type {
  TourAudience,
  TourDefinition,
  TourStepDef,
  TourSurfacePick,
} from './tourTypes'
import {
  CONTROL_PANEL_COLLAPSED_RADIUS_REM,
  CONTROL_PANEL_EXPANDED_RADIUS_REM,
  predictCollapsedControlPanelBox,
  predictExpandedControlPanelBox,
  predictRestoredLibraryDockBox,
} from '../../utils/libraryDockStage'
import { clamp } from '../settings/settingTitleGuideLogic'

export const TOUR_HOLE_PAD = 8
export const TOUR_VIEWPORT_PAD = 16
export const TOUR_CARD_GAP = 14
export const TOUR_ACTIVE_EVENT = 'myriad-tour-active'
export const TOUR_ACTIVE_ATTR = 'tourActive'

let homeEditSurface = false
const homeEditListeners = new Set<() => void>()

export function setHomeEditSurface(active: boolean): void {
  if (homeEditSurface === active) return
  homeEditSurface = active
  homeEditListeners.forEach((listener) => listener())
}

export function isHomeEditSurface(): boolean {
  return homeEditSurface
}

export function subscribeHomeEditSurface(onStoreChange: () => void): () => void {
  homeEditListeners.add(onStoreChange)
  return () => {
    homeEditListeners.delete(onStoreChange)
  }
}

export type ConfigTourSurface = 'browse' | 'persona' | 'ai-persona' | 'none'

let configTourSurface: ConfigTourSurface =
  typeof window === 'undefined' ? 'browse' : readConfigTourSurfaceFromLocation()
const configTourListeners = new Set<() => void>()

function readConfigTourSurfaceFromLocation(): ConfigTourSurface {
  if (typeof window === 'undefined') return 'browse'
  const params = new URLSearchParams(window.location.search)
  const page = params.get('page')
  if (page === 'merope-setup') return 'none'
  if (page === 'merope') return 'persona'
  if (params.get('section') === 'ai') return 'ai-persona'
  return 'browse'
}

export function getConfigTourSurface(): ConfigTourSurface {
  return configTourSurface
}

export function subscribeConfigTourSurface(
  onStoreChange: () => void,
): () => void {
  configTourListeners.add(onStoreChange)
  return () => {
    configTourListeners.delete(onStoreChange)
  }
}

/** 设置页 `?section=` / `?page=` 变化后重读人设教程面。 */
export function refreshConfigTourSurface(): void {
  const next = readConfigTourSurfaceFromLocation()
  if (configTourSurface === next) return
  configTourSurface = next
  configTourListeners.forEach((listener) => listener())
}

export function readTourSurface(
  editingHome: boolean,
  pathname?: string,
): TourSurfacePick {
  if (editingHome) return 'edit'
  const path = normalizeTourPath(
    pathname ??
      (typeof window === 'undefined' ? '/' : window.location.pathname),
  )
  if (path !== '/config') return 'browse'
  return configTourSurface
}

export function pageNameForPath(
  pathname: string,
  nav: {
    home: string
    library: string
    brew: string
    reports: string
    tapp: string
    config: string
  },
  editMode: string,
  editingHome: boolean,
): string {
  const path = pathname.replace(/\/+$/, '') || '/'
  if ((path === '/' || path === '') && editingHome) return editMode
  if (path === '/library' || path.startsWith('/library')) return nav.library
  if (path === '/brew' || path.startsWith('/brew')) return nav.brew
  if (path === '/reports' || path.startsWith('/reports')) return nav.reports
  if (path === '/tapp' || path.startsWith('/tapp')) return nav.tapp
  if (path === '/config' || path.startsWith('/config')) return nav.config
  return nav.home
}

export type HomeEditTourDockPose = 'parked' | 'restored'
export type HomeBrowseTourPanelPose = 'collapsed' | 'expanded'

/** 编辑教程只在小组件库那一步拉开库存，前后都停靠。 */
export function homeEditTourDockPose(
  tourId: string | null,
  stepId: string | null,
): HomeEditTourDockPose | undefined {
  if (tourId !== 'home-edit-owner') return undefined
  return stepId === 'home-widget-library' ? 'restored' : 'parked'
}

/** 首页浏览教程：控制面板步展开，其余步收起，好让控制岛保持收缩态。 */
export function homeBrowseTourPanelPose(
  tourId: string | null,
  stepId: string | null,
): HomeBrowseTourPanelPose | undefined {
  if (tourId !== 'home-visitor' && tourId !== 'home-owner') return undefined
  if (stepId === 'control-panel' || stepId === 'control-panel-owner') {
    return 'expanded'
  }
  return stepId ? 'collapsed' : undefined
}

export type PersonaTourPanel = 'overview' | 'persona' | 'wardrobe' | 'motion'

/** 人物设定教程：走到哪一页签，工作台就切到哪一页签。 */
export function personaTourPanel(
  tourId: string | null,
  stepId: string | null,
): PersonaTourPanel | undefined {
  if (tourId !== 'config-persona-owner') return undefined
  switch (stepId) {
    case 'config-persona-identity':
      return 'persona'
    case 'config-persona-wardrobe':
      return 'wardrobe'
    case 'config-persona-motion':
      return 'motion'
    default:
      return stepId ? 'overview' : undefined
  }
}

export function rootFontSizePx(): number {
  if (typeof document === 'undefined') return 16
  return (
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  )
}

/** 拉开后的库存岛位置，不读正在飞的 transform。 */
export function predictedLibraryDockTourBox(
  viewportWidth: number,
  viewportHeight: number,
  rootFontSize = rootFontSizePx(),
): Box {
  return predictRestoredLibraryDockBox(
    viewportWidth,
    viewportHeight,
    rootFontSize,
  )
}

let lastControlPanelContentHeight = 0

/** 读内层内容高度，不读外壳正在 morph 的 height。 */
export function readControlPanelContentHeight(
  node?: HTMLElement | null,
): number {
  if (typeof document === 'undefined') return lastControlPanelContentHeight
  const el = node ?? queryTourAnchor('control-panel')
  const raw = el?.scrollHeight ?? 0
  if (raw > 0) lastControlPanelContentHeight = raw
  return lastControlPanelContentHeight
}

/** 展开终态控制面板外壳，不读正在变的 width / height / radius。 */
export function predictedControlPanelTourBox(
  viewportWidth: number,
  contentHeight: number,
  rootFontSize = rootFontSizePx(),
): Box {
  return predictExpandedControlPanelBox(
    viewportWidth,
    contentHeight,
    rootFontSize,
  )
}

export function predictedControlPanelHoleRadius(
  rootFontSize = rootFontSizePx(),
): number {
  const rem = rootFontSize > 0 ? rootFontSize : 16
  return CONTROL_PANEL_EXPANDED_RADIUS_REM * rem
}

/** 收缩终态控制岛，不读正在收起的 width / height / radius。 */
export function predictedControlIslandTourBox(
  viewportWidth: number,
  rootFontSize = rootFontSizePx(),
): Box {
  return predictCollapsedControlPanelBox(viewportWidth, rootFontSize)
}

export function predictedControlIslandHoleRadius(
  rootFontSize = rootFontSizePx(),
): number {
  const rem = rootFontSize > 0 ? rootFontSize : 16
  return CONTROL_PANEL_COLLAPSED_RADIUS_REM * rem
}

/** 洞位由终态公式算出，不必跟着外壳 morph 每帧重测。 */
export function isPredictedTourAnchor(
  anchor: string,
  stepId?: string,
): boolean {
  return (
    anchor === 'control-panel' ||
    anchor === 'control-island' ||
    anchor === 'home-widget-library' ||
    stepId === 'home-widget-library'
  )
}

export function tourHoleSync(
  step: { id: string; anchor: string } | null,
): 'dock' | 'panel' | undefined {
  if (!step) return undefined
  if (
    step.id === 'home-widget-library' ||
    step.anchor === 'home-widget-library'
  ) {
    return 'dock'
  }
  if (step.anchor === 'control-panel') {
    return 'panel'
  }
  return undefined
}

export function sameTourHole(
  a: { top: number; left: number; width: number; height: number; radius: number },
  b: { top: number; left: number; width: number; height: number; radius: number },
  epsilon = 0.5,
): boolean {
  return (
    Math.abs(a.top - b.top) < epsilon &&
    Math.abs(a.left - b.left) < epsilon &&
    Math.abs(a.width - b.width) < epsilon &&
    Math.abs(a.height - b.height) < epsilon &&
    Math.abs(a.radius - b.radius) < epsilon
  )
}

export function sameTourCardPos(
  a: TourCardPos,
  b: TourCardPos,
  epsilon = 0.5,
): boolean {
  return (
    a.placement === b.placement &&
    Math.abs(a.top - b.top) < epsilon &&
    Math.abs(a.left - b.left) < epsilon
  )
}

/** Empty value or leftover `{key}` → '' so the caller can fall back. */
export function fillTourHint(
  template: string,
  key: string,
  value: string | undefined | null,
): string {
  const next = value?.trim() ?? ''
  if (!next) return ''
  const filled = template.replaceAll(`{${key}}`, next)
  return filled.includes(`{${key}}`) ? '' : filled
}

export type TourPlacement = 'top' | 'bottom' | 'left' | 'right' | 'dock'

export interface TourCardPos {
  top: number
  left: number
  placement: TourPlacement
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

export function intersectBoxes(a: Box, b: Box): Box | null {
  const top = Math.max(a.top, b.top)
  const left = Math.max(a.left, b.left)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  const width = right - left
  const height = bottom - top
  if (width < 1 || height < 1) return null
  return { top, left, width, height }
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
  const r = node.getBoundingClientRect()
  const host = { top: r.top, left: r.left, width: r.width, height: r.height }
  const fit = node.getAttribute('data-tour-fit')
  if (fit) {
    const union = unionBoxes(
      Array.from(node.querySelectorAll(fit), (el) => {
        const box = el.getBoundingClientRect()
        return {
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
        }
      }),
    )
    if (union && !isDegenerateBox(union)) {
      return intersectBoxes(union, host) ?? host
    }
  }
  return host
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
  surface: TourSurfacePick = 'browse',
): TourDefinition | null {
  if (surface === 'none') return null
  const path = normalizeTourPath(pathname)
  const audience: TourAudience = isOwner ? 'owner' : 'visitor'
  const matchesSurface = (tour: TourDefinition) =>
    (tour.surface ?? 'browse') === surface
  return (
    tours.find(
      (tour) =>
        tour.route === path &&
        tour.audience === audience &&
        matchesSurface(tour),
    ) ??
    tours.find(
      (tour) =>
        tour.matchPrefix === true &&
        tour.audience === audience &&
        matchesSurface(tour) &&
        path.startsWith(`${tour.route}/`),
    ) ??
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
  ].filter((node) => !node.closest('.nav-container.immersive'))
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

/** 控制面板步对准外壳，不圈内层 356px 内容。 */
export function resolveTourMeasureNode(
  anchor: string,
  node: HTMLElement,
): HTMLElement {
  if (anchor !== 'control-panel') return node
  return node.closest('.control-bar-trigger') ?? node
}

/** 展开面板贴齐玻璃外壳，不再外扩一圈。 */
export function holePadForTourAnchor(anchor: string, box: Box): number {
  if (anchor === 'control-panel') return 0
  return holePadForBox(box)
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
  }
}

/**
 * Sit the card against the hole on the roomiest side. Tall rails prefer
 * right; wide bars prefer below/above. If no side can hold the card
 * (a near-full grid), dock it to the bottom of the viewport — never drop
 * it into the hole.
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

  return { placement: best, left, top }
}
