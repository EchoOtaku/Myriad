import assert from 'node:assert/strict'
import test from 'node:test'
import { clearDedupCache, getLatestReportDeduped, getPublicConfigDeduped, getUIConfigDeduped } from './requestDedup'

test('shared config and report reads abort stalled bodies and can retry afterward', async () => {
  const oldFetch = globalThis.fetch
  const oldTimeout = AbortSignal.timeout
  AbortSignal.timeout = () => oldTimeout(5)
  try {
    for (const read of [getUIConfigDeduped, getPublicConfigDeduped, getLatestReportDeduped]) {
      clearDedupCache()
      globalThis.fetch = async (_url, options) => new Response(new ReadableStream({
        start(controller) {
          options?.signal?.addEventListener('abort', () => controller.error(options.signal!.reason), { once: true })
        },
      }), { headers: { 'content-type': 'application/json' } })
      const result = await Promise.race([
        read().then(() => 'unexpected', error => error.name),
        new Promise(resolve => setTimeout(resolve, 50, 'hung')),
      ])
      assert.equal(result, 'TimeoutError')
      globalThis.fetch = async () => Response.json({ success: true, platform_reports: [{}] })
      assert.equal((await read()).success, true)
    }
  } finally {
    globalThis.fetch = oldFetch
    AbortSignal.timeout = oldTimeout
    clearDedupCache()
  }
})
