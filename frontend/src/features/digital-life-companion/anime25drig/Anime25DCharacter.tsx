import type { CompanionActivity } from '../types'
import type { SpeechArticulation } from '../rig/articulation'
import type { GazeSource, GazeTarget } from '../rig/motion'
import type { Anime25DPlayback } from './types'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import {
  Anime25DPlayer,
  IDENTITY_DRIVER,
  type Anime25DDebugSnapshot,
  type Anime25DDriver,
} from './player'

interface Props {
  activity: CompanionActivity
  fallbackUrl: string
  playback: Anime25DPlayback
  atlasUrl: string
  mood: number
}

export interface Anime25DCharacterHandle {
  setSpeechEnergy: (energy: number | null) => void
  setSpeechArticulation: (articulation: SpeechArticulation) => void
  setGazeTarget: (target: GazeTarget | null, source?: GazeSource) => void
  playMotionPlan: () => void
  stopMotionPlan: () => void
  captureFrame: () => string | null
  setDriver: (partial: Partial<Anime25DDriver>) => void
  replaceDriver: (driver: Anime25DDriver) => void
  resetDriver: () => void
  getDriver: () => Anime25DDriver | null
  blinkNow: () => void
  debugSnapshot: () => Anime25DDebugSnapshot | null
}

const Anime25DCharacter = forwardRef<Anime25DCharacterHandle, Props>(
  ({ activity, fallbackUrl, playback, atlasUrl, mood }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const playerRef = useRef<Anime25DPlayer | null>(null)
    const readyRef = useRef(false)
    const wrapperRef = useRef<HTMLSpanElement>(null)
    const activityRef = useRef(activity)
    const moodRef = useRef(mood)
    const manualRef = useRef(false)
    activityRef.current = activity
    moodRef.current = mood

    const applyDriver = (player: Anime25DPlayer) => {
      if (manualRef.current) return
      const currentActivity = activityRef.current
      const smile = Math.max(0, (moodRef.current - 50) / 80)
      player.setTarget({
        talking: currentActivity === 'talking',
        mouth: currentActivity === 'talking' ? 0.42 : smile * 0.12,
        angleY: currentActivity === 'thinking' ? 0.08 : 0,
        lean: currentActivity === 'thinking' ? 0.4 : 0,
      })
    }

    useImperativeHandle(ref, () => ({
      setSpeechEnergy(energy) {
        playerRef.current?.setTarget({
          mouth: energy == null ? 0 : Math.max(0, Math.min(1, energy)),
          talking: energy != null && energy > 0.08,
        })
      },
      setSpeechArticulation(articulation) {
        const openness =
          articulation.viseme === 'closed' || articulation.viseme === 'rest'
            ? 0.08
            : articulation.viseme === 'wide'
              ? 0.92
              : 0.55
        playerRef.current?.setTarget({ mouth: openness, talking: true })
      },
      setGazeTarget(target) {
        playerRef.current?.setTarget({
          angleX: target ? target.x * 0.35 : 0,
          angleY: target ? target.y * 0.28 : 0,
        })
      },
      playMotionPlan() {
        manualRef.current = true
        playerRef.current?.setTarget({
          talking: true,
          mouth: 0.45,
          angleY: -0.08,
          bust: 0.18,
        })
      },
      stopMotionPlan() {
        playerRef.current?.setTarget({
          mouth: 0,
          talking: false,
          armY: 0,
          armPos: 0,
          bust: 0,
        })
      },
      captureFrame() {
        return playerRef.current?.captureFrame() ?? null
      },
      setDriver(partial) {
        manualRef.current = true
        playerRef.current?.setTarget(partial)
      },
      replaceDriver(driver) {
        manualRef.current = true
        playerRef.current?.replaceTarget(driver)
      },
      resetDriver() {
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
    }))

    useEffect(() => {
      const canvas = canvasRef.current
      const wrapper = wrapperRef.current
      if (!canvas || !wrapper) return undefined
      const player = new Anime25DPlayer(canvas, playback)
      playerRef.current = player
      applyDriver(player)
      let frame = 0
      let last = performance.now()
      let cancelled = false
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
        window.cancelAnimationFrame(frame)
        observer.disconnect()
        player.dispose()
        playerRef.current = null
        wrapper.classList.remove('is-ready')
      }
    }, [atlasUrl, playback])

    useEffect(() => {
      const smile = Math.max(0, (mood - 50) / 80)
      playerRef.current?.setTarget({
        talking: activity === 'talking',
        mouth: activity === 'talking' ? 0.42 : smile * 0.12,
        angleY: activity === 'thinking' ? 0.08 : 0,
        lean: activity === 'thinking' ? 0.4 : 0,
      })
    }, [activity, mood])

    return (
      <span
        ref={wrapperRef}
        className="dlc-rig"
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
