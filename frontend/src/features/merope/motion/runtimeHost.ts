import type { RigStateSummary } from '../../../services/agent/types'
import { getRigMotionCoordinator } from './coordinator'
import { getMusicMotionSource, resetMusicMotionSource } from './musicSourceRuntime'
import { captureRigStateSummary } from './rigStateSummary'
import { MotionRuntime } from './runtime'

const production: { current: MotionRuntime | null } = { current: null }

export function getProductionMotionRuntime(): MotionRuntime {
  if (!production.current) {
    production.current = new MotionRuntime(
      getRigMotionCoordinator(),
      getMusicMotionSource(),
      true,
    )
  }
  return production.current
}

export function resetProductionMotionRuntime(): void {
  production.current = null
  resetMusicMotionSource()
}

export function captureProductionRigStateSummary(): RigStateSummary {
  return captureRigStateSummary(getProductionMotionRuntime())
}
