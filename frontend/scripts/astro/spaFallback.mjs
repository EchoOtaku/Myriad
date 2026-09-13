import { rewriteSpaFallbackUrl } from '../../src/spaPaths.mjs'
import { DOCUMENT_PERMISSIONS_POLICY } from './constants.mjs'

/** Rewrite dynamic routes to catch-all files; leave the browser URL intact for React Router. */
export function spaFallbackPlugin() {
  return {
    name: 'spa-fallback',
    enforce: 'pre', // SPA fallback must run before other middleware.
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Astro serve: document gets Permissions-Policy without going through Myriad proxy.
        if (!res.getHeader('Permissions-Policy')) {
          res.setHeader('Permissions-Policy', DOCUMENT_PERMISSIONS_POLICY)
        }

        const url = req.url || ''
        const rewritten = rewriteSpaFallbackUrl(url)
        if (rewritten !== url) {
          req.url = rewritten
        }

        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((_req, res, next) => {
        if (!res.getHeader('Permissions-Policy')) {
          res.setHeader('Permissions-Policy', DOCUMENT_PERMISSIONS_POLICY)
        }
        next()
      })
    },
  }
}
