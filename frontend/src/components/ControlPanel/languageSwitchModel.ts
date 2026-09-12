import type { Locale } from '../../i18n'
import { LOCALES } from '../../i18n'

export const LOCALE_COUNT = LOCALES.length

export const LOOP_ITEMS: readonly Locale[] = [
  LOCALES[LOCALE_COUNT - 1],
  ...LOCALES,
  LOCALES[0],
]

export const LOOP_LAST = LOOP_ITEMS.length - 1

export function initialVirtual(locale: Locale): number {
  return 1 + Math.max(0, LOCALES.indexOf(locale))
}

export function localeAtVirtual(virtual: number): Locale {
  if (virtual <= 0) return LOCALES[LOCALE_COUNT - 1]
  if (virtual >= LOOP_LAST) return LOCALES[0]
  return LOCALES[virtual - 1]
}

export function snapVirtual(virtual: number): number {
  if (virtual <= 0) return LOCALE_COUNT
  if (virtual >= LOOP_LAST) return 1
  return virtual
}

export function needsSnap(virtual: number): boolean {
  return virtual <= 0 || virtual >= LOOP_LAST
}

export function rowTone(distance: number): string {
  if (distance === 0) return ' is-current'
  if (distance === 1) return ' is-near-1'
  if (distance === 2) return ' is-near-2'
  return ' is-far'
}

export const STRIP_BTN_REM = 2.15
export const STRIP_GAP_REM = 0.4
export const STRIP_STEP_REM = STRIP_BTN_REM + STRIP_GAP_REM
export const STRIP_HALF_REM = STRIP_BTN_REM / 2

export function stripTransform(index: number, dragPx: number): string {
  const shift = (index * STRIP_STEP_REM + STRIP_HALF_REM).toFixed(3)
  return `translate3d(calc(${dragPx}px - ${shift}rem), -50%, 0)`
}
