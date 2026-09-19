import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useWelcomeTime, welcomeGreetingKey } from '../../../src/components/widgets/useWelcomeTime'

function Clock() {
  const now = useWelcomeTime()
  return <output>{now.getDate()}:{welcomeGreetingKey(now.getHours())}</output>
}
function Fixture() {
  const [mounted, setMounted] = useState(true)
  return <><button onClick={() => setMounted(value => !value)}>Toggle</button>{mounted && <Clock />}</>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
