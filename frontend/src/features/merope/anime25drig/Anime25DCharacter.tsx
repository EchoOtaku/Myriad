import type {
  PerformanceBaseline,
  PerformanceDirective,
} from '../../../services/agent/types'
import type { SpeechArticulation } from '../rig/articulation'
import type { GazeSource, GazeTarget } from '../rig/motion'
import type { MeropeRigManifest } from '../rig/types'
import type { MeropeActivity } from '../types'
import type { Anime25DDebugSnapshot, Anime25DDriver } from './player'
import type { Anime25DPlayback } from './types'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import { activityExpressionDriverPatch } from './expressionPresets'
import { PerformanceDirectiveGate } from './performanceExpression'
import {
  cueDriverPatch,
  cuePriority,
  idleSpeechDriverPatch,
  performanceRestDriverPatch,
  scheduleBodyCues,
  scheduledBodyCueRemainingDurationMs,
} from './performanceMotion'
import {
  Anime25DPlayer,
  IDENTITY_DRIVER,
} from './player'
import {
  speechArticulationDriverPatch,
  speechEnergyDriverPatch,
  updatedSpeechMouthFormBaseline,
} from './speechDriver'

interface Props {
  activity: MeropeActivity
  fallbackUrl: string
  manifest: MeropeRigManifest
  playback: Anime25DPlayback
  atlasUrl: string
  mood: number
  /** Settings page: sliders own the base pose; live acting stays additive. */
  manualControl?: boolean
}

export interface Anime25DCharacterHandle {
  setSpeechActive: (active: boolean) => void
  setAutoSpeech: (active: boolean) => void
  setSpeechEnergy: (energy: number | null) => void
  setSpeechArticulation: (articulation: SpeechArticulation) => void
  setGazeTarget: (target: GazeTarget | null, source?: GazeSource) => void
  playMotionPlan: (
    performance: PerformanceDirective,
    startedAtMs?: number,
  ) => boolean
  stopMotionPlan: () => void
  captureFrame: () => string | null
  setDriver: (partial: Partial<Anime25DDriver>) => void
  replaceDriver: (driver: Anime25DDriver) => void
  resetDriver: () => void
  getDriver: () => Anime25DDriver | null
  blinkNow: () => void
  debugSnapshot: () => Anime25DDebugSnapshot | null
  setMouse: (x: number, y: number, inside: boolean) => void
}

