import type { TourDefinition } from './tourTypes'
import { pickTour } from './tourLogic'

export const HOME_TOURS: readonly TourDefinition[] = [
  {
    id: 'home-visitor',
    route: '/',
    audience: 'visitor',
    steps: [
      { id: 'nav', anchor: 'nav' },
      { id: 'home-grid', anchor: 'home-grid' },
    ],
  },
  {
    id: 'home-owner',
    route: '/',
    audience: 'owner',
    steps: [
      { id: 'nav', anchor: 'nav' },
      { id: 'home-grid', anchor: 'home-grid' },
      { id: 'home-edit', anchor: 'home-edit' },
      { id: 'control-island', anchor: 'control-island' },
    ],
  },
]

export const TOURS: readonly TourDefinition[] = [...HOME_TOURS]

export function pickRegisteredTour(
  pathname: string,
  isOwner: boolean,
): TourDefinition | null {
  return pickTour(TOURS, pathname, isOwner)
}
