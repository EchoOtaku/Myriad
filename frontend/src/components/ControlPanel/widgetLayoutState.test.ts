import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeWidgetLayout, initialWidgetLayout, widgetLayoutReducer } from './widgetLayoutState'

test('persisted empty layout stays empty rather than restoring defaults', () => {
  const decoded = decodeWidgetLayout({ control_panel_layout: '[]', control_panel_rows: 1 })
  const state = widgetLayoutReducer(initialWidgetLayout(), { type: 'loaded', ...decoded })
  assert.deepEqual(state.widgets, [])
  assert.equal(state.rows, 1)
})

test('late initial configuration never overwrites a local layout and row edit', () => {
  const edit = widgetLayoutReducer(initialWidgetLayout(), { type: 'edited', widgets: [], rows: 1 })
  assert.equal(widgetLayoutReducer(edit, { type: 'loaded', ...initialWidgetLayout() }), edit)
  assert.equal(edit.rows, 1)
})

test('unknown TAPP tiles and overflowing positions remain in source data', () => {
  const widgets = [{ id: 'unknown', type: 'tapp:unknown', size: '4x4', position: { x: 8, y: 7 }, config: { custom: true } }]
  assert.deepEqual(decodeWidgetLayout({ control_panel_layout: JSON.stringify(widgets) }).widgets, widgets)
})

test('malformed layout preserves defaults while valid rows can still load', () => {
  const decoded = decodeWidgetLayout({ control_panel_layout: '{', control_panel_rows: 1 })
  assert.ok(decoded.error)
  const initial = initialWidgetLayout()
  const result = widgetLayoutReducer(initial, { type: 'loaded', ...decoded })
  assert.equal(result.widgets, initial.widgets)
  assert.equal(result.rows, 1)
  for (const rows of [0, -1, 1.5, NaN, '2']) {
    assert.equal(decodeWidgetLayout({ control_panel_rows: rows }).rows, undefined)
  }
})
