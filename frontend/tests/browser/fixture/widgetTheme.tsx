import { useLayoutEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useWidgetTheme } from '../../../src/hooks/useWidgetTheme'
import { authSubject } from '../../../src/utils/authSubject'

function Reader({ id }: { id: string }) {
  const { surface, glow } = useWidgetTheme()
  return <output data-reader={id}>{surface}/{glow}</output>
}
function Editor() {
  const { setSurface, setGlowMode } = useWidgetTheme()
  useLayoutEffect(() => { setSurface('solid') }, [setSurface])
  return <><button onClick={() => setSurface('outline', 'fixture-token')}>Save outline</button><button onClick={() => authSubject.change('next', true)}>Change subject</button><button onClick={() => setSurface('outline')}>Outline</button><button onClick={() => { setSurface('glass'); setGlowMode('identity') }}>Defaults</button></>
}
function Fixture() {
  const [late, setLate] = useState(false)
  return <><Reader id="early" /><Editor /><button onClick={() => setLate(value => !value)}>Toggle reader</button>{late && <Reader id="late" />}</>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
