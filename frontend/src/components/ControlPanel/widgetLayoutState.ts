import type { WidgetConfig } from '../widgetGridTypes'

export interface WidgetLayoutState {
  widgets: WidgetConfig[]
  rows: number
  edited: boolean
}
export function initialWidgetLayout(): WidgetLayoutState {
  return { rows: 2, edited: false, widgets: [
    { id: 'cp-weather', type: 'weather', size: '2x2', position: { x: 0, y: 0 } },
    { id: 'cp-quote', type: 'quote', size: '2x2', position: { x: 2, y: 0 } },
  ] }
}

export function decodeWidgetLayout(data: Record<string, unknown>) {
  let widgets: WidgetConfig[] | undefined
  let error: unknown
  if (typeof data.control_panel_layout === 'string' && data.control_panel_layout) {
    try {
      const parsed = JSON.parse(data.control_panel_layout)
      if (!Array.isArray(parsed)) throw new Error('Control panel layout must be an array')
      // Preserve unknown TAPP types and overflow; registry/packing only affect presentation.
      widgets = parsed
    } catch (caught) {
      error = caught
    }
  }
  const rawRows = data.control_panel_rows
  const rows = typeof rawRows === 'number' && Number.isInteger(rawRows) && rawRows > 0 ? rawRows : undefined
  return { widgets, rows, error }
}

type Action =
  | { type: 'loaded', widgets?: WidgetConfig[], rows?: number }
  | { type: 'edited', widgets: WidgetConfig[], rows?: number }

export function widgetLayoutReducer(state: WidgetLayoutState, action: Action): WidgetLayoutState {
  if (action.type === 'loaded' && state.edited) return state
  return {
    widgets: action.widgets ?? state.widgets,
    rows: action.rows ?? state.rows,
    edited: state.edited || action.type === 'edited',
  }
}
