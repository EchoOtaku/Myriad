import type { Root } from 'react-dom/client'
import type { WidgetComponentProps, WidgetConfig, WidgetType } from './widgetGridTypes'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { after, afterEach, beforeEach, it } from 'node:test'
import { act, createElement } from 'react'
import { WidgetGridItemBody } from './WidgetGridItemBody'

const require = createRequire(import.meta.url)
const { JSDOM } = require(require.resolve('jsdom', { paths: [require.resolve('isomorphic-dompurify')] }))
const dom = new JSDOM('<div id="root"></div>')
const prior = new Map<string, PropertyDescriptor | undefined>()
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
  prior.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, value })
}
const { createRoot } = await import('react-dom/client')
after(() => {
  dom.window.close()
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})
let root: Root
let renders = 0
function Probe({ config, onConfigChange }: WidgetComponentProps) {
  renders++
  return createElement('button', { onClick: () => onConfigChange?.({ changed: true }) }, `${config.size}:${config.config?.label}`)
}
const widgetType: WidgetType = { id: 'probe', name: 'Probe', defaultSize: '2x2', component: Probe }
const widget: WidgetConfig = { id: 'probe-1', type: 'probe', size: '2x2', position: { x: 0, y: 0 }, config: { label: 'before' } }
beforeEach(() => { renders = 0; root = createRoot(document.getElementById('root')!) })
afterEach(async () => { await act(async () => root.unmount()) })
async function render(config: WidgetConfig, onConfigChange?: (value: unknown) => void) {
  await act(async () => root.render(createElement(WidgetGridItemBody, { widget: config, widgetType, isEditMode: false, onConfigChange })))
}

it('updates the configuration callback even when visible widget data is unchanged', async () => {
  const owners: number[] = []
  await render(widget, () => owners.push(1))
  await act(async () => document.querySelector('button')!.click())
  const beforeCallbackChange = renders
  await render(widget, () => owners.push(2))
  assert.equal(renders, beforeCallbackChange)
  await act(async () => document.querySelector('button')!.click())
  assert.deepEqual(owners, [1, 2])
  await render(widget)
  await act(async () => document.querySelector('button')!.click())
  assert.deepEqual(owners, [1, 2])
})

it('keeps content stable for position-only moves but renders size and configuration changes', async () => {
  const save = () => {}
  await render(widget, save)
  const count = renders
  const node = document.querySelector('button')
  await render({ ...widget, position: { x: 1, y: 2 } }, save)
  assert.equal(renders, count)
  assert.equal(document.querySelector('button'), node)
  await render({ ...widget, size: '4x2', config: { label: 'after' } }, save)
  assert.equal(document.querySelector('button')!.textContent, '4x2:after')
  assert.equal(renders, count + 1)
})
