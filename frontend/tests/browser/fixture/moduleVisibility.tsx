import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import apiService from '../../../src/services/api'
import {
  dispatchModuleVisibilityPreferencesUpdated,
  normalizeModuleVisibilityPreferences,
  useModuleVisibilityPreferences,
} from '../../../src/utils/moduleVisibility'

const requests: Array<(value: unknown) => void> = []
Object.assign(apiService, { get: () => new Promise(resolve => requests.push(resolve)) })
Object.assign(window, { moduleVisibilityFixture: {
  count: () => requests.length,
  finish: (index: number, journalSourceSort: string) => requests[index]({ preferences: { journalSourceSort } }),
  update: (journalSourceSort: string) => dispatchModuleVisibilityPreferencesUpdated(normalizeModuleVisibilityPreferences({ journalSourceSort })),
} })
function Consumer({ id }: { id: string }) {
  const { preferences, isLoading, reload } = useModuleVisibilityPreferences()
  return <section><output data-consumer={id}>{isLoading ? 'loading' : preferences.journalSourceSort}</output><button onClick={() => void reload()}>Reload {id}</button></section>
}
function Fixture() {
  const [mounted, setMounted] = useState(true)
  return <><button onClick={() => setMounted(value => !value)}>Toggle consumers</button>{mounted && <><Consumer id="a" /><Consumer id="b" /></>}</>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>)
