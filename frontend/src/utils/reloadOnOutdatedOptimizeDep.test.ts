import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  attachOutdatedOptimizeDepRecovery,
  isOptimizedDepRequest,
  rewriteOptimizedDepCacheControl,
  shouldReloadForOutdatedOptimizeDep,
} from '../../scripts/astro/reloadOnOutdatedOptimizeDep.mjs'

test('only Vite optimized-dep URLs are treated as prebundle requests', () => {
  assert.equal(
    isOptimizedDepRequest('/node_modules/.vite/deps/client-a6h1PKJq.js?v=2a19ba24'),
    true,
  )
  assert.equal(
    isOptimizedDepRequest(
      '/node_modules/.pnpm/@astrojs+react@6.0.5/node_modules/@astrojs/react/dist/client.js',
    ),
    false,
  )
})

test('immutable optimized-dep cache headers become no-cache', () => {
  const url = '/node_modules/.vite/deps/react-dom_client.js?v=2a19ba24'
  assert.equal(
    rewriteOptimizedDepCacheControl(url, 'Cache-Control', 'max-age=31536000,immutable'),
    'no-cache',
  )
  assert.equal(
    rewriteOptimizedDepCacheControl(url, 'Content-Type', 'text/javascript'),
    'text/javascript',
  )
  assert.equal(
    rewriteOptimizedDepCacheControl('/src/App.tsx', 'Cache-Control', 'max-age=31536000,immutable'),
    'max-age=31536000,immutable',
  )
})

test('command-scoped prebundles and versioned source dependencies revalidate', () => {
  const prebundle = '/node_modules/.vite/dev/deps/react.js?v=2a19ba24'
  assert.equal(isOptimizedDepRequest(prebundle), true)
  for (const url of [
    prebundle,
    '/node_modules/.pnpm/lucide-react@1.45.0/node_modules/lucide-react/dist/esm/context.mjs?v=2a19ba24',
  ]) {
    assert.equal(
      rewriteOptimizedDepCacheControl(url, 'Cache-Control', 'max-age=31536000,immutable'),
      'no-cache',
    )
  }
})

test('only the outdated-optimize-dep 504 asks for a full reload', () => {
  assert.equal(
    shouldReloadForOutdatedOptimizeDep(504, 'Outdated Optimize Dep'),
    true,
  )
  assert.equal(shouldReloadForOutdatedOptimizeDep(504, 'Outdated Request'), false)
  assert.equal(shouldReloadForOutdatedOptimizeDep(200, 'Outdated Optimize Dep'), false)
})

test('a 504 outdated optimize dep sends one debounced full-reload', () => {
  const sent: unknown[] = []
  let now = 1_000
  let handler: ((req: object, res: object, next: () => void) => void) | undefined
  attachOutdatedOptimizeDepRecovery(
    {
      hot: { send: (payload: unknown) => sent.push(payload) },
      middlewares: { use: (fn: typeof handler) => { handler = fn } },
    },
    { now: () => now },
  )
  assert.ok(handler)

  const run = (statusMessage: string) => {
    const headers: Array<[string, unknown]> = []
    const res = {
      statusCode: 504,
      statusMessage,
      setHeader(name: string, value: unknown) {
        headers.push([name, value])
        return this
      },
      end() {
        return this
      },
    }
    handler!(
      { url: '/node_modules/.vite/deps/client-a6h1PKJq.js?v=2a19ba24' },
      res,
      () => {},
    )
    res.setHeader('Cache-Control', 'max-age=31536000,immutable')
    res.end()
    return headers
  }

  const first = run('Outdated Optimize Dep')
  now += 10
  run('Outdated Optimize Dep')
  now += 50
  run('Outdated Request')
  now += 50
  run('Outdated Optimize Dep')

  assert.deepEqual(sent, [{ type: 'full-reload' }, { type: 'full-reload' }])
  assert.deepEqual(first, [['Cache-Control', 'no-cache']])
})
