/**
 * Vite 8 / Rolldown can rewrite optimized-dep chunk names (react-dom/client
 * becomes `client-<hash>.js`) without changing `?v=`. The old file 504s
 * "Outdated Optimize Dep". Recover with a full reload. Optimized deps can be
 * `immutable`, so a normal
 * reload can keep a parent module that still imports the dead chunk.
 */

const RELOAD_DEBOUNCE_MS = 50

export function isOptimizedDepRequest(url) {
  const path = String(url || '').split('?')[0]
  return /\/node_modules\/\.vite\/(?:[^/]+\/)?deps\//.test(path)
}

export function rewriteOptimizedDepCacheControl(url, name, value) {
  // Excluded dependencies (e.g. Lucide) also contain rewritten React imports.
  // Keeping those immutable can retain a second React URL after cache migration.
  const request = String(url || '')
  const versionedDependency = request.split('?')[0].includes('/node_modules/')
    && /[?&]v=/.test(request)
  if (!isOptimizedDepRequest(url) && !versionedDependency) return value
  if (String(name).toLowerCase() !== 'cache-control') return value
  if (!/immutable/i.test(String(value))) return value
  return 'no-cache'
}

export function shouldReloadForOutdatedOptimizeDep(statusCode, statusMessage) {
  return statusCode === 504 && statusMessage === 'Outdated Optimize Dep'
}

export function attachOutdatedOptimizeDepRecovery(server, { now = Date.now } = {}) {
  let lastReloadAt = 0
  const sendReload = () => {
    const t = now()
    if (t - lastReloadAt < RELOAD_DEBOUNCE_MS) return
    lastReloadAt = t
    const send = server.hot?.send ?? server.ws?.send
    send?.({ type: 'full-reload' })
  }

  server.middlewares.use((req, res, next) => {
    const url = req.url || ''
    const setHeader = res.setHeader.bind(res)
    res.setHeader = (name, value) =>
      setHeader(name, rewriteOptimizedDepCacheControl(url, name, value))

    const end = res.end.bind(res)
    res.end = (...args) => {
      if (shouldReloadForOutdatedOptimizeDep(res.statusCode, res.statusMessage)) {
        sendReload()
      }
      return end(...args)
    }
    next()
  })
}

export function reloadOnOutdatedOptimizeDepPlugin() {
  return {
    name: 'reload-on-outdated-optimize-dep',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      attachOutdatedOptimizeDepRecovery(server)
    },
  }
}
