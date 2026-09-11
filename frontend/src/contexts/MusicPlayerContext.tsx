import type { ReactNode } from 'react'
import type {
  LyricLine,
  Song,
  VerbatimLyricsSource,
  WordLyricLine,
} from '../utils/musicPlayer'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import { bindMusicMoodListening } from '../features/merope/musicMood'
import { pickMusicContextState } from '../utils/musicPlayerState'
import {
  applyPublishedMusicState,
  bindPublishedMusicState,
  setCurrentSongSnapshot,
} from './currentSong'

export {
  applyPublishedMusicState,
  getCurrentSong,
  subscribeCurrentSong,
} from './currentSong'

interface MusicPlayerState {
  currentSong: Song | null
  isEnabled: boolean
  isPlaying: boolean
  musicColor: string
  isTempPlay: boolean
  currentSongIndex: number
  playlistLength: number
  playlist: Song[]
  lyrics: LyricLine[]
  verbatimLyrics: WordLyricLine[]
  hasVerbatimLyrics: boolean
  verbatimLyricsSource: VerbatimLyricsSource
  currentLyricIndex: number
}

interface MusicPlayerContextType extends MusicPlayerState {
  playSong: (song: Song) => void
  togglePlayPause: () => void
  stopTempPlay: () => void
  updateState: (state: Partial<MusicPlayerState>) => void
}

const MusicPlayerContext = createContext<MusicPlayerContextType | null>(null)

export function MusicPlayerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MusicPlayerState>({
    currentSong: null,
    isEnabled: false,
    isPlaying: false,
    musicColor: '#ef4444',
    isTempPlay: false,
    currentSongIndex: 0,
    playlistLength: 0,
    playlist: [],
    lyrics: [],
    verbatimLyrics: [],
    hasVerbatimLyrics: false,
    verbatimLyricsSource: '',
    currentLyricIndex: -1,
  })

  useEffect(() => bindMusicMoodListening(), [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const globalState = (window as any).__musicPlayerState
      if (globalState) {
        applyPublishedMusicState(globalState)
        setState({
          currentSong: globalState.currentSong || null,
          isEnabled: globalState.isEnabled || false,
          isPlaying: globalState.isPlaying || false,
          musicColor: globalState.musicColor || '#ef4444',
          isTempPlay: globalState.isTempPlay || false,
          currentSongIndex: globalState.currentSongIndex || 0,
          playlistLength: globalState.playlistLength || 0,
          playlist: globalState.playlist || [],
          lyrics: globalState.lyrics || [],
          verbatimLyrics: globalState.verbatimLyrics || [],
          hasVerbatimLyrics: globalState.hasVerbatimLyrics || false,
          verbatimLyricsSource: globalState.verbatimLyricsSource || '',
          currentLyricIndex: globalState.currentLyricIndex ?? -1,
        })
      }
    }
  }, [])

  // Merge by field: detail may be partial; a full setState would wipe lyrics/isPlaying.
  useEffect(() => {
    const handleMusicStateChange = (e: Event) => {
      const detail = (e as CustomEvent).detail as
        Record<string, unknown> | undefined
      if (!detail) return

      applyPublishedMusicState(detail)
      setState((prev) => ({
        ...prev,
        ...(pickMusicContextState(detail) as Partial<MusicPlayerState>),
      }))
    }

    window.addEventListener('music-player-state-change', handleMusicStateChange)
    return () => {
      window.removeEventListener(
        'music-player-state-change',
        handleMusicStateChange,
      )
    }
  }, [])

  const updateState = useCallback((newState: Partial<MusicPlayerState>) => {
    setState((prev) => ({ ...prev, ...newState }))
  }, [])

  const playSong = useCallback((song: Song) => {
    window.dispatchEvent(new CustomEvent('play-song', { detail: { song } }))
  }, [])

  const togglePlayPause = useCallback(() => {
    window.dispatchEvent(new CustomEvent('toggle-play-pause'))
  }, [])

  const stopTempPlay = useCallback(() => {
    window.dispatchEvent(new CustomEvent('stop-temp-play'))
  }, [])

  const value = useMemo(
    () => ({
      ...state,
      playSong,
      togglePlayPause,
      stopTempPlay,
      updateState,
    }),
    [state, playSong, togglePlayPause, stopTempPlay, updateState],
  )

  return (
    <MusicPlayerContext.Provider value={value}>
      {children}
    </MusicPlayerContext.Provider>
  )
}

export function useMusicPlayerControl() {
  const context = useContext(MusicPlayerContext)

  if (!context) {
    console.warn(
      'MusicPlayerProvider not found, using fallback event-based approach',
    )
    return useFallbackMusicPlayerControl()
  }

  return context
}

let globalMusicState: MusicPlayerState = {
  currentSong: null,
  isEnabled: false,
  isPlaying: false,
  musicColor: '#ef4444',
  isTempPlay: false,
  currentSongIndex: 0,
  playlistLength: 0,
  playlist: [],
  lyrics: [],
  verbatimLyrics: [],
  hasVerbatimLyrics: false,
  verbatimLyricsSource: '',
  currentLyricIndex: -1,
}

const musicStateListeners = new Set<() => void>()
let isMusicEventListenerAttached = false

function emitMusicStateChange() {
  musicStateListeners.forEach((listener) => listener())
}

