import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { describe, it } from 'node:test'

import {
  canStampDevHtml,
  finishBufferedHttpBody,
  isBackendUnreachableError,
  isClientAbortError,
  shouldRetryBackendProxy,
  writeDevProxyFailure,
} from '../../scripts/devServerResponse.mjs'

function mockRes({
  headersSent = false,
  writableEnded = false,
  destroyed = false,
  statusCode = 200,
  contentType = 'text/html; charset=utf-8',
} = {}) {
  const headers = new Map()
  if (contentType) headers.set('content-type', contentType)
  return {
    headersSent,
    writableEnded,
    destroyed,
    statusCode,
    getHeader(name) {
      return headers.get(String(name).toLowerCase())
    },
    setHeader(name, value) {
      if (this.headersSent) {
        throw new Error('ERR_HTTP_HEADERS_SENT')
      }
      headers.set(String(name).toLowerCase(), value)
    },
    end(body) {
      this.writableEnded = true
      this.body = body
    },
  }
}

describe('isClientAbortError', () => {
  it('recognizes abort shapes and ignores refused sockets', () => {
    assert.equal(isClientAbortError(new Error('aborted')), true)
    const named = new Error('The operation was aborted.')
    named.name = 'AbortError'
    assert.equal(isClientAbortError(named), true)
    const coded = new Error('late')
    coded.code = 'ABORT_ERR'
    assert.equal(isClientAbortError(coded), true)
    const refused = new Error('connect ECONNREFUSED 127.0.0.1:1103')
    refused.code = 'ECONNREFUSED'
    assert.equal(isClientAbortError(refused), false)
    assert.equal(isClientAbortError(new Error('socket hang up')), false)
  })
})

describe('shouldRetryBackendProxy', () => {
  it('retries transient GET failures only', () => {
    const reset = new Error('socket hang up')
    reset.code = 'ECONNRESET'
    assert.equal(
      shouldRetryBackendProxy(reset, { retryable: true, attempt: 0 }),
      true,
    )
    const refused = new Error('connect ECONNREFUSED 127.0.0.1:1103')
    refused.code = 'ECONNREFUSED'
    assert.equal(
      shouldRetryBackendProxy(refused, { retryable: true, attempt: 0 }),
      false,
    )
    assert.equal(
      shouldRetryBackendProxy(reset, { retryable: true, attempt: 3 }),
      false,
    )
    assert.equal(
      shouldRetryBackendProxy(reset, { retryable: false, attempt: 0 }),
      false,
    )
    assert.equal(isBackendUnreachableError(refused), true)
  })
})

describe('canStampDevHtml / finishBufferedHttpBody', () => {
  it('stamps only uncommitted 200 HTML', () => {
    const raw = Buffer.from('<html></html>')
    assert.equal(canStampDevHtml(mockRes(), raw), true)
    assert.equal(canStampDevHtml(mockRes({ headersSent: true }), raw), false)
    assert.equal(canStampDevHtml(mockRes({ statusCode: 500 }), raw), false)
    assert.equal(
      canStampDevHtml(mockRes({ contentType: 'application/json' }), raw),
      false,
    )
  })

  it('does not setHeader after Vite already writeHead-ed', () => {
    const res = mockRes({ headersSent: true })
    let ended
    const status = finishBufferedHttpBody(
      res,
      (body, callback) => {
        ended = body
        if (typeof callback === 'function') callback()
      },
      Buffer.from('ok'),
    )
    assert.equal(status, 'passthrough')
    assert.equal(String(ended), 'ok')
    assert.equal(res.getHeader('content-length'), undefined)
  })

  it('sets Content-Length only when headers are still mutable', () => {
    const res = mockRes()
    const body = Buffer.from('hello')
    assert.equal(finishBufferedHttpBody(res, () => {}, body), 'length')
    assert.equal(res.getHeader('content-length'), 5)
  })
})

describe('writeDevProxyFailure', () => {
  it('skips a second body after headers are committed', () => {
    const res = mockRes({ headersSent: true })
    assert.equal(writeDevProxyFailure(res, new Error('connect ECONNREFUSED')), 'already-sent')
    assert.equal(res.writableEnded, true)
    assert.equal(res.body, undefined)
  })

  it('writes a 502 JSON body when the response is still open', () => {
    const res = mockRes({ contentType: '' })
    assert.equal(writeDevProxyFailure(res, new Error('connect ECONNREFUSED')), 'wrote')
    assert.equal(res.statusCode, 502)
    assert.equal(res.getHeader('content-type'), 'application/json')
    assert.match(String(res.body), /Backend proxy failed/)
  })
})
