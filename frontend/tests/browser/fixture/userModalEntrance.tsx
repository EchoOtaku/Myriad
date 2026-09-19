import { StrictMode, Suspense, use, useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { UserModalEntrance } from '../../../src/components/ControlPanel/UserModalEntrance'

const pending = Promise.withResolvers<void>()
function Content() { use(pending.promise); return <div data-content>Ready content</div> }
function Fixture() {
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(0)
  const onReady = useCallback(() => setReady(value => value + 1), [])
  return <><button onClick={() => setOpen(true)}>Open</button><button onClick={() => setOpen(false)}>Close</button><button onClick={() => pending.resolve()}>Release</button><output>{ready}</output>{open && <Suspense fallback={<span>Loading</span>}><UserModalEntrance onReady={onReady}><Content /></UserModalEntrance></Suspense>}</>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
