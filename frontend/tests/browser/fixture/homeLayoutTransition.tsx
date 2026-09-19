import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useHomeLayoutTransition } from '../../../src/components/home/useHomeLayoutTransition'

let frameId = 0
const frames = new Map<number, FrameRequestCallback>()
window.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId }
window.cancelAnimationFrame = id => { frames.delete(id) }
const commits: string[] = []
function Probe() {
  const [version, setVersion] = useState('old')
  const [mode, setMode] = useState<'standard' | 'free'>('standard')
  const { layoutFade, transitionTo } = useHomeLayoutTransition(next => {
    commits.push(`${version}:${next}`)
    setMode(next)
  })
  return <>
    <button data-toggle onClick={() => transitionTo(mode === 'free' ? 'standard' : 'free')}>Toggle</button>
    <button onClick={() => setVersion('new')}>Replace callback</button>
    <output data-phase>{layoutFade ?? 'idle'}</output><output data-mode>{mode}</output>
  </>
}
const root = createRoot(document.getElementById('root')!)
root.render(<StrictMode><Probe /></StrictMode>)
Object.assign(window, { homeTransitionFixture: {
  frame: () => {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(performance.now())
  },
  snapshot: () => ({ commits, frames: frames.size }),
  unmount: () => root.unmount(),
} })
