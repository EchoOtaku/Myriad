import type { RefObject } from 'react'
import type { RigMotionPort } from '../rig/motionPort'
import type { MeropeActivity } from '../types'
import type { MotionRuntime } from './runtime'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { setLiveFaceVisible } from '../faceVisible'
import { markTurnTrace, noteTurnTraceDrop } from '../turnTrace'
import { useRigSingingLifecycle } from '../useRigSingingLifecycle'
import { applyMotionFrame, createMotionApplyState } from './applyFrame'
import { createPreviewMotionRuntime } from './runtime'
import { getProductionMotionRuntime } from './runtimeHost'

export interface RigMotionLifecycleOptions {
  mood?: number
  arousal?: number
  activity?: MeropeActivity
  capabilities?: readonly string[]
  /**
   * False until the character handle exists. Subscribe-on-mount would apply
   * the standing bearing into a null ref and never replay it on a live
   * runtime that only emits when mood, speech, or music changes.
   */
  ready?: boolean
}

function useMotionRuntimeConsumer(
  runtime: MotionRuntime,
  rigRef: RefObject<RigMotionPort | null>,
  options: RigMotionLifecycleOptions = {},
  liveFace = false,
): void {
  const mood = options.mood ?? 70
  const arousal = options.arousal ?? 48
  const activity = options.activity ?? 'idle'
  const capabilityKey = options.capabilities?.join(',') ?? ''
  const ready = options.ready ?? true

  useEffect(() => {
    const release = runtime.retain()
    if (liveFace) setLiveFaceVisible(true)
    return () => {
      release()
      if (liveFace) {
        setLiveFaceVisible(
          getProductionMotionRuntime().summaryFacts().faceVisible,
        )
      }
    }
  }, [runtime, liveFace])

  useEffect(() => {
    runtime.mood.set(mood, activity, arousal)
  }, [runtime, mood, activity, arousal])

  useEffect(() => {
    runtime.setCapabilities(capabilityKey ? capabilityKey.split(',') : [])
  }, [runtime, capabilityKey])

  useLayoutEffect(() => {
    if (!ready) return undefined
    const state = createMotionApplyState()
    return runtime.subscribe((frame) => {
      const rig = rigRef.current
      if (!rig) return
      applyMotionFrame(rig, frame, state, (feedback) => {
        if (liveFace && feedback.behaviorId.includes(':cue-')) {
          if (feedback.result === 'accepted') {
            markTurnTrace('performance_applied', {
              behavior: feedback.behaviorId,
            })
          } else {
            noteTurnTraceDrop('behavior_rejected')
          }
        }
        runtime.reportBehaviorRealizer(
          feedback.planId,
          feedback.behaviorId,
          feedback.result,
          feedback.atMs,
          feedback.reason,
        )
      })
    })
  }, [runtime, rigRef, liveFace, ready])
}

/**
 * One owner for a live face. Sources publish intents to the production
 * runtime; this hook only consumes the snapshot.
 */
export function useRigMotionLifecycle(
  rigRef: RefObject<RigMotionPort | null>,
  options: RigMotionLifecycleOptions = {},
): void {
  useRigSingingLifecycle()
  useMotionRuntimeConsumer(getProductionMotionRuntime(), rigRef, options, true)
}

/**
 * Workbench / persona studio: speech and performance on a private runtime
 * so preview never takes production channels.
 */
export function useRigPreviewMotionLifecycle(
  rigRef: RefObject<RigMotionPort | null>,
  options: RigMotionLifecycleOptions = {},
): void {
  const runtimeRef = useRef<MotionRuntime | null>(null)
  if (runtimeRef.current === null) {
    runtimeRef.current = createPreviewMotionRuntime()
  }
  useMotionRuntimeConsumer(runtimeRef.current, rigRef, options)
}
