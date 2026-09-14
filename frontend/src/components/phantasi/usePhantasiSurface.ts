/** 不改 veil 本身。 */

import { useEffect } from 'react'
import { playPhantasiVeilEnter, playPhantasiVeilExit } from '../../hooks/animation'

export function usePhantasiSurface(loading: boolean, lockViewport: boolean) {
  useEffect(() => {
    if (loading) return
    playPhantasiVeilEnter()
    return () => {
      playPhantasiVeilExit()
    }
  }, [loading])

  useEffect(() => {
    if (!lockViewport) return
    const root = document.documentElement
    const previous = root.style.overflow
    root.style.overflow = 'hidden'
    return () => {
      root.style.overflow = previous
    }
  }, [lockViewport])
}
