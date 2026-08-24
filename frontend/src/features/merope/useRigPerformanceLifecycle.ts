import type { RefObject } from 'react'
import type { RigCharacterHandle } from './rig/RigCharacter'
import { useEffect } from 'react'
import {
  MEROPE_PERFORMANCE_EVENT,
  meropePerformanceEventDetail,
} from './performanceEvents'
import { PerformanceLifecycleController } from './performanceLifecycle'
import { MEROPE_SPEECH_EVENT, meropeSpeechEventDetail } from './speechEvents'

/** Connect one mounted rig to strict-Lite semantic performance events. */
export function useRigPerformanceLifecycle(
  rigRef: RefObject<RigCharacterHandle | null>,
): void {
  useEffect(() => {
    const controller = new PerformanceLifecycleController({
      playMotionPlan: (performance) =>
        rigRef.current?.playMotionPlan(performance) ?? false,
      stopMotionPlan: () => rigRef.current?.stopMotionPlan(),
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
  }, [rigRef])
}
