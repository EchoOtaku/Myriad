import { useEffect, useRef } from 'react'
import { useMusicPlayerControl } from '../../contexts/MusicPlayerContext'
import { getMusicMotionSource } from './motion/musicSourceRuntime'

/**
 * Bind site playback to the global music sampler. Frames are consumed
 * through MotionRuntime, not written here.
 */
export function useRigSingingLifecycle(): void {
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
}
