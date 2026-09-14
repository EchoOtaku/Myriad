/**
 * Human SPA paths shared by Astro `getStaticPaths` and the dest fallback.
 * React Router stays on its own table.
 */

export const SPA_STATIC_PATHS = [
  'library',
  'reports',
  'config',
  'agent/settings',
  'login',
  'register',
  'setup',
  'tapp',
  'tapp/store',
  'tapp/playground',
  'tapp/run',
  'phantasi',
]

export const SPA_DEV_ONLY_PATHS = ['dev/phantasi-tiles']

/** Prerender as `${prefix}/_`; dest rewrites `/${prefix}/:id` to that file. */
export const SPA_DYNAMIC_PREFIXES = ['tapp/run', 'tapp/detail']

/** Dest rewrite onto an existing static page; no extra prerender file. */
export const SPA_FALLBACK_ALIASES = [
  { test: /^\/phantasi\/item\/[^/]+/, rewrite: '/phantasi' },
  // Dead URLs: dest matches spa-server's index fallback. React then lands on `/`.
  { test: /^\/details(\?|$)/, rewrite: '/' },
  { test: /^\/federation\/(?:chat|room|ring)(?:\/|(\?|$))/, rewrite: '/' },
]

/** Bare prefix (`/tapp/run`) rewrites onto the same `_` file as `/:id`. */
export const SPA_BARE_REWRITES = ['tapp/run']

/**
 * @param {boolean} dev
 * @returns {string[]} path segments passed to Astro `getStaticPaths`
 */
export function spaPrerenderPaths(dev) {
  const staticRoutes = [...SPA_STATIC_PATHS]
  if (dev) staticRoutes.push(...SPA_DEV_ONLY_PATHS)
  return [
    ...staticRoutes,
    ...SPA_DYNAMIC_PREFIXES.map((prefix) => `${prefix}/_`),
  ]
}

/**
 * Rewrite a Vite/Connect `req.url` onto a prerendered file.
 * Leaves the browser address intact for React Router.
 * @param {string} url
 * @returns {string} rewritten `req.url`, or the original when no rule matches
 */
export function rewriteSpaFallbackUrl(url) {
  const raw = String(url || '')
  for (const prefix of SPA_DYNAMIC_PREFIXES) {
    const escaped = prefix.replaceAll('/', '\\/')
    if (new RegExp(`^\\/${escaped}\\/[^_/][^/]*`).test(raw)) {
      return `/${prefix}/_`
    }
  }
  for (const prefix of SPA_BARE_REWRITES) {
    const escaped = prefix.replaceAll('/', '\\/')
    if (new RegExp(`^\\/${escaped}(\\?|$)`).test(raw)) {
      return `/${prefix}/_`
    }
  }
  for (const alias of SPA_FALLBACK_ALIASES) {
    if (alias.test.test(raw)) {
      return alias.rewrite
    }
  }
  return raw
}
