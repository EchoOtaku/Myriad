/**
 * 首页人设小组件共用一个现场形象。谁先挂上谁播 WebGL，其余只出说明；
 * 持有者卸掉后租约交给队列里下一个。聊天档形象不走这条，它有自己的优先级。
 */

import { useLayoutEffect, useSyncExternalStore } from 'react'

type Listener = () => void

const listeners = new Set<Listener>()
const queue: string[] = []
let holder: string | null = null

function emit(): void {
  for (const listener of listeners) listener()
}

export function meropeWidgetFaceHolder(): string | null {
  return holder
}

export function subscribeMeropeWidgetFaceSlot(
  onStoreChange: Listener,
): () => void {
  listeners.add(onStoreChange)
  return () => {
    listeners.delete(onStoreChange)
  }
}

/** 先占到的那个播。同一 id 再 claim 不会进队两次。 */
export function claimMeropeWidgetFaceSlot(id: string): () => void {
  if (!queue.includes(id)) {
    queue.push(id)
    if (holder === null) holder = id
    emit()
  }
  let released = false
  return () => {
    if (released) return
    released = true
    const index = queue.indexOf(id)
    if (index < 0) return
    queue.splice(index, 1)
    if (holder === id) holder = queue[0] ?? null
    emit()
  }
}

export function resetMeropeWidgetFaceSlotForTests(): void {
  queue.length = 0
  holder = null
}

export function useMeropeWidgetFaceSlot(id: string, active: boolean): boolean {
  const current = useSyncExternalStore(
    subscribeMeropeWidgetFaceSlot,
    meropeWidgetFaceHolder,
    meropeWidgetFaceHolder,
  )

  useLayoutEffect(() => {
    if (!active) return undefined
    return claimMeropeWidgetFaceSlot(id)
  }, [id, active])

  return active && current === id
}
