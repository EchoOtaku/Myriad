import { phantasiMotionQuiet } from './phantasiMotion'

/** 与 settings-motion `--sm-stagger` 同值。 */
export const PHANTASI_TAG_STAGGER_MS = 26

/** 与 settings-motion `--sm-dur-slow` 同值。 */
export const PHANTASI_TAG_ENTER_MS = 320

/** 与 settings-motion `--sm-dur-base` 同值。 */
export const PHANTASI_TAG_EXIT_MS = 220

export function phantasiTagQuiet(): boolean {
  return phantasiMotionQuiet()
}

export function phantasiTagDelay(index: number, quiet = false): number {
  if (quiet || index <= 0) return 0
  return index * PHANTASI_TAG_STAGGER_MS
}
