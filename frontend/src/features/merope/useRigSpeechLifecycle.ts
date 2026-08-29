import type { RefObject } from 'react'
import type { RigMotionCoordinator } from './motion/coordinator'
import type { RigCharacterHandle } from './rig/RigCharacter'
import type { SpeechOccupancy } from './speechLifecycle'
import { useEffect } from 'react'
import { getRigMotionCoordinator } from './motion/coordinator'
import { SpeechMotionLease } from './motion/speechLease'
import { MEROPE_SPEECH_EVENT, meropeSpeechEventDetail } from './speechEvents'
import { SpeechLifecycleController } from './speechLifecycle'

/** Connect one mounted rig to Agent reply speech without owning its UI host. */
export function useRigSpeechLifecycle(
  rigRef: RefObject<RigCharacterHandle | null>,
  occupancy?: SpeechOccupancy,
  coordinator: RigMotionCoordinator = getRigMotionCoordinator(),
): void {
  useEffect(() => {
    const mouth = new SpeechMotionLease(coordinator)
    const controller = new SpeechLifecycleController(
      {
        setSpeechActive: (active) => rigRef.current?.setSpeechActive(active),
        setAutoSpeech: (active) => rigRef.current?.setAutoSpeech(active),
        setSpeechEnergy: (energy) => rigRef.current?.setSpeechEnergy(energy),
        setSpeechArticulation: (articulation) =>
          rigRef.current?.setSpeechArticulation(articulation),
        enqueueSpeechText: (text, locale) =>
          rigRef.current?.enqueueSpeechText(text, locale),
      },
      undefined,
      occupancy,
      (busy) => mouth.setBusy(busy),
    )
    const onSpeech = (event: Event) => {
      const detail = meropeSpeechEventDetail(
        (event as CustomEvent<unknown>).detail,
      )
      if (detail) controller.handle(detail)
    }
    window.addEventListener(MEROPE_SPEECH_EVENT, onSpeech)
    return () => {
      window.removeEventListener(MEROPE_SPEECH_EVENT, onSpeech)
      controller.dispose()
      mouth.release()
    }
  }, [occupancy, rigRef, coordinator])
}
