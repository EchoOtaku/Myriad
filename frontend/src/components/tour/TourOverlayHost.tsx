import { lazy, Suspense, useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import { getTourSnapshot, stopTour, subscribeTour } from './tourStore'

const loadOverlay = () => import('./TourOverlay').then(module => ({ default: module.TourOverlay }))
const Overlay = lazy(loadOverlay)

export function prepareTourOverlay(): void {
  void loadOverlay().catch(() => {})
}

const getActive = () => getTourSnapshot().active
const getServerActive = () => false

/** Keep route-wide state available; load measurement and overlay UI only for a tour. */
export function TourOverlayHost() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (getTourSnapshot().active) stopTour('abort')
  }, [pathname])
  const active = useSyncExternalStore(subscribeTour, getActive, getServerActive)
  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      stopTour()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active])
  return active ? <Suspense fallback={null}><Overlay /></Suspense> : null
}
