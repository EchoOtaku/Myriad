import type { SpeechArticulation, SpeechViseme } from '../rig/articulation'
import type { SpeechSegment } from './speechSegmenter'

export interface TtsPlayHooks {
  onEnergy: (energy: number, articulation: SpeechArticulation) => void
  onEnded: () => void
}

export interface TtsPlayHandle {
  stop: () => void
}

const FFT = 256

/**
 * Plays a TTS buffer through WebAudio. Energy and visemes come from the
 * actual audio; the caller must not fall back to text visemes while this runs.
 */
export function playTtsBuffer(
  audio: ArrayBuffer,
  _segment: SpeechSegment,
  hooks: TtsPlayHooks,
): TtsPlayHandle {
  if (typeof AudioContext === 'undefined') {
    queueMicrotask(hooks.onEnded)
    return { stop() {} }
  }
  const ctx = speechAudioContext()
  let source: AudioBufferSourceNode | null = null
  let analyser: AnalyserNode | null = null
  let raf = 0
  let stopped = false

  const stop = (): void => {
    if (stopped) return
    stopped = true
    if (raf) cancelAnimationFrame(raf)
    try {
      source?.stop()
    } catch {
      // already stopped
    }
    source?.disconnect()
    analyser?.disconnect()
    source = null
    analyser = null
  }

  void ctx
    .decodeAudioData(audio.slice(0))
    .then((decoded) => {
      if (stopped) return
      analyser = ctx.createAnalyser()
      analyser.fftSize = FFT
      source = ctx.createBufferSource()
      source.buffer = decoded
      source.connect(analyser)
      analyser.connect(ctx.destination)
      const bins = new Uint8Array(analyser.fftSize)
      const tick = (): void => {
        if (stopped || !analyser) return
        analyser.getByteTimeDomainData(bins)
        const sample = sampleMouth(bins)
        hooks.onEnergy(sample.energy ?? 0, sample)
        raf = requestAnimationFrame(tick)
      }
      source.onended = () => {
        stop()
        hooks.onEnded()
      }
      if (ctx.state === 'suspended') void ctx.resume()
      source.start()
      tick()
    })
    .catch(() => {
      stop()
      hooks.onEnded()
    })

  return { stop }
}

let sharedContext: AudioContext | null = null

function speechAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new AudioContext()
  }
  return sharedContext
}

export function sampleMouth(bins: Uint8Array): SpeechArticulation {
  let sum = 0
  for (let i = 0; i < bins.length; i++) {
    const centered = (bins[i]! - 128) / 128
    sum += centered * centered
  }
  const energy = Math.min(1, Math.sqrt(sum / Math.max(1, bins.length)) * 2.4)
  return {
    energy,
    viseme: visemeFromEnergy(energy),
    amount: energy,
  }
}

function visemeFromEnergy(energy: number): SpeechViseme {
  if (energy < 0.06) return 'rest'
  if (energy < 0.14) return 'narrow'
  if (energy < 0.28) return 'open'
  if (energy < 0.44) return 'round'
  return 'wide'
}
