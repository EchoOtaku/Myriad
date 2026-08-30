import type {
  PerformanceBaseline,
  PerformanceDirective,
} from '../../../services/agent/types'
import type { MotionChannelPolicy } from '../motion/policy'
import type { SpeechArticulation } from '../rig/articulation'
import type { MeropeRigManifest } from '../rig/types'
import type { SingingSpectrumDrive } from '../singing/singingGroove'
import type { MeropeActivity } from '../types'
import type { Anime25DDriver } from './driver'
import type { Anime25DDebugSnapshot } from './player'
import type { Anime25DPlayback } from './types'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
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
import { Anime25DPlayer } from './player'
import { shouldAnimateAnime25D } from './runtimePolicy'
import {
  speechArticulationDriverPatch,
  speechEnergyDriverPatch,
  updatedSpeechMouthFormBaseline,
} from './speechDriver'

interface Props {
  activity: MeropeActivity
  manifest: MeropeRigManifest
  playback: Anime25DPlayback
  atlasUrl: string
  mood: number
  /** Settings page: sliders own the base pose; live acting stays additive. */
  manualControl?: boolean
  onPlaybackError?: (error: unknown) => void
}

export interface Anime25DCharacterHandle {
  setSpeechActive: (active: boolean) => void
  setSinging: (active: boolean) => void
  setSingingSpectrum: (drive: SingingSpectrumDrive | null) => void
  setAutoSpeech: (active: boolean) => void
  setSpeechEnergy: (energy: number | null) => void
  setSpeechArticulation: (articulation: SpeechArticulation) => void
  enqueueSpeechText: (text: string, locale?: string) => void
  playMotionPlan: (
    performance: PerformanceDirective,
    startedAtMs?: number,
  ) => boolean
  stopMotionPlan: () => void
  setDriver: (partial: Partial<Anime25DDriver>) => void
  replaceDriver: (driver: Anime25DDriver) => void
  blinkNow: () => void
  debugSnapshot: () => Anime25DDebugSnapshot | null
  setMotionPolicy: (policy: MotionChannelPolicy) => void
}

