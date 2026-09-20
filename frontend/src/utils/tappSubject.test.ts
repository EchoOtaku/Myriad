import assert from 'node:assert/strict'
import test from 'node:test'
import { beginTappSubjectChange, finishTappSubjectChange, getTappSubjectSnapshot } from './tappSubject'

test('a superseded cleanup cannot announce a newer subject as ready', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const events: boolean[] = []
  const window = new EventTarget()
  window.addEventListener('tapp-subject-ready', event => events.push((event as CustomEvent).detail.isAuthenticated))
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true })
  try {
    const old = beginTappSubjectChange()
    const current = beginTappSubjectChange()
    finishTappSubjectChange(old, true)
    assert.equal(getTappSubjectSnapshot().ready, false)
    assert.deepEqual(events, [])
    finishTappSubjectChange(current, false)
    assert.equal(getTappSubjectSnapshot().ready, true)
    assert.deepEqual(events, [false])
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
