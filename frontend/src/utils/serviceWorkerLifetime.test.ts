import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

test('service worker delivers network responses before cache writes finish', async () => {
  const listeners = new Map<string, (event: any) => void>()
  let finish!: () => void
  const writing = new Promise<void>((resolve) => { finish = resolve })
  const pending: Promise<unknown>[] = []
  let response!: Promise<Response>
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), {
    URL, Headers, Response, console,
    location: { origin: 'https://example.test' },
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    fetch: async () => new Response('image'),
    caches: { match: async () => undefined, open: async () => ({ put: () => writing, keys: async () => [] }) },
  })
  listeners.get('fetch')!({
    request: { url: 'https://example.test/a.png', method: 'GET', destination: 'image' },
    respondWith: (value: Promise<Response>) => { response = value },
    waitUntil: (value: Promise<unknown>) => pending.push(value),
  })
  try {
    const result = await Promise.race([response, new Promise<null>((resolve) => setTimeout(() => resolve(null), 30))])
    assert.ok(result, 'network response must not wait for cache.put')
    assert.ok(pending.length > 0, 'cache writes must extend worker lifetime')
  } finally { finish(); await response; await Promise.all(pending) }
})