const Anime25DCharacter = forwardRef<Anime25DCharacterHandle, Props>(
  (
    {
      activity,
      manifest,
      playback,
      atlasUrl,
      mood,
      manualControl = false,
      onPlaybackError,
    },
    ref,
  ) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const playerRef = useRef<Anime25DPlayer | null>(null)
    const readyRef = useRef(false)
    const [ready, setReady] = useState(false)
    const wrapperRef = useRef<HTMLSpanElement>(null)
    const activityRef = useRef(activity)
    const moodRef = useRef(mood)
    const speechActiveRef = useRef(false)
    const singingActiveRef = useRef(false)
    const singingSpectrumRef = useRef<SingingSpectrumDrive | null>(null)
    const motionPolicyRef = useRef<MotionChannelPolicy | null>(null)
    const speechMouthFormRef = useRef(0)
    const pendingSpeechTextRef = useRef<
      Array<{ text: string; locale?: string }>
    >([])
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
      const policy = player.getMotionPolicy()
      if (policy.headBody !== 'performance') {
        player.setTarget({ thinking: activityRef.current === 'thinking' })
        return
      }
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
      const policy = player.getMotionPolicy()
      const thinking = currentActivity === 'thinking'
      const expressionFree =
        policy.expression === 'idle' ||
        policy.expression === 'mood' ||
        policy.expression === 'ambient'
      const mouthFree =
        policy.mouth === 'idle' || policy.mouth === 'mood'
      const headFree =
        policy.headBody === 'idle' || policy.headBody === 'ambient'
      player.setTarget({
        ...(expressionFree ? activityExpressionDriverPatch(thinking) : {}),
        ...(headFree
          ? performanceRestDriverPatch(baselineRef.current, thinking)
          : { thinking }),
        ...(mouthFree
          ? idleSpeechDriverPatch(moodRef.current, speechActiveRef.current)
          : {}),
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
        const timer = window.setTimeout(
          () => {
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
              if (restoreTimerRef.current !== null)
                window.clearTimeout(restoreTimerRef.current)
              activePriorityRef.current = priority
              activeUntilRef.current = now + duration
              const headOwned =
                playerRef.current?.getMotionPolicy().headBody === 'performance'
              playerRef.current?.setTarget({
                ...(headOwned
                  ? {
                      ...performanceRestDriverPatch(
                        baselineRef.current,
                        activityRef.current === 'thinking',
                      ),
                      rand: false,
                    }
                  : { thinking: activityRef.current === 'thinking' }),
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
          },
          Math.max(0, scheduledStartAt - performance.now()),
        )
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
      setSinging(active) {
        singingActiveRef.current = active
        playerRef.current?.setSinging(active)
      },
      setSingingSpectrum(drive) {
        singingSpectrumRef.current = drive
        playerRef.current?.setSingingSpectrum(drive)
      },
      setAutoSpeech(active) {
        if (!active) playerRef.current?.clearSpeechText()
        playerRef.current?.setTarget({
          talk: active,
          mouthOpen: 0,
          mouthWide: 0,
          mouthRound: 0,
          mouthNarrow: 0,
          mouthSeal: 0,
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
      enqueueSpeechText(text, locale) {
        if (playerRef.current) {
          playerRef.current.enqueueSpeechText(text, locale)
        } else {
          pendingSpeechTextRef.current.push({ text, locale })
        }
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
          !playerRef.current.playPerformance(
            directive,
            directiveStartedAt / 1_000,
          )
        ) {
          return false
        }
        performanceRef.current = { directive, startedAtMs: directiveStartedAt }
        schedulePerformanceBody(
          directive,
          directiveStartedAt,
          playerRef.current,
        )
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
      blinkNow() {
        playerRef.current?.blinkNow()
      },
      debugSnapshot() {
        return playerRef.current?.debugSnapshot() ?? null
      },
      setMotionPolicy(policy) {
        motionPolicyRef.current = policy
        playerRef.current?.setMotionPolicy(policy)
      },
    }))

    useEffect(() => {
      const canvas = canvasRef.current
      const wrapper = wrapperRef.current
      if (!canvas || !wrapper) return undefined
      let player: Anime25DPlayer
      try {
        player = new Anime25DPlayer(canvas, playback, manifest)
      } catch (error) {
        readyRef.current = false
        setReady(false)
        onPlaybackError?.(error)
        return undefined
      }
      playerRef.current = player
      player.setSpeechActive(speechActiveRef.current)
      player.setSinging(singingActiveRef.current)
      player.setSingingSpectrum(singingSpectrumRef.current)
      if (motionPolicyRef.current) player.setMotionPolicy(motionPolicyRef.current)
      for (const chunk of pendingSpeechTextRef.current) {
        player.enqueueSpeechText(chunk.text, chunk.locale)
      }
      pendingSpeechTextRef.current = []
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
      let atlasReady = false
      let pageVisible = document.visibilityState !== 'hidden'
      let inViewport = true
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
        frame = 0
        if (cancelled || !atlasReady || !pageVisible || !inViewport) return
        player.tick((now - last) / 1000)
        last = now
        frame = window.requestAnimationFrame(tick)
      }
      const syncAnimation = () => {
        const shouldRun = shouldAnimateAnime25D({
          atlasReady,
          pageVisible,
          inViewport,
          cancelled,
        })
        if (!shouldRun) {
          if (frame !== 0) window.cancelAnimationFrame(frame)
          frame = 0
          return
        }
        if (frame !== 0) return
        last = performance.now()
        frame = window.requestAnimationFrame(tick)
      }
      const onVisibilityChange = () => {
        pageVisible = document.visibilityState !== 'hidden'
        syncAnimation()
      }
      const observer = new ResizeObserver(resize)
      observer.observe(wrapper)
      const viewportObserver =
        typeof IntersectionObserver === 'undefined'
          ? null
          : new IntersectionObserver((entries) => {
              inViewport = entries.some((entry) => entry.isIntersecting)
              syncAnimation()
            })
      viewportObserver?.observe(wrapper)
      document.addEventListener('visibilitychange', onVisibilityChange)
      resize()
      void player
        .loadAtlas(atlasUrl)
        .then(() => {
          if (cancelled) return
          atlasReady = true
          readyRef.current = true
          setReady(true)
          syncAnimation()
        })
        .catch((error: unknown) => {
          if (cancelled) return
          atlasReady = false
          readyRef.current = false
          setReady(false)
          onPlaybackError?.(error)
        })
      return () => {
        cancelled = true
        clearCueTimers()
        window.cancelAnimationFrame(frame)
        observer.disconnect()
        viewportObserver?.disconnect()
        document.removeEventListener('visibilitychange', onVisibilityChange)
        canvas.removeEventListener('pointermove', onPointerMove)
        canvas.removeEventListener('pointerleave', onPointerLeave)
        player.dispose()
        playerRef.current = null
        readyRef.current = false
        setReady(false)
      }
    }, [atlasUrl, manifest, onPlaybackError, playback])

    useEffect(() => {
      if (manualRef.current || manualControl) return
      if (playerRef.current) applyDriver(playerRef.current)
    }, [activity, mood, manualControl])

    return (
      <span
        ref={wrapperRef}
        className={ready ? 'merope-rig is-ready' : 'merope-rig'}
        data-rig-quality="layered-2d"
        data-runtime="Anime2.5DRig"
      >
        <canvas ref={canvasRef} aria-hidden />
      </span>
    )
  },
)

export default Anime25DCharacter
