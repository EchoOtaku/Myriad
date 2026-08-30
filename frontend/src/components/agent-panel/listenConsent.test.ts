import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getListenConsent,
  getServerListenConsent,
  setListenConsent,
  subscribeListenConsent,
} from './listenConsent'

test('continuous listen is off until the person turns it on', () => {
  assert.equal(getListenConsent(), false)
  assert.equal(getServerListenConsent(), false)

  const seen: boolean[] = []
  const stop = subscribeListenConsent(() => seen.push(getListenConsent()))
  try {
    setListenConsent(true)
    assert.equal(getListenConsent(), true)
    setListenConsent(true)
    setListenConsent(false)
    assert.equal(getListenConsent(), false)
  } finally {
    stop()
    setListenConsent(false)
  }

  // Repeated writes of the same value do not wake subscribers.
  assert.deepEqual(seen, [true, false])
})

test('the server never grants listen consent on the person behalf', () => {
  setListenConsent(true)
  try {
    assert.equal(getServerListenConsent(), false)
  } finally {
    setListenConsent(false)
  }
})
