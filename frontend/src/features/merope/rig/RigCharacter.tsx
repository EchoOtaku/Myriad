import type { PerformanceDirective } from '../../../services/agent/types'
import type { Anime25DCharacterHandle } from '../anime25drig/Anime25DCharacter'
import type { Anime25DDriver } from '../anime25drig/driver'
import type { Anime25DDebugSnapshot } from '../anime25drig/player'
import type { MotionChannelPolicy } from '../motion/policy'
import type { SingingSpectrumDrive } from '../singing/singingGroove'
import type { MeropeActivity } from '../types'
import type { SpeechArticulation } from './articulation'
import type { GazeSource, GazeTarget } from './motion'
import type { MeropeRigManifest } from './types'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import Anime25DCharacter from '../anime25drig/Anime25DCharacter'
import {
  anime25DRuntimeKey,
  shouldUseAnime25DRuntime,
} from '../anime25drig/runtimePolicy'
import { isAnime25DPlayback } from '../anime25drig/types'

interface Props {
  activity: MeropeActivity
  fallbackUrl?: string | null
  manifest: MeropeRigManifest | null
  mood: number
  manualControl?: boolean
}

export interface RigCharacterHandle {
  setSpeechActive: (active: boolean) => void
  setSinging: (active: boolean) => void
  setSingingSpectrum: (drive: SingingSpectrumDrive | null) => void
  setAutoSpeech: (active: boolean) => void
  setSpeechEnergy: (energy: number | null) => void
  setSpeechArticulation: (articulation: SpeechArticulation) => void
  enqueueSpeechText: (text: string, locale?: string) => void
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
  setMotionPolicy: (policy: MotionChannelPolicy) => void
}

