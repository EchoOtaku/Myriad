/**
 * `/config/hitokoto` 按页去重；例外路径必须回源 / 必须失效。
 * quote.ts 模块加载会挂 HITOKOTO_CONFIG_UPDATED_EVENT（有 window 时），垫片必须先于 import。
 */

import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
} })

// 必须先于 ./quote 的模块体执行
const windowShim = new EventTarget()
;(globalThis as { window?: unknown }).window = windowShim

const apiService = (await import('../services/api')).default
const {
  clearHitokotoConfigCache,
  fetchHitokotoConfig,
  HITOKOTO_CONFIG_UPDATED_EVENT,
} = await import('./quote')

const realGet = apiService.get
after(() => {
  apiService.get = realGet
  clearHitokotoConfigCache()
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

/** 替换 apiService.get，记录调用次数并返回指定 sourceId */
function stubConfig(sourceId: string) {
  const state = { calls: 0 }
  apiService.get = (async () => {
    state.calls += 1
    return { success: true, config: { sourceId } }
  }) as typeof apiService.get
  return state
}

describe('fetchHitokotoConfig 去重', () => {
  beforeEach(() => {
    apiService.get = realGet
    clearHitokotoConfigCache()
  })

  it('多个调用方在 TTL 内只回源一次', async () => {
    const stub = stubConfig('hitokoto-anime')

    const first = await fetchHitokotoConfig()
    const second = await fetchHitokotoConfig()
    const third = await fetchHitokotoConfig()

    assert.equal(stub.calls, 1, '三次读取应只有一次网络请求')
    assert.equal(first.sourceId, 'hitokoto-anime')
    assert.equal(second.sourceId, 'hitokoto-anime')
    assert.equal(third.sourceId, 'hitokoto-anime')
  })

  it('并发调用合并为同一次在途请求', async () => {
    const stub = stubConfig('quotable-en')

    const results = await Promise.all([
      fetchHitokotoConfig(),
      fetchHitokotoConfig(),
      fetchHitokotoConfig(),
    ])

    assert.equal(stub.calls, 1, '并发读取应合并成一次请求')
    for (const r of results) assert.equal(r.sourceId, 'quotable-en')
  })

  it('TTL 到期后重新回源，未到期仍复用配置', async context => {
    context.mock.timers.enable({ apis: ['Date'] })
    const stub = stubConfig('hitokoto-cn')
    await fetchHitokotoConfig()
    context.mock.timers.setTime(5 * 60 * 1000 - 1)
    await fetchHitokotoConfig()
    assert.equal(stub.calls, 1)
    context.mock.timers.setTime(5 * 60 * 1000 + 1)
    await fetchHitokotoConfig()
    assert.equal(stub.calls, 2)
  })

  it('force 绕过缓存（配置编辑器要权威值）', async () => {
    const stub = stubConfig('hitokoto-cn')

    await fetchHitokotoConfig()
    await fetchHitokotoConfig({ force: true })

    assert.equal(stub.calls, 2, 'force 必须真的回源')
  })

  it('force 拿到的新值会写回缓存', async () => {
    const stale = stubConfig('hitokoto-cn')
    await fetchHitokotoConfig()
    assert.equal(stale.calls, 1)

    const fresh = stubConfig('meigen-ja')
    const forced = await fetchHitokotoConfig({ force: true })
    assert.equal(forced.sourceId, 'meigen-ja')

    // 后续普通读取应命中刚写回的新值，不再回源
    const cached = await fetchHitokotoConfig()
    assert.equal(cached.sourceId, 'meigen-ja')
    assert.equal(fresh.calls, 1, 'force 之后的普通读取不该再回源')
  })

  it('请求失败不会把失败状态缓存住', async () => {
    let calls = 0
    apiService.get = (async () => {
      calls += 1
      throw new Error('boom')
    }) as typeof apiService.get

    await assert.rejects(() => fetchHitokotoConfig())
    await assert.rejects(() => fetchHitokotoConfig())

    assert.equal(calls, 2, '失败后下次读取必须重新回源')
  })

  it('配置更新事件带 detail 时直接采纳，不回源', async () => {
    const stub = stubConfig('hitokoto-cn')
    await fetchHitokotoConfig()
    assert.equal(stub.calls, 1)

    windowShim.dispatchEvent(
      new CustomEvent(HITOKOTO_CONFIG_UPDATED_EVENT, {
        detail: { sourceId: 'hitokoto-anime' },
      }),
    )

    const after = await fetchHitokotoConfig()
    assert.equal(after.sourceId, 'hitokoto-anime', '应采纳事件里的新配置')
    assert.equal(stub.calls, 1, '事件带了权威值就不该再回源')
  })

  it('配置更新事件不带 detail 时清空缓存', async () => {
    const stub = stubConfig('hitokoto-cn')
    await fetchHitokotoConfig()
    assert.equal(stub.calls, 1)

    windowShim.dispatchEvent(new CustomEvent(HITOKOTO_CONFIG_UPDATED_EVENT))

    await fetchHitokotoConfig()
    assert.equal(stub.calls, 2, '没有权威值时必须重新回源')
  })
})

describe('configuration invalidation owns pending results', () => {
  beforeEach(() => clearHitokotoConfigCache())

  it('an update event remains authoritative when an earlier read completes', async () => {
    const held = Promise.withResolvers<{ config: { sourceId: string } }>()
    let calls = 0
    apiService.get = (() => { calls++; return held.promise }) as typeof apiService.get
    const old = fetchHitokotoConfig()
    windowShim.dispatchEvent(new CustomEvent(HITOKOTO_CONFIG_UPDATED_EVENT, { detail: { sourceId: 'meigen-ja' } }))
    held.resolve({ config: { sourceId: 'hitokoto-cn' } })
    await old
    assert.equal((await fetchHitokotoConfig()).sourceId, 'meigen-ja')
    assert.equal(calls, 1)
  })

  it('forced reads can replace in-flight reads without a late result overwriting them', async () => {
    const old = Promise.withResolvers<{ config: { sourceId: string } }>()
    const fresh = Promise.withResolvers<{ config: { sourceId: string } }>()
    let calls = 0
    apiService.get = (() => ++calls === 1 ? old.promise : fresh.promise) as typeof apiService.get
    const first = fetchHitokotoConfig()
    const forced = fetchHitokotoConfig({ force: true })
    fresh.resolve({ config: { sourceId: 'meigen-ja' } })
    await forced
    old.resolve({ config: { sourceId: 'hitokoto-cn' } })
    await first
    assert.equal((await fetchHitokotoConfig()).sourceId, 'meigen-ja')
    assert.equal(calls, 2)
  })

  it('a cleared read finishing cannot remove the new in-flight request', async () => {
    const old = Promise.withResolvers<{ config: { sourceId: string } }>()
    const fresh = Promise.withResolvers<{ config: { sourceId: string } }>()
    let calls = 0
    apiService.get = (() => ++calls === 1 ? old.promise : fresh.promise) as typeof apiService.get
    const first = fetchHitokotoConfig()
    clearHitokotoConfigCache()
    const second = fetchHitokotoConfig()
    old.reject(new Error('old request failed'))
    await assert.rejects(first)
    const third = fetchHitokotoConfig()
    fresh.resolve({ config: { sourceId: 'meigen-ja' } })
    await Promise.all([second, third])
    assert.equal(calls, 2)
  })
})

describe('quote request ownership', () => {
  beforeEach(() => {
    clearHitokotoConfigCache()
    storage.clear()
  })

  it('cancels a consumer waiting for shared configuration without starting transport', async t => {
    const { getRandomQuote } = await import('./quote')
    const config = Promise.withResolvers<{ config: { sourceId: string } }>()
    apiService.get = (() => config.promise) as typeof apiService.get
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json({ hitokoto: 'unused' }))
    const owner = new AbortController()
    const request = getRandomQuote('en-US', owner.signal)
    owner.abort()
    await assert.rejects(request, { name: 'AbortError' })
    config.resolve({ config: { sourceId: 'hitokoto-cn' } })
    await fetchHitokotoConfig()
    assert.equal(fetchMock.mock.callCount(), 0)
  })

  it('late response parsing after cancellation cannot repopulate quote storage', async t => {
    const { getRandomQuote } = await import('./quote')
    stubConfig('hitokoto-cn')
    const body = Promise.withResolvers<{ hitokoto: string }>()
    const started = Promise.withResolvers<void>()
    t.mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: () => { started.resolve(); return body.promise },
    }) as Response)
    const owner = new AbortController()
    const request = getRandomQuote('en-US', owner.signal)
    await started.promise
    owner.abort()
    body.resolve({ hitokoto: 'obsolete' })
    await assert.rejects(request, { name: 'AbortError' })
    assert.equal(storage.has('quote_cache'), false)
    assert.equal(storage.has('quote_cache_time'), false)
    assert.equal(storage.has('quote_cache_source'), false)
  })

  it('an active consumer still publishes and caches a successful response', async t => {
    const { getRandomQuote } = await import('./quote')
    stubConfig('hitokoto-cn')
    t.mock.method(globalThis, 'fetch', async () => Response.json({ hitokoto: 'current', from: 'author' }))
    const quote = await getRandomQuote('en-US', new AbortController().signal)
    assert.deepEqual(quote, { text: 'current', author: 'author' })
    assert.deepEqual(JSON.parse(storage.get('quote_cache')!), quote)
  })
})

