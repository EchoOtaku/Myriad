/**
 * Progressive Web App lifecycle: Service Worker + web app manifest.
 *
 * Controlled by site setting `pwa_enabled` (default true). Production only —
 * dev always unregisters SW so local API/proxy work is not hijacked by cache.
 */

import { API_URL } from '../config'

const SW_URL = '/sw.js'
const MANIFEST_HREF = '/manifest.webmanifest'
const APPLE_TOUCH_HREF = '/icons/pwa/icon-192.png'

let lastAppliedEnabled: boolean | null = null
let applyInFlight: Promise<void> | null = null

function isProdBrowser(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    // Vite / Astro: DEV is true in astro dev; PROD when built.
    Boolean(import.meta.env.PROD)
  )
}

function supportsServiceWorker(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

function ensureManifestLink(enabled: boolean): void {
  if (typeof document === 'undefined') return

  const existing = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="manifest"]',
  )
  if (!enabled) {
    existing.forEach((el) => el.remove())
    return
  }

  let link = existing[0]
  if (!link) {
    link = document.createElement('link')
    link.rel = 'manifest'
    document.head.appendChild(link)
  }
  if (link.getAttribute('href') !== MANIFEST_HREF) {
    link.href = MANIFEST_HREF
  }
}

function ensureAppleTouchIcon(enabled: boolean): void {
  if (typeof document === 'undefined') return

  const existing = document.querySelectorAll<HTMLLinkElement>(
    'link[rel="apple-touch-icon"]',
  )
  if (!enabled) {
    existing.forEach((el) => el.remove())
    return
  }

  let link = existing[0]
  if (!link) {
    link = document.createElement('link')
    link.rel = 'apple-touch-icon'
    document.head.appendChild(link)
  }
  if (link.getAttribute('href') !== APPLE_TOUCH_HREF) {
    link.href = APPLE_TOUCH_HREF
  }
}

function setAppleWebAppMeta(enabled: boolean): void {
  if (typeof document === 'undefined') return

  const names = [
    'mobile-web-app-capable',
    'apple-mobile-web-app-capable',
  ] as const

  for (const name of names) {
    let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
    if (!enabled) {
      el?.remove()
      continue
    }
    if (!el) {
      el = document.createElement('meta')
      el.setAttribute('name', name)
      document.head.appendChild(el)
    }
    el.setAttribute('content', 'yes')
  }
}

/**
 * Update manifest name/short_name from site branding when possible.
 * Uses a blob URL so we don't need a dynamic backend endpoint.
 */
export function updateManifestBranding(options: {
  name?: string
  description?: string
  themeColor?: string
}): void {
  if (typeof document === 'undefined' || !import.meta.env.PROD) return
  if (lastAppliedEnabled === false) return

  const name = options.name?.trim()
  if (!name) return

  void fetch(MANIFEST_HREF)
    .then((r) => (r.ok ? r.json() : null))
    .then((base: Record<string, unknown> | null) => {
      if (!base) return
      const short =
        name.length > 12 ? name.slice(0, 12) : name
      const next = {
        ...base,
        name,
        short_name: short,
        ...(options.description?.trim()
          ? { description: options.description.trim() }
          : {}),
        ...(options.themeColor?.trim()
          ? {
              theme_color: options.themeColor.trim(),
              background_color: options.themeColor.trim(),
            }
          : {}),
      }
      const blob = new Blob([JSON.stringify(next)], {
        type: 'application/manifest+json',
      })
      const url = URL.createObjectURL(blob)
      let link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
      if (!link) {
        link = document.createElement('link')
        link.rel = 'manifest'
        document.head.appendChild(link)
      }
      const prev = link.href
      link.href = url
      if (prev.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(prev)
        } catch {
          /* ignore */
        }
      }
    })
    .catch(() => {
      /* keep static manifest */
    })
}

async function clearMyriadCaches(): Promise<void> {
  if (!('caches' in globalThis)) return
  try {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((key) => key.startsWith('myriad-'))
        .map((key) => caches.delete(key)),
    )
  } catch {
    /* ignore */
  }
}

async function unregisterAllServiceWorkers(): Promise<void> {
  if (!supportsServiceWorker()) return
  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.map((r) => r.unregister()))
  } catch {
    /* ignore */
  }
}

async function registerServiceWorker(): Promise<void> {
  if (!supportsServiceWorker() || !isProdBrowser()) return
  try {
    await navigator.serviceWorker.register(SW_URL)
  } catch (error) {
    console.warn('[PWA] Service Worker registration failed:', error)
  }
}

/**
 * Apply PWA on/off: SW + manifest + Apple install meta.
 * Safe to call repeatedly; skips work when state is unchanged.
 */
export async function applyPwaEnabled(enabled: boolean): Promise<void> {
  if (applyInFlight) {
    await applyInFlight
  }

  const run = async () => {
    // Dev: always strip SW so HMR / API proxy are never cached by production SW.
    if (!isProdBrowser()) {
      ensureManifestLink(false)
      ensureAppleTouchIcon(false)
      setAppleWebAppMeta(false)
      const hadController =
        supportsServiceWorker() && Boolean(navigator.serviceWorker.controller)
      await unregisterAllServiceWorkers()
      await clearMyriadCaches()
      lastAppliedEnabled = false
      // One-shot reload so an already-controlling SW drops control after unregister.
      if (
        hadController &&
        !sessionStorage.getItem('myriad-dev-sw-reset')
      ) {
        sessionStorage.setItem('myriad-dev-sw-reset', '1')
        window.location.reload()
      }
      return
    }

    if (lastAppliedEnabled === enabled) return
    lastAppliedEnabled = enabled

    ensureManifestLink(enabled)
    ensureAppleTouchIcon(enabled)
    setAppleWebAppMeta(enabled)

    if (enabled) {
      await registerServiceWorker()
    } else {
      await unregisterAllServiceWorkers()
      await clearMyriadCaches()
    }
  }

  applyInFlight = run().finally(() => {
    applyInFlight = null
  })
  await applyInFlight
}

function parsePwaEnabled(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase()
    if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false
    return true
  }
  // Missing key → keep historical default (PWA on)
  return true
}

/**
 * Read public UI config and sync PWA state.
 * Call on boot and after admin saves `pwa_enabled`.
 */
export async function syncPwaFromServer(): Promise<boolean> {
  let enabled = true
  try {
    const base = API_URL || ''
    const url = base ? `${base}/api/config/ui` : '/api/config/ui'
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 3000)
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)
    if (response.ok) {
      const data = (await response.json()) as { pwa_enabled?: unknown }
      enabled = parsePwaEnabled(data?.pwa_enabled)
    }
  } catch {
    // Network failure: leave prior state; first boot still applies default true via apply.
  }
  await applyPwaEnabled(enabled)
  return enabled
}

/**
 * Boot entry for Astro shell scripts: after load, sync from server.
 * DEV unregisters; PROD registers only when `pwa_enabled` is true.
 */
export function initPwaLifecycle(): void {
  if (typeof window === 'undefined') return

  const run = () => {
    void syncPwaFromServer()
  }

  if (document.readyState === 'complete') {
    run()
  } else {
    window.addEventListener('load', run, { once: true })
  }
}