const Anime25DCharacter = forwardRef<Anime25DCharacterHandle, Props>(
  ({ activity, fallbackUrl, manifest, playback, atlasUrl, mood, manualControl = false }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const playerRef = useRef<Anime25DPlayer | null>(null)
    const readyRef = useRef(false)
    const wrapperRef = useRef<HTMLSpanElement>(null)
    const activityRef = useRef(activity)
    const moodRef = useRef(mood)
    const speechActiveRef = useRef(false)
    const speechMouthFormRef = useRef(0)
    const manualRef = useRef(manualControl)
    const baselineRef = useRef<PerformanceBaseline | null>(null)
    const performanceRef = useRef<{
      directive: PerformanceDirective
      startedAtMs: number
    } | null>(null)
    const performanceGateRef = useRef(new PerformanceDirectiveGate())
    const cueTimersRef = useRef(new Set<number>())
    const restoreTimerRef = useRef<number | null>(null)
    const activePriorityRef = useRef(0)
    const activeUntilRef = useRef(0)
    activityRef.current = activity
    moodRef.current = mood
    manualRef.current = manualControl || manualRef.current

    const applyPerformanceDriver = (player: Anime25DPlayer) => {
      if (manualRef.current || manualControl) return
      player.setTarget(
        performanceRestDriverPatch(
          baselineRef.current,
          activityRef.current === 'thinking',
        ),
      )
    }

    const applyDriver = (player: Anime25DPlayer) => {
      if (manualRef.current || manualControl) return
      const currentActivity = activityRef.current
      player.setTarget({
        ...activityExpressionDriverPatch(currentActivity === 'thinking'),
        ...performanceRestDriverPatch(
          baselineRef.current,
          currentActivity === 'thinking',
        ),
        ...idleSpeechDriverPatch(
          moodRef.current,
          speechActiveRef.current,
        ),
      })
    }

    const clearCueTimers = () => {
      for (const timer of cueTimersRef.current) window.clearTimeout(timer)
      cueTimersRef.current.clear()
      if (restoreTimerRef.current !== null) {
        window.clearTimeout(restoreTimerRef.current)
        restoreTimerRef.current = null
      }
      activePriorityRef.current = 0
      activeUntilRef.current = 0
    }

    const schedulePerformanceBody = (
      directive: PerformanceDirective,
      directiveStartedAt: number,
      player: Anime25DPlayer | null,
    ) => {
      if (manualRef.current || manualControl) return
      if (directive.plan.baseline) {
        baselineRef.current = directive.plan.baseline
      }
      if (player) applyPerformanceDriver(player)

      for (const scheduled of scheduleBodyCues(
        directive.plan.cues,
        directiveStartedAt,
      )) {
        const cue = scheduled.cue
        let scheduledStartAt = scheduled.startMs
        const timer = window.setTimeout(() => {
          cueTimersRef.current.delete(timer)
          const run = () => {
            const priority = cuePriority(cue)
            const now = performance.now()
            const active = now < activeUntilRef.current
            if (cue.interrupt === 'queue' && active) {
              scheduledStartAt = activeUntilRef.current
              const queued = window.setTimeout(() => {
                cueTimersRef.current.delete(queued)
                run()
              }, scheduledStartAt - now)
              cueTimersRef.current.add(queued)
              return
            }
            if (
              cue.interrupt === 'if-lower' &&
              active &&
              priority <= activePriorityRef.current
            ) {
              return
            }
            const duration = scheduledBodyCueRemainingDurationMs(
              {
                ...scheduled,
                startMs: scheduledStartAt,
                endMs:
                  scheduled.endMs + (scheduledStartAt - scheduled.startMs),
              },
              now,
            )
            if (duration <= 0) return
            if (restoreTimerRef.current !== null) window.clearTimeout(restoreTimerRef.current)
            activePriorityRef.current = priority
            activeUntilRef.current = now + duration
            playerRef.current?.setTarget({
              ...performanceRestDriverPatch(
                baselineRef.current,
                activityRef.current === 'thinking',
              ),
              // Authored cues own the pose until their restore timer fires.
              // Ambient motion eases to neutral instead of competing.
              rand: false,
              ...cueDriverPatch(cue),
            })
            restoreTimerRef.current = window.setTimeout(() => {
              activePriorityRef.current = 0
              activeUntilRef.current = 0
              restoreTimerRef.current = null
              if (playerRef.current) {
                applyPerformanceDriver(playerRef.current)
              }
            }, duration)
          }
          run()
        }, Math.max(0, scheduledStartAt - performance.now()))
        cueTimersRef.current.add(timer)
      }
    }

    const enterManualControl = () => {
      if (manualRef.current) return
      clearCueTimers()
      if (playerRef.current) applyPerformanceDriver(playerRef.current)
      manualRef.current = true
    }

    useImperativeHandle(ref, () => ({
      setSpeechActive(active) {
        if (active && !speechActiveRef.current) {
          speechMouthFormRef.current =
            playerRef.current?.getTarget().mouthForm ?? 0
        }
        speechActiveRef.current = active
        playerRef.current?.setSpeechActive(active)
      },
      setAutoSpeech(active) {
        playerRef.current?.setTarget({
          talk: active,
          mouthOpen: 0,
        })
      },
      setSpeechEnergy(energy) {
        playerRef.current?.setTarget(speechEnergyDriverPatch(energy))
      },
      setSpeechArticulation(articulation) {
        playerRef.current?.setTarget(
          speechArticulationDriverPatch(
            articulation,
            speechMouthFormRef.current,
          ),
        )
      },
      setGazeTarget(target) {
        playerRef.current?.setTarget({
          angleX: target ? target.x * 0.35 : 0,
          angleY: target ? target.y * 0.28 : 0,
        })
      },
      playMotionPlan(directive, startedAtMs) {
        const acceptance = performanceGateRef.current.accept(directive)
        if (acceptance === 'reject') return false
        if (acceptance === 'supersede') clearCueTimers()
        const now = performance.now()
        const directiveStartedAt = Number.isFinite(startedAtMs)
          ? Math.max(0, Math.min(now, startedAtMs as number))
          : now
        if (
          playerRef.current &&
          !playerRef.current.playPerformance(directive, directiveStartedAt / 1_000)
        ) {
          return false
        }
        performanceRef.current = { directive, startedAtMs: directiveStartedAt }
        schedulePerformanceBody(directive, directiveStartedAt, playerRef.current)
        return true
      },
      stopMotionPlan() {
        clearCueTimers()
        playerRef.current?.stopPerformance()
        baselineRef.current = null
        performanceRef.current = null
        performanceGateRef.current.reset()
        if (playerRef.current) applyPerformanceDriver(playerRef.current)
      },
      captureFrame() {
        return playerRef.current?.captureFrame() ?? null
      },
      setDriver(partial) {
        enterManualControl()
        speechMouthFormRef.current = updatedSpeechMouthFormBaseline(
          speechMouthFormRef.current,
          speechActiveRef.current,
          partial.mouthForm,
        )
        playerRef.current?.setTarget(partial)
      },
      replaceDriver(driver) {
        enterManualControl()
        speechMouthFormRef.current = updatedSpeechMouthFormBaseline(
          speechMouthFormRef.current,
          speechActiveRef.current,
          driver.mouthForm,
        )
        playerRef.current?.replaceTarget(driver)
      },
      resetDriver() {
        clearCueTimers()
        playerRef.current?.stopPerformance()
        baselineRef.current = null
        performanceRef.current = null
        performanceGateRef.current.reset()
        manualRef.current = false
        playerRef.current?.replaceTarget({ ...IDENTITY_DRIVER })
        if (playerRef.current) applyDriver(playerRef.current)
      },
      getDriver() {
        return playerRef.current?.getTarget() ?? null
      },
      blinkNow() {
        playerRef.current?.blinkNow()
      },
      debugSnapshot() {
        return playerRef.current?.debugSnapshot() ?? null
      },
      setMouse(x, y, inside) {
        playerRef.current?.setMouse(x, y, inside)
      },
    }))

    useEffect(() => {
      const canvas = canvasRef.current
      const wrapper = wrapperRef.current
      if (!canvas || !wrapper) return undefined
      const player = new Anime25DPlayer(canvas, playback, manifest)
      playerRef.current = player
      player.setSpeechActive(speechActiveRef.current)
      if (performanceRef.current) {
        player.playPerformance(
          performanceRef.current.directive,
          performanceRef.current.startedAtMs / 1_000,
        )
        schedulePerformanceBody(
          performanceRef.current.directive,
          performanceRef.current.startedAtMs,
          player,
        )
      }
      applyDriver(player)
      let frame = 0
      let last = performance.now()
      let cancelled = false
      const onPointerMove = (event: PointerEvent) => {
        const bounds = canvas.getBoundingClientRect()
        if (bounds.width <= 0 || bounds.height <= 0) return
        player.setMouse(
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          ((event.clientY - bounds.top) / bounds.height) * 2 - 1,
          true,
        )
      }
      const onPointerLeave = () => {
        player.setMouse(0, 0, false)
      }
      canvas.addEventListener('pointermove', onPointerMove)
      canvas.addEventListener('pointerleave', onPointerLeave)
      const resize = () => {
        const rect = wrapper.getBoundingClientRect()
        player.resize(rect.width, rect.height, window.devicePixelRatio || 1)
      }
      const tick = (now: number) => {
        if (cancelled) return
        player.tick((now - last) / 1000)
        last = now
        frame = window.requestAnimationFrame(tick)
      }
      const observer = new ResizeObserver(resize)
      observer.observe(wrapper)
      resize()
      void player.loadAtlas(atlasUrl).then(() => {
        if (cancelled) return
        readyRef.current = true
        wrapper.classList.add('is-ready')
        frame = window.requestAnimationFrame(tick)
      })
      return () => {
        cancelled = true
        clearCueTimers()
        window.cancelAnimationFrame(frame)
        observer.disconnect()
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerleave', onPointerLeave)
        player.dispose()
        playerRef.current = null
        wrapper.classList.remove('is-ready')
      }
    }, [atlasUrl, manifest, playback])

    useEffect(() => {
      if (manualRef.current || manualControl) return
      if (playerRef.current) applyDriver(playerRef.current)
    }, [activity, mood, manualControl])

    return (
      <span
        ref={wrapperRef}
        className="merope-rig"
        data-rig-quality="layered-2d"
        data-runtime="Anime2.5DRig"
      >
        <img src={fallbackUrl} alt="" draggable={false} />
        <canvas ref={canvasRef} aria-hidden />
      </span>
    )
  },
)

export default Anime25DCharacter
