import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useWidgetLayout } from '../../../src/components/ControlPanel/useWidgetLayout'

const pending: Array<(response: Response) => void> = []
window.fetch = () => new Promise<Response>(resolve => pending.push(resolve))
Object.assign(window, { widgetLayoutFixture: {
  requests: () => pending.length,
  load: (empty: boolean) => pending[0](Response.json({
    control_panel_layout: JSON.stringify(empty ? [] : [{ id: 'saved', type: 'tapp:unregistered', size: '2x2', position: { x: 0, y: 0 } }]),
    control_panel_rows: 2,
  })),
} })
function Probe() {
  const { widgets, gridRows, editLayout } = useWidgetLayout('Failed to load layout')
  const [rerenders, setRerenders] = useState(0)
  return <>
    <output data-widgets>{widgets.map(widget => widget.id).join(',') || 'empty'}</output>
    <output data-rows>{gridRows}</output>
    <button onClick={() => editLayout([], 1)}>Edit layout</button>
    <button onClick={() => setRerenders(value => value + 1)}>Rerender {rerenders}</button>
  </>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Probe /></StrictMode>)
