export enum AnimationPriority {
  /** 立即执行，不占槽。 */
  PAGE = 0,
  SECTION = 1,
  COMPONENT = 2,
  ELEMENT = 3,
}

export enum AnimationState {
  WAITING = 'waiting',
  SCHEDULED = 'scheduled',
  READY = 'ready',
  RUNNING = 'running',
  COMPLETED = 'completed',
  SKIPPED = 'skipped',
}

export interface AnimationConfig {
  id: string
  priority: AnimationPriority
  groupId?: string
  index?: number
  delay?: number
  duration?: number
}

export type AnimationListener = (state: AnimationState) => void

export type Unsubscribe = () => void

export interface CoordinatorConfig {
  baseConcurrent: number
  burstConcurrent: number
  burstDuration: number
  defaultStaggerDelay: number
}

export const DEFAULT_CONFIG: CoordinatorConfig = {
  baseConcurrent: 16,
  burstConcurrent: 48,
  burstDuration: 5000,
  defaultStaggerDelay: 35,
}