describe('optional quote persistence', () => {
  beforeEach(() => { clearHitokotoConfigCache(); storage.clear(); stubConfig('hitokoto-cn') })

  for (const failure of ['getItem', 'setItem', 'json'] as const) {
    it(`retains network content when persistence fails: ${failure}`, async t => {
      const { BUILTIN_HITOKOTO_SOURCES, getRandomQuote } = await import('./quote')
      if (failure === 'json') {
        storage.set('quote_cache', '{broken')
        storage.set('quote_cache_time', String(Date.now()))
        storage.set('quote_cache_source', BUILTIN_HITOKOTO_SOURCES['hitokoto-cn'].url)
      } else {
        t.mock.method(localStorage, failure, () => { throw new Error('storage unavailable') })
      }
      t.mock.method(globalThis, 'fetch', async () => Response.json({ hitokoto: 'network result' }))
      assert.equal((await getRandomQuote('en-US'))?.text, 'network result')
    })
  }

  it('publishes a confirmed configuration save even if old persistent data cannot be removed', async t => {
    const { updateHitokotoConfig } = await import('./quote')
    t.mock.method(apiService, 'put', async () => ({ success: true, config: { sourceId: 'meigen-ja' } }))
    t.mock.method(localStorage, 'removeItem', () => { throw new Error('storage unavailable') })
    let notified = 0
    const listener = () => { notified++ }
    windowShim.addEventListener(HITOKOTO_CONFIG_UPDATED_EVENT, listener)
    try {
      assert.equal((await updateHitokotoConfig({ sourceId: 'meigen-ja' })).sourceId, 'meigen-ja')
      assert.equal(notified, 1)
      assert.equal((await fetchHitokotoConfig()).sourceId, 'meigen-ja')
    } finally {
      windowShim.removeEventListener(HITOKOTO_CONFIG_UPDATED_EVENT, listener)
    }
  })
})
