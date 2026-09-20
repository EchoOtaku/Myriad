import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import apiService from '../services/api'
import { apiRequest } from '../tapp/services/TappHttpClient'
import { ensureSessionStoragePolyfill } from '../test/sessionStoragePolyfill'
import { authSubject } from './authSubject'
import { clearCSRFToken } from './csrf'
import { HOST_SESSION_RECHECK_EVENT, notifyHostSessionFailure } from './hostSessionFailure'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const originalFetch = globalThis.fetch
let checks = 0
beforeEach(() => {
  checks = 0
  ensureSessionStoragePolyfill()
  Object.defineProperty(globalThis, 'localStorage', { value: sessionStorage, configurable: true })
  const window = Object.assign(new EventTarget(), { location: { origin: 'https://myriad.test' } })
  window.addEventListener(HOST_SESSION_RECHECK_EVENT, () => checks++)
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true })
})
afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalLocal) Object.defineProperty(globalThis, 'localStorage', originalLocal)
  else Reflect.deleteProperty(globalThis, 'localStorage')
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

for (const [name, request] of [['fetch', () => apiService.get('/private')], ['TAPP', () => apiRequest('/api/private')]] as const) {
  test(`${name} requests session validation on 401 without masking the request error`, async () => {
    globalThis.fetch = async () => Response.json({ error: 'Unauthorized' }, { status: 401 })
    await assert.rejects(request(), (error: any) => { assert.equal(error.status, 401, String(error)); return true })
    assert.equal(checks, 1)
  })
}

test('runtime grants, forbidden responses, and late old-subject failures do not invalidate the current host', () => {
  const old = authSubject.signal
  notifyHostSessionFailure(401, { code: 'INVALID_RUNTIME_GRANT' }, old)
  notifyHostSessionFailure(403, {}, old)
  assert.equal(checks, 0)
  authSubject.change('replacement', true)
  notifyHostSessionFailure(401, {}, old)
  assert.equal(checks, 0)
  notifyHostSessionFailure(401, {}, authSubject.signal)
  assert.equal(checks, 1)
})

test('a disposed TAPP operation cannot dispatch a mutation after waiting for CSRF', async () => {
  clearCSRFToken()
  const held = Promise.withResolvers<Response>()
  const entered = Promise.withResolvers<void>()
  const controller = new AbortController()
  let writes = 0
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('csrf-token')) { entered.resolve(); return held.promise }
    if (init?.method === 'POST') writes++
    return Response.json({ success: true })
  }
  const pending = apiRequest('/api/tapps/example/start', { method: 'POST', signal: controller.signal })
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await entered.promise
  controller.abort()
  await rejected
  held.resolve(Response.json({ csrf_token: null }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(writes, 0)
  clearCSRFToken()
})
