/**
 * 全站现场形象只跑一套 WebGL。面板聊天档优先于首页小组件；
 * 没拿到租约的表面只出说明，不另开播放器，也不用主立绘占位。
 *
 * 和小组件张数租约是两件事：多张卡片里只有一张是「那张卡」，
 * 这张卡和面板之间还要再争一次播放权。
 */

import { useLayoutEffect, useSyncExternalStore } from 'react'

type Listener = () => void

interface Claim {
  priority: number
  order: number
}

const listeners = new Set<Listener>()
const claims = new Map<string, Claim>()
let nextOrder = 0
let holder: string | null = null

function emit(): void {
  for (const listener of listeners) listener()
}

function pickHolder(): string | null {
  let bestId: string | null = null
  let best: Claim | null = null
  for (const [id, claim] of claims) {
    if (
      !best ||
      claim.priority > best.priority ||
      (claim.priority === best.priority && claim.order < best.order)
    ) {
      best = claim
      bestId = id
    }
  }
  return bestId
}

function setHolder(next: string | null): void {
  if (holder === next) return
  holder = next
  emit()
}

export const LIVE_FACE_PLAYBACK_PRIORITY = {
  widget: 1,
  panel: 2,
} as const

export function liveFacePlaybackHolder(): string | null {
  return holder
}

export function subscribeLiveFacePlayback(onStoreChange: Listener): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

export function claimLiveFacePlayback(
  id: string,
  priority: number,
): () => void {
  const existing = claims.get(id)
  if (existing) {
    existing.priority = priority
  } else {
    claims.set(id, { priority, order: nextOrder })
    nextOrder += 1
  }
  setHolder(pickHolder())
  let released = false
  return () => {
    if (released) return
    released = true
    claims.delete(id)
    setHolder(pickHolder())
  }
}

export function resetLiveFacePlaybackForTests(): void {
  claims.clear()
  holder = null
  nextOrder = 0
  listeners.clear()
}

export function useLiveFacePlayback(
  id: string,
  active: boolean,
  priority: number,
): boolean {
  const current = useSyncExternalStore(
    subscribeLiveFacePlayback,
    liveFacePlaybackHolder,
    liveFacePlaybackHolder,
  )

  useLayoutEffect(() => {
    if (!active) return undefined
    return claimLiveFacePlayback(id, priority)
  }, [id, active, priority])

  return active && current === id
}
