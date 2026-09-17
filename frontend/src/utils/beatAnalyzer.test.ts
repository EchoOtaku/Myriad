import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
import test from 'node:test'
import { analyzeBeatGrid } from './beatAnalyzer'

test('rejects oversized declared audio before reading or decoding it', async () => {
  const original = globalThis.fetch
  let reads = 0
  globalThis.fetch = async () => ({ ok: true, headers: new Headers({ 'content-length': String(17 * 1024 * 1024) }), body: { cancel: async () => {} }, arrayBuffer: async () => { reads++; return new ArrayBuffer(0) } }) as unknown as Response
  try {
    assert.equal(await analyzeBeatGrid('large', 'large'), null)
    assert.equal(reads, 0)
  } finally { globalThis.fetch = original }
})

test('serializes analyses and aborts queued work before fetch', async () => {
  const original = globalThis.fetch
  const pending = Promise.withResolvers<Response>()
  const controller = new AbortController()
  const calls: string[] = []
  globalThis.fetch = async url => { calls.push(String(url)); return pending.promise }
  try {
    const first = analyzeBeatGrid('first', 'first')
    const second = analyzeBeatGrid('second', 'second', controller.signal)
    await new Promise(resolve => setImmediate(resolve))
    controller.abort()
    assert.deepEqual(calls, ['first'])
    pending.resolve(new Response(null, { status: 404 }))
    await Promise.all([first, second])
    assert.deepEqual(calls, ['first'])
  } finally { globalThis.fetch = original; pending.resolve(new Response(null, { status: 404 })) }
})

test('counts actual streaming bytes when content length is absent', async () => {
  const original = globalThis.fetch
  let cancelled = false
  let pulls = 0
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)) },
    cancel() { cancelled = true },
  }))
  try {
    assert.equal(await analyzeBeatGrid('stream', 'stream'), null)
    assert.equal(cancelled, true)
    assert.ok(pulls <= 18)
  } finally { globalThis.fetch = original }
})

test('long media is rejected at metadata stage before Web Audio decoding', async () => {
  const originalFetch = globalThis.fetch
  const originalAudio = globalThis.Audio
  const originalWindow = globalThis.window
  let contexts = 0
  let released = false
  globalThis.fetch = async () => new Response(new Uint8Array(10))
  globalThis.window = { AudioContext: class { constructor() { contexts++ } } } as unknown as Window & typeof globalThis
  globalThis.Audio = class {
    duration = 901; onloadedmetadata?: () => void; onerror = null; preload = ''; src = ''
    load() { if (this.src) queueMicrotask(() => this.onloadedmetadata?.()); else released = true }
  } as unknown as typeof Audio
  try {
    assert.equal(await analyzeBeatGrid('long', 'long'), null)
    assert.equal(contexts, 0)
    assert.equal(released, true)
  } finally { globalThis.fetch = originalFetch; globalThis.Audio = originalAudio; globalThis.window = originalWindow }
})

test('aborted callers settle promptly while an uncancellable decode retains the serial slot', async () => {
  const originalFetch = globalThis.fetch
  const originalAudio = globalThis.Audio
  const originalWindow = globalThis.window
  const originalAny = AbortSignal.any
  const combinedSignals: AbortSignal[] = []
  AbortSignal.any = signals => {
    const combined = originalAny(signals)
    combinedSignals.push(combined)
    return combined
  }
  const decoding = Promise.withResolvers<void>()
  const decoded = Promise.withResolvers<AudioBuffer>()
  let fetches = 0
  globalThis.fetch = async () => { fetches++; return new Response(new Uint8Array(4)) }
  globalThis.Audio = class {
    duration = 15; onloadedmetadata?: () => void; onerror = null; preload = ''; src = ''
    load() { if (this.src) queueMicrotask(() => this.onloadedmetadata?.()) }
  } as unknown as typeof Audio
  globalThis.window = { AudioContext: class {
    decodeAudioData() { decoding.resolve(); return decoded.promise }
    async close() {}
  } } as unknown as Window & typeof globalThis
  const active = new AbortController()
  const queued = new AbortController()
  const later = new AbortController()
  try {
    const first = analyzeBeatGrid('decode-held', 'decode-held', active.signal)
    await decoding.promise
    const second = analyzeBeatGrid('queued-cancelled', 'queued-cancelled', queued.signal)
    active.abort()
    queued.abort()
    const settled = await Promise.race([
      Promise.all([first, second]).then(results => results.every(result => result === null)),
      new Promise<boolean>(resolve => setTimeout(resolve, 30, false)),
    ])
    assert.equal(settled, true, 'cancellation must not await a different decode')
    const third = analyzeBeatGrid('must-wait', 'must-wait', later.signal)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(fetches, 1, 'an aborted decode still owns the execution slot')
    later.abort()
    assert.equal(await third, null)
    for (const signal of combinedSignals) assert.equal(getEventListeners(signal, 'abort').length, 0)
    decoded.resolve({ duration: 15 } as AudioBuffer)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(fetches, 1, 'cancelled queue entries never fetch')
  } finally {
    active.abort(); queued.abort(); later.abort()
    decoded.resolve({ duration: 15 } as AudioBuffer)
    await new Promise(resolve => setImmediate(resolve))
    globalThis.fetch = originalFetch
    globalThis.Audio = originalAudio
    globalThis.window = originalWindow
    AbortSignal.any = originalAny
  }
})
