import type { Song } from '../utils/musicPlayer'

const listeners = new Set<() => void>()
let current: Song | null = null

export function getCurrentSong(): Song | null {
  return current
}

export function setCurrentSongSnapshot(song: Song | null): void {
  current = song
  for (const listener of listeners) listener()
}

export function subscribeCurrentSong(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
