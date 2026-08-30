/**
 * Continuous listen is off until the person turns it on.
 * Push-to-talk does not enable this.
 */

const STORAGE_KEY = 'myriad.agentPanel.listenConsent'

let enabled = false
let loaded = false
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'on'
  } catch {
    return false
  }
}

function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  if (typeof window !== 'undefined') enabled = read()
}

export function getListenConsent(): boolean {
  ensureLoaded()
  return enabled
}

export function setListenConsent(next: boolean): void {
  ensureLoaded()
  if (enabled === next) return
  enabled = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off')
  } catch {
    // session-only is fine
  }
  for (const listener of listeners) listener()
}

export function subscribeListenConsent(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getServerListenConsent(): boolean {
  return false
}
