import type { CompanionMessage, CompanionSnapshot } from './types'

export const COMPANION_CONFIG_CHANGED_EVENT =
  'digital-life-companion-config-changed'
export const COMPANION_CONFIG_REVISION_KEY =
  'myriad-digital-life-companion-config-revision'

export function announceCompanionConfigChanged(): void {
  window.dispatchEvent(new CustomEvent(COMPANION_CONFIG_CHANGED_EVENT))
  try {
    localStorage.setItem(COMPANION_CONFIG_REVISION_KEY, String(Date.now()))
  } catch {}
}

export function shouldMountCompanion(
  hasChecked: boolean,
  isAuthenticated: boolean,
  enabled: unknown,
): boolean {
  return hasChecked && isAuthenticated && enabled === true
}

export function companionPollInterval(documentHidden: boolean): number {
  return documentHidden ? 120_000 : 30_000
}

export function snapshotChanged(
  current: CompanionSnapshot | null,
  next: CompanionSnapshot,
): boolean {
  return current?.fingerprint !== next.fingerprint
}

export function latestUnreadProactive(
  messages: CompanionMessage[],
): CompanionMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'proactive' && !message.meta.readAt) return message
  }
  return null
}

/** Floating overlay only mounts chat when onboarding is completed (Reports entry). */
export function isCompanionOverlayReady(
  hasCharacter: boolean,
  onboardingCompleted: boolean | undefined,
): boolean {
  return hasCharacter && onboardingCompleted === true
}

type ScheduleFrame = (callback: FrameRequestCallback) => number
type CancelFrame = (handle: number) => void

/**
 * Leaves one fully painted, phase-continuous frame between expanding the panel
 * and starting its greeting. Two animation frames are intentional: the first
 * observes the React commit, the second begins the velocity handoff.
 */
export function deferCompanionExpansionGesture(
  callback: () => void,
  scheduleFrame: ScheduleFrame,
  cancelFrame: CancelFrame,
): () => void {
  let firstFrame = 0
  let secondFrame = 0
  firstFrame = scheduleFrame(() => {
    firstFrame = 0
    secondFrame = scheduleFrame(() => {
      secondFrame = 0
      callback()
    })
  })
  return () => {
    if (firstFrame) cancelFrame(firstFrame)
    if (secondFrame) cancelFrame(secondFrame)
    firstFrame = 0
    secondFrame = 0
  }
}

export function companionExpansionGenerationIsCurrent(
  scheduledGeneration: number,
  currentGeneration: number,
  collapsed: boolean,
): boolean {
  return scheduledGeneration === currentGeneration && !collapsed
}

export function shouldAnimateCompanionUnread(
  expanded: boolean,
  previousUnreadCount: number,
  unreadCount: number,
): boolean {
  return expanded && unreadCount > previousUnreadCount
}
