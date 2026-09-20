import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  canStampDevHtml,
  finishBufferedHttpBody,
} from '../devServerResponse.mjs'
import {
  createBrandLoader,
  stampDocumentHtml,
  stampWebManifest,
} from '../siteBrandingStamp.mjs'

/** Vite serve / preview: stamp the same slots spa-server paints in production. */
export function siteBrandingStampPlugin({ backendTarget, frontendRoot }) {
  const loadBrand = createBrandLoader(`${backendTarget}/api/config/metadata`)
  const manifestPath = path.resolve(frontendRoot, './public/manifest.webmanifest')

  function attach(server) {
    server.middlewares.use(async (req, res, next) => {
      const urlPath = String(req.url || '').split('?')[0]
      if (urlPath === '/manifest.webmanifest') {
        try {
          const brand = await loadBrand()
          const raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
          const body = JSON.stringify(brand ? stampWebManifest(raw, brand) : raw)
          res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(body)
          return
        } catch {
          next()
          return
        }
      }

      if (
        urlPath.startsWith('/api/') ||
        urlPath.startsWith('/@') ||
        urlPath.startsWith('/src/') ||
        urlPath.startsWith('/node_modules/')
      ) {
        next()
        return
      }

      const accept = req.headers.accept || ''
      if (!accept.includes('text/html')) {
        next()
        return
      }

      const chunks = []
      const originalEnd = res.end.bind(res)
      let finished = false

      const take = (chunk, encoding) => {
        if (chunk == null) return
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding))
      }

      res.write = (chunk, encoding, callback) => {
        take(chunk, typeof encoding === 'string' ? encoding : undefined)
        if (typeof encoding === 'function') encoding()
        else if (typeof callback === 'function') callback()
        return true
      }

      res.end = (chunk, encoding, callback) => {
        if (finished) return res
        finished = true
        if (typeof chunk === 'function') {
          callback = chunk
          chunk = undefined
          encoding = undefined
        } else if (typeof encoding === 'function') {
          callback = encoding
          encoding = undefined
        }
        take(chunk, typeof encoding === 'string' ? encoding : undefined)
        const raw = Buffer.concat(chunks)
        const finish = (body) =>
          finishBufferedHttpBody(res, originalEnd, body, callback)
        if (canStampDevHtml(res, raw)) {
          loadBrand()
            .then((brand) =>
              finish(
                brand
                  ? Buffer.from(stampDocumentHtml(raw.toString('utf8'), brand))
                  : raw,
              ),
            )
            .catch(() => finish(raw))
          return res
        }
        finish(raw)
        return res
      }

      next()
    })
  }

  return {
    name: 'site-branding-stamp',
    apply: 'serve',
    enforce: 'pre',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
