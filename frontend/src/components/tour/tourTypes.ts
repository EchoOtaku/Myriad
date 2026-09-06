export type TourAudience = 'visitor' | 'owner'

export interface TourStepDef {
  id: string
  anchor: string
}

export interface TourDefinition {
  id: string
  /** Exact pathname after trailing-slash normalize (`/` stays `/`). */
  route: string
  audience: TourAudience
  steps: TourStepDef[]
}
