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
    const result = await Promise.race([response, new Promise<null>((resolve) => setTimeout(resolve, 30, null))])
    assert.ok(result, 'network response must not wait for cache.put')
    assert.ok(pending.length > 0, 'cache writes must extend worker lifetime')
  } finally { finish(); await response; await Promise.all(pending) }
})

test('parallel static cache writes evict expired and excess entries', async () => {
  const listeners = new Map<string, (event: any) => void>()
  const entries = new Map<string, Response>([
    ['https://example.test/expired.js', new Response('old', { headers: { 'sw-cached-date': '2000-01-01' } })],
  ])
  const cache = {
    put: async (request: { url: string }, response: Response) => { entries.set(request.url, response) },
    keys: async () => [...entries.keys()],
    match: async (key: string) => entries.get(key),
    delete: async (key: string) => entries.delete(key),
  }
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), {
    URL, Headers, Response, console,
    location: { origin: 'https://example.test' },
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    fetch: async () => new Response('module'),
    caches: { match: async () => undefined, open: async () => cache },
  })
  const writes: Promise<unknown>[] = []
  const responses: Promise<Response>[] = []
  for (let i = 0; i < 190; i++) {
    listeners.get('fetch')!({
      request: { url: `https://example.test/${i}.js`, method: 'GET' },
      respondWith: (value: Promise<Response>) => responses.push(value),
      waitUntil: (value: Promise<unknown>) => writes.push(value),
    })
  }
  await Promise.all(responses)
  await Promise.all(writes)
  assert.equal(entries.has('https://example.test/expired.js'), false)
  assert.equal(entries.size, 180)
})

test('clearing caches invalidates queued writes before acknowledging completion', async () => {
  const listeners = new Map<string, (event: any) => void>()
  let finish!: () => void
  const blocked = new Promise<void>((resolve) => { finish = resolve })
  const entries = new Map<string, Response>()
  let puts = 0
  const cache = {
    put: async (request: { url: string }, response: Response) => { puts++; await blocked; entries.set(request.url, response) },
    keys: async () => [...entries.keys()], match: async (key: string) => entries.get(key),
    delete: async (key: string) => entries.delete(key),
  }
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), {
    URL, Headers, Response, console,
    location: { origin: 'https://example.test' },
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    fetch: async () => new Response('module'),
    caches: {
      match: async () => undefined, open: async () => cache,
      keys: async () => ['test-cache'], delete: async () => { entries.clear(); return true },
    },
  })
  const writes: Promise<unknown>[] = []
  const responses: Promise<Response>[] = []
  for (let i = 0; i < 3; i++) listeners.get('fetch')!({
    request: { url: `https://example.test/${i}.js`, method: 'GET' },
    respondWith: (value: Promise<Response>) => responses.push(value),
    waitUntil: (value: Promise<unknown>) => writes.push(value),
  })
  await Promise.all(responses)
  let cleared!: Promise<void>
  let acknowledged = false
  listeners.get('message')!({
    data: { type: 'CLEAR_CACHE' }, ports: [{ postMessage: () => { acknowledged = true } }],
    waitUntil: (value: Promise<void>) => { cleared = value },
  })
  await Promise.resolve()
  assert.equal(acknowledged, false)
  finish()
  await cleared
  await Promise.all(writes)
  assert.equal(acknowledged, true)
  assert.equal(entries.size, 0)
  assert.equal(puts, 1)
})

test('fresh precache survives activation and remains an offline navigation fallback', async () => {
  const listeners = new Map<string, (event: any) => void>()
  const entries = new Map<string, Response>()
  const cache = {
    put: async (request: string, response: Response) => { entries.set(request, response) },
    keys: async () => [...entries.keys()], match: async (key: string) => entries.get(key),
    delete: async (key: string) => entries.delete(key),
  }
  runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), {
    URL, Headers, Response, console,
    location: { origin: 'https://example.test' }, skipWaiting() {}, clients: { claim() {} },
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    fetch: async () => new Response('precache'),
    caches: { match: async (key: string) => entries.get(key), open: async () => cache, keys: async () => [], delete: async () => true },
  })
  let pending!: Promise<void>
  const event = { waitUntil: (value: Promise<void>) => { pending = value } }
  listeners.get('install')!(event)
  await pending
  listeners.get('activate')!(event)
  await pending
  assert.ok(entries.get('/')?.headers.get('sw-cached-date'))
  assert.equal(entries.size, 3)
})
