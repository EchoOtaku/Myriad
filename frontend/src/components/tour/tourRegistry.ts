import type { TourDefinition, TourStepDef } from './tourTypes'
import { pickTour } from './tourLogic'

const NAV: TourStepDef = { id: 'nav', anchor: 'nav' }
const CONTROL_ISLAND: TourStepDef = {
  id: 'control-island',
  anchor: 'control-island',
}

function pair(
  page: string,
  route: string,
  mid: readonly TourStepDef[],
): readonly TourDefinition[] {
  return [
    {
      id: `${page}-visitor`,
      route,
      audience: 'visitor',
      steps: [NAV, ...mid],
    },
    {
      id: `${page}-owner`,
      route,
      audience: 'owner',
      steps: [NAV, ...mid, CONTROL_ISLAND],
    },
  ]
}

export const HOME_TOURS: readonly TourDefinition[] = [
  {
    id: 'home-visitor',
    route: '/',
    audience: 'visitor',
    steps: [NAV, { id: 'home-grid', anchor: 'home-grid' }],
  },
  {
    id: 'home-owner',
    route: '/',
    audience: 'owner',
    steps: [
      NAV,
      { id: 'home-grid', anchor: 'home-grid' },
      { id: 'home-edit', anchor: 'home-edit' },
      CONTROL_ISLAND,
    ],
  },
]

export const LIBRARY_TOURS: readonly TourDefinition[] = pair('library', '/library', [
  { id: 'library-grid', anchor: 'library-grid' },
])

export const REPORTS_TOURS: readonly TourDefinition[] = pair('reports', '/reports', [
  { id: 'reports-status', anchor: 'reports-status' },
  { id: 'reports-cards', anchor: 'reports-cards' },
])

export const TAPP_TOURS: readonly TourDefinition[] = pair('tapp', '/tapp', [
  { id: 'tapp-toolbar', anchor: 'tapp-toolbar' },
  { id: 'tapp-grid', anchor: 'tapp-grid' },
])

export const TAPP_STORE_TOURS: readonly TourDefinition[] = pair(
  'tapp-store',
  '/tapp/store',
  [
    { id: 'tapp-store-nav', anchor: 'tapp-store-nav' },
    { id: 'tapp-store-catalog', anchor: 'tapp-store-catalog' },
  ],
)

export const CONFIG_TOURS: readonly TourDefinition[] = [
  {
    id: 'config-owner',
    route: '/config',
    audience: 'owner',
    steps: [
      NAV,
      { id: 'config-sidebar', anchor: 'config-sidebar' },
      { id: 'config-content', anchor: 'config-content' },
      CONTROL_ISLAND,
    ],
  },
]

export const TOURS: readonly TourDefinition[] = [
  ...HOME_TOURS,
  ...LIBRARY_TOURS,
  ...REPORTS_TOURS,
  ...TAPP_TOURS,
  ...TAPP_STORE_TOURS,
  ...CONFIG_TOURS,
]

export function pickRegisteredTour(
  pathname: string,
  isOwner: boolean,
): TourDefinition | null {
  return pickTour(TOURS, pathname, isOwner)
}
