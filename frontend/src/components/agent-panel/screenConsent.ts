const STORAGE_KEY = 'myriad.agentPanel.screenConsent'

let enabled = false
let loaded = false

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

export function getScreenConsent(): boolean {
  ensureLoaded()
  return enabled
}
