import { getRigMotionCoordinator } from './coordinator'
import { getMusicMotionSource, resetMusicMotionSource } from './musicSourceRuntime'
import { MotionRuntime } from './runtime'

const production: { current: MotionRuntime | null } = { current: null }

export function getProductionMotionRuntime(): MotionRuntime {
  if (!production.current) {
    production.current = new MotionRuntime(
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
