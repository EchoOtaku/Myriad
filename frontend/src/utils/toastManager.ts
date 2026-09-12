import type { ToastType } from '../components/Toast'

export interface ToastEvent {
  message: string
  title?: string
  type?: ToastType
  /** ms. Ignored when `sticky` is set. */
  duration?: number
  showCloseButton?: boolean
  /**
   * Persistent toast: stays until the user closes it.
   * Must be declared; duration 0 does not imply this.
   */
  sticky?: boolean
  icon?: string
  onClick?: () => void
  onClose?: () => void
  timestamp?: number
  /** Same key replaces the previous toast instead of stacking. */
  replaceKey?: string
}

export function resolveToastEvent(event: ToastEvent): ToastEvent {
  const sticky = event.sticky === true
  const duration =
    sticky || event.duration == null || event.duration <= 0
      ? undefined
      : event.duration
  return {
    ...event,
    sticky,
    duration,
    showCloseButton: sticky ? true : event.showCloseButton,
    timestamp: event.timestamp ?? Date.now(),
  }
}

const VISIBLE_TOAST_CAP = 5

export function pickVisibleToasts<T extends { id: string; sticky?: boolean }>(
  toasts: T[],
  cap = VISIBLE_TOAST_CAP,
): T[] {
  const sticky = toasts.filter((toast) => toast.sticky)
  const ephemeral = toasts.filter((toast) => !toast.sticky)
  const keptSticky = sticky.length > cap ? sticky.slice(-cap) : sticky
  const room = cap - keptSticky.length
  const keptEphemeral = room > 0 ? ephemeral.slice(-room) : []
  const keep = new Set(
    [...keptSticky, ...keptEphemeral].map((toast) => toast.id),
  )
  return toasts.filter((toast) => keep.has(toast.id))
}

/** Keep leaving toasts in the list so the slot can collapse instead of popping out. */
export function layoutToastStack<
  T extends { id: string; sticky?: boolean; leaving?: boolean },
>(toasts: T[], cap?: number): T[] {
  const active = pickVisibleToasts(
    toasts.filter((toast) => !toast.leaving),
    cap,
  )
  const activeIds = new Set(active.map((toast) => toast.id))
  return toasts.filter((toast) => toast.leaving || activeIds.has(toast.id))
}

type ToastListener = (event: ToastEvent) => void

const listeners = new Set<ToastListener>()

export function subscribeToast(listener: ToastListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function showToast(event: ToastEvent): void {
  const resolved = resolveToastEvent(event)

  listeners.forEach((listener) => {
    try {
      listener(resolved)
    } catch (error) {
      console.error('[ToastManager] Listener error:', error)
    }
  })
}

/** Persistent toast. Caller must declare this; default toasts still auto-dismiss. */
export function showStickyToast(
  event: Omit<ToastEvent, 'sticky' | 'duration'>,
): void {
  showToast({ ...event, sticky: true })
}

export function showSuccess(message: string, title?: string): void {
  showToast({ message, title, type: 'success' })
}

export function showError(message: string, title?: string): void {
  showToast({ message, title, type: 'error' })
}

export function showWarning(message: string, title?: string): void {
  showToast({ message, title, type: 'warning' })
}

export function showInfo(message: string, title?: string): void {
  showToast({ message, title, type: 'info' })
}

export default {
  subscribe: subscribeToast,
  show: showToast,
  sticky: showStickyToast,
  success: showSuccess,
  error: showError,
  warning: showWarning,
  info: showInfo,
}
