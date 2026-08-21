import type { CompanionActivity } from '../types'
import type { SpeechArticulation } from './articulation'
import type { IdleAccentTimerLoop } from './director'
import type { GeneratedMotionPhase } from './generation'
import type {
  GazeSource,
  GazeTarget,
  MotionCharacterState,
  MotionDebugSignals,
} from './motion'
import type {
  RigPerformancePlaybackState,
  RigPerformanceSequence,
  RigPerformanceTimelineEvent,
} from './performance'
import type { CompanionMotionPlan, PlannedMotionCue } from './planner'
import type { CompanionRigManifest, RigMotionProfile } from './types'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { shouldAnimateCompanionUnread } from '../behavior'
import {
  createIdleAccentTimerLoop,
  nextIdleBehaviorMode,
  resolveRigGesture,
  resolveRigStateGesture,
  shouldScheduleIdleAccent,
} from './director'
import {
  createDefaultMotionProfile,
  idleAccentDelayMs,
  nextSeededUnit,
} from './motion'
import { buildRigPerformanceSequences } from './performance'
import {
  createBrowserPerformanceClock,
  RigPerformancePlayer,
} from './performancePlayer'
import { CompanionRigRenderer } from './renderer'

interface Props {
  activity: CompanionActivity
  expanded: boolean
  fallbackUrl: string
  gestureNonce: number
  manifest: CompanionRigManifest | null
  busy: boolean
  unreadCount: number
  energy: number
  mood: number
  boredom: number
  curiosity: number
  social: number
  affection: number
}

export interface RigCharacterHandle {
  setSpeechEnergy: (energy: number | null) => void
  setSpeechArticulation: (articulation: SpeechArticulation) => void
  setGazeTarget: (target: GazeTarget | null, source?: GazeSource) => void
  playMotionPlan: (plan: CompanionMotionPlan) => void
  previewIntent: (intent: PlannedMotionCue['intent']) => void
  previewClip: (
    clipId: string,
    options?: { variationSeed?: number; phase?: GeneratedMotionPhase },
  ) => void
  previewPerformance: (
    sequence: RigPerformanceSequence,
    onProgress?: (state: RigPerformancePlaybackState) => void,
  ) => number | null
  stopMotionPlan: () => void
  captureFrame: () => string | null
  setMotionProfile: (profile: RigMotionProfile) => void
  readMotionSignals: () => Readonly<MotionDebugSignals> | null
}

