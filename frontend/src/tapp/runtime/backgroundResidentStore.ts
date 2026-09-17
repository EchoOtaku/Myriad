import type { BackgroundRequirement, TappInstance } from '../types'
import { useSyncExternalStore } from 'react'

export interface BackgroundResident {
  id: string
  name: string
  requirements: readonly BackgroundRequirement[]
}

const EMPTY_RESIDENTS: readonly BackgroundResident[] = []

let residents = EMPTY_RESIDENTS
let stopHandler: ((tappId: string) => void) | null = null
const listeners = new Set<() => void>()

function sameResidents(
  left: readonly BackgroundResident[],
  right: readonly BackgroundResident[],
): boolean {
  return (
    left.length === right.length &&
    left.every((resident, index) => {
      const candidate = right[index]
      return (
        candidate?.id === resident.id &&
        candidate.name === resident.name &&
        candidate.requirements.length === resident.requirements.length &&
        candidate.requirements.every(
          (requirement, requirementIndex) =>
            requirement === resident.requirements[requirementIndex],
        )
      )
    })
  )
}

function notify(): void {
  for (const listener of listeners) listener()
}

export function publishBackgroundResidents(
  tapps: readonly TappInstance[],
  requirementsFor: (tappId: string) => BackgroundRequirement[],
): void {
  const next = tapps.map((tapp) => ({
    id: tapp.id,
    name: tapp.manifest.name,
    requirements: requirementsFor(tapp.id),
  }))
  if (sameResidents(residents, next)) return
  residents = next.length > 0 ? next : EMPTY_RESIDENTS
  notify()
}

export function clearBackgroundResidents(): void {
  if (residents.length === 0) return
  residents = EMPTY_RESIDENTS
  notify()
}

export function registerBackgroundResidentStopHandler(
  handler: (tappId: string) => void,
): () => void {
  stopHandler = handler
  return () => {
    if (stopHandler === handler) stopHandler = null
  }
}

export function stopBackgroundResident(tappId: string): void {
  stopHandler?.(tappId)
}

export function subscribeBackgroundResidents(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getBackgroundResidentsSnapshot(): readonly BackgroundResident[] {
  return residents
}

export function getServerBackgroundResidentsSnapshot(): readonly BackgroundResident[] {
  return EMPTY_RESIDENTS
}

export function useBackgroundResidents(): readonly BackgroundResident[] {
  return useSyncExternalStore(
    subscribeBackgroundResidents,
    getBackgroundResidentsSnapshot,
    getServerBackgroundResidentsSnapshot,
  )
}
