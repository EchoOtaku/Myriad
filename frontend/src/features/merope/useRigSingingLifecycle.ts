import type { RefObject } from 'react'
import type { RigCharacterHandle } from './rig/RigCharacter'
import type { SingingCue } from './singing/singingTimeline'
import type { SpeechOccupancy } from './speechLifecycle'
import { useEffect, useRef } from 'react'
import { useMusicPlayerControl } from '../../contexts/MusicPlayerContext'
import { isPageVisible, onVisibility } from '../../hooks/animation'
import { audioManager } from '../../utils/musicPlayer'
import {
  restSingingArticulation,
  sampleSingingCue,
  singingArticulation,
  singingVocalEnergy,
} from './singing/singingClock'
import { singingSpectrumDrive } from './singing/singingGroove'
import { singingPlaybackGap } from './singing/singingHold'
import { compileSingingTimeline } from './singing/singingTimeline'

const SAMPLE_INTERVAL_MS = 50
const TRACK_SWITCH_HOLD_MS = 12_000

/** Drive one mounted rig from site music without using the Agent speech event bus. */
export function useRigSingingLifecycle(
  rigRef: RefObject<RigCharacterHandle | null>,
  occupancy?: SpeechOccupancy,
): void {
  const { isPlaying, currentSong, lyrics, verbatimLyrics, hasVerbatimLyrics } =
    useMusicPlayerControl()
  const cuesRef = useRef<SingingCue[]>([])
  const hummingRef = useRef(true)
  const ownedRef = useRef(false)
  const connectedRef = useRef(false)
  const generationRef = useRef(0)
  const lyricsRef = useRef(lyrics)
  const verbatimRef = useRef(verbatimLyrics)
  const lastSongIdRef = useRef(currentSong?.id ?? '')
  const switchingRef = useRef(false)
  lyricsRef.current = lyrics
  verbatimRef.current = verbatimLyrics

  const songId = currentSong?.id ?? ''
  const timelineKey = [
    songId,
    currentSong?.duration ?? 0,
    hasVerbatimLyrics ? 'v' : 'l',
    hasVerbatimLyrics ? verbatimLyrics.length : lyrics.length,
    hasVerbatimLyrics ? verbatimLyrics[0]?.time : lyrics[0]?.time,
    hasVerbatimLyrics
      ? verbatimLyrics[verbatimLyrics.length - 1]?.time
      : lyrics[lyrics.length - 1]?.time,
  ].join(':')

  useEffect(() => {
    if (songId && songId !== lastSongIdRef.current && ownedRef.current) {
      switchingRef.current = true
    }
    lastSongIdRef.current = songId
  }, [songId])

  useEffect(() => {
    if (isPlaying) switchingRef.current = false
  }, [isPlaying])

  useEffect(() => {
    const generation = ++generationRef.current
    if (!songId) {
      cuesRef.current = []
      hummingRef.current = true
      return
    }
    void compileSingingTimeline({
      verbatim: hasVerbatimLyrics ? verbatimRef.current : undefined,
      lines: lyricsRef.current,
      songDuration: currentSong?.duration,
    }).then((cues) => {
      if (generation !== generationRef.current) return
      cuesRef.current = cues
      hummingRef.current = cues.length === 0
    })
    return () => {
      generationRef.current += 1
    }
  }, [songId, currentSong?.duration, hasVerbatimLyrics, timelineKey])

  useEffect(() => {
    let cancelled = false
    let frame = 0
    let lastSample = 0
    let holdUntil = 0
    const pageVisible = { current: isPageVisible() }

    const releaseMouth = () => {
      if (!ownedRef.current) return
      ownedRef.current = false
      switchingRef.current = false
      const rig = rigRef.current
      if (!rig) return
      rig.setSinging(false)
      rig.setSingingSpectrum(null)
      if (occupancy?.current) return
      rig.setSpeechArticulation(restSingingArticulation())
      rig.setSpeechActive(false)
    }

    const apply = (timestamp: number) => {
      if (cancelled) return
      if (!pageVisible.current) {
        frame = 0
        holdUntil = 0
        releaseMouth()
        return
      }
      const gap = singingPlaybackGap(isPlaying, switchingRef.current)
      if (gap === 'stop') {
        frame = 0
        holdUntil = 0
        releaseMouth()
        return
      }
      if (gap === 'hold') {
        if (!holdUntil) holdUntil = timestamp + TRACK_SWITCH_HOLD_MS
        if (timestamp >= holdUntil) {
          holdUntil = 0
          switchingRef.current = false
          frame = 0
          releaseMouth()
          return
        }
        const rig = rigRef.current
        if (ownedRef.current && rig) {
          rig.setSpeechArticulation(restSingingArticulation())
        }
        frame = requestAnimationFrame(apply)
        return
      }
      holdUntil = 0
      if (timestamp - lastSample >= SAMPLE_INTERVAL_MS) {
        lastSample = timestamp
        sample(rigRef, occupancy, cuesRef, hummingRef, ownedRef, connectedRef)
      }
      frame = requestAnimationFrame(apply)
    }

    const start = () => {
      if (cancelled || frame) return
      if (!pageVisible.current) return
      const gap = singingPlaybackGap(isPlaying, switchingRef.current)
      if (gap === 'stop' && !ownedRef.current) return
      frame = requestAnimationFrame(apply)
    }

    const stop = () => {
      if (!frame) {
        return
      }
      cancelAnimationFrame(frame)
      frame = 0
    }

    const unsubscribe = onVisibility((visible) => {
      pageVisible.current = visible
      if (visible) {
        start()
      } else {
        stop()
        holdUntil = 0
        releaseMouth()
      }
    })

    start()
    return () => {
      cancelled = true
      unsubscribe()
      stop()
    }
  }, [isPlaying, occupancy, rigRef, songId])

  useEffect(() => {
    return () => {
      ownedRef.current = false
      switchingRef.current = false
      connectedRef.current = false
      const rig = rigRef.current
      if (!rig) return
      rig.setSinging(false)
      rig.setSingingSpectrum(null)
      if (occupancy?.current) return
      rig.setSpeechArticulation(restSingingArticulation())
      rig.setSpeechActive(false)
    }
  }, [occupancy, rigRef])
}