const RigCharacter = forwardRef<RigCharacterHandle, Props>(
  (
    {
      activity,
      expanded,
      fallbackUrl,
      gestureNonce,
      manifest,
      busy,
      unreadCount,
      energy,
      mood,
      boredom,
      curiosity,
      social,
      affection,
    }: Props,
    ref,
  ) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const rendererRef = useRef<CompanionRigRenderer | null>(null)
    const activityRef = useRef(activity)
    const expandedRef = useRef(expanded)
    const [ready, setReady] = useState(false)
    const previousBusy = useRef(busy)
    const previousUnreadCount = useRef(unreadCount)
    const motionStateRef = useRef<MotionCharacterState>({
      energy,
      mood,
      boredom,
      curiosity,
      social,
      affection,
    })
    const idleSeedRef = useRef(1)
    const idleProfileSeedRef = useRef<number | null>(null)
    const idleBehaviorModeRef = useRef<'idle' | 'rest' | 'fidget'>('idle')
    const fidgetSequenceRef = useRef(0)
    const gestureSequenceRef = useRef(0)
    const recentGestureIdsRef = useRef<string[]>([])
    const planTimersRef = useRef<number[]>([])
    const pendingPlanRef = useRef<CompanionMotionPlan | null>(null)
    const performancePlayerRef = useRef<RigPerformancePlayer | null>(null)
    const idleAccentTimerRef = useRef<IdleAccentTimerLoop | null>(null)

    const rememberGesture = useCallback((clipId: string) => {
      recentGestureIdsRef.current = [clipId, ...recentGestureIdsRef.current]
        .filter((id, index, values) => values.indexOf(id) === index)
        .slice(0, 8)
    }, [])

    const clearMotionPlan = useCallback((notify = false) => {
      pendingPlanRef.current = null
      for (const timer of planTimersRef.current) window.clearTimeout(timer)
      planTimersRef.current = []
      performancePlayerRef.current?.stop(notify)
      rendererRef.current?.cancelPendingWakeActions()
    }, [])

    const playIntent = useCallback(
      (intent: Parameters<typeof resolveRigGesture>[1]) => {
        if (!manifest) return
        const gesture = resolveRigGesture(manifest, intent, {
          seed: gestureSequenceRef.current++,
          avoid: recentGestureIdsRef.current,
        })
        if (gesture) {
          rememberGesture(gesture.clipId)
          rendererRef.current?.playOneShot(gesture.clipId, gesture.priority, {
            ...gesture,
            wakeBefore: true,
            locksIdle: intent === 'greet',
          })
        }
      },
      [manifest, rememberGesture],
    )

    const playCue = useCallback(
      (cue: PlannedMotionCue) => {
        if (!manifest) return
        const gesture = resolveRigGesture(manifest, cue.intent, {
          seed: gestureSequenceRef.current++,
          avoid: recentGestureIdsRef.current,
          prefer: cue.preferredClipIds,
        })
        if (!gesture) return
        rememberGesture(gesture.clipId)
        rendererRef.current?.playOneShot(gesture.clipId, gesture.priority, {
          intensity: cue.intensity,
          tempo: cue.tempo,
          fadeInMs: cue.fadeInMs,
          fadeOutMs: cue.fadeOutMs,
          interrupt: cue.interrupt,
          variationSeed: cue.variationSeed,
          phase: cue.phase,
          transitionMs: cue.transitionMs,
          wakeBefore: true,
          locksIdle: cue.intent === 'greet',
        })
      },
      [manifest, rememberGesture],
    )

    const playPerformanceAction = useCallback(
      (
        action: RigPerformanceSequence['cues'][number]['actions'][number],
        locksIdle: boolean,
      ) => {
        rendererRef.current?.playOneShot(action.clipId, action.priority, {
          intensity: action.intensity,
          tempo: action.tempo,
          fadeInMs: action.fadeInMs,
          fadeOutMs: action.fadeOutMs,
          transitionMs: action.transitionMs,
          interrupt: action.interrupt,
          exclusive: action.exclusive,
          allowLooping: true,
          variationSeed: action.variationSeed,
          phase: action.phase,
          wakeBefore: true,
          locksIdle,
        })
      },
      [],
    )

    const applyPerformanceEvent = useCallback(
      (
        sequence: RigPerformanceSequence,
        event: RigPerformanceTimelineEvent,
      ) => {
        const cue = sequence.cues[event.cueIndex]
        const renderer = rendererRef.current
        if (!renderer) return
        if (event.type === 'gaze') {
          renderer.setGazeTarget(
            cue?.gaze ? { ...cue.gaze, source: 'performance' } : null,
            cue?.gaze ? undefined : 'performance',
          )
        } else if (event.type === 'expression') {
          renderer.setPerformanceExpression(cue?.expression || null)
        } else if (event.type === 'action' && cue) {
          const action = cue.actions[event.actionIndex]
          if (action) playPerformanceAction(action, sequence.id === 'greeting')
        } else if (event.type === 'contact' && cue) {
          const contact =
            cue.actions[event.actionIndex]?.contacts[event.contactIndex]
          if (!contact) return
          renderer.triggerPerformanceImpulse(contact.kind, contact.intensity)
        } else if (event.type === 'release') {
          renderer.releasePerformance(420)
        }
      },
      [playPerformanceAction],
    )

    const playMotionPlan = useCallback(
      (plan: CompanionMotionPlan) => {
        clearMotionPlan()
        if (
          !rendererRef.current ||
          !performancePlayerRef.current ||
          !manifest
        ) {
          pendingPlanRef.current = plan
          return
        }
        if (plan.performanceId) {
          const sequence = buildRigPerformanceSequences(manifest).find(
            (candidate) => candidate.id === plan.performanceId,
          )
          if (sequence) {
            performancePlayerRef.current.play(sequence, {
              onEvent: applyPerformanceEvent,
            })
            return
          }
        }
        for (const cue of plan.cues) {
          if (cue.atMs <= 0) {
            playCue(cue)
            continue
          }
          planTimersRef.current.push(window.setTimeout(playCue, cue.atMs, cue))
        }
      },
      [applyPerformanceEvent, clearMotionPlan, manifest, playCue],
    )

    useImperativeHandle(
      ref,
      () => ({
        setSpeechEnergy: (value) => rendererRef.current?.setSpeechEnergy(value),
        setSpeechArticulation: (value) =>
          rendererRef.current?.setSpeechArticulation(value),
        setGazeTarget: (target, source) =>
          rendererRef.current?.setGazeTarget(target, source),
        setMotionProfile: (profile) =>
          rendererRef.current?.setMotionProfile(profile),
        previewIntent: (intent) => {
          clearMotionPlan()
          const gesture =
            manifest &&
            resolveRigGesture(manifest, intent, {
              seed: gestureSequenceRef.current++,
              avoid: recentGestureIdsRef.current,
            })
          if (gesture) {
            rememberGesture(gesture.clipId)
            rendererRef.current?.playOneShot(gesture.clipId, gesture.priority, {
              ...gesture,
              interrupt: 'replace',
              exclusive: true,
            })
          }
        },
        previewClip: (clipId, options) => {
          clearMotionPlan()
          rendererRef.current?.playOneShot(clipId, 200, {
            intensity: 1,
            tempo: 1,
            interrupt: 'replace',
            allowLooping: true,
            exclusive: true,
            variationSeed: options?.variationSeed,
            phase: options?.phase,
          })
        },
        previewPerformance: (sequence, onProgress) => {
          clearMotionPlan()
          if (!rendererRef.current || !performancePlayerRef.current) return null
          return performancePlayerRef.current.play(sequence, {
            onEvent: applyPerformanceEvent,
            onProgress,
          })
        },
        stopMotionPlan: () => {
          clearMotionPlan(true)
          rendererRef.current?.releasePerformance()
        },
        captureFrame: () => rendererRef.current?.captureFrame() || null,
        readMotionSignals: () =>
          rendererRef.current?.readMotionSignals() || null,
        playMotionPlan,
      }),
      [
        applyPerformanceEvent,
        clearMotionPlan,
        manifest,
        playMotionPlan,
        playCue,
        rememberGesture,
      ],
    )

    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas || !manifest) {
        setReady(false)
        return
      }
      let cancelled = false
      setReady(false)
      void CompanionRigRenderer.create(canvas, manifest, () => setReady(false))
        .then((renderer) => {
          if (cancelled) {
            renderer.destroy()
            return
          }
          rendererRef.current = renderer
          performancePlayerRef.current = new RigPerformancePlayer(
            createBrowserPerformanceClock(),
          )
          renderer.setMotionState(motionStateRef.current)
          renderer.setIdleBehaviorMode(idleBehaviorModeRef.current)
          renderer.setActivity(activityRef.current)
          renderer.setExpanded(expandedRef.current)
          renderer.start()
          setReady(true)
          const pendingPlan = pendingPlanRef.current
          if (pendingPlan) playMotionPlan(pendingPlan)
        })
        .catch(() => setReady(false))
      return () => {
        cancelled = true
        clearMotionPlan()
        performancePlayerRef.current?.destroy()
        performancePlayerRef.current = null
        rendererRef.current?.destroy()
        rendererRef.current = null
      }
    }, [clearMotionPlan, manifest, playMotionPlan])

    useEffect(() => {
      activityRef.current = activity
      rendererRef.current?.setActivity(activity)
    }, [activity])

    useEffect(() => {
      expandedRef.current = expanded
      if (!expanded) clearMotionPlan()
      rendererRef.current?.setExpanded(expanded)
    }, [clearMotionPlan, expanded])

    useEffect(() => {
      motionStateRef.current = {
        energy,
        mood,
        boredom,
        curiosity,
        social,
        affection,
      }
      rendererRef.current?.setMotionState(motionStateRef.current)
    }, [affection, boredom, curiosity, energy, mood, social])

    useEffect(() => {
      const previousMode = idleBehaviorModeRef.current
      const behaviorMode = nextIdleBehaviorMode(previousMode, {
        energy,
        boredom,
      })
      idleBehaviorModeRef.current = behaviorMode
      rendererRef.current?.setIdleBehaviorMode(behaviorMode)
      if (!manifest || activity !== 'idle' || behaviorMode === previousMode) {
        return
      }
      if (previousMode === 'rest') {
        rendererRef.current?.stopOneShots(520)
      }
      if (behaviorMode !== 'rest') return
      const gesture = resolveRigStateGesture(
        manifest,
        { energy, mood, boredom },
        {
          seed: gestureSequenceRef.current++,
          avoid: recentGestureIdsRef.current,
          behaviorMode,
        },
      )
      if (!gesture) return
      rememberGesture(gesture.clipId)
      rendererRef.current?.playOneShot(gesture.clipId, gesture.priority, {
        ...gesture,
        fadeInMs: 360,
        fadeOutMs: 480,
        transitionMs: 480,
        interrupt: 'replace',
      })
    }, [activity, boredom, energy, manifest, mood, rememberGesture])

    useEffect(() => {
      if (gestureNonce > 0) {
        playIntent(
          gestureNonce % 3 === 0
            ? 'poke'
            : gestureNonce % 2 === 0
              ? 'pat'
              : 'greet',
        )
      }
    }, [gestureNonce, playIntent])

    useEffect(() => {
      if (
        shouldAnimateCompanionUnread(
          expandedRef.current,
          previousUnreadCount.current,
          unreadCount,
        )
      ) {
        playIntent('notify')
      }
      previousUnreadCount.current = unreadCount
    }, [playIntent, unreadCount])

    useEffect(() => {
      if (busy && !previousBusy.current) playIntent('listen')
      if (!busy && previousBusy.current) playIntent('respond')
      previousBusy.current = busy
    }, [busy, playIntent])

    useEffect(() => {
      if (!manifest || activity !== 'idle') return
      const profileSeed = createDefaultMotionProfile(manifest).seed
      if (idleProfileSeedRef.current !== profileSeed) {
        idleSeedRef.current = profileSeed
        idleProfileSeedRef.current = profileSeed
      }
      const timer = createIdleAccentTimerLoop(
        () => {
          const random = nextSeededUnit(idleSeedRef.current)
          idleSeedRef.current = random.seed
          return idleAccentDelayMs(
            motionStateRef.current,
            random.value,
            idleBehaviorModeRef.current,
          )
        },
        () => {
          if (
            !expandedRef.current ||
            activityRef.current !== 'idle' ||
            !shouldScheduleIdleAccent(idleBehaviorModeRef.current)
          ) {
            idleAccentTimerRef.current?.pause()
            return
          }
          const behaviorMode = idleBehaviorModeRef.current
          const gesture = resolveRigStateGesture(
            manifest,
            motionStateRef.current,
            {
              seed: gestureSequenceRef.current++,
              avoid: recentGestureIdsRef.current,
              behaviorMode,
              fidgetSequence:
                behaviorMode === 'fidget'
                  ? fidgetSequenceRef.current++
                  : undefined,
            },
          )
          if (gesture) {
            rememberGesture(gesture.clipId)
            rendererRef.current?.playOneShot(
              gesture.clipId,
              gesture.priority,
              gesture,
            )
          }
        },
      )
      idleAccentTimerRef.current = timer
      if (
        expandedRef.current &&
        shouldScheduleIdleAccent(idleBehaviorModeRef.current)
      ) {
        timer.resume()
      }
      return () => {
        timer.cancel()
        if (idleAccentTimerRef.current === timer) {
          idleAccentTimerRef.current = null
        }
      }
    }, [activity, manifest, rememberGesture])

    useEffect(() => {
      const timer = idleAccentTimerRef.current
      if (!timer) return
      if (
        expanded &&
        activity === 'idle' &&
        shouldScheduleIdleAccent(idleBehaviorModeRef.current)
      ) {
        timer.resume()
      } else {
        timer.pause()
      }
    }, [activity, boredom, energy, expanded, manifest])

    return (
      <span
        className={`dlc-rig ${ready ? 'is-ready' : ''}`}
        data-rig-quality={manifest?.quality || 'static'}
      >
        <img src={fallbackUrl} alt="" draggable={false} />
        <canvas ref={canvasRef} aria-hidden />
      </span>
    )
  },
)

export default RigCharacter
