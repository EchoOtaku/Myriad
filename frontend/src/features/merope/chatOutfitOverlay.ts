/**
 * Chat-session overlay of a saved wardrobe set. Panel chat may play it;
 * the worn outfit and the home widget stay on `/active`.
 */

import { useSyncExternalStore } from 'react'

type Listener = () => void

const listeners = new Set<Listener>()
let overlayId: string | null = null

function emit(): void {
  for (const listener of listeners) listener()
}

export function getChatOutfitOverlay(): string | null {
  return overlayId
}

export function setChatOutfitOverlay(next: string | null): void {
  const outfitId = next?.trim() || null
  if (overlayId === outfitId) return
  overlayId = outfitId
  emit()
}

export function clearChatOutfitOverlay(): void {
  setChatOutfitOverlay(null)
}

export function subscribeChatOutfitOverlay(onStoreChange: Listener): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

export function resetChatOutfitOverlayForTests(): void {
  overlayId = null
  listeners.clear()
}

export function useChatOutfitOverlay(): string | null {
  return useSyncExternalStore(
    subscribeChatOutfitOverlay,
    getChatOutfitOverlay,
    getChatOutfitOverlay,
  )
}
