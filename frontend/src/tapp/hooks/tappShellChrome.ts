/**
 * Shared chrome tokens for Tapp run / store shells.
 *
 * Layout model (single tree — no JS measurement):
 *   max-w-6xl column  ← useTappShellPresence (enter/exit transform)
 *     header (rounded-t)
 *     slot (relative flex-1)
 *       content (absolute inset-0 | fixed inset-0 when fullscreen)
 *
 * Content stays mounted under the slot so fullscreen only flips positioning.
 * Open/close motion: see useTappShellPresence (no bounce; fade when safe; off while fullscreen).
 */

/** Horizontal pad: mobile 0.75rem → sm 1rem → md 1.5rem */
export const TAPP_SHELL_CHROME_PAD_CLASS = 'px-3 sm:px-4 md:px-6' as const

/** Desktop bottom pad under the content column */
export const TAPP_SHELL_CHROME_PB_DESKTOP = '1.5rem' as const

/** Mobile bottom pad: nav island + safe area */
export const TAPP_SHELL_CHROME_PB_MOBILE =
  'max(5.5rem, calc(env(safe-area-inset-bottom, 0px) + 4.5rem))' as const

/**
 * Content shell classes: same DOM node, CSS-only fullscreen switch.
 * Keep iframe / host panel mounted across the toggle.
 */
export function tappShellContentClass(isFullscreen: boolean, extra?: string): string {
  const base =
    'pointer-events-auto overflow-hidden transition-[border-radius] duration-300 ease-out'
  const mode = isFullscreen
    ? 'fixed inset-0 z-[1] rounded-none'
    : 'absolute inset-0 rounded-b-xl'
  return extra ? `${base} ${mode} ${extra}` : `${base} ${mode}`
}
