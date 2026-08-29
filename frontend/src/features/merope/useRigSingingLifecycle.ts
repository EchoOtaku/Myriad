import type { RefObject } from 'react'
import type { RigCharacterHandle } from './rig/RigCharacter'
import { useEffect, useRef } from 'react'
import { useMusicPlayerControl } from '../../contexts/MusicPlayerContext'
import { applySingingWrite } from './motion/applySnapshot'
import { getMusicMotionSource } from './motion/musicSourceRuntime'

/**
 * Drive one mounted rig from the site-wide music sampler.
 * Mouth writes yield to speech; groove stays unless another source owns head/body.
 */
export function useRigSingingLifecycle(
  rigRef: RefObject<RigCharacterHandle | null>,
): void {
  const { isPlaying, currentSong, lyrics, verbatimLyrics, hasVerbatimLyrics } =
    useMusicPlayerControl()
  const lastSongIdRef = useRef(currentSong?.id ?? '')
  const songId = currentSong?.id ?? ''

  useEffect(() => {
    const source = getMusicMotionSource()
    if (songId && songId !== lastSongIdRef.current) source.markSwitching()
    lastSongIdRef.current = songId
    source.setTrack({
      songId,
      duration: currentSong?.duration,
      verbatim: hasVerbatimLyrics ? verbatimLyrics : undefined,
      lines: lyrics,
    })
  }, [songId, currentSong?.duration, hasVerbatimLyrics, lyrics, verbatimLyrics])

  useEffect(() => {
    getMusicMotionSource().setPlayback(isPlaying, false)
  }, [isPlaying])

  useEffect(() => {
    const source = getMusicMotionSource()
    return source.subscribe((frame) => {
      const rig = rigRef.current
      if (!rig) return
      applySingingWrite(rig, frame.apply, {
        spectrum: frame.spectrum,
        articulation: frame.articulation,
      })
    })
  }, [rigRef])
}
