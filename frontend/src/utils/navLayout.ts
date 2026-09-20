import {
  isAppleTouchDevice,
  isCoarsePointerPrimary,
} from './platformDetect'
import {
  VIEWPORT_DESKTOP_MIN,
  VIEWPORT_PHONE_MAX,
} from './viewportBands'

export type NavLayout = 'mobile' | 'desktop'

export const NAV_MOBILE_MAX_WIDTH = VIEWPORT_PHONE_MAX
export const NAV_DESKTOP_MIN_WIDTH = VIEWPORT_DESKTOP_MIN

export interface NavLayoutSignals {
  width: number
  coarsePointer: boolean
  appleTouch: boolean
}

export function resolveNavLayout(signals: NavLayoutSignals): NavLayout {
  const width = Number.isFinite(signals.width) ? signals.width : 0
  if (width <= NAV_MOBILE_MAX_WIDTH) return 'mobile'
  if (width >= NAV_DESKTOP_MIN_WIDTH) return 'desktop'
  if (signals.coarsePointer || signals.appleTouch) return 'mobile'
  return 'desktop'
}

export function readNavLayoutSignals(
  win: Window = typeof window !== 'undefined' ? window : (undefined as never),
): NavLayoutSignals {
  if (typeof win === 'undefined' || !win) {
    return { width: NAV_DESKTOP_MIN_WIDTH, coarsePointer: false, appleTouch: false }
  }
  return {
    width: win.innerWidth,
    coarsePointer: isCoarsePointerPrimary(),
    appleTouch: isAppleTouchDevice(),
  }
}

export function getNavLayout(
  win?: Window,
): NavLayout {
  if (typeof window === 'undefined' && !win) return 'desktop'
  return resolveNavLayout(readNavLayoutSignals(win ?? window))
}

export function isDesktopNavLayout(win?: Window): boolean {
  return getNavLayout(win) === 'desktop'
}

export function isMobileNavLayout(win?: Window): boolean {
  return getNavLayout(win) === 'mobile'
}

export function applyNavLayoutToDocument(
  layout: NavLayout,
  doc: Document = typeof document !== 'undefined' ? document : (undefined as never),
): void {
  if (!doc?.documentElement) return
  if (doc.documentElement.dataset.navLayout === layout) return
  doc.documentElement.dataset.navLayout = layout
}

type Listener = () => void

const listeners = new Set<Listener>()
let stopObserving: (() => void) | null = null
let cachedLayout: NavLayout | null = null

/** Debounce resize across 768/1024. */
const LAYOUT_RESIZE_DEBOUNCE_MS = 48

function recomputeAndNotify(): void {
  const next = getNavLayout()
  if (cachedLayout === next) return
  cachedLayout = next
  listeners.forEach((l) => l())
}

function ensureSubscribed(): void {
  if (stopObserving || typeof window === 'undefined') return
  const win = window
  cachedLayout = getNavLayout()
  let mqWidth: MediaQueryList | null = null
  let mqPointer: MediaQueryList | null = null
  let orientationFrame: number | null = null

  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  const onResize = () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      resizeTimer = null
      recomputeAndNotify()
    }, LAYOUT_RESIZE_DEBOUNCE_MS)
  }
  // Orientation: next frame; no long debounce.
  const onOrientation = () => {
    if (resizeTimer) clearTimeout(resizeTimer)
    resizeTimer = null
    if (orientationFrame !== null) cancelAnimationFrame(orientationFrame)
    orientationFrame = requestAnimationFrame(() => {
      orientationFrame = null
      recomputeAndNotify()
    })
  }

  win.addEventListener('resize', onResize, { passive: true })
  win.addEventListener('orientationchange', onOrientation, { passive: true })

  try {
    // Apply on band crossing; do not wait for debounce.
    mqWidth = window.matchMedia(
      `(max-width: ${NAV_MOBILE_MAX_WIDTH}px), (min-width: ${NAV_DESKTOP_MIN_WIDTH}px)`,
    )
    mqWidth.addEventListener('change', onResize)
  } catch {
    mqWidth = null
  }
  try {
    mqPointer = window.matchMedia('(hover: none) and (pointer: coarse)')
    mqPointer.addEventListener('change', onResize)
  } catch {
    mqPointer = null
  }
  stopObserving = () => {
    win.removeEventListener('resize', onResize)
    win.removeEventListener('orientationchange', onOrientation)
    mqWidth?.removeEventListener('change', onResize)
    mqPointer?.removeEventListener('change', onResize)
    if (resizeTimer !== null) clearTimeout(resizeTimer)
    if (orientationFrame !== null) cancelAnimationFrame(orientationFrame)
    cachedLayout = null
    stopObserving = null
  }
}

export const NAV_CHROME_SETTLED_EVENT = 'navChromeSettled'

export function subscribeNavLayout(listener: Listener): () => void {
  if (typeof window === 'undefined') return () => {}
  ensureSubscribed()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) stopObserving?.()
  }
}

export function getNavLayoutSnapshot(): NavLayout {
  if (typeof window === 'undefined') return 'desktop'
  // Reading during render must not install listeners or mutate document styles.
  return stopObserving ? cachedLayout ?? getNavLayout() : getNavLayout()
}

export function getServerNavLayoutSnapshot(): NavLayout {
  return 'desktop'
}
