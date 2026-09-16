import { VIEWPORT_TABLET_MIN } from '../../../utils/viewportBands'

export const PHANTASI_SEARCH_MEDIA = `(min-width: ${VIEWPORT_TABLET_MIN}px)`
export const PHANTASI_PEEK_MEDIA = `${PHANTASI_SEARCH_MEDIA} and (hover: hover) and (pointer: fine)`

export function canPhantasiPeek(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(PHANTASI_PEEK_MEDIA).matches
}
