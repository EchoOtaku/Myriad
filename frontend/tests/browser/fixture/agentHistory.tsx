import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useConversationHistory } from '../../../src/components/agent-panel/conversationHistory'
import { AgentPresenceList } from '../../../src/components/agent-panel/useAgentPresence'
import { useConversationPan } from '../../../src/components/agent-panel/useConversationPan'

function History({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount)
  const ids = Array.from({ length: count }, (_, i) => String(i))
  const viewport = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const { visibleIds, onNearStart } = useConversationHistory(ids)
  useConversationPan(
    viewport,
    track,
    true,
    'history',
    '.agent-panel-message',
    onNearStart,
  )
  return (
    <><button style={{ position: 'fixed', right: 0, top: 0, zIndex: 10 }} onClick={() => setCount(value => value + 20)}>Append</button>
    <div ref={viewport} style={{ height: 200, overflow: 'hidden' }}>
      <div ref={track} data-testid="track" style={{ position: 'relative' }}>
        <AgentPresenceList retainRemoved={false} items={visibleIds} keyOf={(id) => id}>
          {(id) => (
            <div
              className="agent-panel-message"
              data-message-id={id}
              style={{ height: 100 }}
            >
              {id}
            </div>
          )}
        </AgentPresenceList>
      </div>
    </div></>
  )
}

export function mountAgentHistory(initialCount = 80) {
  createRoot(document.getElementById('root')!).render(<History initialCount={initialCount} />)
}