function sample(
  rigRef: RefObject<RigCharacterHandle | null>,
  occupancy: SpeechOccupancy | undefined,
  cuesRef: RefObject<SingingCue[]>,
  hummingRef: RefObject<boolean>,
  ownedRef: { current: boolean },
  connectedRef: { current: boolean },
): void {
  const rig = rigRef.current
  if (!rig) return
  if (occupancy?.current) {
    if (ownedRef.current) {
      ownedRef.current = false
      rig.setSinging(false)
      rig.setSingingSpectrum(null)
    }
    return
  }

  const audio = audioManager.getCurrentAudio()
  if (!audio || audio.paused) {
    if (!ownedRef.current) return
    rig.setSpeechArticulation(restSingingArticulation())
    return
  }

  if (!connectedRef.current) {
    connectedRef.current = audioManager.connectAudioToAnalyser(audio)
  }

  const time = Number.isFinite(audio.currentTime) ? audio.currentTime : 0
  const bands = audioManager.getSpectrumBands()
  const energy = singingVocalEnergy(bands)
  const hasSpectrum = bands.some((band) => band > 0.01)
  const humming = hummingRef.current
  const cue = humming ? null : sampleSingingCue(cuesRef.current, time)
  const articulation = singingArticulation({
    cue,
    energy: hasSpectrum ? energy : null,
    humming,
  })

  if (!ownedRef.current) {
    ownedRef.current = true
    rig.setSpeechActive(true)
    rig.setSinging(true)
  }
  rig.setSingingSpectrum(hasSpectrum ? singingSpectrumDrive(bands) : null)
  rig.setSpeechArticulation(articulation)
}
