/**
 * Dev / preview HTTP helpers. Vite may writeHead before our wrappers see
 * res.end; Node then throws ERR_HTTP_HEADERS_SENT if we setHeader again.
 */

export function isClientAbortError(error) {
  if (error == null) return false
  if (error.name === 'AbortError') return true
  if (error.code === 'ABORT_ERR') return true
  const message = String(error.message || error)
  return message === 'aborted' || /operation was aborted/i.test(message)
}

export function isBackendUnreachableError(error) {
  const code = error?.code
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH'
  )
}

export function shouldRetryBackendProxy(
  error,
  { retryable, attempt, maxAttempts = 3 } = {},
) {
  if (!retryable || attempt >= maxAttempts) return false
  if (isClientAbortError(error) || isBackendUnreachableError(error)) return false
  return true
}

export function isResponseOpen(res) {
  return Boolean(res) && !res.writableEnded && !res.destroyed
}

export function canStampDevHtml(res, raw) {
  return (
    isResponseOpen(res) &&
    !res.headersSent &&
    res.statusCode === 200 &&
    String(res.getHeader?.('content-type') || '').includes('text/html') &&
    raw != null &&
    raw.length > 0
  )
}

export function finishBufferedHttpBody(res, originalEnd, body, callback) {
  if (!isResponseOpen(res)) {
    if (typeof callback === 'function') callback()
    return 'ended'
  }
  if (!res.headersSent) {
    res.setHeader('Content-Length', body.length)
  }
  originalEnd(body, callback)
  return res.headersSent ? 'passthrough' : 'length'
}

export function writeDevProxyFailure(res, error) {
  if (!isResponseOpen(res)) return 'ended'
  if (res.headersSent) {
    res.end()
    return 'already-sent'
  }
  res.statusCode = 502
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('x-myriad-dev-proxy', 'http')
  res.end(
    JSON.stringify({
      error: 'Backend proxy failed',
      message: error instanceof Error ? error.message : String(error),
    }),
  )
  return 'wrote'
}
