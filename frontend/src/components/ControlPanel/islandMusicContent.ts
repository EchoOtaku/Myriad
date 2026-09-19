import type { LyricLine, Song } from '../../utils/musicPlayer'

export interface IslandMusicInput {
  currentSong: Pick<Song, 'id' | 'name' | 'artist'> | null
  isPlaying: boolean
  lyrics: LyricLine[]
  currentLyricIndex: number
}

/** Derive the whole presentation, including metadata and timing, from playback. */
export function islandMusicContent({ currentSong, isPlaying, lyrics, currentLyricIndex }: IslandMusicInput) {
  if (!currentSong) return null
  const current = isPlaying ? lyrics[currentLyricIndex] : undefined
  if (current?.text) {
    const next = lyrics[currentLyricIndex + 1]
    const gap = next ? next.time - current.time : 8
    return {
      text: current.text,
      subtext: `${currentSong.name} - ${currentSong.artist}`,
      playing: true,
      lyricDuration: Number.isFinite(gap) ? Math.max(1, gap) : 8,
    }
  }
  return { text: currentSong.name, subtext: currentSong.artist, playing: isPlaying, lyricDuration: undefined }
}
