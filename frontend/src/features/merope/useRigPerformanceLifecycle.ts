import type { RefObject } from 'react'
import type { RigMotionCoordinator } from './motion/coordinator'
import type { RigCharacterHandle } from './rig/RigCharacter'
import { useEffect } from 'react'
import { getRigMotionCoordinator } from './motion/coordinator'
import { PerformanceMotionLeases } from './motion/performanceLeases'
import {
  MEROPE_PERFORMANCE_EVENT,
  meropePerformanceEventDetail,
} from './performanceEvents'
import { PerformanceLifecycleController } from './performanceLifecycle'
import { MEROPE_SPEECH_EVENT, meropeSpeechEventDetail } from './speechEvents'

/** Connect one mounted rig to strict-Lite semantic performance events. */
export function useRigPerformanceLifecycle(
  rigRef: RefObject<RigCharacterHandle | null>,
  coordinator: RigMotionCoordinator = getRigMotionCoordinator(),
): void {
  useEffect(() => {
    const leases = new PerformanceMotionLeases(coordinator)
    const controller = new PerformanceLifecycleController({
      playMotionPlan: (performance) => {
        const accepted = rigRef.current?.playMotionPlan(performance) ?? false
        if (accepted) {
          leases.apply(performance, globalThis.performance.now())
        }
        return accepted
      },
      stopMotionPlan: () => {
        leases.releaseAll()
        rigRef.current?.stopMotionPlan()
      },
    })
    const onPerformance = (event: Event) => {
      const detail = meropePerformanceEventDetail(
        (event as CustomEvent<unknown>).detail,
      )
      if (detail) controller.handle(detail)
    }
    const onSpeech = (event: Event) => {
      const detail = meropeSpeechEventDetail(
        (event as CustomEvent<unknown>).detail,
      )
      if (detail) controller.handleSpeech(detail)
    }
    window.addEventListener(MEROPE_PERFORMANCE_EVENT, onPerformance)
    window.addEventListener(MEROPE_SPEECH_EVENT, onSpeech)
    return () => {
      window.removeEventListener(MEROPE_PERFORMANCE_EVENT, onPerformance)
      window.removeEventListener(MEROPE_SPEECH_EVENT, onSpeech)
      controller.dispose()
    }
  }, [rigRef, coordinator])
}