const RigCharacter = forwardRef<RigCharacterHandle, Props>(
  ({ activity, fallbackUrl, manifest, mood, manualControl = false }, ref) => {
    const animeRef = useRef<Anime25DCharacterHandle>(null)
    const speechActiveRef = useRef(false)
    const singingActiveRef = useRef(false)
    const singingSpectrumRef = useRef<SingingSpectrumDrive | null>(null)
    const motionPolicyRef = useRef<MotionChannelPolicy | null>(null)
    const pendingSpeechTextRef = useRef<
      Array<{ text: string; locale?: string }>
    >([])
    const latestPerformanceRef = useRef<{
      directive: PerformanceDirective
      startedAtMs: number
    } | null>(null)
    const latestSpeechRef = useRef<
      | { kind: 'auto'; active: boolean }
      | { kind: 'energy'; energy: number | null }
      | { kind: 'articulation'; articulation: SpeechArticulation }
    >({ kind: 'auto', active: false })
    const playback =
      manifest?.anime25dPlayback &&
      isAnime25DPlayback(manifest.anime25dPlayback)
        ? manifest.anime25dPlayback
        : null
    const atlasUrl = manifest?.textures[0]?.url || ''
    const runtimeKey = anime25DRuntimeKey(
      manifest?.sourceMasterAssetId,
      manifest?.characterAssetContractVersion,
      atlasUrl,
    )
    const [failedRuntimeKey, setFailedRuntimeKey] = useState<string | null>(
      null,
    )
    const handlePlaybackError = useCallback(() => {
      setFailedRuntimeKey(runtimeKey)
    }, [runtimeKey])

    useEffect(() => {
      animeRef.current?.setSpeechActive(speechActiveRef.current)
      animeRef.current?.setSinging(singingActiveRef.current)
      animeRef.current?.setSingingSpectrum(singingSpectrumRef.current)
      if (motionPolicyRef.current) {
        animeRef.current?.setMotionPolicy(motionPolicyRef.current)
      }
      const latest = latestSpeechRef.current
      if (latest.kind === 'auto') {
        animeRef.current?.setAutoSpeech(latest.active)
      } else if (latest.kind === 'energy') {
        animeRef.current?.setSpeechEnergy(latest.energy)
      } else {
        animeRef.current?.setSpeechArticulation(latest.articulation)
      }
      for (const chunk of pendingSpeechTextRef.current) {
        animeRef.current?.enqueueSpeechText(chunk.text, chunk.locale)
      }
      pendingSpeechTextRef.current = []
      if (latestPerformanceRef.current) {
        animeRef.current?.playMotionPlan(
          latestPerformanceRef.current.directive,
          latestPerformanceRef.current.startedAtMs,
        )
      }
    }, [atlasUrl, playback])

    useImperativeHandle(ref, () => ({
      setSpeechActive: (active) => {
        speechActiveRef.current = active
        animeRef.current?.setSpeechActive(active)
      },
      setSinging: (active) => {
        singingActiveRef.current = active
        animeRef.current?.setSinging(active)
      },
      setSingingSpectrum: (drive) => {
        singingSpectrumRef.current = drive
        animeRef.current?.setSingingSpectrum(drive)
      },
      setAutoSpeech: (active) => {
        latestSpeechRef.current = { kind: 'auto', active }
        animeRef.current?.setAutoSpeech(active)
      },
      setSpeechEnergy: (energy) => {
        latestSpeechRef.current = { kind: 'energy', energy }
        animeRef.current?.setSpeechEnergy(energy)
      },
      setSpeechArticulation: (articulation) => {
        latestSpeechRef.current = { kind: 'articulation', articulation }
        animeRef.current?.setSpeechArticulation(articulation)
      },
      enqueueSpeechText: (text, locale) => {
        if (animeRef.current) {
          animeRef.current.enqueueSpeechText(text, locale)
        } else {
          pendingSpeechTextRef.current.push({ text, locale })
        }
      },
      setGazeTarget: (target, source) =>
        animeRef.current?.setGazeTarget(target, source),
      playMotionPlan: (directive, startedAtMs) => {
        const started = startedAtMs ?? window.performance.now()
        const accepted =
          animeRef.current?.playMotionPlan(directive, started) ?? true
        if (!accepted) return false
        latestPerformanceRef.current = { directive, startedAtMs: started }
        return true
      },
      stopMotionPlan: () => {
        latestPerformanceRef.current = null
        animeRef.current?.stopMotionPlan()
      },
      captureFrame: () => animeRef.current?.captureFrame() ?? null,
      setDriver: (partial) => animeRef.current?.setDriver(partial),
      replaceDriver: (driver) => animeRef.current?.replaceDriver(driver),
      resetDriver: () => {
        latestPerformanceRef.current = null
        animeRef.current?.resetDriver()
      },
      getDriver: () => animeRef.current?.getDriver() ?? null,
      blinkNow: () => animeRef.current?.blinkNow(),
      debugSnapshot: () => animeRef.current?.debugSnapshot() ?? null,
      setMouse: (x, y, inside) => animeRef.current?.setMouse(x, y, inside),
      setMotionPolicy: (policy) => {
        motionPolicyRef.current = policy
        animeRef.current?.setMotionPolicy(policy)
      },
    }))

    if (
      shouldUseAnime25DRuntime({
        hasManifest: Boolean(manifest),
        hasPlayback: Boolean(playback),
        atlasUrl,
        runtimeKey,
        failedRuntimeKey,
      }) &&
      manifest &&
      playback
    ) {
      return (
        <Anime25DCharacter
          ref={animeRef}
          activity={activity}
          manifest={manifest}
          playback={playback}
          atlasUrl={atlasUrl}
          mood={mood}
          manualControl={manualControl}
          onPlaybackError={handlePlaybackError}
        />
      )
    }

    if (!fallbackUrl) return null

    return (
      <span className="merope-rig is-ready" data-rig-quality="static">
        <img src={fallbackUrl} alt="" draggable={false} />
      </span>
    )
  },
)

export default RigCharacter
