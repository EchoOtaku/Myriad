import type { RefObject } from 'react'
import type { RigCharacterHandle } from '../rig/RigCharacter'
import { useRef } from 'react'
import { useRigPerformanceLifecycle } from '../useRigPerformanceLifecycle'
import { useRigSingingLifecycle } from '../useRigSingingLifecycle'
import { useRigSpeechLifecycle } from '../useRigSpeechLifecycle'

/**
 * One owner for a live face: speech, Lite performance, and site music
 * go through the motion coordinator before they touch the player.
 */
export function useRigMotionLifecycle(
  rigRef: RefObject<RigCharacterHandle | null>,
): void {
  const occupancy = useRef({ current: false })
  useRigPerformanceLifecycle(rigRef)
  useRigSpeechLifecycle(rigRef, occupancy)
  useRigSingingLifecycle(rigRef)
}

/**
 * Workbench / persona studio: speech and performance only. Preview sliders
 * keep the highest channel priority by writing the isolated player directly.
 */
export function useRigPreviewMotionLifecycle(
  rigRef: RefObject<RigCharacterHandle | null>,
): void {
  useRigPerformanceLifecycle(rigRef)
  useRigSpeechLifecycle(rigRef)
}
