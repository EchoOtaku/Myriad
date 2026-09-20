import { createRoot } from 'react-dom/client'
import { AgentSessionHost } from '../../../src/components/agent-panel/AgentSessionHost'
import { initPageLoader, markDocumentReady } from '../../../src/utils/pageLoader'

export function mount() {
  initPageLoader()
  const root = createRoot(document.getElementById('app-root')!)
  root.render(<AgentSessionHost><span id="session-ready">Session mounted</span></AgentSessionHost>)
  return { ready: markDocumentReady, unmount: () => root.unmount() }
}
