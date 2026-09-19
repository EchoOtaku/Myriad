import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { usePublicUiConfig } from '../../../src/hooks/usePublicUiConfig'
import { clearDedupCache } from '../../../src/utils/requestDedup'

const requests: Array<(response: Response) => void> = []
window.fetch = () => new Promise<Response>(resolve => requests.push(resolve))
Object.assign(window, { publicUiFixture: {
  count: () => requests.length,
  finish: (index: number, value: string, failed = false) => requests[index](Response.json({ value }, { status: failed ? 500 : 200 })),
  reload: () => {
    clearDedupCache()
    window.dispatchEvent(new Event('fixtureConfigChanged'))
  },
} })
function Consumer({ id }: { id: string }) {
  const config = usePublicUiConfig<{ value: string }>('fixtureConfigChanged')
  return <output data-config={id}>{config?.value ?? 'initial'}</output>
}
function Fixture() {
  const [mounted, setMounted] = useState(true)
  return <><button onClick={() => setMounted(value => !value)}>Toggle consumers</button>{mounted && <><Consumer id="a" /><Consumer id="b" /></>}</>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
