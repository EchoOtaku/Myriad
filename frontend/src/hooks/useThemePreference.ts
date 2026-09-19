import { useSyncExternalStore } from 'react'

export type ThemePreference = 'light' | 'dark' | 'auto'
const CYCLE: ThemePreference[] = ['light', 'dark', 'auto']
const subscribers = new Set<() => void>()
let volatilePreference: ThemePreference | null = null

function readPreference(): ThemePreference {
  if (volatilePreference !== null) return volatilePreference
  try {
    const stored = localStorage.getItem('theme')
    return stored === 'light' || stored === 'dark' ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

function applyPreference(preference: ThemePreference) {
  const dark = preference === 'auto'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : preference === 'dark'
  const html = document.documentElement
  html.classList.toggle('dark', dark)
  html.classList.toggle('light', !dark)
  const color = getComputedStyle(html).getPropertyValue('--color-primary').trim() || '#94a3b8'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}

function notify() {
  for (const subscriber of [...subscribers]) subscriber()
}

function onStorage(event: StorageEvent) {
  if (event.key !== 'theme' && event.key !== null) return
  volatilePreference = null
  applyPreference(readPreference())
  notify()
}

function subscribe(callback: () => void) {
  if (subscribers.size === 0) window.addEventListener('storage', onStorage)
  subscribers.add(callback)
  return () => {
    subscribers.delete(callback)
    if (subscribers.size === 0) window.removeEventListener('storage', onStorage)
  }
}

function cycleThemePreference(): ThemePreference {
  const current = readPreference()
  const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]
  try {
    localStorage.setItem('theme', next)
    volatilePreference = null
  } catch {
    volatilePreference = next
  }
  applyPreference(next)
  notify()
  return next
}

/** Preference edits are shared; resolved light/dark still follows ThemeBoot and the DOM. */
export function useThemePreference() {
  const themePreference = useSyncExternalStore(subscribe, readPreference, () => 'auto' as const)
  return { themePreference, cycleThemePreference }
}
