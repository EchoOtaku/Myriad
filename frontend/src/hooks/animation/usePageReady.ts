import { useSyncExternalStore } from 'react'
import { coordinator } from './coordinator'

export function usePageReady(): boolean {
  return useSyncExternalStore(
    coordinator.subscribePage,
    coordinator.getPageReadySnapshot,
    coordinator.getPageReadySnapshot,
  )
}
