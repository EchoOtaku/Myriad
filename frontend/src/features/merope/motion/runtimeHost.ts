import type { RigStateSummary } from '../../../services/agent/types'
import type { MotionRuntime } from './runtime'
import { getRigMotionCoordinator } from './coordinator'
import { getMusicMotionSource, resetMusicMotionSource } from './musicSourceRuntime'
import { captureRigStateSummary } from './rigStateSummary'
import { createLiveMotionRuntime } from './runtime'

const production: { current: MotionRuntime | null } = { current: null }

export function getProductionMotionRuntime(): MotionRuntime {
  if (!production.current) {
    production.current = createLiveMotionRuntime(
      getRigMotionCoordinator(),
      getMusicMotionSource(),
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
