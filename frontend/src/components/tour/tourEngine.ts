import type { TourDefinition, TourStepDef } from './tourTypes'
import { markTourDone } from './tourDone'
import {
  firstVisibleIndex,
  hasTourAnchor,
  previousVisibleIndex,
  setTourDomActive,
} from './tourLogic'
import { pickRegisteredTour } from './tourRegistry'

export interface TourSnapshot {
  active: boolean
  tourId: string | null
  index: number
  total: number
  step: TourStepDef | null
}

const EMPTY: TourSnapshot = {
  active: false,
  tourId: null,
  index: 0,
  total: 0,
  step: null,
}

let visible: TourStepDef[] = []
let snapshot: TourSnapshot = EMPTY
const listeners = new Set<() => void>()

function emit(next: TourSnapshot): void {
  snapshot = next
  listeners.forEach((listener) => listener())
}

function stopInternal(): void {
  visible = []
  setTourDomActive(false)
  emit(EMPTY)
}

function showIndex(index: number): void {
  const step = visible[index]
  if (!step) {
    stopInternal()
    return
  }
  emit({
    active: true,
    tourId: snapshot.tourId,
    index,
    total: visible.length,
    step,
  })
}

export function subscribeTour(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

export function getTourSnapshot(): TourSnapshot {
  return snapshot
}

export type StartTourResult = 'started' | 'no-tour' | 'no-targets'

export function startTour(def: TourDefinition): boolean {
  const steps = def.steps.filter((step) => hasTourAnchor(step.anchor))
  if (steps.length === 0) return false
  visible = steps
  setTourDomActive(true)
  emit({
    active: true,
    tourId: def.id,
    index: 0,
    total: steps.length,
    step: steps[0]!,
  })
  return true
}

export function startTourForRoute(
  pathname: string,
  isOwner: boolean,
): StartTourResult {
  const def = pickRegisteredTour(pathname, isOwner)
  if (!def) return 'no-tour'
  return startTour(def) ? 'started' : 'no-targets'
}

export type StopTourReason = 'done' | 'skip' | 'abort'

export function stopTour(reason: StopTourReason = 'abort'): void {
  if (!snapshot.active) return
  if ((reason === 'done' || reason === 'skip') && snapshot.tourId) {
    markTourDone(snapshot.tourId)
  }
  stopInternal()
}

export function nextTourStep(): void {
  if (!snapshot.active) return
  const next = firstVisibleIndex(visible, hasTourAnchor, snapshot.index + 1)
  if (next < 0) {
    stopTour('done')
    return
  }
  showIndex(next)
}

export function previousTourStep(): void {
  if (!snapshot.active) return
  const prev = previousVisibleIndex(visible, hasTourAnchor, snapshot.index)
  if (prev < 0) return
  showIndex(prev)
}

/** If the current anchor vanished, jump forward or stop. */
export function recoverTourStep(): void {
  if (!snapshot.active || !snapshot.step) return
  if (hasTourAnchor(snapshot.step.anchor)) return
  const next = firstVisibleIndex(visible, hasTourAnchor, snapshot.index)
  if (next < 0) {
    stopInternal()
    return
  }
  showIndex(next)
}
