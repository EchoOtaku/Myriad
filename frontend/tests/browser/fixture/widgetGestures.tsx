import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useWidgetGestures } from '../../../src/components/ControlPanel/useWidgetGestures'

let edits = 0
const rowChanges: string[] = []
function Probe() {
  const [visible, setVisible] = useState(true)
  const [admin, setAdmin] = useState(true)
  const [editing, setEditing] = useState(false)
  const [rows, setRows] = useState(2)
  const [page, setPage] = useState(0)
  const [version, setVersion] = useState('old')
  const gestures = useWidgetGestures({ visible, isAdmin: admin, editing, rows, page, maxPage: 2,
    onEdit: () => { edits++; setEditing(true) },
    onPrepareEdit: () => {},
    onRows: value => { rowChanges.push(`${version}:${value}`); setRows(value) },
    onPage: setPage,
  })
  return <>
    <button onClick={() => setVisible(value => !value)}>Toggle visibility</button>
    <button onClick={() => setAdmin(value => !value)}>Toggle admin</button>
    <button onClick={() => setEditing(true)}>Edit</button>
    <button onClick={() => setVersion('new')}>Change callback</button>
    <div data-press onMouseDown={gestures.handleMouseDown} onMouseUp={gestures.handleMouseUp} onTouchCancel={gestures.handleMouseUp}>Press</div>
    <div data-drag onMouseDown={gestures.handleResizeStart}>Drag</div>
    <div data-wheel onWheel={gestures.handleWheel}>Wheel</div>
    <output data-page>{page}</output><output data-rows>{rows}</output>
  </>
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Probe /></StrictMode>)
Object.assign(window, { widgetGesturesFixture: {
  unmount: () => root.unmount(),
  snapshot: () => ({ edits, rowChanges }),
} })
