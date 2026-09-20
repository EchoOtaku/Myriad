import assert from 'node:assert/strict'
import { it } from 'node:test'
import { watchPanelTransition } from './panelTransitionCompletion'

function shell() { return new EventTarget() as unknown as HTMLElement }
function end(element: HTMLElement, propertyName = 'width', target: EventTarget = element) {
  const event = new Event('transitionend')
  Object.defineProperties(event, { propertyName: { value: propertyName }, target: { value: target } })
  element.dispatchEvent(event)
}
it('completes once for shell width and cancels its fallback', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const element = shell()
  let completed = 0
  const stop = watchPanelTransition(element, true, 600, () => completed++)
  end(element, 'opacity')
  end(element, 'width', new EventTarget())
  assert.equal(completed, 0)
  end(element)
  end(element)
  t.mock.timers.tick(1000)
  stop()
  assert.equal(completed, 1)
})
it('cancellation cannot announce completion or affect its replacement', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const element = shell()
  let old = 0
  let current = 0
  const stop = watchPanelTransition(element, true, 600, () => old++)
  stop()
  const stopCurrent = watchPanelTransition(element, true, 600, () => current++)
  end(element)
  t.mock.timers.tick(1000)
  stopCurrent()
  assert.equal(old, 0)
  assert.equal(current, 1)
})
it('non-spatial motion waits for its existing fallback duration', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const element = shell()
  let completed = 0
  const stop = watchPanelTransition(element, false, 180, () => completed++)
  end(element)
  t.mock.timers.tick(179)
  assert.equal(completed, 0)
  t.mock.timers.tick(1)
  assert.equal(completed, 1)
  stop()
})
