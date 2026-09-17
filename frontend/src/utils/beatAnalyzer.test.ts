import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeBeatGrid } from './beatAnalyzer'

test('rejects oversized declared audio before reading or decoding it', async () => {
  const original = globalThis.fetch
  let reads = 0
  globalThis.fetch = async () => ({ ok: true, headers: new Headers({ 'content-length': String(5 * 1024 * 1024) }), body: { cancel: async () => {} }, arrayBuffer: async () => { reads++; return new ArrayBuffer(0) } }) as unknown as Response
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
