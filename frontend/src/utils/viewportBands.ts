/**
 * Canonical pure-width viewport bands for layout chrome.
 *
 * Hard cuts (no hysteresis) so grid columns, home shell, widget scale band,
 * and matchMedia all flip on the same integer width:
 *
 * - phone:   ≤ 767
 * - tablet:  768 – 1077
 * - desktop: ≥ 1078
 */

export type ViewportBand = 'phone' | 'tablet' | 'desktop'

/** Max width still treated as phone (Tailwind `md` is min 768). */
export const VIEWPORT_PHONE_MAX = 767
/** Min width for tablet band. */
export const VIEWPORT_TABLET_MIN = 768
/** Max width still treated as tablet. */
export const VIEWPORT_TABLET_MAX = 1077
/** Min width for desktop / PC band (tablet↔desktop switch). */
export const VIEWPORT_DESKTOP_MIN = 1078

/** Home grid column counts per band. */
export const HOME_GRID_COLS_PHONE = 4
export const HOME_GRID_COLS_TABLET = 8
export const HOME_GRID_COLS_DESKTOP = 16

/** Instant band from width — hard cut, no dead zone. */
export function resolveViewportBand(width: number): ViewportBand {
  if (!Number.isFinite(width) || width <= 0) return 'desktop'
  if (width <= VIEWPORT_PHONE_MAX) return 'phone'
  if (width <= VIEWPORT_TABLET_MAX) return 'tablet'
  return 'desktop'
}

export function homeGridColsForBand(band: ViewportBand): number {
  switch (band) {
    case 'phone':
      return HOME_GRID_COLS_PHONE
    case 'tablet':
      return HOME_GRID_COLS_TABLET
    default:
      return HOME_GRID_COLS_DESKTOP
  }
}

/**
 * Home grid columns from width.
 * `previous` is only used when width is invalid (keep last known cols).
 * No ±12/±16 hysteresis — must match VIEWPORT_MQ / useBreakpoints exactly.
 */
export function resolveHomeGridColumns(
  width: number,
  previous: number = HOME_GRID_COLS_DESKTOP,
): number {
  if (!Number.isFinite(width) || width <= 0) {
    return previous === HOME_GRID_COLS_PHONE ||
      previous === HOME_GRID_COLS_TABLET ||
      previous === HOME_GRID_COLS_DESKTOP
      ? previous
      : HOME_GRID_COLS_DESKTOP
  }
  return homeGridColsForBand(resolveViewportBand(width))
}

/** MatchMedia snippets — same integers as resolveViewportBand. */
export const VIEWPORT_MQ = {
  phone: `(max-width: ${VIEWPORT_PHONE_MAX}px)`,
  tablet: `(min-width: ${VIEWPORT_TABLET_MIN}px) and (max-width: ${VIEWPORT_TABLET_MAX}px)`,
  desktop: `(min-width: ${VIEWPORT_DESKTOP_MIN}px)`,
  /** phone + tablet (not desktop PC layout) */
  notDesktop: `(max-width: ${VIEWPORT_TABLET_MAX}px)`,
  /** tablet + desktop (not phone) */
  notPhone: `(min-width: ${VIEWPORT_TABLET_MIN}px)`,
} as const
