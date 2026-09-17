import assert from 'node:assert/strict'
import { it, mock } from 'node:test'
import { connectSourceUpdates } from './sourceConnection'

it('coalesces error/close, ignores stale messages, and cancels reconnect on disposal', () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const sockets: Array<{ onclose: (() => void) | null; close: () => void; message: () => void; error: () => void }> = []
  let refreshed = 0
  const dispose = connectSourceUpdates((message, error) => {
    const socket = { onclose: null as (() => void) | null, close() { this.onclose?.() }, message, error }
    sockets.push(socket)
    return socket
  }, () => refreshed++)
  sockets[0].error()
  sockets[0].onclose?.()
  mock.timers.tick(5000)
  assert.equal(sockets.length, 2)
  sockets[0].message()
  assert.equal(refreshed, 0)
  sockets[1].message()
  assert.equal(refreshed, 1)
  sockets[1].error()
  dispose()
  sockets[1].message()
  mock.timers.tick(10000)
  assert.equal(sockets.length, 2)
  assert.equal(refreshed, 1)
  mock.timers.reset()
})