function subscribeMusicState(listener: () => void) {
  musicStateListeners.add(listener)
  if (typeof window !== 'undefined') {
    const currentState = (window as any).__musicPlayerState
    if (currentState) {
      globalMusicState = { ...globalMusicState, ...currentState }
      setCurrentSongSnapshot(globalMusicState.currentSong)
    }
  }
  attachMusicEventListener()
  return () => {
    musicStateListeners.delete(listener)
    if (musicStateListeners.size === 0) {
      detachMusicEventListener()
    }
  }
}

function getMusicStateSnapshot() {
  return globalMusicState
}

/** useMusicPlayer owns __musicPlayerState; do not write currentTime:0 / sparse patches back. */
function updateGlobalMusicState(newState: Partial<MusicPlayerState>) {
  const next = { ...globalMusicState, ...newState }
  const changed =
    next.currentSong !== globalMusicState.currentSong ||
    next.isEnabled !== globalMusicState.isEnabled ||
    next.isPlaying !== globalMusicState.isPlaying ||
    next.musicColor !== globalMusicState.musicColor ||
    next.isTempPlay !== globalMusicState.isTempPlay ||
    next.currentSongIndex !== globalMusicState.currentSongIndex ||
    next.playlistLength !== globalMusicState.playlistLength ||
    next.playlist !== globalMusicState.playlist ||
    next.lyrics !== globalMusicState.lyrics ||
    next.verbatimLyrics !== globalMusicState.verbatimLyrics ||
    next.hasVerbatimLyrics !== globalMusicState.hasVerbatimLyrics ||
    next.verbatimLyricsSource !== globalMusicState.verbatimLyricsSource ||
    next.currentLyricIndex !== globalMusicState.currentLyricIndex

  if (!changed) return
  globalMusicState = next
  setCurrentSongSnapshot(next.currentSong)
  emitMusicStateChange()
}

function handleGlobalMusicStateChange(event: Event) {
  const detail = (event as CustomEvent).detail as
    Record<string, unknown> | undefined
  if (!detail) return
  // Ignore host-only fields such as currentTime / musicColors.
  const patch = pickMusicContextState(detail) as Partial<MusicPlayerState>
  updateGlobalMusicState(patch)
}

function attachMusicEventListener() {
  if (isMusicEventListenerAttached || typeof window === 'undefined') return
  window.addEventListener(
    'music-player-state-change',
    handleGlobalMusicStateChange,
  )
  isMusicEventListenerAttached = true
}

function detachMusicEventListener() {
  if (!isMusicEventListenerAttached || typeof window === 'undefined') return
  window.removeEventListener(
    'music-player-state-change',
    handleGlobalMusicStateChange,
  )
  isMusicEventListenerAttached = false
}

if (typeof window !== 'undefined') {
  // Tapp SDK reads spectrum data from window.audioManager.
  import('../utils/musicPlayer').then(({ audioManager }) => {
    ;(window as any).audioManager = audioManager
  })

  const initialState = (window as any).__musicPlayerState
  if (initialState) {
    globalMusicState = { ...globalMusicState, ...initialState }
    applyPublishedMusicState(initialState)
  }
  bindPublishedMusicState()
  attachMusicEventListener()
}

function useFallbackMusicPlayerControl() {
  const state = useSyncExternalStore(
    subscribeMusicState,
    getMusicStateSnapshot,
    getMusicStateSnapshot,
  )

  const playSong = useCallback((song: Song) => {
    window.dispatchEvent(new CustomEvent('play-song', { detail: { song } }))
  }, [])

  const togglePlayPause = useCallback(() => {
    window.dispatchEvent(new CustomEvent('toggle-play-pause'))
  }, [])

  const stopTempPlay = useCallback(() => {
    window.dispatchEvent(new CustomEvent('stop-temp-play'))
  }, [])

  const updateState = useCallback((newState: Partial<MusicPlayerState>) => {
    updateGlobalMusicState(newState)
  }, [])

  return useMemo(
    () => ({
      ...state,
      playSong,
      togglePlayPause,
      stopTempPlay,
      updateState,
    }),
    [state, playSong, togglePlayPause, stopTempPlay, updateState],
  )
}

interface MusicLyricsSlice {
  lyrics: LyricLine[]
  currentLyricIndex: number
}

let lyricsSliceCache: MusicLyricsSlice = {
  lyrics: globalMusicState.lyrics,
  currentLyricIndex: globalMusicState.currentLyricIndex,
}

function getMusicLyricsSliceSnapshot(): MusicLyricsSlice {
  const s = globalMusicState
  if (
    lyricsSliceCache.lyrics === s.lyrics &&
    lyricsSliceCache.currentLyricIndex === s.currentLyricIndex
  ) {
    return lyricsSliceCache
  }
  lyricsSliceCache = {
    lyrics: s.lyrics,
    currentLyricIndex: s.currentLyricIndex,
  }
  return lyricsSliceCache
}

/** Lyrics + current index only; isPlaying / playlist must not retrigger. */
export function useMusicLyricsSlice(): MusicLyricsSlice {
  return useSyncExternalStore(
    subscribeMusicState,
    getMusicLyricsSliceSnapshot,
    getMusicLyricsSliceSnapshot,
  )
}
