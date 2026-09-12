import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  pickVisibleToasts,
  resolveToastEvent,
  showStickyToast,
  showToast,
  subscribeToast,
} from './toastManager'

test('showToast forwards replaceKey so a slot can replace instead of stack', () => {
  const seen: string[] = []
  const stop = subscribeToast((event) => {
    if (event.replaceKey) seen.push(event.replaceKey)
  })
  showToast({ message: 'saving', type: 'info', replaceKey: 'config' })
  showToast({ message: 'saved', type: 'success', replaceKey: 'config' })
  stop()
  assert.deepEqual(seen, ['config', 'config'])
})

test('resolveToastEvent persists only when sticky is declared', () => {
  const fromDuration = resolveToastEvent({ message: 'x', duration: 0 })
  assert.equal(fromDuration.sticky, false)
  assert.equal(fromDuration.duration, undefined)
  assert.equal(fromDuration.showCloseButton, undefined)

  const sticky = resolveToastEvent({
    message: 'x',
    sticky: true,
    duration: 8000,
    showCloseButton: false,
  })
  assert.equal(sticky.sticky, true)
  assert.equal(sticky.duration, undefined)
  assert.equal(sticky.showCloseButton, true)

  const timed = resolveToastEvent({ message: 'x', duration: 4000 })
  assert.equal(timed.sticky, false)
  assert.equal(timed.duration, 4000)
})

test('showStickyToast declares sticky and ignores duration', () => {
  const seen: Array<{ sticky?: boolean; duration?: number }> = []
  const stop = subscribeToast((event) => {
    seen.push({ sticky: event.sticky, duration: event.duration })
  })
  showStickyToast({ message: 'stay', type: 'error' })
  stop()
  assert.deepEqual(seen, [{ sticky: true, duration: undefined }])
})

test('pickVisibleToasts prefers sticky slots then newest ephemeral', () => {
  const visible = pickVisibleToasts(
    [
      { id: 'e1' },
      { id: 's1', sticky: true },
      { id: 'e2' },
      { id: 's2', sticky: true },
      { id: 'e3' },
      { id: 'e4' },
      { id: 's3', sticky: true },
    ],
    5,
  )
  assert.deepEqual(
    visible.map((toast) => toast.id),
    ['s1', 's2', 'e3', 'e4', 's3'],
  )
})

test('pickVisibleToasts keeps the newest sticky when they overflow the cap', () => {
  const visible = pickVisibleToasts(
    [
      { id: 's1', sticky: true },
      { id: 's2', sticky: true },
      { id: 's3', sticky: true },
      { id: 's4', sticky: true },
      { id: 's5', sticky: true },
      { id: 's6', sticky: true },
    ],
    5,
  )
  assert.deepEqual(
    visible.map((toast) => toast.id),
    ['s2', 's3', 's4', 's5', 's6'],
  )
})
