import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useBreakpoints, useDesktopLayoutBand } from '../../../src/hooks/useBreakpoints'
import { useMediaQuery } from '../../../src/hooks/useMediaQuery'
import { useDebouncedWindowSize, useSharedResize } from '../../../src/hooks/useSharedEventListener'
import { sharedEventManager } from '../../../src/utils/sharedEventManager'

function Probe() {
  const [query, setQuery] = useState('(min-width: 1000px)')
  const queryMatches = useMediaQuery(query)
  const [enabled, setEnabled] = useState(true)
  const [immediate, setImmediate] = useState(0)
  const [debounced, setDebounced] = useState(0)
  const [delay, setDelay] = useState(500)
  const size = useDebouncedWindowSize(delay, enabled)
  useSharedResize(() => setDebounced(value => value + 1), { enabled, debounce: delay })
  useSharedResize(() => setImmediate(value => value + 1))
  const bands = useBreakpoints()
  const desktop = useDesktopLayoutBand()
  return <>
    <button onClick={() => setQuery('(min-width: 800px)')}>Change query</button>
    <output data-query>{String(queryMatches)}</output>
    <button onClick={() => setEnabled(value => !value)}>Toggle subscription</button>
    <button onClick={() => setDelay(100)}>Change delay</button>
    <output data-enabled>{String(enabled)}</output>
    <output data-immediate>{immediate}</output>
    <output data-debounced>{debounced}</output>
    <output data-width>{size.width}</output>
    <output data-mobile>{String(bands.isMobile)}</output>
    <output data-desktop>{String(desktop)}</output>
  </>
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Probe /></StrictMode>)
Object.assign(window, { sharedEventsFixture: { unmount: () => root.unmount(), stats: () => sharedEventManager.getStats() } })
